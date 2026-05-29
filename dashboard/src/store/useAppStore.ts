import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ArbiterState, AppSettings, CliStats, AgentData, TabKey, WidgetId, ArbiterConfig, AgentsConfig, EngineGate } from '../api/types';
import { DEFAULT_SETTINGS, DEFAULT_WIDGET_ORDER, DEFAULT_WIDGET_SIZES, DEFAULT_ARBITER_CONFIG } from '../api/types';
import { LiveApi, connectRepo } from '../api/live';
import { saveRepoHandles, loadRepoHandles, queryHandlePermission, requestHandlePermission } from '../lib/handleStore';
import { ServerApi } from '../api/serverApi';
import { createLLMAdapter } from '../api/llm';
import type { PlanAnalysis, PlanItem, PlanStatus, CliMessage, ConductorSession, GateName } from '../api/types';
import { synthesizeJobsFromBoard, activeExecPlanTickets, type ExecPlanFile } from '../lib/execPlan';
import { DEFAULT_FLOW, deriveCards, type LaneCard, type TaskSnapshot } from '../features/lanes/flow';
import { sendConductorMessage, createConductorSession } from '../api/conductor';

interface AppStore {
  // ── Settings (persisted) ─────────────────────────────────
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  settingsPanelOpen: boolean;
  toggleSettingsPanel: () => void;

  // ── Connection ───────────────────────────────────────────
  fsHandle: FileSystemDirectoryHandle | null;
  liveApi: LiveApi | ServerApi | null;
  isConnected: boolean;
  connect: () => Promise<void>;
  connectWithHandle: (arbiterHandle: FileSystemDirectoryHandle, rootHandle?: FileSystemDirectoryHandle) => Promise<void>;
  connectDev: (repoRoot: string) => Promise<void>;
  /** Silently reconnect from a previously persisted handle if permission is still granted. */
  restoreConnection: () => Promise<void>;
  /** One-click reconnect to the saved handle (prompts for permission — needs a user gesture). */
  reconnectSaved: () => Promise<boolean>;
  /** Name of a saved repo awaiting a permission re-grant after reload (null when none/connected). */
  pendingReconnectName: string | null;

  // ── Arbiter state ─────────────────────────────────────────
  arbiterState: ArbiterState;
  /** Human gates from the engine's pending-gates.json (what a `conduct` run actually waits on). */
  pendingEngineGates: EngineGate[];
  /** Approve/reject an engine gate — rewrites pending-gates.json so the Conductor continues. */
  resolveEngineGate: (gateId: string, decision: 'approved' | 'rejected') => Promise<void>;
  /** Cards for the swim-lane board, derived from each task's state.json + pending gates. */
  laneCards: LaneCard[];
  loadLanes: () => Promise<void>;
  /** Create a new task in the Brainstorm lane (writes task.md + an ideation state, + optional attachment). */
  createBrainstormTask: (title: string, idea: string, attachment?: { name: string; content: string }) => Promise<string | null>;
  cliStats: CliStats | null;
  agentData: Record<string, AgentData>;
  messages: CliMessage[];
  sendAgentMessage: (to: string, text: string, ticket?: string) => Promise<void>;
  lastUpdated: Date | null;
  poll: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
  _pollInterval: ReturnType<typeof setInterval> | null;

  // ── UI state ─────────────────────────────────────────────
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;
  expandedJobs: Set<string>;
  toggleJobExpand: (id: string) => void;
  showCompleted: boolean;
  toggleShowCompleted: () => void;
  toast: string | null;
  showToast: (msg: string, duration?: number) => void;

  // ── Modal state ──────────────────────────────────────────
  openModal: 'watcher' | 'plan' | 'planReview' | 'editPlan' | 'improvements' | 'connect' | null;
  setOpenModal: (m: AppStore['openModal']) => void;
  reviewingJobId: string | null;
  openPlanReview: (jobId: string) => void;
  jobDetailId: string | null;
  openJobDetail: (id: string) => void;
  closeJobDetail: () => void;
  stageDetail: { jobId: string; stageKey: string } | null;
  openStageDetail: (jobId: string, stageKey: string) => void;
  closeStageDetail: () => void;
  dismissedGateIds: string[];
  dismissGate: (id: string) => void;

  // ── Job actions ──────────────────────────────────────────
  addJob: (analysis: PlanAnalysis) => void;
  updateJob: (id: string, patch: Partial<import('../api/types').Job>) => void;
  approveJobPlan: (id: string) => void;
  approveGate: () => Promise<void>;

  // ── Plans backlog ────────────────────────────────────────
  plans: PlanItem[];
  selectedPlanId: string | null;
  orderPending: boolean;
  addPlan: (analysis: PlanAnalysis, planType?: import('../api/types').PlanType) => string;
  createBlankPlan: () => string;
  updatePlanMd: (id: string, md: string) => void;
  reloadPlanFromDisk: (id: string) => Promise<void>;
  setPlanExtraDocs: (id: string, text: string) => void;
  setPlanStatus: (id: string, status: PlanStatus) => void;
  reorderPlans: (orderedIds: string[]) => void;
  movePlan: (id: string, dir: -1 | 1) => void;
  deletePlan: (id: string) => void;
  selectPlan: (id: string | null) => void;
  importJobAsPlan: (jobId: string) => Promise<void>;
  submitToFactory: (id: string) => Promise<void>;

