/**
 * conductor.ts — Conductor chat session logic.
 *
 * Wraps the Anthropic SDK for the gate-side chat. The conductor is a persistent
 * LLM session that carries context across all three gates for a single task.
 */
import { anthropicCreateMessage } from './anthropicRest';
import type { GateName, ConductorSession, ConductorMessage, ConductorOpenItem } from './types';

const GATE_LABELS: Record<GateName, string> = {
  discovery: 'Gate 1 — Discovery Review',
  design:    'Gate 2 — Design Review',
  frontend:  'Gate 3 — Frontend Review',
  schema:    'Schema Gate',
};

/** Assemble the conductor's system prompt for a given gate and artifact set. */
export function buildConductorSystemPrompt(
  gate: GateName,
  taskId: string,
  artifacts: Record<string, string>,  // filename → content
  priorSession?: Pick<ConductorSession, 'messages' | 'open_items'> | null,
): string {
  const gateLabel = GATE_LABELS[gate];

  const artifactBlock = Object.entries(artifacts)
    .map(([name, content]) => `### ${name}\n\`\`\`\n${content.slice(0, 4000)}\n\`\`\``)
    .join('\n\n');

  const priorDecisions = priorSession?.messages
    .filter((m) => m.role === 'assistant')
    .slice(-6)
    .map((m) => m.content.slice(0, 400))
    .join('\n---\n') ?? '';

  const priorBlock = priorDecisions
    ? `\n\n## Prior gate decisions (summary)\n${priorDecisions}`
    : '';

  return `You are the Conductor for the Foederata automation factory. You are now at ${gateLabel} for task ${taskId}.

## Your role
Brief Pedram on what the pipeline agents found or built — in plain language, not file paths.
Chat naturally until every open item is resolved.
When ALL items are resolved, end your response with exactly: [ALL_RESOLVED]
Do NOT emit [ALL_RESOLVED] until you have genuinely covered everything.

## Rules
- Chat naturally. No bullet lists when a sentence works.
- No filler: "Great!", "Certainly!" — just answer.
- Double-check important decisions: "Just to confirm — you want X, not Y, right?"
- Never reference file paths. Say "the design" not "3-design.md".
- Never approve your own gate. The Approve button is controlled by the dashboard.
- If Pedram asks you to change something that requires an agent re-run, end with: [RERUN:agent-name]
${priorBlock}

## Artifacts for this gate
${artifactBlock || '(No artifacts available for this gate yet.)'}`;
}

export interface ConductorTurn {
  assistantMessage: string;
  allResolved: boolean;
  rerunAgents: string[];
  updatedSession: ConductorSession;
}

/** Send a user message and get the conductor's response. Updates the session in-place. */
export async function sendConductorMessage(
  apiKey: string,
  session: ConductorSession,
  userText: string,
  artifacts: Record<string, string>,
): Promise<ConductorTurn> {
  const systemPrompt = buildConductorSystemPrompt(
    session.current_gate,
    session.task_id,
    artifacts,
    session,
  );

  // Build Anthropic messages array from session history + new user message
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = session.messages.map(
    (m) => ({ role: m.role, content: m.content })
  );
  history.push({ role: 'user', content: userText });

  const rawText = (await anthropicCreateMessage({
    apiKey,
    model: 'claude-opus-4-7',
    maxTokens: 2048,
    system: systemPrompt,
    messages: history,
  })) || '(no response)';

  // Parse signals from response
  const allResolved = rawText.includes('[ALL_RESOLVED]');
  const rerunMatch = rawText.match(/\[RERUN:([^\]]+)\]/);
  const rerunAgents = rerunMatch ? rerunMatch[1].split(',').map((s) => s.trim()) : [];

  // Strip signal tokens from displayed text
  const displayText = rawText
    .replace(/\[ALL_RESOLVED\]/g, '')
    .replace(/\[RERUN:[^\]]+\]/g, '')
    .trim();

  const now = new Date().toISOString();
  const newUserMsg: ConductorMessage = { role: 'user', content: userText, ts: now };
  const newAssistantMsg: ConductorMessage = { role: 'assistant', content: displayText, ts: now };

  const updatedOpenItems: ConductorOpenItem[] = allResolved
    ? session.open_items.map((item) => ({ ...item, resolved: true }))
    : session.open_items;

  const updatedSession: ConductorSession = {
    ...session,
    messages: [...session.messages, newUserMsg, newAssistantMsg],
    open_items: updatedOpenItems,
    all_resolved: allResolved,
  };

  return { assistantMessage: displayText, allResolved, rerunAgents, updatedSession };
}

/** Create an initial conductor session for a gate. */
export function createConductorSession(taskId: string, gate: GateName): ConductorSession {
  return {
    task_id: taskId,
    current_gate: gate,
    gate_status: 'waiting',
    messages: [],
    open_items: [],
    all_resolved: false,
  };
}
