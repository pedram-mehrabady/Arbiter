import fs from 'node:fs/promises';
import path from 'node:path';
import { GateDefinition, GateStatus, ServiceResult } from '../types/index';
import { GateType, GateRegistry } from './GateRegistry';
import { DecisionLog } from '../decisions/DecisionLog';

const GATES_FILE = path.join('.arbiter', 'pending-gates.json');
const POLL_INTERVAL_MS = 5_000;

export class GatePoller {
  private readonly gatesPath: string;
  private readonly registry: GateRegistry;
  private readonly decisionLog: DecisionLog;

  constructor(workspaceRoot: string, decisionLog: DecisionLog) {
    this.gatesPath = path.join(workspaceRoot, GATES_FILE);
    this.registry = new GateRegistry();
    this.decisionLog = decisionLog;
  }

  async createGate(
    taskId: string,
    gateType: GateType,
    context: string,
    subTask?: string,
  ): Promise<ServiceResult<GateDefinition>> {
    const spec = this.registry.getSpec(gateType);
    if (!spec) {
      return { ok: false, error: `Unknown gate type: ${gateType}` };
    }

    const gate: GateDefinition = {
      gate_id: `gate-${gateType}-${taskId}-${Date.now()}`,
      type: gateType,
      task_id: taskId,
      sub_task: subTask,
      created_at: new Date().toISOString(),
      context,
      status: 'pending',
    };

    const existing = await this.readAll();
    if (!existing.ok) return existing;

    existing.value.push(gate);
    const writeResult = await this.writeAll(existing.value);
    if (!writeResult.ok) return writeResult;

    await this.decisionLog.logGateCreated(taskId, gate.gate_id, gateType);

    console.log(`\n⏸  GATE: ${spec.label}`);
    console.log(`   ${spec.description}`);
    console.log(`   Gate ID: ${gate.gate_id}`);
    console.log(`   Resolve: arbiter gate approve ${gate.gate_id}`);
    console.log(`            arbiter gate reject  ${gate.gate_id}`);

    return { ok: true, value: gate };
  }

  async resolve(
    gateId: string,
    status: 'approved' | 'rejected',
    comment?: string,
  ): Promise<ServiceResult<GateDefinition>> {
    const allResult = await this.readAll();
    if (!allResult.ok) return allResult;

    const idx = allResult.value.findIndex(g => g.gate_id === gateId);
    if (idx === -1) {
      return { ok: false, error: `Gate ${gateId} not found`, code: 'NOT_FOUND' };
    }

    const gate = allResult.value[idx];
    if (gate.status !== 'pending') {
      return { ok: false, error: `Gate ${gateId} already resolved (${gate.status})` };
    }

    gate.status = status;
    gate.resolved_at = new Date().toISOString();
    gate.comment = comment;

    const writeResult = await this.writeAll(allResult.value);
    if (!writeResult.ok) return writeResult;

    await this.decisionLog.logGateResolved(gate.task_id, gateId, status);

    return { ok: true, value: gate };
  }

  // Remove all gate entries (pending or resolved) belonging to a task.
  // Used by `arbiter task reset` so stale gates don't block the next run.
  async clearTask(taskId: string): Promise<ServiceResult<number>> {
    const allResult = await this.readAll();
    if (!allResult.ok) return allResult;
    const before = allResult.value.length;
    const filtered = allResult.value.filter(g => g.task_id !== taskId);
    const writeResult = await this.writeAll(filtered);
    if (!writeResult.ok) return writeResult;
    return { ok: true, value: before - filtered.length };
  }

  async listPending(taskId?: string): Promise<ServiceResult<GateDefinition[]>> {
    const allResult = await this.readAll();
    if (!allResult.ok) return allResult;

    const pending = allResult.value.filter(
      g => g.status === 'pending' && (!taskId || g.task_id === taskId),
    );
    return { ok: true, value: pending };
  }

  // Block conductor until this gate is resolved. Polls every POLL_INTERVAL_MS.
  async waitForApproval(gateId: string): Promise<ServiceResult<GateStatus>> {
    process.stdout.write(`Waiting for gate ${gateId}...`);

    while (true) {
      await sleep(POLL_INTERVAL_MS);

      const allResult = await this.readAll();
      if (!allResult.ok) return allResult;

      const gate = allResult.value.find(g => g.gate_id === gateId);
      if (!gate) {
        return { ok: false, error: `Gate ${gateId} disappeared from file`, code: 'GATE_MISSING' };
      }

      if (gate.status !== 'pending') {
        process.stdout.write(` ${gate.status}\n`);
        return { ok: true, value: gate.status };
      }

      process.stdout.write('.');
    }
  }

  private async readAll(): Promise<ServiceResult<GateDefinition[]>> {
    try {
      const content = await fs.readFile(this.gatesPath, 'utf-8');
      return { ok: true, value: JSON.parse(content) as GateDefinition[] };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ok: true, value: [] };
      }
      return { ok: false, error: `Failed to read gates: ${String(err)}` };
    }
  }

  private async writeAll(gates: GateDefinition[]): Promise<ServiceResult<void>> {
    try {
      await fs.mkdir(path.dirname(this.gatesPath), { recursive: true });
      const tmp = `${this.gatesPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
      await fs.writeFile(tmp, JSON.stringify(gates, null, 2), 'utf-8');
      await fs.rename(tmp, this.gatesPath);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: `Failed to write gates: ${String(err)}` };
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
