import { LLMProvider, estimateCost } from './LLMProvider';
import { LLMRequest, LLMResponse, ServiceResult } from '../types/index';

// Canned responses keyed by agent role substring in the prompt.
// Used by integration tests — no real API calls made.

const RESEARCH_RESPONSE = `
# Research Analysis

## Summary
This task modifies the DMS upload UI component to add progress tracking.

## Blast Radius

\`\`\`json
{
  "blast_radius": {
    "modules_touched": ["foederata-web/features/dms"],
    "new_modules_created": [],
    "cross_module_contracts_changed": false,
    "new_data_schemas": false,
    "new_cryptographic_surfaces": false,
    "new_external_integrations": false,
    "architectural_boundary_crossed": false,
    "files_changed": ["web/src/features/dms/DmsUpload.tsx"]
  }
}
\`\`\`

## Impact Analysis
- Only touches the DMS upload UI component
- No shared contracts changed
- No new database schemas
- No cryptographic surfaces touched
`;

const PLAN_RESPONSE = `
\`\`\`json
{
  "task_id": "MOCK-TASK",
  "complexity_score": {
    "file_count": 2,
    "new_dependency_count": 0,
    "crypto_or_validation_logic": 0,
    "subprocess_or_migration": 0,
    "cross_module_integration": 0,
    "weighted_total": 2,
    "tier": "1",
    "notes": "Small UI-only change"
  },
  "sub_tasks": [
    {
      "id": "frontend-dms-progress",
      "agent_role": "frontend",
      "description": "Add progress bar to DmsUpload component",
      "files_touched": ["web/src/features/dms/DmsUpload.tsx"],
      "depends_on": ["plan"]
    },
    {
      "id": "test-dms-progress",
      "agent_role": "test-writer",
      "description": "Write Vitest tests for DmsUpload progress bar",
      "files_touched": ["web/src/features/dms/DmsUpload.test.tsx"],
      "depends_on": ["frontend-dms-progress"]
    }
  ]
}
\`\`\`
`;

const AGENT_RESPONSES: Record<string, string> = {
  reframe:        `# Reframed Task\n\nAdd a progress bar indicator to the DMS file upload component.`,
  research:       RESEARCH_RESPONSE,
  design:         `# Design\n\n## Approach\nAdd a \`progress\` prop to \`DmsUpload\`. Use AntD Progress component.`,
  'design-critic':`# Design Review\n\n## Assessment: APPROVED\nThe design is minimal and correct. No architectural concerns.`,
  integrator:     `# Interface Specification\n\nNo cross-module contracts changed. DmsUpload interface: add \`progress?: number\` prop.`,
  plan:           PLAN_RESPONSE,
  frontend:       `# Frontend Implementation\n\n\`\`\`tsx\nexport function DmsUpload({ progress }: { progress?: number }) {\n  return <Progress percent={progress ?? 0} />;\n}\n\`\`\``,
  backend:        `# Backend Implementation\n\nNo backend changes required for this task.`,
  'test-writer':  `# Tests\n\n\`\`\`ts\nit('renders progress bar', () => {\n  render(<DmsUpload progress={50} />);\n  expect(screen.getByRole('progressbar')).toBeInTheDocument();\n});\n\`\`\``,
  reviewer:       `# Review Report\n\n## Verdict: APPROVED\n\nImplementation is clean. Tests cover the main path. No security concerns.`,
  'tech-writer':  `# Documentation\n\n## DmsUpload Progress Feature\n\nThe DmsUpload component now accepts an optional \`progress\` prop (0-100).`,
  debugger:       `# Debugger Output\n\nFixed the issue in the previous output.`,
};

function responseForRole(prompt: string): string {
  for (const [role, content] of Object.entries(AGENT_RESPONSES)) {
    // The assembled prompt includes the agent role in section headers
    if (prompt.toLowerCase().includes(role.toLowerCase())) {
      return content;
    }
  }
  return `# Generic Response\n\nTask completed successfully.`;
}

export class MockProvider implements LLMProvider {
  private readonly forcedRole?: string;

  // Pass forcedRole to always return a specific agent's response
  // regardless of what's in the prompt.
  constructor(forcedRole?: string) {
    this.forcedRole = forcedRole;
  }

  async invoke(request: LLMRequest): Promise<ServiceResult<LLMResponse>> {
    const role = this.forcedRole ?? request.agentRole;
    const content = role
      ? (AGENT_RESPONSES[role] ?? `# ${role} output\n\nTask completed.`)
      : responseForRole(request.assembledPrompt);

    // Simulate a small delay to make timing realistic in tests
    await new Promise(resolve => setTimeout(resolve, 5));

    return {
      ok: true,
      value: {
        content,
        inputTokens: 100,
        outputTokens: 50,
        exitCode: 0,
        rateLimitInfo: {
          requestsRemaining: 100,
          tokensRemaining: 100_000,
        },
      },
    };
  }

  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    return estimateCost(model, inputTokens, outputTokens);
  }
}
