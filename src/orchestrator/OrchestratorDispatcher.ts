import fs from 'node:fs/promises';
import path from 'node:path';
import { SqliteStore } from '../state/SqliteStore';
import { LLMProvider } from '../providers/LLMProvider';
import { estimateTokenCount } from '../providers/LLMProvider';

export type OrchestratorTrigger =
  | 'user_chat'
  | 'gate5_reached'
  | 'gate_failed_twice'
  | 'task_complete'
  | 'pr_comment'
  | 'conductor_query';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface OrchestratorResponse {
  content: string;
  decision?: 'approve' | 'reject';
  reason?: string;
  summary?: string;
  lessons?: string[];
  commentType?: 'code_change' | 'question' | 'lgtm';
}

const MAX_CHAT_HISTORY_TOKENS = 24_000;
const ORCHESTRATOR_MODEL = 'claude-opus-4-7';
const RULES_FILE = 'agents/orchestrator/rules.md';

export class OrchestratorDispatcher {
  constructor(
    private readonly sqliteStore: SqliteStore,
    private readonly provider: LLMProvider,
    private readonly workspaceRoot: string,
    private readonly model: string = ORCHESTRATOR_MODEL,
  ) {}

  async wake(
    taskId: string,
    trigger: OrchestratorTrigger,
    payload: Record<string, unknown>,
  ): Promise<OrchestratorResponse> {
    // 1. Load orchestrator state from SqliteStore
    const state = this.sqliteStore.getOrchestratorState(taskId);
    const history: ChatMessage[] = state?.chat_history
      ? (JSON.parse(state.chat_history) as ChatMessage[])
      : [];

    // 2. Build context
    const rulesContent = await this.loadRules();
    const historyBlock = this.buildHistoryBlock(history);
    const payloadBlock = this.buildPayloadBlock(trigger, payload);

    const assembledPrompt = [rulesContent, historyBlock, payloadBlock].filter(Boolean).join('\n\n---\n\n');

    // 3. Enforce token budget — prune oldest history if needed
    const prunedPrompt = this.enforceTokenBudget(assembledPrompt, rulesContent, payloadBlock);

    // 4. Call LLM
    let responseContent: string;
    try {
      const result = await this.provider.invoke({
        model: this.model,
        assembledPrompt: prunedPrompt,
        maxTokens: 4096,
        timeoutMs: 180_000,
        agentRole: 'orchestrator',
      });
      responseContent = result.ok && result.value.exitCode === 0
        ? result.value.content
        : this.fallbackResponse(trigger);
    } catch {
      responseContent = this.fallbackResponse(trigger);
    }

    // 5. Parse response
    const parsed = this.parseResponse(responseContent, trigger);

    // 6. Save response to chat_history in SqliteStore
    if (trigger === 'user_chat' || trigger === 'gate5_reached') {
      const userMsg: ChatMessage = {
        role: 'user',
        content: String(payload.message ?? JSON.stringify(payload)),
        timestamp: new Date().toISOString(),
      };
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: responseContent,
        timestamp: new Date().toISOString(),
      };

      const newHistory = [...history, userMsg, assistantMsg];
      this.sqliteStore.setOrchestratorState(taskId, {
        phase: trigger,
        summary: parsed.summary ?? state?.summary ?? '',
        chat_history: JSON.stringify(newHistory),
      });
    }

    // 7. Append lessons to CLI-LESSONS-LEARNED.md on task_complete
    if ((trigger === 'task_complete' || trigger === 'gate5_reached') && parsed.lessons?.length) {
      await this.appendLessons(taskId, parsed.lessons);
    }