  // ── Arbiter config (arbiter.config.json) ─────────────────
  readArbiterConfigRaw: () => Promise<object | null>;
  writeArbiterConfigRaw: (config: object) => Promise<void>;

  // ── Factory config (legacy foederata path) ────────────────
  readFactoryConfig: () => Promise<object | null>;
  writeFactoryConfig: (config: object) => Promise<void>;
  readRepoFile: (path: string) => Promise<string | null>;

  // ── Arbiter / Agents config ───────────────────────────────
  arbiterConfig: ArbiterConfig;
  agentsConfig: AgentsConfig | null;
  loadArbiterConfig: () => Promise<void>;
  loadAgentsConfig: () => Promise<void>;

  // ── LLM ─────────────────────────────────────────────────
  analyzePlan: (requirements: string) => Promise<PlanAnalysis>;
  extractFeatures: (document: string) => Promise<import('../api/llm/types').ExtractedFeature[]>;
  bulkAddPlans: (items: Array<{ feature: import('../api/llm/types').ExtractedFeature; deferred: boolean }>) => void;

  // ── Conductor (gate chat) ────────────────────────────────
  conductorSessions: Record<string, ConductorSession>;
  conductorArtifacts: Record<string, Record<string, string>>;
  activeConductorGate: { taskId: string; gate: GateName } | null;
  openConductorGate: (taskId: string, gate: GateName) => void;
  closeConductorGate: () => void;
  sendConductorMsg: (taskId: string, gate: GateName, text: string) => Promise<void>;
  approveConductorGate: (taskId: string, gate: GateName) => Promise<void>;
  loadConductorArtifacts: (taskId: string, gate: GateName) => Promise<void>;

  // ── Widget layout ────────────────────────────────────────
  widgetOrder: WidgetId[];
  setWidgetOrder: (order: WidgetId[]) => void;
  widgetSizes: Record<WidgetId, number>;
  setWidgetSize: (id: WidgetId, span: number) => void;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      // ── Settings ────────────────────────────────────────
      settings: DEFAULT_SETTINGS,
      updateSettings: (patch) => {
        set((s) => ({ settings: { ...s.settings, ...patch } }));
      },
      settingsPanelOpen: false,
      toggleSettingsPanel: () => set((s) => ({ settingsPanelOpen: !s.settingsPanelOpen })),

      // ── Connection ──────────────────────────────────────
      fsHandle: null,
      liveApi: null,
      isConnected: false,
      pendingReconnectName: null,

      connect: async () => {
        const result = await connectRepo();
        if (!result.ok) {
          if (result.reason) get().showToast(result.reason, 6000);
          return;
        }
        const api = new LiveApi(result.arbiterHandle, result.rootHandle);
        set({ fsHandle: result.arbiterHandle, liveApi: api, isConnected: true, pendingReconnectName: null });
        void saveRepoHandles(result.arbiterHandle, result.rootHandle);
        get().showToast('Connected to repo — going live', 2500);
        void get().loadArbiterConfig();
        void get().loadAgentsConfig();
        get().startPolling();
      },

      connectWithHandle: async (arbiterHandle, rootHandle) => {
        const api = new LiveApi(arbiterHandle, rootHandle);
        set({ fsHandle: arbiterHandle, liveApi: api, isConnected: true, pendingReconnectName: null });
        void saveRepoHandles(arbiterHandle, rootHandle);
        get().showToast('Connected to repo — going live', 2500);
        void get().loadArbiterConfig();
        void get().loadAgentsConfig();
        get().startPolling();
      },

      restoreConnection: async () => {
        if (get().isConnected) return;
        const saved = await loadRepoHandles();
        if (!saved) return;
        // Only auto-connect when permission is still granted (no prompt → no gesture needed).
        const perm = await queryHandlePermission(saved.root ?? saved.arbiter);
        if (perm === 'granted') {
          await get().connectWithHandle(saved.arbiter, saved.root);
        } else {
          // Surface a one-click reconnect; requestPermission needs a user gesture.
          set({ pendingReconnectName: (saved.root ?? saved.arbiter).name });
        }
      },

      reconnectSaved: async () => {
        const saved = await loadRepoHandles();
        if (!saved) { get().showToast('No saved repo to reconnect', 4000); return false; }
        const target = saved.root ?? saved.arbiter;
        const perm = await requestHandlePermission(target);
        if (perm !== 'granted') {
          get().showToast('Permission denied — pick the folder again', 5000);
          return false;
        }
        // Ensure the arbiter handle is also usable when root and arbiter differ.
        if (saved.root && saved.root !== saved.arbiter) await requestHandlePermission(saved.arbiter);
        await get().connectWithHandle(saved.arbiter, saved.root);
        return true;
      },

      connectDev: async (repoRoot: string) => {
        const arbiterPath = `${repoRoot}/.arbiter`;
        const api = new ServerApi(arbiterPath, repoRoot) as unknown as LiveApi;
        set({ fsHandle: null, liveApi: api, isConnected: true });
        get().showToast('Connected via server (dev mode)', 2500);
        void get().loadArbiterConfig();
        void get().loadAgentsConfig();
        get().startPolling();
      },

