import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { BuildReceipt } from '../types/index';
import { GitCommit } from './GitCommitReader';

export const ALC_CONTROLS = [
  'ALC_REQ',
  'ALC_IMP.1',
  'ALC_TDS.1',
  'ALC_TDS.2',
  'ALC_TDS.3',
  'ALC_IMP.2',
  'ALC_IMP',
  'ALC_TEC',
  'ALC_QA',
  'AGD_OPE',
] as const;

export type ALCControl = (typeof ALC_CONTROLS)[number];

export interface BundleManifest {
  bundle_id: string;
  task_id: string;
  feature_name: string;
  arbiter_version: string;
  completed_at: string;
  git_commits: Array<{
    hash: string;
    short_hash: string;
    subject: string;
    timestamp: string;
    receipt_id?: string;
  }>;
  receipts: string[];
  alc_controls_covered: ALCControl[];
  missing_artifacts: string[];
  bundle_hash: string;
  bundle_signature: string;
}

// Maps bundle-relative paths to ALC controls they satisfy.
// Stored in the manifest so an evaluator can find each control in one lookup.
export const ALC_ARTIFACT_MAP: Record<string, ALCControl> = {
  '01-requirements/spec.md':                 'ALC_REQ',
  '01-requirements/reframe-output.md':       'ALC_REQ',
  '02-impact-analysis/research-output.md':   'ALC_IMP.1',
  '03-design/design.md':                     'ALC_TDS.1',
  '03-design/design-critic.md':              'ALC_TDS.2',
  '03-design/integrator-output.md':          'ALC_TDS.3',
  '04-implementation-plan/plan-output.md':   'ALC_IMP.2',
  '05-implementation/git-commits.json':      'ALC_IMP',
  '06-tests/test-writer-output.md':          'ALC_TEC',
  '07-review/reviewer-report.md':            'ALC_QA',
  '08-documentation/tech-writer-output.md':  'AGD_OPE',
};

export class BundleManifestBuilder {
  build(params: {
    taskId: string;
    featureName: string;
    completedAt: string;
    gitCommits: GitCommit[];
    receipts: BuildReceipt[];
    presentArtifacts: string[];
    missingArtifacts: string[];
  }): Omit<BundleManifest, 'bundle_hash' | 'bundle_signature'> {
    const bundleId = `${params.taskId}-bundle-${params.completedAt.slice(0, 10)}`;

    // Derive which ALC controls are covered from present artifacts
    const coveredControls = new Set<ALCControl>();
    for (const artifact of params.presentArtifacts) {
      const control = ALC_ARTIFACT_MAP[artifact];
      if (control) coveredControls.add(control);
    }

    return {
      bundle_id: bundleId,
      task_id: params.taskId,
      feature_name: params.featureName,
      arbiter_version: '0.1.0',
      completed_at: params.completedAt,
      git_commits: params.gitCommits.map(c => ({
        hash: c.hash,
        short_hash: c.shortHash,
        subject: c.subject,
        timestamp: c.timestamp,
        receipt_id: c.receiptId,
      })),
      receipts: params.receipts.map(r => r.receipt_id),
      alc_controls_covered: Array.from(coveredControls),
      missing_artifacts: params.missingArtifacts,
    };
  }

  // Feature name is the first H1 heading in task.md, falling back to task ID
  async extractFeatureName(taskMdPath: string, taskId: string): Promise<string> {
    try {
      const content = await fs.readFile(taskMdPath, 'utf-8');
      const h1 = /^#\s+(.+)$/m.exec(content);
      return h1?.[1]?.trim() ?? taskId;
    } catch {
      return taskId;
    }
  }

  computeZipHash(zipBuffer: Buffer): string {
    return `sha256:${createHash('sha256').update(zipBuffer).digest('hex')}`;
  }
}
