import fs from 'node:fs/promises';
import path from 'node:path';
import { ServiceResult } from '../types/index';
import { InterviewAnswers } from './Interview';

// Default model assignments per role — these reflect the recommended tiering:
// Opus for roles requiring deep reasoning (plan, integrator, reviewer, debugger)
// Haiku for roles where cost matters and a lighter touch is fine (design-critic, test-writer)
// Sonnet for everything else

function buildRoles(answers: InterviewAnswers): Record<string, { provider: string; model: string }> {
  const { provider } = answers;

  const opus   = provider === 'ollama' ? 'llama3' : 'claude-opus-4-7';
  const sonnet = provider === 'ollama' ? 'llama3' : (provider === 'anthropic_sdk' ? answers.providerModel : 'claude-sonnet-4-6');
  const haiku  = provider === 'ollama' ? 'llama3' : 'claude-haiku-4-5-20251001';

  return {
    reframe:        { provider, model: sonnet },
    research:       { provider, model: sonnet },
    design:         { provider, model: sonnet },
    'design-critic':{ provider, model: haiku  },
    integrator:     { provider, model: opus   },
    plan:           { provider, model: opus   },
    frontend:       { provider, model: sonnet },
    backend:        { provider, model: sonnet },
    'test-writer':  { provider, model: haiku  },
    reviewer:       { provider, model: opus   },
    'tech-writer':  { provider, model: sonnet },
    debugger:       { provider, model: opus   },
  };
}

function buildProviderConfig(answers: InterviewAnswers): Record<string, unknown> {
  switch (answers.provider) {
    case 'anthropic_sdk':
      return { anthropic_sdk: { api_key_env: 'ANTHROPIC_API_KEY' } };
    case 'ollama':
      return { ollama: { base_url: 'http://localhost:11434' } };
    default:
      return { claude_max_cli: { cmd: 'claude', headless_flag: '-p' } };
  }
}

export async function generateConfig(
  workspaceRoot: string,
  answers: InterviewAnswers,
): Promise<ServiceResult<string>> {
  const configPath = path.join(workspaceRoot, 'arbiter.config.json');

  try {
    await fs.access(configPath);
    // File exists — don't overwrite silently
    return {
      ok: false,
      error: 'arbiter.config.json already exists. Delete it first if you want to reinitialise.',
    };
  } catch { /* doesn't exist — proceed */ }

  const config = {
    auto_merge: false,
    providers: buildProviderConfig(answers),
    roles: buildRoles(answers),
  };

  try {
    await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  } catch (err) {
    return { ok: false, error: `Failed to write arbiter.config.json: ${String(err)}` };
  }

  // Generate agents/docs/master-directives.md
  const docsDir = path.join(workspaceRoot, 'agents', 'docs');
  await fs.mkdir(docsDir, { recursive: true });
  await fs.writeFile(
    path.join(docsDir, 'master-directives.md'),
    buildMasterDirectives(answers),
    'utf-8',
  );

  return { ok: true, value: configPath };
}

function buildMasterDirectives(answers: InterviewAnswers): string {
  const securityBaseline = answers.audience === 'regulated'
    ? `## Security (regulated industry)
- Every endpoint requires authentication and authorization checks.
- No hardcoded secrets or API keys anywhere in source.
- Use only approved cryptography: AES-256-GCM, RSA-2048+, SHA-256+, bcrypt/Argon2id.
- All user-supplied input must be validated and sanitised.
- Error responses must not reveal stack traces or internal identifiers.`
    : answers.audience === 'internal'
    ? `## Security (internal tool)
- Endpoints must verify the caller is an authenticated internal user.
- No hardcoded secrets.
- Approved crypto only: AES-256-GCM, SHA-256+.`
    : `## Security (public web app)
- All endpoints require authentication unless explicitly marked public.
- Protect against XSS, CSRF, and injection attacks.
- No hardcoded secrets.`;

  const stackSection = [
    answers.stackFrontend !== 'none' ? `- Frontend: ${answers.stackFrontend}` : null,
    answers.stackBackend  !== 'none' ? `- Backend: ${answers.stackBackend}` : null,
    answers.stackDatabase !== 'none' ? `- Database: ${answers.stackDatabase}` : null,
    answers.testFramework !== 'none' ? `- Tests: ${answers.testFramework}` : null,
  ].filter(Boolean).join('\n');

  return `# Master Directives — ${answers.projectName}

These rules apply to every agent. Read them before producing any output.

## Stack
${stackSection || '(update this section with your stack details)'}

## Design system
${answers.designSystem !== 'none' ? answers.designSystem : '(none specified — update if applicable)'}

## Conventions
${answers.conventions || '(no conventions specified — update this section with your project rules)'}

${securityBaseline}

## Output rules
- Produce only what is specified in your role's output format.
- Do not modify files outside your assigned scope.
- Do not introduce new dependencies without explicitly noting them.
- ServiceResult<T> pattern: never throw from service or data-access layers.
`;
}