      // ── Arbiter state ────────────────────────────────────
      arbiterState: { jobs: [] },
      pendingEngineGates: [],
      resolveEngineGate: async (gateId, decision) => {
        const { liveApi } = get();
        if (!liveApi) { get().showToast('Connect the repo first'); return; }
        const api = liveApi as unknown as { resolveGate?: (id: string, d: 'approved' | 'rejected') => Promise<boolean> };
        const ok = api.resolveGate ? await api.resolveGate(gateId, decision) : false;
        if (ok) {
          // Optimistically drop it from the list; the next poll reconciles.
          set((s) => ({ pendingEngineGates: s.pendingEngineGates.filter((g) => g.gate_id !== gateId) }));
          get().showToast(`Gate ${decision}`);
        } else {
          get().showToast('Gate already resolved or not found', 4000);
        }
      },
      laneCards: [],
      loadLanes: async () => {
        const { liveApi } = get();
        if (!liveApi) return;
        const api = liveApi as unknown as {
          listTaskIds?: () => Promise<string[]>;
          readTaskState?: (id: string) => Promise<{ sub_tasks?: Record<string, { agent_role: string; status: string }> } | null>;
          readPendingGates?: () => Promise<Array<{ gate_id: string; task_id: string; type: string; sub_task?: string; status: string }>>;
        };
        if (!api.listTaskIds || !api.readTaskState) return;
        const ids = await api.listTaskIds();
        const gates = (await api.readPendingGates?.() ?? []).filter(g => g.status === 'pending');
        const gateByTask = new Map(gates.map(g => [g.task_id, { type: g.type, subTask: g.sub_task, gateId: g.gate_id }]));
        const rank = (s: string) => (s === 'in_progress' ? 3 : s === 'failed' ? 2 : s === 'pending' ? 1 : 0);
        const snapshots: TaskSnapshot[] = [];
        for (const id of ids) {
          const st = await api.readTaskState!(id);
          const agentStatus: Record<string, string> = {};
          for (const sub of Object.values(st?.sub_tasks ?? {})) {
            const cur = agentStatus[sub.agent_role];
            if (!cur || rank(sub.status) > rank(cur)) agentStatus[sub.agent_role] = sub.status;
          }
          snapshots.push({ taskId: id, title: id, agentStatus, pendingGate: gateByTask.get(id) });
        }
        set({ laneCards: deriveCards(DEFAULT_FLOW, snapshots) });
      },

      createBrainstormTask: async (title, idea, attachment) => {
        const { liveApi } = get();
        if (!liveApi) { get().showToast('Connect a repo first'); return null; }
        const api = liveApi as unknown as { writeRepoFile?: (p: string, c: string) => Promise<void> };
        if (!api.writeRepoFile) { get().showToast('This connection cannot create tasks'); return null; }
        const slug = title.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'IDEA';
        const stamp = Date.now().toString(36).slice(-5).toUpperCase();
        const taskId = `${slug}-${stamp}`;
        const md = `# ${title.trim()}\n\n${idea.trim()}\n`;
        // A minimal state placing the task in the Brainstorm lane (ideation in progress).
        const state = { task_id: taskId, phase: 'brainstorm', sub_tasks: { ideation: { agent_role: 'ideation', status: 'in_progress' } } };
        try {
          await api.writeRepoFile(`arbiter/tasks/${taskId}/task.md`, md);
          await api.writeRepoFile(`arbiter/tasks/${taskId}/state.json`, JSON.stringify(state, null, 2));
          if (attachment && attachment.content) {
            const safe = attachment.name.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'attachment.md';
            await api.writeRepoFile(`arbiter/tasks/${taskId}/attachments/${safe}`, attachment.content);
          }
          await get().loadLanes();
          get().showToast(`Started brainstorm: ${taskId}`);
          return taskId;
        } catch (e) {
          get().showToast(`Could not create task: ${(e as Error).message}`, 5000);
          return null;
        }
      },
      cliStats: null,
      agentData: {},
      messages: [],
      lastUpdated: null,

      sendAgentMessage: async (to, text, ticket) => {
        const body = text.trim();
        if (!body) return;
        const { liveApi } = get();
        if (!liveApi) { get().showToast('Connect the repo first'); return; }
        const msg: CliMessage = { from: 'pedram', to, text: body, ts: new Date().toISOString() };
        if (ticket) msg.ticket = ticket;
        await liveApi.appendMessage(msg);
        set((s) => ({ messages: [...s.messages, msg] }));
        get().showToast(`Sent to ${to}`);
      },
      _pollInterval: null,

