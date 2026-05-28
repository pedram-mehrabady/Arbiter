import fs from 'node:fs/promises';
import path from 'node:path';
import { DecisionLogEntry, FailureClass, AgentRole, ServiceResult } from '../types/index';

const LOG_FILE = path.join('arbiter', 'decision-log.jsonl');

export class DecisionLog {
  private readonly filePath: string;

  constructor(workspaceRoot: string) {
    this.filePath = path.join(workspaceRoot, LOG_FILE);
  }

  async append(entry: Omit<DecisionLogEntry, 'ts'>): Promise<ServiceResult<void>> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
      await fs.appendFile(this.filePath, line, 'utf-8');
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: `Failed to append decision log: ${String(err)}` };
    }
  }

  async logPreflightReject(
    taskId: string,
    subTask: string,
    reason: string,
    detail: string,
  ): Promise<ServiceResult<void>> {
    return this.append({
      task_id: taskId,
      sub_task: subTask,
      event: 'preflight_reject',
      class: 'infrastructure',
      detail: `${reason}: ${detail}`,
    });
  }

  async logAgentStart(
    taskId: string,
    subTask: string,
    agentRole: AgentRole,
    model: string,
  ): Promise<ServiceResult<void>> {
    return this.append({
      task_id: taskId,
      sub_task: subTask,
      event: 'agent_start',
      agent_role: agentRole,
      model,
      detail: `Starting ${agentRole} (${model})`,
    });
  }

  async logAgentComplete(
    taskId: string,
    subTask: string,
    agentRole: AgentRole,
    receiptId: string,
  ): Promise<ServiceResult<void>> {
    return this.append({
      task_id: taskId,
      sub_task: subTask,
      event: 'agent_complete',
      agent_role: agentRole,
      detail: `Completed, receipt: ${receiptId}`,
    });
  }

  async logFailure(
    taskId: string,
    subTask: string,
    failureClass: FailureClass,
    strikeCount: number,
    detail: string,
  ): Promise<ServiceResult<void>> {
    return this.append({
      task_id: taskId,
      sub_task: subTask,
      event: 'agent_failure',
      class: failureClass,
      detail: `strike=${strikeCount} class=${failureClass}: ${detail}`,
    });
  }

  async logGateCreated(taskId: string, gateId: string, gateType: string): Promise<ServiceResult<void>> {
    return this.append({
      task_id: taskId,
      event: 'gate_created',
      detail: `gate_id=${gateId} type=${gateType}`,
    });
  }

  async logGateResolved(taskId: string, gateId: string, status: 'approved' | 'rejected'): Promise<ServiceResult<void>> {
    return this.append({
      task_id: taskId,
      event: 'gate_resolved',
      detail: `gate_id=${gateId} status=${status}`,
    });
  }

  async readAll(): Promise<ServiceResult<DecisionLogEntry[]>> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      const entries = content
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line) as DecisionLogEntry);
      return { ok: true, value: entries };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ok: true, value: [] };
      }
      return { ok: false, error: `Failed to read decision log: ${String(err)}` };
    }
  }
}
