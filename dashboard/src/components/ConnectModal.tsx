import { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import type { OsType } from '../api/types';
import css from './ConnectModal.module.css';

// ── Provider registry ────────────────────────────────────────────────────────

const PROVIDER_OPTIONS = [
  { value: 'claude_max_cli',  label: 'Claude CLI (Max)',      type: 'cli'   },
  { value: 'anthropic_api',   label: 'Anthropic API',         type: 'api'   },
  { value: 'openai_api',      label: 'OpenAI-compatible API', type: 'api'   },
  { value: 'local_mac_ollama',label: 'Local model (Ollama)',  type: 'local' },
] as const;

type ProviderKey = typeof PROVIDER_OPTIONS[number]['value'];

const PROVIDER_DEFAULTS: Record<ProviderKey, Record<string, string>> = {
  claude_max_cli:   { cmd: 'claude', headless_flag: '-p' },
  anthropic_api:    { base_url: 'https://api.anthropic.com', api_key: '' },
  openai_api:       { base_url: 'https://api.openai.com/v1', api_key: '' },
  local_mac_ollama: { endpoint: 'http://localhost:11434/api/generate' },
};

const KNOWN_PROVIDERS = new Set(PROVIDER_OPTIONS.map((p) => p.value));

// ── Types ────────────────────────────────────────────────────────────────────

interface RoleEntry  { provider: string; model: string; [k: string]: string; }
interface FullConfig {
  roles:     Record<string, RoleEntry>;
  providers: Record<string, Record<string, string>>;
  [k: string]: unknown;
}

// ── Component ────────────────────────────────────────────────────────────────

export function ConnectModal() {
  const {
    openModal, setOpenModal,
    settings, updateSettings,
    isConnected, connect,
    readArbiterConfigRaw, writeArbiterConfigRaw,
  } = useAppStore(useShallow((s) => ({
    openModal:              s.openModal,
    setOpenModal:           s.setOpenModal,
    settings:               s.settings,
    updateSettings:         s.updateSettings,
    isConnected:            s.isConnected,
    connect:                s.connect,
    readArbiterConfigRaw:   s.readArbiterConfigRaw,
    writeArbiterConfigRaw:  s.writeArbiterConfigRaw,
  })));

  const [fullConfig,   setFullConfig]   = useState<FullConfig | null>(null);
  const [configDirty,  setConfigDirty]  = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [saveMsg,      setSaveMsg]      = useState('');

  // Load arbiter.config.json when modal opens and repo is connected
  useEffect(() => {
    if (openModal !== 'connect') return;
    if (!isConnected) return;
    setConfigDirty(false);
    setSaveMsg('');
    readArbiterConfigRaw().then((raw) => {
      if (raw && typeof raw === 'object' && 'roles' in raw) {
        const cfg = raw as FullConfig;
        if (!cfg.providers) cfg.providers = {};
        setFullConfig(cfg);
      }
    });
  }, [openModal, isConnected]);

  if (openModal !== 'connect') return null;

  function close() { setOpenModal(null); }

  // ── Role mutations ──────────────────────────────────────────────────────────

  function handleProviderChange(agent: string, provider: string) {
    setFullConfig((prev) => {
      if (!prev) return prev;
      const providers = { ...prev.providers };
      // Inject default provider config if first use of this provider
      if (!providers[provider] && KNOWN_PROVIDERS.has(provider as ProviderKey)) {
        providers[provider] = { ...PROVIDER_DEFAULTS[provider as ProviderKey] };
      }
      return {
        ...prev,
        providers,
        roles: {
          ...prev.roles,
          [agent]: { ...prev.roles[agent], provider },
        },
      };
    });
    setConfigDirty(true);
  }

  function handleModelChange(agent: string, model: string) {
    setFullConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        roles: { ...prev.roles, [agent]: { ...prev.roles[agent], model } },
      };
    });
    setConfigDirty(true);
  }

  // ── Provider credential mutations ───────────────────────────────────────────

  function handleProviderField(providerKey: string, field: string, value: string) {
    setFullConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        providers: {
          ...prev.providers,
          [providerKey]: { ...prev.providers[providerKey], [field]: value },
        },
      };
    });
    setConfigDirty(true);
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  async function saveConfig() {
    if (!fullConfig || !configDirty) return;
    setSaving(true);
    try {
      await writeArbiterConfigRaw(fullConfig);
      setConfigDirty(false);
      setSaveMsg('Saved ✓');
      setTimeout(() => setSaveMsg(''), 2500);
    } catch (e) {
      setSaveMsg(`Error: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  // ── Set all agents to the same model ───────────────────────────────────────

  function applyModelToAll(model: string) {
    setFullConfig((prev) => {
      if (!prev) return prev;
      const roles = Object.fromEntries(
        Object.entries(prev.roles).map(([k, v]) => [k, { ...v, model }])
      );
      return { ...prev, roles };
    });
    setConfigDirty(true);
  }

  // ── Derived data ─────────────────────────────────────────────────────────────

  const roles         = fullConfig?.roles     ?? {};
  const providerCfgs  = fullConfig?.providers ?? {};

  // Unique providers currently assigned to any role
  const usedProviders = [...new Set(Object.values(roles).map((r) => r.provider))];

  return (
    <div className="modal-overlay" onClick={close}>
      <div
        className={`modal ${css.modal}`}
        style={{ maxWidth: 560 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="modal-hdr">
          <div>
            <div className="modal-title">⚙ Factory settings</div>
            <div className="modal-sub">Configure providers, models &amp; credentials — saved to arbiter.config.json</div>
          </div>
          <button className="modal-close" onClick={close}>✕</button>
        </div>

        {/* ── Scrollable body ── */}
        <div className={css.body}>

          {/* Connection status */}
          <div className={css.connRow}>
            <span className={`${css.connStatus}${isConnected ? ' ' + css.connStatusOk : ''}`}>
              <span className={`${css.connDot}${isConnected ? ' ' + css.connDotOk : ''}`} />
              {isConnected ? 'Connected — live data' : 'Not connected — showing preview'}
            </span>
            {!isConnected && (
              <button className={css.connectBtn} onClick={() => connect()}>
                Connect repo →
              </button>
            )}
          </div>

          <div className={css.divider} />

          {/* Repo path */}
          <div className={css.field}>
            <span className={css.fieldLabel}>Repository</span>
            <div className={css.repoRow}>
              <input
                className={css.input}
                type="text"
                placeholder="/Users/yourname/my-project"
                value={settings.repoPath}
                onChange={(e) => updateSettings({ repoPath: e.target.value.replace(/\/+$/, '') })}
              />
              <button className={css.folderBtn} onClick={() => connect()} title="Browse for project folder">
                📁
              </button>
            </div>
          </div>

          {/* OS */}
          <div className={css.field}>
            <span className={css.fieldLabel}>Operating system</span>
            <div className={css.osToggle}>
              {(['mac', 'win'] as OsType[]).map((os) => (
                <button
                  key={os}
                  className={`${css.osBtn}${settings.os === os ? ' ' + css.osBtnActive : ''}`}
                  onClick={() => updateSettings({ os })}
                >
                  {os === 'mac' ? '🍎 Mac' : '🪟 Windows'}
                </button>
              ))}
            </div>
          </div>

          <div className={css.divider} />

          {/* Anthropic API key (for document extraction) */}
          <label className={css.field}>
            <span className={css.fieldLabel}>Anthropic API key</span>
            <span className={css.fieldHint}>Used for document feature extraction (claude-opus-4-7)</span>
            <input
              className={css.input}
              type="password"
              placeholder="sk-ant-…"
              value={settings.anthropicApiKey}
              onChange={(e) => updateSettings({ anthropicApiKey: e.target.value })}
            />
          </label>

          {/* Factory config — only when connected and loaded */}
          {isConnected && fullConfig && (
            <>
              <div className={css.divider} />

              {/* ── Provider credentials ── */}
              <div className={css.sectionLabel}>Provider credentials</div>
              <div className={css.sectionHint}>
                Configure once — all agents using a provider share its credentials
              </div>

              <div className={css.providerList}>
                {usedProviders.map((pKey) => {
                  const option = PROVIDER_OPTIONS.find((o) => o.value === pKey);
                  const cfg    = providerCfgs[pKey] ?? {};
                  const type   = option?.type ?? (pKey.includes('cli') ? 'cli' : pKey.includes('local') ? 'local' : 'api');

                  return (
                    <div key={pKey} className={css.providerCard}>
                      <div className={css.providerCardHeader}>
                        <span className={css.providerName}>{option?.label ?? pKey}</span>
                        <span className={`${css.providerBadge} ${css[`badge_${type}`] ?? ''}`}>
                          {type === 'cli' ? 'CLI' : type === 'local' ? 'LOCAL' : 'API'}
                        </span>
                      </div>

                      {type === 'cli' && (
                        <div className={css.cliSetup}>
                          <div className={css.cliSetupNote}>
                            Calls <code>{cfg.cmd ?? 'claude'} {cfg.headless_flag ?? '-p'}</code> directly — requires Claude Code CLI installed &amp; logged in with a <strong>Claude Max</strong> subscription.
                          </div>
                          <div className={css.cliSteps}>
                            <div className={css.cliStep}>
                              <span className={css.cliStepNum}>1</span>
                              <div>
                                <div className={css.cliStepLabel}>Install Claude Code CLI <span className={css.cliOnce}>(once)</span></div>
                                <div className={css.cliCmdRow}>
                                  <code className={css.cliCmd}>npm install -g @anthropic-ai/claude-code</code>
                                  <button className={css.cliCopy} onClick={() => navigator.clipboard.writeText('npm install -g @anthropic-ai/claude-code')}>Copy</button>
                                </div>
                              </div>
                            </div>
                            <div className={css.cliStep}>
                              <span className={css.cliStepNum}>2</span>
                              <div>
                                <div className={css.cliStepLabel}>Log in with your Claude Max account <span className={css.cliOnce}>(once)</span></div>
                                <div className={css.cliCmdRow}>
                                  <code className={css.cliCmd}>claude login</code>
                                  <button className={css.cliCopy} onClick={() => navigator.clipboard.writeText('claude login')}>Copy</button>
                                </div>
                                <div className={css.cliStepSub}>Opens a browser tab — sign in with your Claude account</div>
                              </div>
                            </div>
                            <div className={css.cliStep}>
                              <span className={css.cliStepNum}>3</span>
                              <div>
                                <div className={css.cliStepLabel}>Verify it works</div>
                                <div className={css.cliCmdRow}>
                                  <code className={css.cliCmd}>claude -p "ping"</code>
                                  <button className={css.cliCopy} onClick={() => navigator.clipboard.writeText('claude -p "ping"')}>Copy</button>
                                </div>
                                <div className={css.cliStepSub}>Should print a short reply — factory is ready</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {type === 'api' && (
                        <div className={css.providerFields}>
                          <label className={css.providerFieldRow}>
                            <span className={css.providerFieldLabel}>API key</span>
                            <input
                              className={css.providerInput}
                              type="password"
                              placeholder="sk-…"
                              value={cfg.api_key ?? ''}
                              onChange={(e) => handleProviderField(pKey, 'api_key', e.target.value)}
                            />
                          </label>
                          <label className={css.providerFieldRow}>
                            <span className={css.providerFieldLabel}>Base URL</span>
                            <input
                              className={css.providerInput}
                              type="text"
                              value={cfg.base_url ?? ''}
                              onChange={(e) => handleProviderField(pKey, 'base_url', e.target.value)}
                            />
                          </label>
                        </div>
                      )}

                      {type === 'local' && (
                        <div className={css.providerFields}>
                          <label className={css.providerFieldRow}>
                            <span className={css.providerFieldLabel}>Endpoint</span>
                            <input
                              className={css.providerInput}
                              type="text"
                              placeholder="http://localhost:11434/api/generate"
                              value={cfg.endpoint ?? cfg.base_url ?? ''}
                              onChange={(e) => handleProviderField(pKey, 'endpoint', e.target.value)}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className={css.divider} />

              {/* ── Agent roles ── */}
              <div className={css.sectionLabel}>Factory agent models</div>
              <div className={css.sectionHint}>
                Saved to <code>arbiter.config.json</code>
              </div>

              {/* Quick-pick: apply one model to all agents */}
              <div className={css.allModelRow}>
                <span className={css.allModelLabel}>Set all agents to:</span>
                {[
                  { model: 'claude-opus-4-7',         label: 'Opus 4.7'    },
                  { model: 'claude-sonnet-4-6',        label: 'Sonnet 4.6'  },
                  { model: 'claude-haiku-4-5-20251001',label: 'Haiku 4.5'   },
                ].map(({ model, label }) => (
                  <button
                    key={model}
                    className={css.allModelBtn}
                    onClick={() => applyModelToAll(model)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className={css.agentTable}>
                <div className={`${css.agentRow} ${css.agentRowHeader}`}>
                  <span className={css.agentName}>agent</span>
                  <span className={css.agentProvider}>provider</span>
                  <span className={css.agentModel}>model</span>
                </div>
                {Object.entries(roles)
                  .filter(([k]) => !k.startsWith('_'))
                  .map(([agent, entry]) => (
                    <div key={agent} className={css.agentRow}>
                      <span className={css.agentName}>{agent}</span>

                      <select
                        className={css.agentSelect}
                        value={KNOWN_PROVIDERS.has(entry.provider as ProviderKey) ? entry.provider : 'claude_max_cli'}
                        onChange={(e) => handleProviderChange(agent, e.target.value)}
                      >
                        {PROVIDER_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                        {/* Preserve unknown provider values */}
                        {!KNOWN_PROVIDERS.has(entry.provider as ProviderKey) && (
                          <option value={entry.provider}>{entry.provider}</option>
                        )}
                      </select>

                      <input
                        className={css.agentInput}
                        type="text"
                        value={entry.model ?? ''}
                        placeholder="claude-opus-4-7"
                        onChange={(e) => handleModelChange(agent, e.target.value)}
                      />
                    </div>
                  ))}
              </div>

              {/* Save factory config */}
              <div className={css.saveRow}>
                {saveMsg && (
                  <span className={saveMsg.startsWith('Error') ? css.saveError : css.saveOk}>
                    {saveMsg}
                  </span>
                )}
                <button
                  className={css.saveConfigBtn}
                  onClick={saveConfig}
                  disabled={!configDirty || saving}
                >
                  {saving ? 'Saving…' : '💾 Save factory config'}
                </button>
              </div>
            </>
          )}

          {/* Footer */}
          <div className={css.footer}>
            <button className={css.saveBtn} onClick={close}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
