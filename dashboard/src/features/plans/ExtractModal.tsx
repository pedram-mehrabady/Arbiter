import { useState, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import type { ExtractedFeature } from '../../api/llm/types';
import type { PlanType } from '../../api/types';
import css from './ExtractModal.module.css';

const TYPE_META: Record<PlanType, { icon: string; cls: string }> = {
  feature:  { icon: '✨', cls: css.typeFeature  },
  bug:      { icon: '🐛', cls: css.typeBug      },
  refactor: { icon: '♻️', cls: css.typeRefactor },
  chore:    { icon: '🔧', cls: css.typeChore    },
};

const COMPLEXITY_CLS: Record<string, string> = {
  Simple: css.cxSimple, Medium: css.cxMedium, Complex: css.cxComplex, Epic: css.cxEpic,
};

interface Props { onClose: () => void; }

type Phase = 'input' | 'extracting' | 'review';

export function ExtractModal({ onClose }: Props) {
  const { extractFeatures, bulkAddPlans, showToast } = useAppStore(useShallow((s) => ({
    extractFeatures: s.extractFeatures,
    bulkAddPlans:    s.bulkAddPlans,
    showToast:       s.showToast,
  })));

  const [phase, setPhase]         = useState<Phase>('input');
  const [doc, setDoc]             = useState('');
  const [features, setFeatures]   = useState<ExtractedFeature[]>([]);
  const [selected, setSelected]   = useState<Set<string>>(new Set()); // keys of items to add NOW
  const [error, setError]         = useState('');
  const fileInputRef              = useRef<HTMLInputElement>(null);

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (text) { setDoc(text); setError(''); }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function runExtract() {
    if (!doc.trim()) { setError('Paste a document first.'); return; }
    setError('');
    setPhase('extracting');
    try {
      const result = await extractFeatures(doc.trim());
      if (result.length === 0) { setError('No features found. Try a more detailed document.'); setPhase('input'); return; }
      setFeatures(result);
      // Default: all checked (add to active backlog)
      setSelected(new Set(result.map((f) => f.key)));
      setPhase('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Extraction failed. Check your LLM settings.');
      setPhase('input');
    }
  }

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function selectAll()   { setSelected(new Set(features.map((f) => f.key))); }
  function selectNone()  { setSelected(new Set()); }

  function commit() {
    bulkAddPlans(features.map((f) => ({ feature: f, deferred: !selected.has(f.key) })));
    const active   = features.filter((f) => selected.has(f.key)).length;
    const deferred = features.length - active;
    showToast(`Added ${active} to backlog${deferred > 0 ? ` · ${deferred} deferred` : ''}`);
    onClose();
  }

  const activeCount   = selected.size;
  const deferredCount = features.length - selected.size;

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${css.modal}`}>
        <div className="modal-hdr">
          <div>
            <div className="modal-title">📄 Extract from document</div>
            <div className="modal-sub">
              {phase === 'input'    && 'Paste a spec or requirements doc — the AI extracts all features'}
              {phase === 'extracting' && 'Analysing document…'}
              {phase === 'review'   && `${features.length} features found — tick what goes into backlog now, untick to defer`}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* ── Input phase ── */}
          {phase === 'input' && (
            <>
              <textarea
                className={`arbiter-textarea ${css.docArea}`}
                rows={12}
                placeholder={"Paste your 1000-word product spec, requirements document, or feature brief here…\n\nThe AI will extract every distinct feature, task, bug, or improvement mentioned."}
                value={doc}
                onChange={(e) => { setDoc(e.target.value); setError(''); }}
                autoFocus
              />
              {error && <div className={css.error}>{error}</div>}
              <div className="widget-row">
                <button className="btn-primary" onClick={runExtract} disabled={!doc.trim()}>
                  🔍 Extract features
                </button>
                <button className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
                  📎 Upload file
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.txt"
                  style={{ display: 'none' }}
                  onChange={handleFileUpload}
                />
                <span className="btn-note">{doc.trim().split(/\s+/).filter(Boolean).length} words</span>
              </div>
            </>
          )}

          {/* ── Extracting phase ── */}
          {phase === 'extracting' && (
            <div className={css.extractingWrap}>
              <div className={css.spinner} />
              <div>
                <div className={css.extractingTitle}>Extracting features…</div>
                <div className={css.extractingSub}>Reading the document and identifying distinct work items</div>
              </div>
            </div>
          )}

          {/* ── Review phase ── */}
          {phase === 'review' && (
            <>
              <div className={css.reviewControls}>
                <button className={css.selBtn} onClick={selectAll}>Select all</button>
                <button className={css.selBtn} onClick={selectNone}>Select none</button>
                <span className={css.reviewSummary}>
                  <span className={css.summaryActive}>{activeCount} → backlog</span>
                  {deferredCount > 0 && <span className={css.summaryDeferred}>{deferredCount} → deferred</span>}
                </span>
              </div>

              <div className={css.featureList}>
                {features.map((f) => {
                  const meta = TYPE_META[f.planType] ?? TYPE_META.feature;
                  const isActive = selected.has(f.key);
                  return (
                    <label
                      key={f.key}
                      className={`${css.featureRow}${isActive ? '' : ' ' + css.featureRowDeferred}`}
                    >
                      <input
                        type="checkbox"
                        checked={isActive}
                        onChange={() => toggle(f.key)}
                        className={css.check}
                      />
                      <div className={css.featureInfo}>
                        <div className={css.featureTop}>
                          <span className={`${css.typeBadge} ${meta.cls}`}>{meta.icon} {f.planType}</span>
                          <span className={`${css.cxBadge} ${COMPLEXITY_CLS[f.complexity] ?? ''}`}>{f.complexity}</span>
                          {!isActive && <span className={css.deferredTag}>💤 deferred</span>}
                        </div>
                        <div className={css.featureTitle}>{f.title}</div>
                        <div className={css.featureDesc}>{f.description}</div>
                      </div>
                    </label>
                  );
                })}
              </div>

              <div className="widget-row" style={{ marginTop: 16 }}>
                <button className="btn-primary" onClick={commit}>
                  ✅ Add {activeCount} to backlog{deferredCount > 0 ? ` + keep ${deferredCount} as deferred` : ''}
                </button>
                <button className="btn-secondary" onClick={() => setPhase('input')}>← Edit document</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
