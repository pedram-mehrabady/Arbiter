import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { FULL_TEMPLATES, SPEED_TEMPLATES } from './agentTemplates';
import css from './AgentDocModal.module.css';

// ── Types ─────────────────────────────────────────────────────────────────────

type DocTab = 'rulebook' | 'manifest' | 'terminal';

interface ChatMessage {
  role: 'user' | 'assistant' | 'applied';
  content: string;
}

export interface AgentDocModalProps {
  agentKey: string;
  agentLabel: string;
  agentEmoji: string;
  agentModel: string;
  template: 'full' | 'compact';
  initialTab?: DocTab;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function agentDocPath(template: 'full' | 'compact', agentKey: string, file: 'rulebook.md' | 'manifest.md') {
  const slug = template === 'compact' ? 'speed' : 'full';
  return `.arbiter/factory/${slug}/agents/${agentKey}/${file}`;
}

function buildTermCmd(agentModel: string, template: 'full' | 'compact', agentKey: string, os: string) {
  const slug = template === 'compact' ? 'speed' : 'full';
  const rbPath = `.arbiter/factory/${slug}/agents/${agentKey}/rulebook.md`;
  const mfPath = `.arbiter/factory/${slug}/agents/${agentKey}/manifest.md`;

  if (os === 'win') {
    const rbWin = rbPath.replace(/\//g, '\\');
    const mfWin = mfPath.replace(/\//g, '\\');
    return `claude --model ${agentModel} \`\n  --dangerously-skip-permissions \`\n  --system-prompt (Get-Content "${rbWin}") \`\n  -p (Get-Content "${mfWin}")`;
  }
  return `claude --model ${agentModel} \\\n  --dangerously-skip-permissions \\\n  --system-prompt "$(cat ${rbPath})" \\\n  -p "$(cat ${mfPath})"`;
}

function looksLikeFileContent(text: string): boolean {
  const trimmed = text.trim();
  const lines = trimmed.split('\n');
  return lines.length > 3 && (trimmed.startsWith('#') || trimmed.startsWith('- '));
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AgentDocModal({
  agentKey,
  agentLabel,
  agentEmoji,
  agentModel,
  template,
  initialTab = 'rulebook',
  onClose,
}: AgentDocModalProps) {
  const settings = useAppStore((s) => s.settings);
  const repoPath  = settings.repoPath;
  const os        = settings.os;

  const [activeTab, setActiveTab]       = useState<DocTab>(initialTab);
  const [rulebook,  setRulebook]        = useState('');
  const [manifest,  setManifest]        = useState('');
  const [hasRulebook, setHasRulebook]   = useState(false);
  const [hasManifest, setHasManifest]   = useState(false);
  const [loading,   setLoading]         = useState(true);
  const [dirty,     setDirty]           = useState(false);
  const [saving,    setSaving]          = useState(false);
  const [messages,  setMessages]        = useState<ChatMessage[]>([]);
  const [draft,     setDraft]           = useState('');
  const [busy,      setBusy]            = useState(false);

  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const rbPath = agentDocPath(template, agentKey, 'rulebook.md');
  const mfPath = agentDocPath(template, agentKey, 'manifest.md');
  const termCmd = buildTermCmd(agentModel, template, agentKey, os);

  // ── Load files on mount ───────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      setLoading(true);
      const root = repoPath || undefined;

      async function readFile(path: string): Promise<string | null> {
        try {
          const params = new URLSearchParams({ path });
          if (root) params.set('root', root);
          const res = await fetch(`/api/repo-read?${params}`);
          const data = await res.json() as { ok: boolean; content?: string };
          return data.ok ? (data.content ?? '') : null;
        } catch { return null; }
      }

      const [rb, mf] = await Promise.all([readFile(rbPath), readFile(mfPath)]);
      setHasRulebook(rb !== null);
      setHasManifest(mf !== null);
      if (rb !== null) setRulebook(rb);
      if (mf !== null) setManifest(mf);
      setLoading(false);
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rbPath, mfPath]);

  // ── Escape to close ───────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ── Scroll chat ───────────────────────────────────────────────────────────

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  // ── Initialize from template ──────────────────────────────────────────────

  const initialize = useCallback(async () => {
    const templates = template === 'compact' ? SPEED_TEMPLATES : FULL_TEMPLATES;
    const tpl = templates[agentKey];
    if (!tpl) return;

    const root = repoPath || undefined;
    async function writeFile(path: string, content: string) {
      await fetch('/api/repo-write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content, ...(root ? { root } : {}) }),
      });
    }

    await Promise.all([writeFile(rbPath, tpl.rulebook), writeFile(mfPath, tpl.manifest)]);
    setRulebook(tpl.rulebook);
    setManifest(tpl.manifest);
    setHasRulebook(true);
    setHasManifest(true);
    setDirty(false);
  }, [template, agentKey, repoPath, rbPath, mfPath]);

  // ── Save current file ─────────────────────────────────────────────────────

  const save = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    const root = repoPath || undefined;
    const isRulebook = activeTab === 'rulebook';
    const path = isRulebook ? rbPath : mfPath;
    const content = isRulebook ? rulebook : manifest;
    try {
      await fetch('/api/repo-write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content, ...(root ? { root } : {}) }),
      });
      setDirty(false);
      if (isRulebook) setHasRulebook(true); else setHasManifest(true);
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, activeTab, rbPath, mfPath, rulebook, manifest, repoPath]);

  // ── Run agent in terminal ─────────────────────────────────────────────────

  const runAgent = useCallback(async () => {
    const platformOs = os === 'win' ? 'win' : 'mac';
    // Use bash -c on mac, cmd /k on windows
    const cmd  = platformOs === 'win' ? 'cmd'  : 'bash';
    const args = platformOs === 'win'
      ? ['/k', termCmd.replace(/\\\n\s+/g, ' ')]
      : ['-c', termCmd.replace(/\\\n\s+/g, ' ')];
    await fetch('/api/launch-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd, args, os: platformOs }),
    });
  }, [os, termCmd]);

  // ── Chat send ─────────────────────────────────────────────────────────────

  const sendChat = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;

    const provider = settings.assistantProvider;
    const model    = settings.assistantModel || 'claude-opus-4-7';
    if (!provider) return;

    const currentContent = activeTab === 'manifest' ? manifest : rulebook;
    const fileLabel = activeTab === 'manifest' ? 'manifest' : 'rule book';

    const systemMsg = [
      `You are editing the ${fileLabel} for the ${agentLabel} agent in an AI development pipeline.`,
      `The user will ask you to make changes to the document.`,
      `Return ONLY the updated markdown file content — no preamble, no explanation, just the file.`,
      `Current file content:\n\n${currentContent}`,
    ].join('\n');

    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setDraft('');
    setBusy(true);

    try {
      const res = await fetch('/api/run-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model,
          apiKey: settings.anthropicApiKey || undefined,
          messages: [
            { role: 'user', content: systemMsg },
            { role: 'user', content: text },
          ],
        }),
      });
      const data = await res.json() as { ok: boolean; reply?: string; error?: string };
      const reply = data.ok ? (data.reply ?? '') : `Error: ${data.error}`;

      if (data.ok && looksLikeFileContent(reply)) {
        if (activeTab === 'rulebook' || activeTab === 'manifest') {
          if (activeTab === 'rulebook') setRulebook(reply.trim());
          else setManifest(reply.trim());
          setDirty(true);
          setMessages((prev) => [...prev, { role: 'applied', content: '✓ Applied to editor — review and save.' }]);
        } else {
          setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
        }
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
      }
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Network error: ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }, [draft, busy, settings, activeTab, rulebook, manifest, agentLabel, messages]);

  function onChatKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const filesExist = hasRulebook || hasManifest;
  const currentContent = activeTab === 'rulebook' ? rulebook : manifest;
  const templateSlug = template === 'compact' ? 'speed' : 'full';
  const activePath = activeTab === 'rulebook' ? rbPath : activeTab === 'manifest' ? mfPath : '';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={css.overlay} onClick={onClose}>
      <div className={css.modal} onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className={css.header}>
          <div className={css.headerTitle}>
            <span className={css.headerEmoji}>{agentEmoji}</span>
            {agentLabel} — Docs
          </div>
          {activePath && (
            <span className={css.headerPath}>{activePath}</span>
          )}
          <button className={css.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div className={css.body}>

          {/* ── Left panel ─────────────────────────────────────────── */}
          <div className={css.leftPanel}>
            <div className={css.tabBar}>
              {(['rulebook', 'manifest', 'terminal'] as DocTab[]).map((t) => (
                <button
                  key={t}
                  className={`${css.tab}${activeTab === t ? ' ' + css.tabActive : ''}`}
                  onClick={() => setActiveTab(t)}
                >
                  {t === 'terminal' ? '⌨ terminal' : `${t}.md`}
                </button>
              ))}
            </div>

            <div className={css.editorWrap}>
              {loading ? (
                <div className={css.spinnerWrap}>
                  <div className={css.spinner} />
                  <span>Reading from repo…</span>
                </div>
              ) : activeTab === 'terminal' ? (
                <div className={css.terminalContent}>
                  <div className={css.terminalLabel}>
                    {os === 'win' ? '🪟 Windows (PowerShell)' : '🍎 Mac / Linux (bash)'}
                  </div>
                  <pre className={css.terminalCmdBlock}>{termCmd}</pre>
                  <div className={css.terminalActions}>
                    <button
                      className={css.terminalBtn}
                      onClick={() => navigator.clipboard.writeText(termCmd).catch(() => {})}
                    >
                      📋 Copy
                    </button>
                    <button className={css.terminalBtn} onClick={runAgent}>
                      ▶ Run in terminal
                    </button>
                  </div>
                  <div className={css.terminalNote}>
                    Opens a new terminal window and runs the agent using the manifest from{' '}
                    <code>.arbiter/factory/{templateSlug}/agents/{agentKey}/</code>
                  </div>
                </div>
              ) : !filesExist ? (
                <div className={css.initCta}>
                  <div className={css.initCtaCard}>
                    <div className={css.initCtaIcon}>📄</div>
                    <div className={css.initCtaTitle}>No docs yet</div>
                    <div className={css.initCtaDesc}>
                      Create default rule book and manifest for this agent in{' '}
                      <code>.arbiter/factory/{templateSlug}/agents/{agentKey}/</code>
                    </div>
                    <button className={css.saveBtn} onClick={initialize}>
                      Initialize from template
                    </button>
                  </div>
                </div>
              ) : (
                <textarea
                  ref={textareaRef}
                  className={css.editor}
                  value={currentContent}
                  onChange={(e) => {
                    if (activeTab === 'rulebook') setRulebook(e.target.value);
                    else setManifest(e.target.value);
                    setDirty(true);
                  }}
                  spellCheck={false}
                />
              )}
            </div>
          </div>

          {/* ── Right panel (chat) ──────────────────────────────────── */}
          <div className={css.rightPanel}>
            <div className={css.chatHdr}>
              💬 Edit with assistant
            </div>

            {!settings.assistantProvider ? (
              <div className={css.chatNotice}>
                Configure an assistant in Settings to enable AI-powered editing.
              </div>
            ) : (
              <>
                <div className={css.chatMessages}>
                  {messages.length === 0 && !busy && (
                    <div className={css.chatEmpty}>
                      <span className={css.chatEmptyIcon}>✏️</span>
                      <span>Ask me to edit the active document.</span>
                      <span style={{ fontSize: 11, opacity: 0.6 }}>
                        e.g. "Add a rule: never import from other modules"
                      </span>
                    </div>
                  )}
                  {messages.map((m, i) => (
                    <div
                      key={i}
                      className={`${css.msgRow} ${
                        m.role === 'user'    ? css.msgRowUser
                        : css.msgRowAssistant
                      }`}
                    >
                      <div
                        className={`${css.bubble} ${
                          m.role === 'user'    ? css.bubbleUser
                          : m.role === 'applied' ? css.bubbleApplied
                          : css.bubbleAssistant
                        }`}
                      >
                        {m.content}
                      </div>
                    </div>
                  ))}
                  {busy && (
                    <div className={`${css.msgRow} ${css.msgRowAssistant}`}>
                      <div className={`${css.bubble} ${css.bubbleThinking}`}>Thinking…</div>
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>

                <div className={css.chatInputRow}>
                  <textarea
                    className={css.chatInput}
                    placeholder="Ask to edit the active doc… (Enter to send)"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onChatKeyDown}
                    rows={1}
                    disabled={busy || activeTab === 'terminal'}
                  />
                  <button
                    className={css.chatSendBtn}
                    onClick={sendChat}
                    disabled={!draft.trim() || busy || activeTab === 'terminal'}
                  >
                    {busy ? '…' : '↑'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className={css.footer}>
          <button
            className={css.saveBtn}
            onClick={save}
            disabled={!dirty || saving || activeTab === 'terminal'}
          >
            {saving ? 'Saving…' : '💾 Save'}
          </button>
          <button className={css.initBtn} onClick={initialize}>
            Initialize from template
          </button>
          {dirty && <span className={css.dirtyDot}>• Unsaved changes</span>}
        </div>
      </div>
    </div>
  );
}
