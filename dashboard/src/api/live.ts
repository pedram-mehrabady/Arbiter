import type { ArbiterState, CliStats, AgentData, ImprovementItem, PlanOrderRequest, PlanOrderResult, CliMessage, BoardData, ConductorSession, GateName, ArbiterConfig, AgentsConfig, EngineGate } from './types';

export class LiveApi {
  constructor(
    private dir: FileSystemDirectoryHandle,       // arbiter/ subdirectory
    private rootDir?: FileSystemDirectoryHandle,  // repo root (needed for compliance/ + factory-config)
  ) {}

  async writeDeveloperIdentity(name: string): Promise<void> {
    const fh = await this.dir.getFileHandle('developer-identity.json', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({ name: name.trim() }, null, 2));
    await w.close();
  }

  async readState(): Promise<ArbiterState | null> {
    try {
      const fh = await this.dir.getFileHandle('mcp-state.json', { create: false });
      return JSON.parse(await (await fh.getFile()).text());
    } catch { return null; }
  }

  // ── Per-task state (arbiter/tasks/<id>/state.json) ───────────────────────
  async listTaskIds(): Promise<string[]> {
    const ids: string[] = [];
    try {
      const tasksDir = await this.dir.getDirectoryHandle('tasks', { create: false });
      for await (const [name, handle] of tasksDir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
        if (handle.kind === 'directory') ids.push(name);
      }
    } catch { /* no tasks dir yet */ }
    return ids;
  }

  async readTaskState(taskId: string): Promise<{ task_id: string; sub_tasks?: Record<string, { agent_role: string; status: string }> } | null> {
    try {
      const tasksDir = await this.dir.getDirectoryHandle('tasks', { create: false });
      const taskDir = await tasksDir.getDirectoryHandle(taskId, { create: false });
      const fh = await taskDir.getFileHandle('state.json', { create: false });
      return JSON.parse(await (await fh.getFile()).text());
    } catch { return null; }
  }

  /** Per-step usage rows for a task, from arbiter/usage.jsonl (what ran, tokens, context, cost, ts). */
  async readUsageForTask(taskId: string): Promise<Array<{ sub_task?: string; agent_role?: string; model?: string; input_tokens?: number; output_tokens?: number; context_tokens?: number; cost_usd?: number; ts?: string }>> {
    try {
      const fh = await this.dir.getFileHandle('usage.jsonl', { create: false });
      const text = await (await fh.getFile()).text();
      return text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter((r): r is NonNullable<typeof r> => !!r && r.task_id === taskId);
    } catch { return []; }
  }