      poll: async () => {
        const { liveApi } = get();
        if (!liveApi) return;
        const [state, stats, agents, msgs, board, engineGates] = await Promise.all([
          liveApi.readState(),
          liveApi.readCliStats(),
          liveApi.readAgents(),
          liveApi.readMessages(),
          liveApi.readBoard(),
          liveApi.readPendingGates(),
        ]);

        // Collect tickets to probe: board-based active ones + any plan marked "ready"
        const activeTickets = activeExecPlanTickets(board);
        const readyTickets = get().plans
          .filter((p) => p.status === 'ready' && p.ticket)
          .map((p) => p.ticket!);
        const toProbe = [...new Set([...activeTickets, ...readyTickets])];

        // Probe exec-plan stage dirs live (bypasses board.json staleness)
        const execPlanDir = get().arbiterConfig.exec_plan_dir;
        const EXEC_STAGES = [
          { dir: '02-incubating', status: 'building' as const },
          { dir: '03-building',   status: 'building' as const },
          { dir: '04-human-gate', status: 'building' as const },
          { dir: '05-review',     status: 'building' as const },
          { dir: '06-completed',  status: 'done'     as const },
          { dir: '07-failed',     status: 'failed'   as const },
        ];
        const execPlanFiles: Record<string, ExecPlanFile[]> = {};
        const execPlanStage: Record<string, typeof EXEC_STAGES[number]> = {};
        await Promise.all(
          toProbe.map(async (ticket) => {
            for (const stg of EXEC_STAGES) {
              const files = await liveApi.listExecPlanFolder(stg.dir, ticket, execPlanDir);
              if (files.length > 0) {
                execPlanFiles[ticket] = files;
                execPlanStage[ticket] = stg;
                break;
              }
            }
          })
        );

        // Merge synthetic jobs (from live exec-plan scan) with real mcp-state jobs; real takes precedence
        const realJobs = (state ?? get().arbiterState).jobs ?? [];
        const synthetic = synthesizeJobsFromBoard(board, execPlanFiles, realJobs, execPlanStage);
        const mergedJobs = [...realJobs, ...synthetic];

        // Auto-inject gate messages when a new pending_approval arrives
        const prevApprovalId = get().arbiterState.pending_approval?.id ?? null;
        const newApproval = state?.pending_approval;
        const newApprovalId = newApproval?.id ?? null;
        const messages = msgs;
        if (newApprovalId && newApprovalId !== prevApprovalId && newApproval) {
          const ticket = newApproval.ticket ?? newApproval.job_id;
          const alreadyHas = messages.some(
            (m) => m.from === 'conductor' && m.ticket === ticket &&
                   m.text.includes(newApprovalId),
          );
          if (!alreadyHas && ticket) {
            const details = newApproval.details
              ? Object.entries(newApproval.details)
                  .filter(([, v]) => v != null)
                  .map(([k, v]) => `• ${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
                  .join('\n')
              : '';
            const gateText = [
              `⏸ Gate: ${newApproval.gate_title ?? newApproval.title ?? 'Review needed'}`,
              `[approval-id:${newApprovalId}]`,
              '',
              newApproval.explanation ?? '',
              details ? `\n${details}` : '',
            ].filter(Boolean).join('\n');
            const gateMsg: CliMessage = {
              from: 'conductor',
              ticket,
              text: gateText,
              ts: new Date().toISOString(),
            };
            liveApi.appendMessage(gateMsg).catch(() => {});
            messages.push(gateMsg);
          }
        }

        const baseState = state ?? get().arbiterState;
        const pendingGates = board?.pending_gates ?? baseState.pending_gates ?? [];

        // Auto-open conductor gate when a new gate appears
        const prevPendingGates = get().arbiterState.pending_gates ?? [];
        const newGates = pendingGates.filter(
          (pg) => !prevPendingGates.some((p) => p.task_id === pg.task_id && p.gate === pg.gate)
        );
        if (newGates.length > 0 && !get().activeConductorGate) {
          const first = newGates[0];
          get().openConductorGate(first.task_id, first.gate);
        }

        set({
          arbiterState: { ...baseState, jobs: mergedJobs, pending_gates: pendingGates },
          pendingEngineGates: (engineGates ?? []).filter((g) => g.status === 'pending'),
          cliStats: stats,
          agentData: agents,
          messages,
          lastUpdated: new Date(),
        });
      },

      startPolling: () => {
        get().stopPolling();
        get().poll();
        void get().loadLanes();
        const id = setInterval(() => { get().poll(); void get().loadLanes(); }, 5000);
        set({ _pollInterval: id });
      },

      stopPolling: () => {
        const id = get()._pollInterval;
        if (id) clearInterval(id);
        set({ _pollInterval: null });
      },

      // ── UI state ────────────────────────────────────────
      activeTab: 'arbiter',
      setActiveTab: (tab) => set({ activeTab: tab }),

      expandedJobs: new Set(),
      toggleJobExpand: (id) =>
        set((s) => {
          const prev = s.expandedJobs instanceof Set ? s.expandedJobs : new Set<string>();
          const next = new Set(prev);
          next.has(id) ? next.delete(id) : next.add(id);
          return { expandedJobs: next };
        }),

      showCompleted: false,
      toggleShowCompleted: () => set((s) => ({ showCompleted: !s.showCompleted })),

      toast: null,
      showToast: (msg, duration = 2400) => {
        set({ toast: msg });
        setTimeout(() => set({ toast: null }), duration);
      },

      // ── Modal state ─────────────────────────────────────
      openModal: null,
      setOpenModal: (m) => set({ openModal: m }),
      reviewingJobId: null,
      openPlanReview: (jobId) => set({ reviewingJobId: jobId, openModal: 'planReview' }),
      jobDetailId: null,
      openJobDetail: (id) => set({ jobDetailId: id }),
      closeJobDetail: () => set({ jobDetailId: null }),
      stageDetail: null,
      openStageDetail: (jobId, stageKey) => set({ stageDetail: { jobId, stageKey } }),
      closeStageDetail: () => set({ stageDetail: null }),
      dismissedGateIds: [],
      dismissGate: (id) =>
        set((s) => (s.dismissedGateIds.includes(id) ? {} : { dismissedGateIds: [...s.dismissedGateIds, id] })),

      // ── Job actions ─────────────────────────────────────
      addJob: (analysis) => {
        const newJob = {
          id: 'plan-' + Date.now(),
          ticket: analysis.ticket,
          title: analysis.title,
          app: 'foederata',
          status: 'planned' as const,
          stage_label: 'planned',
          requirements: analysis.requirements,
          complexity: analysis.complexity,
          estimated_stages: analysis.estimated_stages,
          rework_history: [],
          stage_history: [],
          stage_started_at: null,
          queued_at: null,
          started_at: null,
          completed_at: null,
        };
        set((s) => ({
          arbiterState: { ...s.arbiterState, jobs: [newJob, ...s.arbiterState.jobs] },
        }));
        const { liveApi } = get();
        if (liveApi) {
          const md = buildPlanMd(newJob);
          liveApi.writePlanFile(newJob.ticket ?? newJob.id, md).catch(() => {});
        }
      },

      updateJob: (id, patch) =>
        set((s) => ({
          arbiterState: {
            ...s.arbiterState,
            jobs: s.arbiterState.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)),
          },
        })),

      approveJobPlan: (id) => {
        get().updateJob(id, { status: 'plan-ready', stage_label: 'plan-ready' });
        get().showToast('✅ Plan approved — ready to build');
        const { liveApi, arbiterState } = get();
        if (liveApi) {
          const job = arbiterState.jobs.find((j) => j.id === id);
          if (job) liveApi.writePlanFile(job.ticket ?? job.id, buildPlanMd(job)).catch(() => {});
        }
      },

      approveGate: async () => {
        const { liveApi, arbiterState } = get();
        if (!liveApi || !arbiterState.pending_approval) {
          get().showToast('No pending gate to approve');
          return;
        }
        const appr = arbiterState.pending_approval;
        try {
          await liveApi.writeResponse(appr.id, 'approved');
          await liveApi.clearPendingApproval();
          get().showToast('✅ Gate approved — conductor will continue');
          set((s) => ({
            arbiterState: { ...s.arbiterState, pending_approval: null },
          }));
        } catch (e) {
          get().showToast(`Approve failed: ${(e as Error).message}`, 5000);
        }
      },

      // ── Plans backlog ───────────────────────────────────
      plans: [],
      selectedPlanId: null,
      orderPending: false,

      addPlan: (analysis, planType = 'feature') => {
        const id = 'plan-' + Date.now();
        // Only count non-deferred plans so deferred (high-number) priorities don't pollute active queue
        const maxPriority = get().plans.filter((p) => !p.deferred).reduce((m, p) => Math.max(m, p.priority), -1);
        const md = planMdTemplate(analysis);
        const plan: PlanItem = {
          id,
          ticket: analysis.ticket,
          title: analysis.title,
          planType,
          complexity: analysis.complexity,
          priority: maxPriority + 1,
          status: 'draft',
          md,
          estimated_stages: analysis.estimated_stages,
          created_at: new Date().toISOString(),
        };
        set((s) => ({ plans: [...s.plans, plan], selectedPlanId: id }));
        const { liveApi } = get();
        if (liveApi) liveApi.writePlanFile(plan.ticket, md).catch(() => {});
        return id;
      },

      createBlankPlan: () => {
        const n = get().plans.length + 1;
        return get().addPlan({
          ticket: `PLAN-${String(n).padStart(2, '0')}`,
          title: 'Untitled plan',
          complexity: 'Medium',
          requirements: '',
        });
      },

      updatePlanMd: (id, md) => {
        const title = md.match(/^#\s+(.+)$/m)?.[1]?.trim();
        const ticket = md.match(/\*\*Ticket:\*\*\s*(.+?)\s*$/m)?.[1]?.trim();
        set((s) => ({
          plans: s.plans.map((p) =>
            p.id === id
              ? {
                  ...p, md,
                  title: title || p.title,
                  ticket: ticket && ticket !== '—' ? ticket : p.ticket,
                }
              : p,
          ),
        }));
        const plan = get().plans.find((p) => p.id === id);
        const { liveApi } = get();
        if (plan && liveApi) liveApi.writePlanFile(plan.ticket, md).catch(() => {});
      },

      reloadPlanFromDisk: async (id) => {
        const { plans, liveApi } = get();
        const plan = plans.find((p) => p.id === id);
        if (!plan) return;
        if (!liveApi) { get().showToast('Connect repo to read the file'); return; }
        const md = await liveApi.readPlanFile(plan.ticket);
        if (md == null) { get().showToast('No .md file on disk yet'); return; }
        set((s) => ({ plans: s.plans.map((p) => (p.id === id ? { ...p, md } : p)) }));
        get().showToast('Reloaded from disk');
      },

      setPlanExtraDocs: (id, text) => {
        set((s) => ({ plans: s.plans.map((p) => (p.id === id ? { ...p, extraDocs: text } : p)) }));
        const plan = get().plans.find((p) => p.id === id);
        const { liveApi } = get();
        if (plan && liveApi) liveApi.writeExtraDocs(plan.ticket, text).catch(() => {});
      },

      setPlanStatus: (id, status) =>
        set((s) => ({ plans: s.plans.map((p) => (p.id === id ? { ...p, status } : p)) })),

      reorderPlans: (orderedIds) =>
        set((s) => {
          const byId = new Map(s.plans.map((p) => [p.id, p]));
          const reordered = orderedIds
            .map((id) => byId.get(id))
            .filter((p): p is PlanItem => !!p)
            .map((p, i) => ({ ...p, priority: i }));
          const missing = s.plans.filter((p) => !orderedIds.includes(p.id));
          return { plans: [...reordered, ...missing] };
        }),

      movePlan: (id, dir) =>
        set((s) => {
          const sorted = [...s.plans].sort((a, b) => a.priority - b.priority);
          const idx = sorted.findIndex((p) => p.id === id);
          const swap = idx + dir;
          if (idx < 0 || swap < 0 || swap >= sorted.length) return {};
          [sorted[idx], sorted[swap]] = [sorted[swap], sorted[idx]];
          return { plans: sorted.map((p, i) => ({ ...p, priority: i })) };
        }),

      deletePlan: (id) =>
        set((s) => ({
          plans: s.plans.filter((p) => p.id !== id),
          selectedPlanId: s.selectedPlanId === id ? null : s.selectedPlanId,
        })),

      selectPlan: (id) => set({ selectedPlanId: id }),

      importJobAsPlan: async (jobId) => {
        const { arbiterState, plans, liveApi } = get();
        const job = arbiterState.jobs.find((j) => j.id === jobId);
        if (!job) return;
        const ticket = job.ticket ?? job.id;

        const existing = plans.find((p) => p.ticket === ticket);
        if (existing) { get().selectPlan(existing.id); get().showToast('Already in Plans'); return; }

        let md = '';
        if (liveApi) md = (await liveApi.readPlanFile(ticket)) ?? '';
        if (!md) md = buildPlanMd(job);

        const maxPriority = plans.filter((p) => !p.deferred).reduce((m, p) => Math.max(m, p.priority), -1);
        const plan: PlanItem = {
          id: 'plan-' + Date.now(),
          ticket,
          title: job.title,
          planType: 'feature',
          complexity: job.complexity,
          priority: maxPriority + 1,
          status: 'ready',
          md,
          estimated_stages: job.estimated_stages,
          created_at: new Date().toISOString(),
        };
        set((s) => ({ plans: [...s.plans, plan], selectedPlanId: plan.id }));
        get().showToast(`${ticket} imported to Plans`);
      },

      submitToFactory: async (id) => {
        const { plans, liveApi } = get();
        const plan = plans.find((p) => p.id === id);
        if (!plan) return;
        if (!liveApi) { get().showToast('Connect the repo first'); return; }

        try {
          await liveApi.writePlanFile(plan.ticket, plan.md);
          if (plan.extraDocs) await liveApi.writeExtraDocs(plan.ticket, plan.extraDocs);
          const brief = `# ${plan.ticket}\n\n${plan.md}`;
          await liveApi.writeInboxTask(plan.ticket, brief);
          await liveApi.enqueueTask(plan.ticket);
          set((s) => ({ plans: s.plans.map((p) => (p.id === id ? { ...p, status: 'ready' as PlanStatus } : p)) }));
          get().showToast(`${plan.ticket} submitted to factory`);
        } catch (e) {
          get().showToast(`Submit failed: ${(e as Error).message}`, 5000);
        }
      },

      // ── Arbiter config (arbiter.config.json) ─────────────────
      readArbiterConfigRaw: async () => {
        const { liveApi } = get();
        if (!liveApi) return null;
        return liveApi.readArbiterConfigRaw();
      },

      writeArbiterConfigRaw: async (config) => {
        const { liveApi } = get();
        if (!liveApi) { get().showToast('Connect the repo first'); return; }
        try {
          await liveApi.writeArbiterConfigRaw(config);
          get().showToast('arbiter.config.json saved');
        } catch (e) {
          get().showToast(`Save failed: ${(e as Error).message}`, 5000);
        }
      },

      // ── Factory config (legacy foederata path) ────────────────
      readFactoryConfig: async () => {
        const { liveApi } = get();
        if (!liveApi) return null;
        return liveApi.readFactoryConfig();
      },

      writeFactoryConfig: async (config) => {
        const { liveApi } = get();
        if (!liveApi) { get().showToast('Connect the repo first'); return; }
        try {
          await liveApi.writeFactoryConfig(config);
          get().showToast('Factory config saved');
        } catch (e) {
          get().showToast(`Save failed: ${(e as Error).message}`, 5000);
        }
      },

      readRepoFile: async (path) => {
        const { liveApi } = get();
        if (!liveApi) return null;
        return liveApi.readRepoFile(path);
      },

      // ── Arbiter / Agents config ────────────────────────────
      arbiterConfig: DEFAULT_ARBITER_CONFIG,
      agentsConfig: null,

      loadArbiterConfig: async () => {
        const { liveApi } = get();
        if (!liveApi) return;
        const cfg = await liveApi.readArbiterConfig();
        if (cfg) set({ arbiterConfig: { ...DEFAULT_ARBITER_CONFIG, ...cfg } });
      },

      loadAgentsConfig: async () => {
        const { liveApi, arbiterConfig } = get();
        if (!liveApi) return;
        const cfg = await liveApi.readAgentsConfig(arbiterConfig.agents_config_path);
        if (cfg) set({ agentsConfig: cfg });
      },

      // ── LLM ─────────────────────────────────────────────
      analyzePlan: async (requirements) => {
        const { settings, arbiterState } = get();
        const adapter = createLLMAdapter(settings);
        if (!adapter.isConfigured()) {
          await new Promise((r) => setTimeout(r, 1200));
          return {
            ticket: `FEAT-${51 + arbiterState.jobs.filter((j) => j.status === 'planned').length}`,
            title: requirements.split('\n')[0].replace(/^[-*•]\s*/, '').slice(0, 50),
            complexity: 'Medium' as const,
            requirements,
            estimated_stages: { front: '3h', backend: '4h', push: '45m' },
          };
        }
        // Real LLM path — adapter.extractFeatures handles the heavy lifting
        // analyzePlan is a legacy entry point; extractFeatures is preferred
        await new Promise((r) => setTimeout(r, 1200));
        return {
          ticket: `FEAT-${51 + arbiterState.jobs.filter((j) => j.status === 'planned').length}`,
          title: requirements.split('\n')[0].replace(/^[-*•]\s*/, '').slice(0, 50),
          complexity: 'Medium' as const,
          requirements,
          estimated_stages: { front: '3h', backend: '4h', push: '45m' },
        };
      },

      extractFeatures: async (document) => {
        const { settings } = get();
        const adapter = createLLMAdapter(settings);
        if (!adapter.isConfigured()) {
          await new Promise((r) => setTimeout(r, 1500));
          const lines = document.split('\n').filter((l) => l.trim().length > 20).slice(0, 6);
          return lines.map((line, i) => ({
            key: `feature-${i + 1}`,
            title: line.replace(/^[-*#•]\s*/, '').slice(0, 60),
            description: line.trim(),
            planType: 'feature' as const,
            complexity: 'Medium' as const,
          }));
        }
        return adapter.extractFeatures(document);
      },

      bulkAddPlans: (items) => {
        const existingPlans = get().plans;
        const maxActivePriority = existingPlans
          .filter((p) => !p.deferred)
          .reduce((m, p) => Math.max(m, p.priority), -1);
        const maxDeferredPriority = existingPlans
          .filter((p) => p.deferred)
          .reduce((m, p) => Math.max(m, p.priority), 9999);
        let activeOffset = 0;
        let deferredOffset = 0;
        let globalOffset = 0;
        const newPlans: PlanItem[] = items.map(({ feature, deferred }) => {
          const id = `plan-${Date.now()}-${globalOffset++}`;
          const ticket = `FEAT-${60 + existingPlans.length + globalOffset}`;
          const md = `# ${feature.title}\n\n**Ticket:** ${ticket}\n**Type:** ${feature.planType}\n**Complexity:** ${feature.complexity}\n\n## Description\n\n${feature.description}\n`;
          const priority = deferred
            ? maxDeferredPriority + 1 + deferredOffset++
            : maxActivePriority + 1 + activeOffset++;
          return {
            id,
            ticket,
            title: feature.title,
            planType: feature.planType,
            complexity: feature.complexity,
            priority,
            status: 'draft' as const,
            deferred,
            md,
            created_at: new Date().toISOString(),
          };
        });
        set((s) => ({ plans: [...s.plans, ...newPlans] }));
        const { liveApi } = get();
        if (liveApi) {
          newPlans.forEach((p) => liveApi.writePlanFile(p.ticket, p.md).catch(() => {}));
        }
      },

      // ── Conductor (gate chat) ────────────────────────────
      conductorSessions: {},
      conductorArtifacts: {},
      activeConductorGate: null,

      openConductorGate: (taskId, gate) => {
        const existing = get().conductorSessions[taskId];
        if (!existing) {
          set((s) => ({
            conductorSessions: {
              ...s.conductorSessions,
              [taskId]: createConductorSession(taskId, gate),
            },
            activeConductorGate: { taskId, gate },
          }));
        } else {
          set({ activeConductorGate: { taskId, gate } });
        }
        void get().loadConductorArtifacts(taskId, gate);
      },

      closeConductorGate: () => set({ activeConductorGate: null }),

      sendConductorMsg: async (taskId, gate, text) => {
        const session = get().conductorSessions[taskId];
        const artifacts = get().conductorArtifacts[taskId] ?? {};
        const apiKey = get().settings.anthropicApiKey ?? '';
        if (!session) return;
        try {
          const turn = await sendConductorMessage(apiKey, session, text, artifacts);
          set((s) => ({
            conductorSessions: {
              ...s.conductorSessions,
              [taskId]: turn.updatedSession,
            },
          }));
        } catch (e) {
          get().showToast('Conductor error: ' + (e instanceof Error ? e.message : 'unknown'), 4000);
        }
      },

      approveConductorGate: async (taskId, gate) => {
        const { liveApi } = get();
        if (liveApi) {
          await liveApi.writeGateApproval(taskId, gate, 'approved').catch(() => {});
        }
        set((s) => ({
          activeConductorGate: null,
          conductorSessions: {
            ...s.conductorSessions,
            [taskId]: s.conductorSessions[taskId]
              ? { ...s.conductorSessions[taskId], gate_status: 'approved' as const }
              : s.conductorSessions[taskId],
          },
        }));
        get().showToast(`Gate "${gate}" approved — pipeline continuing`, 3000);
      },

      loadConductorArtifacts: async (taskId, _gate) => {
        const { liveApi, arbiterConfig } = get();
        if (!liveApi) return;
        const artifacts: Record<string, string> = {};
        const execPlanDir = arbiterConfig.exec_plan_dir;
        for (const stageDir of ['02-incubating', '03-building', '04-human-gate', '05-review']) {
          try {
            const files = await liveApi.listExecPlanFolder(stageDir, taskId, execPlanDir);
            await Promise.all(
              files.map(async ({ name }) => {
                const content = await liveApi.readRepoFile(
                  `${execPlanDir}/${stageDir}/${taskId}/${name}`
                );
                if (content) artifacts[name] = content;
              })
            );
          } catch { /* stage may not exist */ }
        }
        set((s) => ({
          conductorArtifacts: {
            ...s.conductorArtifacts,
            [taskId]: { ...(s.conductorArtifacts[taskId] ?? {}), ...artifacts },
          },
        }));
      },

      // ── Widget layout ────────────────────────────────────
      widgetOrder: DEFAULT_WIDGET_ORDER,
      setWidgetOrder: (order) => set({ widgetOrder: order }),
      widgetSizes: DEFAULT_WIDGET_SIZES,
      setWidgetSize: (id, span) =>
        set((s) => ({ widgetSizes: { ...s.widgetSizes, [id]: span } })),
    }),
    {
      name: 'pipeline-dashboard-settings',
      partialize: (state) => ({
        settings: state.settings,
        activeTab: state.activeTab,
        widgetOrder: state.widgetOrder,
        widgetSizes: state.widgetSizes,
        plans: state.plans,
        dismissedGateIds: state.dismissedGateIds,
      }),
    }
  )
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function planMdTemplate(a: PlanAnalysis): string {
  const est = a.estimated_stages
    ? Object.entries(a.estimated_stages).map(([k, v]) => `- **${k}:** ${v}`).join('\n')
    : '_Not estimated_';
  return [
    `# ${a.title}`,
    ``,
    `**Ticket:** ${a.ticket}  `,
    `**Complexity:** ${a.complexity}`,
    ``,
    `## 1. Requirements`,
    ``,
    a.requirements || '_Describe what needs to be built…_',
    ``,
    `## 2. Acceptance Criteria`,
    ``,
    `- [ ] _When is this done?_`,
    ``,
    `## 3. Edge Cases & Constraints`,
    ``,
    `- _What could go wrong / special handling_`,
    ``,
    `## 4. Technical Approach`,
    ``,
    `- _FE / BE / DB notes_`,
    ``,
    `## 5. Open Questions`,
    ``,
    `_None_`,
    ``,
    `---`,
    ``,
    `## Estimated Time`,
    ``,
    est,
  ].join('\n');
}

function buildPlanMd(job: import('../api/types').Job): string {
  const s = job.planSections;
  const est = job.estimated_stages
    ? Object.entries(job.estimated_stages).map(([k, v]) => `- **${k}:** ${v}`).join('\n')
    : '_Not estimated_';
  const status = job.status === 'plan-ready' ? '✅ Approved — Ready to Build' : '📋 Draft';
  return [
    `# ${job.title}`,
    ``,
    `**Ticket:** ${job.ticket ?? '—'}  `,
    `**Complexity:** ${job.complexity ?? '—'}  `,
    `**Plan status:** ${status}`,
    ``,
    `## 1. Requirements`,
    ``,
    s?.requirements ?? job.requirements ?? '_Not filled_',
    ``,
    `## 2. Acceptance Criteria`,
    ``,
    s?.acceptance ?? '_Not filled_',
    ``,
    `## 3. Edge Cases & Constraints`,
    ``,
    s?.edgeCases ?? '_Not filled_',
    ``,
    `## 4. Technical Approach`,
    ``,
    s?.technical ?? '_Not filled_',
    ``,
    `## 5. Open Questions`,
    ``,
    s?.openQuestions || '_None_',
    ``,
    `---`,
    ``,
    `## Estimated Time`,
    ``,
    est,
  ].join('\n');
}
