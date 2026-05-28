import { useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import type { PlanType } from '../../../api/types';
import styles from './PlanModal.module.css';

type Phase = 'input' | 'analyzing' | 'result';

const TYPE_OPTIONS: { value: PlanType; label: string; icon: string }[] = [
  { value: 'feature', label: 'Feature', icon: '✨' },
  { value: 'bug',     label: 'Bug',     icon: '🐛' },
  { value: 'refactor',label: 'Refactor',icon: '♻️' },
  { value: 'chore',   label: 'Chore',   icon: '🔧' },
];

export function PlanModal() {
  const { setOpenModal, analyzePlan, addPlan, showToast } = useAppStore(useShallow((s) => ({
    setOpenModal: s.setOpenModal,
    analyzePlan: s.analyzePlan,
    addPlan: s.addPlan,
    showToast: s.showToast,
  })));

  const [phase, setPhase] = useState<Phase>('input');
  const [planType, setPlanType] = useState<PlanType>('feature');
  const [req, setReq] = useState('');
  const [analysis, setAnalysis] = useState<Awaited<ReturnType<typeof analyzePlan>> | null>(null);
  const [error, setError] = useState('');

  const handleAnalyze = async () => {
    if (!req.trim()) { setError('Describe the feature first'); return; }
    setError('');
    setPhase('analyzing');
    try {
      const result = await analyzePlan(req.trim());
      setAnalysis(result);
      setPhase('result');
    } catch (e) {
      setPhase('input');
      setError(e instanceof Error ? e.message : 'Analysis failed');
    }
  };

  const handleAdd = () => {
    if (!analysis) return;
    addPlan(analysis, planType);
    showToast(`✅ ${analysis.title} added to plans — edit & prioritize it`);
    setOpenModal(null);
  };

  const close = () => setOpenModal(null);

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" style={{ maxWidth: 620 }}>
        <div className="modal-hdr">
          <div>
            <div className="modal-title">📋 Plan New Task</div>
            <div className="modal-sub">Describe what to build — Babysitter estimates complexity and queues the pipeline</div>
          </div>
          <button className="modal-close" onClick={close}>✕</button>
        </div>

        <div className="modal-body">
          {phase === 'input' && (
            <>
              <div className={styles.typeRow}>
                {TYPE_OPTIONS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    className={`${styles.typeBtn}${planType === t.value ? ' ' + styles.typeBtnActive : ''}`}
                    onClick={() => setPlanType(t.value)}
                  >
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>
              <textarea
                className="arbiter-textarea"
                rows={6}
                placeholder={"Describe the feature in detail...\n\nExample:\n- Add a notification bell to the top nav\n- Clicking opens a dropdown with unread notifications\n- Types: new share received, contact accepted, subscription warning\n- Badge count clears when the dropdown is opened"}
                value={req}
                onChange={(e) => setReq(e.target.value)}
                autoFocus
              />
              {error && <div className={styles.error}>{error}</div>}
              <div className="widget-row">
                <button className="btn-primary" onClick={handleAnalyze}>🔍 Analyze with Babysitter</button>
                <span className="btn-note">Estimates complexity and prepares pipeline stages</span>
              </div>
            </>
          )}

          {phase === 'analyzing' && (
            <div className={styles.analyzingWrap}>
              <div className={styles.spinner} />
              <div>
                <div className={styles.analyzingTitle}>Babysitter is analyzing…</div>
                <div className={styles.analyzingSub}>Estimating complexity, stage breakdown, and dependencies</div>
              </div>
            </div>
          )}

          {phase === 'result' && analysis && (
            <>
              <div className={styles.resultCard}>
                <div className={styles.resultRow}>
                  <span className={styles.resultLabel}>Ticket</span>
                  <span className={styles.resultValue}>{analysis.ticket}</span>
                </div>
                <div className={styles.resultRow}>
                  <span className={styles.resultLabel}>Title</span>
                  <span className={styles.resultValue}>{analysis.title}</span>
                </div>
                <div className={styles.resultRow}>
                  <span className={styles.resultLabel}>Complexity</span>
                  <span className={`${styles.resultValue} ${styles['complexity' + analysis.complexity]}`}>{analysis.complexity}</span>
                </div>
                {analysis.estimated_stages && (
                  <div className={styles.resultRow}>
                    <span className={styles.resultLabel}>Estimate</span>
                    <div className={styles.estChips}>
                      {Object.entries(analysis.estimated_stages).map(([k, v]) => (
                        <span key={k} className={styles.estChip}><span className={styles.estKey}>{k}</span>{v}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="widget-row" style={{ marginTop: 14 }}>
                <button className="btn-primary" onClick={handleAdd}>➕ Add to Plans</button>
                <button className="btn-secondary" onClick={() => setPhase('input')}>← Edit</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
