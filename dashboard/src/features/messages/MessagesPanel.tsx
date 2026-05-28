import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import css from './MessagesPanel.module.css';

const AGENTS = ['babysitter', 'front', 'backend', 'push'];

function fmtTime(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function MessagesPanel() {
  const { messages, isConnected, sendAgentMessage } = useAppStore(useShallow((s) => ({
    messages: s.messages,
    isConnected: s.isConnected,
    sendAgentMessage: s.sendAgentMessage,
  })));

  const [target, setTarget] = useState('babysitter');
  const [text, setText] = useState('');
  const feedRef = useRef<HTMLDivElement>(null);

  const sorted = [...messages].sort((a, b) => (a.ts < b.ts ? -1 : 1));

  // Auto-scroll to the newest message
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function send() {
    const body = text.trim();
    if (!body) return;
    sendAgentMessage(target, body);
    setText('');
  }

  return (
    <div className={css.panel}>
      <div className={css.header}>
        <span className={css.title}>Messages</span>
        <span className={css.sub}>· talk to the running CLIs</span>
        <span className={css.spacer} />
        {!isConnected && <span className={css.disconnected}>connect repo to chat</span>}
      </div>

      <div className={css.feed} ref={feedRef}>
        {sorted.length === 0 ? (
          <div className={css.empty}>
            No messages yet.<br />Send one below — the CLI replies appear here.
          </div>
        ) : (
          sorted.map((m, i) => {
            const mine = m.from === 'pedram';
            return (
              <div key={i} className={`${css.msg} ${mine ? css.msgMine : css.msgCli}`}>
                <div className={`${css.bubble} ${mine ? css.bubbleMine : css.bubbleCli}`}>{m.text}</div>
                <div className={css.meta}>
                  <span className={css.fromTag}>{mine ? `you → ${m.to ?? '?'}` : m.from}</span>
                  {m.ts && <> · {fmtTime(m.ts)}</>}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className={css.composer}>
        <select className={css.select} value={target} onChange={(e) => setTarget(e.target.value)}>
          {AGENTS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <input
          className={css.input}
          type="text"
          placeholder={isConnected ? `Message ${target}…` : 'Connect repo first'}
          value={text}
          disabled={!isConnected}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
        />
        <button className={css.sendBtn} onClick={send} disabled={!isConnected || !text.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
