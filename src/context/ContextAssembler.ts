import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { AgentRole, AssembledContext, ServiceResult } from '../types/index';
import { estimateTokenCount } from '../providers/LLMProvider';
import { PackageVersionInjector } from './PackageVersionInjector';

const execFileAsync = promisify(execFile);

export type TemplateVars = Partial<{
  STACK_FRONTEND: string;
  STACK_BACKEND: string;
  STACK_DATABASE: string;
  STACK_TEST_FRAMEWORK: string;
  PROJECT_CONVENTIONS: string;
  PROJECT_NAME: string;
}>;

const TOKEN_BUDGETS: Partial<Record<AgentRole, number>> = {
  'triage':       4_000,
  'investigator': 12_000,
  'backend':      24_000,
  'frontend':     24_000,
  'test-writer':  16_000,
  'orchestrator': 32_000,
};

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
  'gate-poller':     ['arbiter/pending-gates.json'],
  'surveyor':        ['task.md', 'MASTER-DIRECTIVES.md'],
  'question':        ['task.md'],
  'prd':             ['task.md'],
  'push':            ['task.md', 'frontend-output.md', 'backend-output.md', 'test-writer-output.md'],
  'triage':          ['task.md', 'arbiter.config.json'],
  'investigator':    ['task.md', 'engine/MASTER-DIRECTIVES.md'],
  'orchestrator':    ['task.md', '3-design.md', '5-plan.json'],
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
    templateVars?: TemplateVars,
  ): Promise<ServiceResult<AssembledContext>> {
    const contextFilePaths = overrideFiles ?? AGENT_CONTEXT_MANIFESTS[role] ?? [];

    // Load agent template and substitute placeholders
    const resolvedSystemPrompt = await this.buildSystemPrompt(role, systemPrompt, templateVars);

    const resolvedFiles = await this.resolveFiles(contextFilePaths, taskDir);
    const sections: string[] = [`# SYSTEM\n\n${resolvedSystemPrompt}`];

    // For design role: inject package versions at the top
    if (role === 'design') {
      const versionBlock = await new PackageVersionInjector().inject(this.workspaceRoot);
      if (versionBlock) {
        sections.push(`# PACKAGE VERSIONS\n\n${versionBlock}`);
      }
    }
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

  getTokenBudget(role: AgentRole): number | undefined {
    return TOKEN_BUDGETS[role];
  }

  async buildContextWithMadge(
    role: AgentRole,
    taskDir: string,
    targetFiles: string[],
    lockedContractPaths?: string[],
  ): Promise<ServiceResult<{ files: string[]; madgeUsed: boolean }>> {
    const budget = TOKEN_BUDGETS[role];
    let madgeUsed = false;
    let files: string[] = [];

    if (targetFiles.length > 0) {
      try {
        const { stdout } = await execFileAsync(
          'npx',
          ['madge', '--json', ...targetFiles],
          { cwd: this.workspaceRoot, timeout: 10_000 },
        );
        const depGraph = JSON.parse(stdout) as Record<string, string[]>;
        const allowlist = new Set(AGENT_CONTEXT_MANIFESTS[role] ?? []);

        files = Object.keys(depGraph)
          .filter(f => allowlist.has(f) || allowlist.has(path.extname(f)))
          .map(f => path.join(this.workspaceRoot, f));

        madgeUsed = true;
      } catch {
        // madge not installed or failed — fall back to glob resolution
        console.warn('[ContextAssembler] madge not available — falling back to glob resolution');
        files = await this.resolveFiles(AGENT_CONTEXT_MANIFESTS[role] ?? [], taskDir);
      }
    } else {
      files = await this.resolveFiles(AGENT_CONTEXT_MANIFESTS[role] ?? [], taskDir);
    }

    // Append locked contracts
    if (lockedContractPaths?.length) {
      for (const contractPath of lockedContractPaths) {
        const abs = path.join(this.workspaceRoot, contractPath);
        files.push(abs);
      }
    }

    // Enforce token budget
    if (budget) {
      const budgetedFiles: string[] = [];
      let tokensSoFar = 0;
      for (const f of files) {
        try {
          const content = await fs.readFile(f, 'utf-8');
          const fileTokens = estimateTokenCount(content);
          if (tokensSoFar + fileTokens > budget) break;
          budgetedFiles.push(f);
          tokensSoFar += fileTokens;
        } catch {
          budgetedFiles.push(f);
        }
      }
      files = budgetedFiles;
    }

    return { ok: true, value: { files: [...new Set(files)], madgeUsed } };
  }

  private async buildSystemPrompt(
    role: AgentRole,
    passedPrompt: string,
    vars?: TemplateVars,
  ): Promise<string> {
    // If a non-empty prompt was explicitly passed, use it (tests inject their own)
    if (passedPrompt.trim()) return passedPrompt;

    // Try to load agents/templates/<role>.md from workspace root
    const templatePath = path.join(this.workspaceRoot, 'agents', 'templates', `${role}.md`);
    try {
      const raw = await fs.readFile(templatePath, 'utf-8');
      return vars ? this.substituteVars(raw, vars) : raw;
    } catch {
      // Template file absent — return empty string (keeps existing behaviour)
      return '';
    }
  }

  private substituteVars(template: string, vars: TemplateVars): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      if (value !== undefined) {
        result = result.replaceAll(`{{${key}}}`, value);
      }
    }
    // Clear any remaining unfilled placeholders so agents don't see raw {{...}}
    result = result.replace(/\{\{[A-Z_]+\}\}/g, '(not specified)');
    return result;
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
