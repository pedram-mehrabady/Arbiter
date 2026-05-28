import { useState, useEffect } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import type { PlanSections } from '../../../api/types';
import styles from './PlanReviewModal.module.css';

const SECTIONS: { id: keyof PlanSections; num: number; title: string; hint: string; placeholder: string; rows: number }[] = [
  {
    id: 'requirements', num: 1, title: 'Requirements', hint: 'What exactly needs to be built',
    placeholder: 'Describe what needs to be built in detail…', rows: 4,
  },
  {
    id: 'acceptance', num: 2, title: 'Acceptance Criteria', hint: 'When is this feature done?',
    placeholder: '- [ ] User can do X\n- [ ] System handles Y\n- [ ] Edge case Z is covered', rows: 4,
  },
  {
    id: 'edgeCases', num: 3, title: 'Edge Cases & Constraints', hint: 'What could go wrong or needs special handling',
    placeholder: '- What happens when…\n- Constraint: must work offline\n- Performance: <200ms', rows: 3,
  },
  {
    id: 'technical', num: 4, title: 'Technical Approach', hint: 'How will this be built',
    placeholder: '- FE: new hook in subscription feature\n- BE: POST /api/v1/…\n- DB: new table in subscriptions schema', rows: 3,
  },
  {
    id: 'openQuestions', num: 5, title: 'Open Questions', hint: 'Decisions to make before building',
    placeholder: '- Do we support X?\n- Which approach for Y?\n(Leave empty if none)', rows: 3,
  },
];

const EMPTY: PlanSections = { requirements: '', acceptance: '', edgeCases: '', technical: '', openQuestions: '' };

export function PlanReviewModal() {
  const { reviewingJobId, arbiterState, updateJob, approveJobPlan, setOpenModal, showToast, liveApi } = useAppStore(useShallow((s) => ({
    reviewingJobId: s.reviewingJobId,
    arbiterState: s.arbiterState,
    updateJob: s.updateJob,
    approveJobPlan: s.approveJobPlan,
    setOpenModal: s.setOpenModal,
    showToast: s.showToast,
    liveApi: s.liveApi,
  })));

  const job = arbiterState.jobs.find((j) => j.id === reviewingJobId) ?? null;

  const [sections, setSections] = useState<PlanSections>(job?.planSections ?? { ...EMPTY, requirements: job?.requirements ?? '' });
  const [saveNote, setSaveNote] = useState('');

  useEffect(() => {
    if (job) setSections(job.planSections ?? { ...EMPTY, requirements: job.requirements ?? '' });
  }, [reviewingJobId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!job) return null;

  const close = () => setOpenModal(null);

  const patch = (id: keyof PlanSections, val: string) =>
    setSections((prev) => ({ ...prev, [id]: val }));

  const handleSaveDraft = () => {
    updateJob(job.id, { planSections: sections });
    setSaveNote('Draft saved');
    setTimeout(() => setSaveNote(''), 2000);
  };

  const handleApprove = () => {
    if (!sections.requirements.trim() || !sections.acceptance.trim()) {
      showToast('Fill in Requirements and Acceptance Criteria before approving');
      return;
    }
    updateJob(job.id, { planSections: sections });
    approveJobPlan(job.id);
    close();
  };

  const handleOpenEditor = () => {
    if (!liveApi) { showToast('Connect your repo first'); return; }
    const md = buildPreviewMd(job.ticket ?? job.id, sections);
    const fileName = `plans/${(job.ticket ?? job.id).replace(/[^a-zA-Z0-9-_]/g, '')}.md`;
    liveApi.writePlanFile(job.ticket ?? job.id, md)
      .then(() => showToast(`Saved to .arbiter/${fileName}`))
      .catch(() => showToast('Could not write plan file'));
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className={`modal ${styles.reviewModal}`}>
        <div className="modal-hdr">
          <div>
            <div className="modal-title">📋 Plan Review — {job.ticket ?? job.title}</div>
            <div className="modal-sub">Complete all sections before approving</div>
          </div>
          <button className="modal-close" onClick={close}>✕</button>
        </div>

        <div className={`modal-body ${styles.body}`}>
          {SECTIONS.map((s) => (
            <div key={s.id} className={styles.section}>
              <div className={styles.sectionHdr}>
                <span className={styles.sectionNum}>{s.num}</span>
                <div>
                  <div className={styles.sectionTitle}>{s.title}</div>
                  <div className={styles.sectionHint}>{s.hint}</div>
                </div>
              </div>
              <textarea
                className="arbiter-textarea"
                rows={s.rows}
                placeholder={s.placeholder}
                value={sections[s.id]}
                onChange={(e) => patch(s.id, e.target.value)}
              />
            </div>
          ))}

          <div className={`widget-row ${styles.actions}`}>
            <button className="btn-primary" onClick={handleApprove}>✅ Approve — Ready to Build</button>
            <button className="btn-secondary" onClick={handleSaveDraft}>💾 Save Draft</button>
            <button className="btn-secondary" onClick={handleOpenEditor}>↗ Open in Editor</button>
            {saveNote && <span className="btn-note">{saveNote}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function buildPreviewMd(ticket: string, s: PlanSections): string {
  return [
    `# Plan Review — ${ticket}`,
    ``,
    `## 1. Requirements`,
    ``,
    s.requirements || '_Not filled_',
    ``,
    `## 2. Acceptance Criteria`,
    ``,
    s.acceptance || '_Not filled_',
    ``,
    `## 3. Edge Cases & Constraints`,
    ``,
    s.edgeCases || '_Not filled_',
    ``,
    `## 4. Technical Approach`,
    ``,
    s.technical || '_Not filled_',
    ``,
    `## 5. Open Questions`,
    ``,
    s.openQuestions || '_None_',
  ].join('\n');
}
