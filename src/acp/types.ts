// ACP — Agent Capability Protocol
// Interface groundwork for v3 external agent plug-ins.
// No runtime code here: these types let third-party agents declare capabilities
// and exchange messages with Arbiter without a breaking change in v3.

export interface AgentCapability {
  id: string;
  name: string;
  version: string;
  description: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  supported_tiers: (1 | 2 | 3)[];
  gate_positions: (1 | 2 | 3 | 4 | 5)[];
  provider: string;
}

export interface AgentMessage {
  from: string;
  to: string;
  task_id: string;
  payload: Record<string, unknown>;
  ts: string;
  correlation_id: string;
}

export interface HandoffPayload {
  context_files: string[];
  contracts_path?: string;
  triage_result: import('../types/index').TriageResult;
  task_md: string;
}

export interface AcpHandshake {
  agent_id: string;
  capabilities: AgentCapability[];
  arbiter_version: string;
}
