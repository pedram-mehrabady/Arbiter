import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AgentRole, AssembledContext, ServiceResult } from '../types/index';
import { estimateTokenCount } from '../providers/LLMProvider';

// Each agent role declares which files it needs. Agents never receive files
// outside this allowlist — this is the agent context scoping principle.
const AGENT_CONTEXT_MANIFESTS: Record<AgentRole, string[]> = {
  'reframe':         ['task.md'],
  'research':        ['task.md', 'reframe.md', 'src/**/*.ts', 'src/**/*.cs'],
  'design':          ['task.md', 'reframe.md', 'research.json', 'MASTER-DIRECTIVES.md'],
  'design-critic':   ['task.md', 'design.md', 'MASTER-DIRECTIVES.md'],
  'integrator':      ['task.md', 'design.md', 'design-critic.md', 'src/**/*.ts'],
  'plan':            ['task.md', 'design.md', 'integrator.md', 'MASTER-DIRECTIVES.md'],
  'backend':         ['task.md', 'design.md', '5-plan.json', 'MASTER-DIRECTIVES.md'],
  'frontend':        ['task.md', 'design.md', '5-plan.json', 'MASTER-DIRECTIVES.md'],
  'test-writer':     ['task.md', '5-plan.json', 'src/**/*.ts', 'src/**/*.cs'],
  'reviewer':        ['task.md', 'design.md', 'src/**/*.ts', 'src/**/*.cs', 'tests/**/*.ts'],
  'tech-writer':     ['task.md', 'design.md', 'reviewer-report.md'],
  'debugger':        ['task.md', 'debug-notes.md', 'src/**/*.ts', 'src/**/*.cs'],
  'report-formatter':['gate-report-raw.json'],
  'gate-poller':     ['.arbiter/pending-gates.json'],
  'surveyor':        ['task.md', 'MASTER-DIRECTIVES.md'],
  'question':        ['task.md'],
};

const SECTION_SEPARATOR = '\n\n' + '─'.repeat(60) + '\n\n';

export class ContextAssembler {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  async assemble(
    role: AgentRole,
    taskDir: string,
    systemPrompt: string,
    userPrompt: string,
    overrideFiles?: string[],
  ): Promise<ServiceResult<AssembledContext>> {
    const contextFilePaths = overrideFiles ?? AGENT_CONTEXT_MANIFESTS[role] ?? [];

    const resolvedFiles = await this.resolveFiles(contextFilePaths, taskDir);
    const sections: string[] = [`# SYSTEM\n\n${systemPrompt}`];
    const includedFiles: string[] = [];

    for (const filePath of resolvedFiles) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const relPath = path.relative(this.workspaceRoot, filePath);
        sections.push(`# FILE: ${relPath}\n\n${content}`);
        includedFiles.push(filePath);
      } catch {
        // Missing optional context files are skipped, not errored
      }
    }

    sections.push(`# TASK\n\n${userPrompt}`);

    const prompt = sections.join(SECTION_SEPARATOR);
    const tokenEstimate = estimateTokenCount(prompt);
    const contextHash = `sha256:${createHash('sha256').update(prompt).digest('hex')}`;

    return {
      ok: true,
      value: {
        prompt,
        tokenEstimate,
        contextHash,
        filesIncluded: includedFiles,
        pruned: false,
        prunedTokensSaved: 0,
      },
    };
  }

  getContextFiles(role: AgentRole): string[] {
    return AGENT_CONTEXT_MANIFESTS[role] ?? [];
  }

  private async resolveFiles(patterns: string[], taskDir: string): Promise<string[]> {
    const resolved: string[] = [];

    for (const pattern of patterns) {
      if (pattern.includes('**')) {
        // Glob pattern — resolve against workspace root
        const files = await this.glob(pattern);
        resolved.push(...files);
      } else {
        // Exact file — resolve against task dir first, then workspace root
        const inTaskDir = path.join(taskDir, pattern);
        const inWorkspace = path.join(this.workspaceRoot, pattern);
        const exists = await fileExists(inTaskDir);
        resolved.push(exists ? inTaskDir : inWorkspace);
      }
    }

    return [...new Set(resolved)];
  }

  private async glob(pattern: string): Promise<string[]> {
    // Minimal glob: supports `dir/**/*.ext` patterns only
    const [baseDir, , ext] = pattern.split('/');
    if (!baseDir || !ext) return [];

    const absBase = path.join(this.workspaceRoot, baseDir);
    const extension = ext.replace('*', '');

    try {
      return await findFilesWithExtension(absBase, extension);
    } catch {
      return [];
    }
  }
}

async function fileExists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true).catch(() => false);
}

async function findFilesWithExtension(dir: string, ext: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        results.push(...await findFilesWithExtension(fullPath, ext));
      } else if (entry.isFile() && entry.name.endsWith(ext)) {
        results.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist — return empty
  }
  return results;
}
