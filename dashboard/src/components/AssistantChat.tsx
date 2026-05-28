import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import css from './AssistantChat.module.css';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function AssistantChat() {
  const { settings, setOpenModal } = useAppStore(useShallow((s) => ({
    settings:     s.settings,
    setOpenModal: s.setOpenModal,
  })));

  const [open, setOpen]         = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft]       = useState('');
  const [busy, setBusy]         = useState(false);
  const bottomRef               = useRef<HTMLDivElement>(null);
  const textareaRef             = useRef<HTMLTextAreaElement>(null);

  const provider = settings.assistantProvider;
  const model    = settings.assistantModel || 'claude-opus-4-7';

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  // Auto-resize textarea
  function handleDraftChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setDraft(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy || !provider) return;

    const next: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setDraft('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setBusy(true);

    try {
      const res = await fetch('/api/run-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model,
          messages: next,
          apiKey: settings.anthropicApiKey || undefined,
        }),
      });
      const data = await res.json() as { ok: boolean; reply?: string; error?: string };
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.ok ? (data.reply ?? '') : `Error: ${data.error}` },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Network error: ${(e as Error).message}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const modelShort = model.replace('claude-', '').replace('-20251001', '');

  return (
    <>
      {/* Floating action button */}
      <button
        className={`${css.fab}${open ? ' ' + css.fabOpen : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={open ? 'Close assistant' : 'Open AI assistant'}
        aria-label={open ? 'Close assistant' : 'Open AI assistant'}
      >
        {open ? '✕' : '💬'}
      </button>

      {/* Chat panel */}
      {open && (
        <div className={css.panel}>
          <div className={css.panelHdr}>
            <span className={css.panelTitle}>AI Assistant</span>
            {provider && (
              <span className={css.panelMeta}>
                {provider === 'claude_max_cli' ? 'CLI' : 'API'} · {modelShort}
              </span>
            )}
            <button className={css.panelClose} onClick={() => setOpen(false)}>✕</button>
          </div>

          {!provider ? (
            <div className={css.notice}>
              No assistant configured.{' '}
              <button
                className={css.noticeLink}
                onClick={() => { setOpenModal('connect'); setOpen(false); }}
              >
                Open Settings
              </button>{' '}
              to pick a provider and model.
            </div>
          ) : (
            <>
              <div className={css.messages}>
                {messages.length === 0 && !busy && (
                  <div className={css.empty}>
                    <span className={css.emptyIcon}>💬</span>
                    Ask me anything about your project or Arbiter.
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`${css.msgRow} ${m.role === 'user' ? css.msgRowUser : css.msgRowAssistant}`}>
                    <div className={`${css.bubble} ${m.role === 'user' ? css.bubbleUser : css.bubbleAssistant}`}>
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

              <div className={css.inputRow}>
                <textarea
                  ref={textareaRef}
                  className={css.input}
                  placeholder="Ask anything… (Enter to send, Shift+Enter for newline)"
                  value={draft}
                  onChange={handleDraftChange}
                  onKeyDown={onKeyDown}
                  rows={1}
                  disabled={busy}
                />
                <button
                  className={css.sendBtn}
                  onClick={send}
                  disabled={!draft.trim() || busy}
                >
                  {busy ? '…' : '↑'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
