/**
 * ServerApi — mirrors LiveApi but talks to the Vite dev-server file endpoints
 * instead of the browser File System Access API. Used when connecting by path
 * (e.g. from Playwright or CI) rather than via the folder picker.
 */
import type {
  ArbiterState, CliStats, AgentData, ImprovementItem,
  PlanOrderRequest, PlanOrderResult, CliMessage, BoardData,
  ConductorSession, GateName, ArbiterConfig, AgentsConfig,
  TaskTier, IronFunnelStatus, IronFunnelGateStatus, CriticalPathFlag, EngineGate,
} from './types';

async function serverRead(relPath: string, root: string): Promise<string | null> {
  try {
    const r = await fetch(
      `/api/repo-read?path=${encodeURIComponent(relPath)}&root=${encodeURIComponent(root)}`
    );
    if (!r.ok) return null;
    const j = await r.json() as { ok: boolean; content?: string };
    return j.ok ? (j.content ?? null) : null;
  } catch { return null; }
}

async function serverWrite(relPath: string, content: string, root: string): Promise<void> {
  await fetch('/api/repo-write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: relPath, content, root }),
  });
}

async function serverLs(relPath: string, root: string): Promise<Array<{ name: string; kind: string; mtime_ms?: number }>> {
  try {
    const r = await fetch(
      `/api/repo-ls?path=${encodeURIComponent(relPath)}&root=${encodeURIComponent(root)}`
    );
    if (!r.ok) return [];
    const j = await r.json() as { ok: boolean; entries?: Array<{ name: string; kind: string; mtime_ms?: number }> };
    return j.ok ? (j.entries ?? []) : [];
  } catch { return []; }
}

export class ServerApi {
  constructor(
    private arbiterPath: string,  // absolute path to arbiter/
    private rootPath: string,    // absolute path to repo root
  ) {}

  async writeDeveloperIdentity(name: string): Promise<void> {
    await serverWrite('arbiter/developer-identity.json', JSON.stringify({ name: name.trim() }, null, 2), this.rootPath);
  }

  async readState(): Promise<ArbiterState | null> {
    const raw = await serverRead('arbiter/mcp-state.json', this.rootPath);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  }

  async readBoard(): Promise<BoardData | null> {
    const raw = await serverRead('arbiter/board.json', this.rootPath);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  }

  async readCliStats(): Promise<CliStats | null> {
    const raw = await serverRead('arbiter/cli-stats.json', this.rootPath);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  }