  // ── Engine human gates (arbiter/pending-gates.json) ──────────────────────
  async readPendingGates(): Promise<EngineGate[]> {
    try {
      const fh = await this.dir.getFileHandle('pending-gates.json', { create: false });
      const data = JSON.parse(await (await fh.getFile()).text());
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  }

  /**
   * Resolve a gate exactly as the engine's GatePoller does: flip status
   * pending→approved/rejected + stamp resolved_at, then rewrite the file. The
   * Conductor polls this file every 5s and continues on a non-pending status.
   */
  async resolveGate(gateId: string, decision: 'approved' | 'rejected', comment?: string): Promise<boolean> {
    const gates = await this.readPendingGates();
    const gate = gates.find(g => g.gate_id === gateId);
    if (!gate || gate.status !== 'pending') return false;
    gate.status = decision;
    gate.resolved_at = new Date().toISOString();
    if (comment) gate.comment = comment;
    const fh = await this.dir.getFileHandle('pending-gates.json', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(gates, null, 2));
    await w.close();
    return true;
  }

  async readBoard(): Promise<BoardData | null> {
    try {
      const fh = await this.dir.getFileHandle('board.json', { create: false });
      return JSON.parse(await (await fh.getFile()).text());
    } catch { return null; }
  }

  async readCliStats(): Promise<CliStats | null> {
    try {
      const fh = await this.dir.getFileHandle('cli-stats.json', { create: false });
      return JSON.parse(await (await fh.getFile()).text());
    } catch { return null; }
  }

  async readMessages(): Promise<CliMessage[]> {
    try {
      const fh = await this.dir.getFileHandle('messages.json', { create: false });
      const data = JSON.parse(await (await fh.getFile()).text());
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.messages)) return data.messages;
      return [];
    } catch { return []; }
  }

  async appendMessage(msg: CliMessage): Promise<void> {
    const existing = await this.readMessages();
    existing.push(msg);
    const fh = await this.dir.getFileHandle('messages.json', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(existing, null, 2));
    await w.close();
  }

  async readAgents(): Promise<Record<string, AgentData>> {
    const result: Record<string, AgentData> = {};
    try {
      const dir = await this.dir.getDirectoryHandle('agents', { create: false });
      for await (const [name, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
        if (name.endsWith('.json') && handle.kind === 'file') {
          try {
            result[name.replace('.json', '')] = JSON.parse(
              await (await (handle as FileSystemFileHandle).getFile()).text()
            );
          } catch { /* skip corrupted */ }
        }
      }
    } catch { /* dir not created yet */ }
    return result;
  }

  // ── Plan files in arbiter/plans/ ──────────────────────────────────────────

  async readPlanFile(ticket: string): Promise<string | null> {
    const filename = `${ticket.replace(/[^a-zA-Z0-9-_]/g, '')}.md`;
    try {
      const plansDir = await this.dir.getDirectoryHandle('plans', { create: false });
      const fh = await plansDir.getFileHandle(filename, { create: false });
      return await (await fh.getFile()).text();
    } catch { return null; }
  }

  async writePlanFile(ticket: string, content: string): Promise<string> {
    const filename = `${ticket.replace(/[^a-zA-Z0-9-_]/g, '')}.md`;
    const plansDir = await this.dir.getDirectoryHandle('plans', { create: true });
    const fh = await plansDir.getFileHandle(filename, { create: true });
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
    return filename;
  }

  async writeExtraDocs(ticket: string, content: string): Promise<void> {
    const filename = `${ticket.replace(/[^a-zA-Z0-9-_]/g, '')}-docs.md`;
    const plansDir = await this.dir.getDirectoryHandle('plans', { create: true });
    const fh = await plansDir.getFileHandle(filename, { create: true });
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
  }

  // ── Factory pipeline integration ──────────────────────────────────────────

  async readArbiterConfig(): Promise<ArbiterConfig | null> {
    if (!this.rootDir) return null;
    try {
      const fh = await this.rootDir.getFileHandle('arbiter.config.json', { create: false });
      return JSON.parse(await (await fh.getFile()).text()) as ArbiterConfig;
    } catch { return null; }
  }

  async readAgentsConfig(agentsConfigPath = 'compliance/automation/agents.config.json'): Promise<AgentsConfig | null> {
    if (!this.rootDir) return null;
    try {
      const parts = agentsConfigPath.split('/').filter(Boolean);
      let dir: FileSystemDirectoryHandle = this.rootDir;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: false });
      }
      const fh = await dir.getFileHandle(parts[parts.length - 1], { create: false });
      return JSON.parse(await (await fh.getFile()).text()) as AgentsConfig;
    } catch { return null; }
  }

  /** Write a task brief to <execPlanDir>/01-inbox/<taskId>.md (requires rootDir) */
  async writeInboxTask(taskId: string, brief: string, execPlanDir = 'compliance/exec-plan'): Promise<void> {
    if (!this.rootDir) throw new Error('Repo root not available — reconnect the folder');
    const parts = execPlanDir.split('/').filter(Boolean);
    let dir: FileSystemDirectoryHandle = this.rootDir;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: false });
    }
    const inbox = await dir.getDirectoryHandle('01-inbox', { create: true });
    const fh    = await inbox.getFileHandle(`${taskId}.md`, { create: true });
    const w     = await fh.createWritable();
    await w.write(brief);
    await w.close();
  }

  /** Append taskId to arbiter/queue-order.json so factory.sh picks it up */
  async enqueueTask(taskId: string): Promise<void> {
    let order: string[] = [];
    try {
      const fh = await this.dir.getFileHandle('queue-order.json', { create: false });
      const parsed = JSON.parse(await (await fh.getFile()).text());
      // factory.sh writes {"order":[...]}; handle plain array for backwards compat
      if (Array.isArray(parsed)) order = parsed;
      else if (parsed?.order && Array.isArray(parsed.order)) order = parsed.order;
    } catch { /* first entry */ }
    if (!order.includes(taskId)) order.push(taskId);
    const fh = await this.dir.getFileHandle('queue-order.json', { create: true });
    const w  = await fh.createWritable();
    await w.write(JSON.stringify({ order }, null, 2));
    await w.close();
  }

  /** Read arbiter.config.json from repo root */
  async readArbiterConfigRaw(): Promise<object | null> {
    if (!this.rootDir) return null;
    try {
      const fh = await this.rootDir.getFileHandle('arbiter.config.json', { create: false });
      return JSON.parse(await (await fh.getFile()).text());
    } catch { return null; }
  }

  /** Write arbiter.config.json to repo root */
  async writeArbiterConfigRaw(config: object): Promise<void> {
    if (!this.rootDir) throw new Error('Repo root not available — reconnect the folder');
    const fh = await this.rootDir.getFileHandle('arbiter.config.json', { create: true });
    const w  = await fh.createWritable();
    await w.write(JSON.stringify(config, null, 2) + '\n');
    await w.close();
  }

  /** Read compliance/automation/factory-config.json (requires rootDir) */
  async readFactoryConfig(): Promise<object | null> {
    if (!this.rootDir) return null;
    try {
      const compliance  = await this.rootDir.getDirectoryHandle('compliance', { create: false });
      const automation  = await compliance.getDirectoryHandle('automation', { create: false });
      const fh          = await automation.getFileHandle('factory-config.json', { create: false });
      return JSON.parse(await (await fh.getFile()).text());
    } catch { return null; }
  }

  /** Write compliance/automation/factory-config.json (requires rootDir) */
  async writeFactoryConfig(config: object): Promise<void> {
    if (!this.rootDir) throw new Error('Repo root not available — reconnect the folder');
    const compliance  = await this.rootDir.getDirectoryHandle('compliance', { create: false });
    const automation  = await compliance.getDirectoryHandle('automation', { create: false });
    const fh          = await automation.getFileHandle('factory-config.json', { create: false });
    const w           = await fh.createWritable();
    await w.write(JSON.stringify(config, null, 2));
    await w.close();
  }

  // ── Exec-plan artifact listing ────────────────────────────────────────────

  /** List files inside <execPlanDir>/{stageDir}/{taskId}/ with modification times */
  async listExecPlanFolder(stageDir: string, taskId: string, execPlanDir = 'compliance/exec-plan'): Promise<Array<{ name: string; mtime_ms: number }>> {
    const root = this.rootDir ?? this.dir;
    try {
      const parts = execPlanDir.split('/').filter(Boolean);
      let execPlan: FileSystemDirectoryHandle = root;
      for (const part of parts) {
        execPlan = await execPlan.getDirectoryHandle(part, { create: false });
      }
      const stage      = await execPlan.getDirectoryHandle(stageDir, { create: false });
      const taskFolder = await stage.getDirectoryHandle(taskId, { create: false });
      const files: Array<{ name: string; mtime_ms: number }> = [];
      for await (const [name, handle] of taskFolder as unknown as AsyncIterable<[string, FileSystemHandle]>) {
        if (handle.kind === 'file') {
          try {
            const file = await (handle as FileSystemFileHandle).getFile();
            files.push({ name, mtime_ms: file.lastModified });
          } catch { files.push({ name, mtime_ms: 0 }); }
        }
      }
      return files;
    } catch { return []; }
  }

  // ── Generic file reader (relative to repo root) ───────────────────────────

  async readRepoFile(relativePath: string): Promise<string | null> {
    const root = this.rootDir ?? this.dir;
    try {
      const parts = relativePath.split('/').filter(Boolean);
      let dir: FileSystemDirectoryHandle = root;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: false });
      }
      const fh = await dir.getFileHandle(parts[parts.length - 1], { create: false });
      return (await fh.getFile()).text();
    } catch { return null; }
  }

  /** Write a file relative to the repo root, creating intermediate directories. */
  async writeRepoFile(relativePath: string, content: string): Promise<void> {
    const root = this.rootDir ?? this.dir;
    const parts = relativePath.split('/').filter(Boolean);
    let dir: FileSystemDirectoryHandle = root;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i], { create: true });
    }
    const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
  }

  // ── Misc ──────────────────────────────────────────────────────────────────

  async writeImprovementItem(item: ImprovementItem): Promise<void> {
    let items: ImprovementItem[] = [];
    try {
      const fh = await this.dir.getFileHandle('improvements.json', { create: false });
      const raw = JSON.parse(await (await fh.getFile()).text());
      if (Array.isArray(raw)) items = raw;
    } catch { /* first write */ }
    items.unshift(item);
    const fh = await this.dir.getFileHandle('improvements.json', { create: true });
    const w  = await fh.createWritable();
    await w.write(JSON.stringify(items, null, 2));
    await w.close();
  }

  async writeResponse(id: string, value: string): Promise<void> {
    const payload = { id, value, responded_at: new Date().toISOString() };
    let data: { responses: object[] } = { responses: [] };
    try {
      const fh = await this.dir.getFileHandle('arbiter-responses.json', { create: false });
      data = JSON.parse(await (await fh.getFile()).text());
    } catch { /* first write */ }
    if (!Array.isArray(data.responses)) data.responses = [];
    data.responses.push(payload);
    const fh = await this.dir.getFileHandle('arbiter-responses.json', { create: true });
    const w  = await fh.createWritable();
    await w.write(JSON.stringify(data, null, 2));
    await w.close();
  }

  async clearPendingApproval(): Promise<void> {
    try {
      const fh = await this.dir.getFileHandle('mcp-state.json', { create: false });
      const state = JSON.parse(await (await fh.getFile()).text());
      state.pending_approval = null;
      const wh = await this.dir.getFileHandle('mcp-state.json', { create: true });
      const w = await wh.createWritable();
      await w.write(JSON.stringify(state, null, 2));
      await w.close();
    } catch { /* file missing — nothing to clear */ }
  }

  async writeOrderRequest(payload: PlanOrderRequest): Promise<void> {
    const fh = await this.dir.getFileHandle('order-request.json', { create: true });
    const w  = await fh.createWritable();
    await w.write(JSON.stringify(payload, null, 2));
    await w.close();
  }

  async readOrderResult(): Promise<PlanOrderResult | null> {
    try {
      const fh = await this.dir.getFileHandle('order-result.json', { create: false });
      return JSON.parse(await (await fh.getFile()).text());
    } catch { return null; }
  }

  async clearOrderResult(): Promise<void> {
    try { await this.dir.removeEntry('order-result.json'); } catch { /* already gone */ }
  }

  // ── Conductor session ─────────────────────────────────────────────────────

  async readConductorSession(taskId: string): Promise<ConductorSession | null> {
    try {
      const sessDir = await this.dir.getDirectoryHandle('conductor-sessions', { create: false });
      const fh = await sessDir.getFileHandle(`${taskId}.json`, { create: false });
      return JSON.parse(await (await fh.getFile()).text());
    } catch { return null; }
  }

  async writeConductorSession(taskId: string, session: ConductorSession): Promise<void> {
    const sessDir = await this.dir.getDirectoryHandle('conductor-sessions', { create: true });
    const fh = await sessDir.getFileHandle(`${taskId}.json`, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(session, null, 2));
    await w.close();
  }

  /** Write arbiter/gate-approvals/<taskId>-<gate>.json to unblock factory.sh */
  async writeGateApproval(taskId: string, gate: GateName, decision: 'approved' | 'rejected'): Promise<void> {
    const approvalsDir = await this.dir.getDirectoryHandle('gate-approvals', { create: true });
    const fh = await approvalsDir.getFileHandle(`${taskId}-${gate}.json`, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({
      task_id: taskId,
      gate,
      decision,
      decided_at: new Date().toISOString(),
    }, null, 2));
    await w.close();
  }
}

