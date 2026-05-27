import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { ProjectProfile } from './Scanner';

export interface InterviewAnswers {
  projectName: string;
  provider: 'claude_max_cli' | 'anthropic_sdk' | 'ollama';
  providerModel: string;
  stackFrontend: string;
  stackBackend: string;
  stackDatabase: string;
  testFramework: string;
  designSystem: string;
  conventions: string;
  audience: 'public' | 'internal' | 'regulated';
  gates: { design: boolean; plan: boolean; review: boolean };
}

export async function runInterview(detected: ProjectProfile): Promise<InterviewAnswers> {
  const rl = createInterface({ input, output });

  const ask = async (question: string, fallback = ''): Promise<string> => {
    const prompt = fallback ? `${question} [${fallback}]: ` : `${question}: `;
    const answer = await rl.question(prompt);
    return answer.trim() || fallback;
  };

  const askBool = async (question: string, fallback = true): Promise<boolean> => {
    const def = fallback ? 'Y/n' : 'y/N';
    const answer = await rl.question(`${question} [${def}]: `);
    if (!answer.trim()) return fallback;
    return answer.trim().toLowerCase().startsWith('y');
  };

  console.log('\nArbiter Setup — answering these 6 questions generates your pipeline config.\n');

  // 1. Project name
  const projectName = await ask('Project name', detected.name);

  // 2. Provider
  console.log('\nProvider options:');
  console.log('  1) claude  — Claude Max CLI (recommended, requires `claude` in PATH)');
  console.log('  2) sdk     — Anthropic SDK (requires ANTHROPIC_API_KEY)');
  console.log('  3) ollama  — Local Ollama (fully offline)');
  const providerChoice = await ask('Provider [1/2/3]', '1');
  let provider: InterviewAnswers['provider'];
  let providerModel: string;
  if (providerChoice === '2') {
    provider = 'anthropic_sdk';
    providerModel = await ask('Default model', 'claude-sonnet-4-6');
  } else if (providerChoice === '3') {
    provider = 'ollama';
    providerModel = await ask('Ollama model', 'llama3');
  } else {
    provider = 'claude_max_cli';
    providerModel = 'claude-sonnet-4-6';
  }

  // 3. Stack (pre-filled from detection)
  console.log('\nStack (press enter to confirm detected values):');
  const stackFrontend = await ask('Frontend framework', detected.stackFrontend !== 'none' ? detected.stackFrontend : 'none');
  const stackBackend  = await ask('Backend framework',  detected.stackBackend  !== 'none' ? detected.stackBackend  : 'none');
  const stackDatabase = await ask('Database',           detected.stackDatabase !== 'none' ? detected.stackDatabase : 'none');
  const testFramework = await ask('Test framework',     detected.testFramework !== 'none' ? detected.testFramework : 'none');

  // 4. Design system
  console.log('\nDesign system / component library (e.g. "Tailwind + shadcn/ui", "Material UI", or "none"):');
  const designSystem = await ask('Design system', 'none');

  // 5. Conventions
  console.log('\nKey coding conventions agents MUST follow (e.g. naming rules, folder structure, forbidden patterns).');
  console.log('Type a brief description, or press enter to skip:');
  const conventions = await ask('Conventions', '');

  // 6. Audience
  console.log('\nTarget audience:');
  console.log('  1) public    — public web application');
  console.log('  2) internal  — internal tool / intranet');
  console.log('  3) regulated — regulated industry (finance, healthcare, government)');
  const audienceChoice = await ask('Audience [1/2/3]', '1');
  const audience: InterviewAnswers['audience'] =
    audienceChoice === '3' ? 'regulated' : audienceChoice === '2' ? 'internal' : 'public';

  // 7. Gates
  console.log('\nHuman gates — the pipeline pauses here and waits for your approval:');
  const gateDesign = await askBool('  Design gate (before implementation starts)?', true);
  const gatePlan   = await askBool('  Plan gate (before agents spawn)?', true);
  const gateReview = await askBool('  Review gate (before merge)?', true);

  rl.close();

  return {
    projectName,
    provider,
    providerModel,
    stackFrontend,
    stackBackend,
    stackDatabase,
    testFramework,
    designSystem,
    conventions,
    audience,
    gates: { design: gateDesign, plan: gatePlan, review: gateReview },
  };
}