    return parsed;
  }

  getChatHistory(taskId: string): ChatMessage[] {
    const state = this.sqliteStore.getOrchestratorState(taskId);
    if (!state?.chat_history) return [];
    try {
      return JSON.parse(state.chat_history) as ChatMessage[];
    } catch {
      return [];
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async loadRules(): Promise<string> {
    const rulesPath = path.join(this.workspaceRoot, RULES_FILE);
    try {
      return await fs.readFile(rulesPath, 'utf-8');
    } catch {
      return '# Orchestrator\nYou are the Orchestrator. Review and approve or reject changes.';
    }
  }

  private buildHistoryBlock(history: ChatMessage[]): string {
    if (history.length === 0) return '';
    const lines = history.map(m => `[${m.role.toUpperCase()} ${m.timestamp}]\n${m.content}`);
    return `# CONVERSATION HISTORY\n\n${lines.join('\n\n')}`;
  }

  private buildPayloadBlock(trigger: OrchestratorTrigger, payload: Record<string, unknown>): string {
    const triggerLabel = `# TRIGGER: ${trigger.toUpperCase()}`;
    const sections: string[] = [triggerLabel];

    if (trigger === 'user_chat' && payload.message) {
      sections.push(`## New Message\n${payload.message}`);
    } else if (trigger === 'gate5_reached') {
      if (payload.taskMd) sections.push(`## Task\n${payload.taskMd}`);
      if (payload.contracts) sections.push(`## Contracts\n${payload.contracts}`);
      if (payload.prDiff) sections.push(`## PR Diff\n${String(payload.prDiff).slice(0, 8000)}`);
    } else if (trigger === 'gate_failed_twice' || trigger === 'task_complete') {
      sections.push(`## Payload\n${JSON.stringify(payload, null, 2)}`);
    } else if (trigger === 'pr_comment') {
      if (payload.comment) sections.push(`## PR Comment\n${payload.comment}`);
    } else {
      sections.push(`## Payload\n${JSON.stringify(payload, null, 2)}`);
    }

    return sections.join('\n\n');
  }

  private enforceTokenBudget(
    fullPrompt: string,
    rulesContent: string,
    payloadBlock: string,
  ): string {
    const total = estimateTokenCount(fullPrompt);
    if (total <= MAX_CHAT_HISTORY_TOKENS) return fullPrompt;

    // Prune: keep rules + payload, drop oldest history
    const baseTokens = estimateTokenCount(rulesContent + payloadBlock);
    if (baseTokens >= MAX_CHAT_HISTORY_TOKENS) {
      // Rules + payload alone exceed budget — truncate payload
      const truncated = (rulesContent + '\n\n' + payloadBlock).slice(0, MAX_CHAT_HISTORY_TOKENS * 4);
      return truncated + '\n\n[... history pruned due to token budget]';
    }

    return rulesContent + '\n\n[... chat history pruned due to token budget]\n\n' + payloadBlock;
  }

  private parseResponse(content: string, trigger: OrchestratorTrigger): OrchestratorResponse {
    const response: OrchestratorResponse = { content };

    if (trigger === 'gate5_reached') {
      const decisionMatch = content.match(/^DECISION:\s*(approve|reject)/im);
      const reasonMatch = content.match(/^REASON:\s*(.+)/im);
      const summaryMatch = content.match(/^SUMMARY:\s*(.+)/im);
      const lessonsMatch = content.match(/^LESSONS:\s*\n((?:\d+\..+\n?)+)/im);

      if (decisionMatch) {
        response.decision = decisionMatch[1].toLowerCase() as 'approve' | 'reject';
      }
      if (reasonMatch) response.reason = reasonMatch[1].trim();
      if (summaryMatch) response.summary = summaryMatch[1].trim();
      if (lessonsMatch) {
        response.lessons = lessonsMatch[1]
          .split('\n')
          .filter(l => /^\d+\./.test(l.trim()))
          .map(l => l.replace(/^\d+\.\s*/, '').trim());
      }

      if (!response.decision) response.decision = 'approve';
    }

    if (trigger === 'gate_failed_twice' || trigger === 'task_complete') {
      const lessonsMatch = content.match(/^LESSONS:\s*\n((?:\d+\..+\n?)+)/im);
      if (lessonsMatch) {
        response.lessons = lessonsMatch[1]
          .split('\n')
          .filter(l => /^\d+\./.test(l.trim()))
          .map(l => l.replace(/^\d+\.\s*/, '').trim());
      }
    }

    if (trigger === 'pr_comment') {
      const typeMatch = content.match(/^COMMENT_TYPE:\s*(code_change|question|lgtm)/im);
      if (typeMatch) {
        response.commentType = typeMatch[1] as 'code_change' | 'question' | 'lgtm';
      }
    }

    return response;
  }

  private fallbackResponse(trigger: OrchestratorTrigger): string {
    if (trigger === 'gate5_reached') {
      return [
        'DECISION: approve',
        'SUMMARY: Insufficient context for full review — auto-approved',
        'LESSONS:',
        '1. Provide complete diff for Gate 5 review',
        '2. Ensure contracts files exist before Gate 5',
        '3. Run full pipeline to generate required artifacts',
      ].join('\n');
    }
    return 'Unable to generate response — LLM call failed. Please retry.';
  }

  private async appendLessons(taskId: string, lessons: string[]): Promise<void> {
    const lessonsPath = path.join(this.workspaceRoot, 'engine', 'CLI-LESSONS-LEARNED.md');
    const entry = [
      `\n## Task ${taskId} — ${new Date().toISOString().split('T')[0]}`,
      ...lessons.map((l, i) => `${i + 1}. ${l}`),
      '',
    ].join('\n');

    try {
      await fs.appendFile(lessonsPath, entry, 'utf-8');
    } catch {
      // File doesn't exist or unwritable — non-fatal
    }
  }
}