export type ConnectResult =
  | { ok: true; arbiterHandle: FileSystemDirectoryHandle; rootHandle: FileSystemDirectoryHandle }
  | { ok: false; reason: string };

export async function connectRepo(): Promise<ConnectResult> {
  if (!window.showDirectoryPicker) {
    return { ok: false, reason: 'This browser cannot open folders. Use Chrome, Edge, or Brave.' };
  }

  let picked: FileSystemDirectoryHandle;
  try {
    picked = await window.showDirectoryPicker({ id: 'repo-dir', mode: 'readwrite' });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return { ok: false, reason: '' };
    return { ok: false, reason: `Could not open the folder picker: ${(e as Error).message}` };
  }

  if (picked.name === 'arbiter') {
    // User picked arbiter directly — no root available
    return { ok: true, arbiterHandle: picked, rootHandle: picked };
  }

  try {
    const arbiter = await picked.getDirectoryHandle('arbiter', { create: false });
    return { ok: true, arbiterHandle: arbiter, rootHandle: picked };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'NotFoundError') {
      return {
        ok: false,
        reason: `No "arbiter" folder inside "${picked.name}". Pick the repo root (run factory.sh once if it doesn't exist yet).`,
      };
    }
    return { ok: false, reason: `Could not read "${picked.name}": ${(e as Error).message}` };
  }
}