  async readMessages(): Promise<CliMessage[]> {
    const raw = await serverRead('arbiter/messages.json', this.rootPath);
    try {
      const data = raw ? JSON.parse(raw) : null;
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.messages)) return data.messages;
      return [];
    } catch { return []; }
  }

  async appendMessage(msg: CliMessage): Promise<void> {
    const existing = await this.readMessages();
    existing.push(msg);
    await serverWrite('arbiter/messages.json', JSON.stringify(existing, null, 2), this.rootPath);
  }

  async readAgents(): Promise<Record<string, AgentData>> {
    const entries = await serverLs('arbiter/agents', this.rootPath);
    const result: Record<string, AgentData> = {};
    await Promise.all(
      entries
        .filter((e) => e.kind === 'file' && e.name.endsWith('.json'))
        .map(async (e) => {
          const raw = await serverRead(`arbiter/agents/${e.name}`, this.rootPath);
          try { if (raw) result[e.name.replace('.json', '')] = JSON.parse(raw); } catch { /* skip */ }
        })
    );
    return result;
  }

  async readPlanFile(ticket: string): Promise<string | null> {
    const filename = `${ticket.replace(/[^a-zA-Z0-9-_]/g, '')}.md`;
    return serverRead(`arbiter/plans/${filename}`, this.rootPath);
  }

  async writePlanFile(ticket: string, content: string): Promise<string> {
    const filename = `${ticket.replace(/[^a-zA-Z0-9-_]/g, '')}.md`;
    await serverWrite(`arbiter/plans/${filename}`, content, this.rootPath);
    return filename;
  }

  async writeExtraDocs(ticket: string, content: string): Promise<void> {
    const filename = `${ticket.replace(/[^a-zA-Z0-9-_]/g, '')}-docs.md`;
    await serverWrite(`arbiter/plans/${filename}`, content, this.rootPath);
  }

  async readArbiterConfig(): Promise<ArbiterConfig | null> {
    const raw = await serverRead('arbiter.config.json', this.rootPath);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  }

  async readAgentsConfig(agentsConfigPath = 'compliance/automation/agents.config.json'): Promise<AgentsConfig | null> {
    const raw = await serverRead(agentsConfigPath, this.rootPath);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  }

  async writeInboxTask(taskId: string, brief: string, execPlanDir = 'compliance/exec-plan'): Promise<void> {
    await serverWrite(`${execPlanDir}/01-inbox/${taskId}.md`, brief, this.rootPath);
  }

  async enqueueTask(taskId: string): Promise<void> {
    const raw = await serverRead('arbiter/queue-order.json', this.rootPath);
    let order: string[] = [];
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) order = parsed;
      else if (parsed?.order && Array.isArray(parsed.order)) order = parsed.order;
    } catch { /* first */ }
    if (!order.includes(taskId)) order.push(taskId);
    await serverWrite('arbiter/queue-order.json', JSON.stringify({ order }, null, 2), this.rootPath);
  }

  async readArbiterConfigRaw(): Promise<object | null> {
    const raw = await serverRead('arbiter.config.json', this.rootPath);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  }

  async writeArbiterConfigRaw(config: object): Promise<void> {
    await serverWrite('arbiter.config.json', JSON.stringify(config, null, 2) + '\n', this.rootPath);
  }

  async readFactoryConfig(): Promise<object | null> {
    const raw = await serverRead('compliance/automation/factory-config.json', this.rootPath);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  }

  async writeFactoryConfig(config: object): Promise<void> {
    await serverWrite('compliance/automation/factory-config.json', JSON.stringify(config, null, 2), this.rootPath);
  }

  async readRepoFile(relativePath: string): Promise<string | null> {
    return serverRead(relativePath, this.rootPath);
  }

  async writeRepoFile(relativePath: string, content: string): Promise<void> {
    await serverWrite(relativePath, content, this.rootPath);
  }

  async readEpics(): Promise<Array<{ id: string; title: string; total: number; done: number; pct: number; stories: Array<{ id: string; title: string; total: number; done: number; pct: number }> }>> {
    const raw = await serverRead('arbiter/epics.json', this.rootPath);
    if (!raw) return [];
    try { const j = JSON.parse(raw); return Array.isArray(j.epics) ? j.epics : []; } catch { return []; }
  }

  async createEpic(title: string, doc: string): Promise<string> {
    const slug = title.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 16) || 'EPIC';
    const id = `EPIC-${slug}-${Date.now().toString(36).slice(-5).toUpperCase()}`;
    await serverWrite(`arbiter/epics/${id}/epic.md`, `# ${title.trim()}\n\n${doc.trim()}\n`, this.rootPath);
    await serverWrite(`arbiter/epics/${id}/epic.json`, JSON.stringify({ id, title: title.trim(), createdAt: new Date().toISOString(), stories: [] }, null, 2), this.rootPath);
    await serverWrite(`arbiter/epics/${id}/decompose.flag`, new Date().toISOString(), this.rootPath);
    return id;
  }

  async readLanesBoard(): Promise<{ generated: string; cards: unknown[] } | null> {
    const raw = await serverRead('arbiter/lanes.json', this.rootPath);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  async listTaskIds(): Promise<string[]> {
    const entries = await serverLs('arbiter/tasks', this.rootPath);
    return entries.filter(e => e.kind === 'directory').map(e => e.name);
  }

  async readTaskState(taskId: string): Promise<{ task_id: string; sub_tasks?: Record<string, { agent_role: string; status: string }> } | null> {
    const raw = await serverRead(`arbiter/tasks/${taskId}/state.json`, this.rootPath);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  async listAttachments(taskId: string): Promise<Array<{ name: string; content: string }>> {
    const entries = await serverLs(`arbiter/tasks/${taskId}/attachments`, this.rootPath);
    const out: Array<{ name: string; content: string }> = [];
    for (const e of entries) {
      if (e.kind === 'file') {
        const content = await serverRead(`arbiter/tasks/${taskId}/attachments/${e.name}`, this.rootPath);
        if (content != null) out.push({ name: e.name, content });
      }
    }
    return out;
  }

  async readUsageForTask(taskId: string): Promise<Array<{ sub_task?: string; agent_role?: string; model?: string; input_tokens?: number; output_tokens?: number; context_tokens?: number; cost_usd?: number; ts?: string }>> {
    const raw = await serverRead('arbiter/usage.jsonl', this.rootPath);
    if (!raw) return [];
    return raw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter((r): r is { task_id: string } & Record<string, unknown> => !!r && (r as { task_id?: string }).task_id === taskId) as never;
  }

  async readPendingGates(): Promise<EngineGate[]> {
    const raw = await serverRead('arbiter/pending-gates.json', this.rootPath);
    if (!raw) return [];
    try { const d = JSON.parse(raw); return Array.isArray(d) ? d : []; } catch { return []; }
  }

  async resolveGate(gateId: string, decision: 'approved' | 'rejected', comment?: string): Promise<boolean> {
    const gates = await this.readPendingGates();
    const gate = gates.find(g => g.gate_id === gateId);
    if (!gate || gate.status !== 'pending') return false;
    gate.status = decision;
    gate.resolved_at = new Date().toISOString();
    if (comment) gate.comment = comment;
    await serverWrite('arbiter/pending-gates.json', JSON.stringify(gates, null, 2), this.rootPath);
    return true;
  }

  async listExecPlanFolder(stageDir: string, taskId: string, execPlanDir = 'compliance/exec-plan'): Promise<Array<{ name: string; mtime_ms: number }>> {
    const entries = await serverLs(`${execPlanDir}/${stageDir}/${taskId}`, this.rootPath);
    return entries
      .filter((e) => e.kind === 'file')
      .map((e) => ({ name: e.name, mtime_ms: e.mtime_ms ?? 0 }));
  }

  async writeImprovementItem(item: ImprovementItem): Promise<void> {
    const raw = await serverRead('arbiter/improvements.json', this.rootPath);
    let items: ImprovementItem[] = [];
    try { const parsed = raw ? JSON.parse(raw) : []; if (Array.isArray(parsed)) items = parsed; } catch { /* first */ }
    items.unshift(item);
    await serverWrite('arbiter/improvements.json', JSON.stringify(items, null, 2), this.rootPath);
  }

  async writeResponse(id: string, value: string): Promise<void> {
    const raw = await serverRead('arbiter/arbiter-responses.json', this.rootPath);
    let data: { responses: object[] } = { responses: [] };
    try { const parsed = raw ? JSON.parse(raw) : null; if (parsed) data = parsed; } catch { /* first */ }
    if (!Array.isArray(data.responses)) data.responses = [];
    data.responses.push({ id, value, responded_at: new Date().toISOString() });
    await serverWrite('arbiter/arbiter-responses.json', JSON.stringify(data, null, 2), this.rootPath);
  }

  async clearPendingApproval(): Promise<void> {
    const raw = await serverRead('arbiter/mcp-state.json', this.rootPath);
    try {
      const state = raw ? JSON.parse(raw) : null;
      if (!state) return;
      state.pending_approval = null;
      await serverWrite('arbiter/mcp-state.json', JSON.stringify(state, null, 2), this.rootPath);
    } catch { /* malformed — skip */ }
  }

  async writeOrderRequest(payload: PlanOrderRequest): Promise<void> {
    await serverWrite('arbiter/order-request.json', JSON.stringify(payload, null, 2), this.rootPath);
  }

  async readOrderResult(): Promise<PlanOrderResult | null> {
    const raw = await serverRead('arbiter/order-result.json', this.rootPath);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  }

  async clearOrderResult(): Promise<void> {
    // No easy delete via the server API — write empty sentinel
    await serverWrite('arbiter/order-result.json', 'null', this.rootPath);
  }

  // ── Conductor session ─────────────────────────────────────────────────────

  async readConductorSession(taskId: string): Promise<ConductorSession | null> {
    const raw = await serverRead(`arbiter/conductor-sessions/${taskId}.json`, this.rootPath);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  }

  async writeConductorSession(taskId: string, session: ConductorSession): Promise<void> {
    await serverWrite(`arbiter/conductor-sessions/${taskId}.json`, JSON.stringify(session, null, 2), this.rootPath);
  }

  async writeGateApproval(taskId: string, gate: GateName, decision: 'approved' | 'rejected'): Promise<void> {
    await serverWrite(`arbiter/gate-approvals/${taskId}-${gate}.json`, JSON.stringify({
      task_id: taskId,
      gate,
      decision,
      decided_at: new Date().toISOString(),
    }, null, 2), this.rootPath);
  }

  // ── Iron Funnel / Tier data ───────────────────────────────────────────────

  async readTaskTier(taskId: string): Promise<TaskTier | null> {
    const raw = await serverRead(`arbiter/iron-funnel-${taskId}.json`, this.rootPath);
    try {
      const data = raw ? JSON.parse(raw) : null;
      if (data?.tier == null) return null;
      return { tier: data.tier as 1 | 2 | 3, profile: data.profile ?? '' };
    } catch { return null; }
  }

  async readIronFunnelStatus(taskId: string): Promise<IronFunnelStatus | null> {
    const raw = await serverRead(`arbiter/iron-funnel-${taskId}.json`, this.rootPath);
    try {
      const data = raw ? JSON.parse(raw) : null;
      if (!data?.gates || !Array.isArray(data.gates)) return null;
      const gates: IronFunnelGateStatus[] = (data.gates as Array<Record<string, unknown>>).map((g) => ({
        gate: g.gate as 1 | 2 | 3 | 4 | 5,
        name: String(g.name ?? ''),
        type: (g.type as 'deterministic' | 'llm') ?? 'deterministic',
        status: (g.status as IronFunnelGateStatus['status']) ?? 'pending',
        elapsed_ms: typeof g.elapsed_ms === 'number' ? g.elapsed_ms : undefined,
        error_count: typeof g.error_count === 'number' ? g.error_count : undefined,
      }));
      const hasRunning = gates.some((g) => g.status === 'running');
      const hasFailed  = gates.some((g) => g.status === 'failed');
      const allPassed  = gates.every((g) => g.status === 'passed' || g.status === 'skipped');
      const overall = hasFailed ? 'failed' : hasRunning ? 'running' : allPassed ? 'passed' : 'pending';
      return { gates, overall };
    } catch { return null; }
  }

  async readCriticalPathFlag(taskId: string): Promise<CriticalPathFlag | null> {
    const raw = await serverRead(`arbiter/iron-funnel-${taskId}.json`, this.rootPath);
    try {
      const data = raw ? JSON.parse(raw) : null;
      if (data?.is_critical_path == null) return null;
      return { isCriticalPath: Boolean(data.is_critical_path), blockingCount: Number(data.blocking_count ?? 0) };
    } catch { return null; }
  }

  async readGateTimeoutStatus(taskId: string): Promise<{ warnAt: string; escalateAt: string; status: 'ok' | 'warn' | 'escalated' } | null> {
    const raw = await serverRead(`arbiter/iron-funnel-${taskId}.json`, this.rootPath);
    try {
      const data = raw ? JSON.parse(raw) : null;
      if (!data?.started_at) return null;
      const startTs = new Date(data.started_at as string).getTime();
      if (Number.isNaN(startTs)) return null;
      const elapsedHours = (Date.now() - startTs) / 3_600_000;
      const warnAt = new Date(startTs + 4 * 3_600_000).toISOString();
      const escalateAt = new Date(startTs + 8 * 3_600_000).toISOString();
      const status = elapsedHours >= 8 ? 'escalated' : elapsedHours >= 4 ? 'warn' : 'ok';
      return { warnAt, escalateAt, status };
    } catch { return null; }
  }
}
