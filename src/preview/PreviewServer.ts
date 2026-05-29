import { spawn, ChildProcess } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface PreviewHandle {
  url: string;
  port: number;
  script: string;
  stop: () => Promise<void>;
}

/** Find a free TCP port. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

/** Pick the dev script from package.json (dev → start → preview → serve). */
async function detectScript(dir: string): Promise<string | null> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf-8')) as { scripts?: Record<string, string> };
    for (const s of ['dev', 'start', 'preview', 'serve']) if (pkg.scripts?.[s]) return s;
  } catch { /* no package.json */ }
  return null;
}

/**
 * Start the project's dev server in `dir` on a free port and return its URL.
 * Sets PORT env and passes `-- --port <p>` (covers Vite/Next/CRA-style servers).
 * Resolves once a localhost URL is seen on stdout, or after a short grace period
 * (falling back to the assigned port). Returns null when there's no dev script.
 */
export async function startPreview(dir: string, log: (m: string) => void = () => {}): Promise<PreviewHandle | null> {
  const script = await detectScript(dir);
  if (!script) { log('no dev/start/preview script in package.json — nothing to preview'); return null; }

  const port = await freePort();
  const child: ChildProcess = spawn('npm', ['run', script, '--', '--port', String(port)], {
    cwd: dir,
    env: { ...process.env, PORT: String(port), BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let resolvedUrl = `http://localhost:${port}`;
  const urlSeen = new Promise<void>((resolve) => {
    let done = false;
    const onData = (buf: Buffer) => {
      const m = buf.toString().match(/https?:\/\/localhost:\d+\/?/);
      if (m && !done) { resolvedUrl = m[0].replace(/\/$/, ''); done = true; resolve(); }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    setTimeout(() => { if (!done) { done = true; resolve(); } }, 6000); // fall back to assigned port
  });
  await urlSeen;

  const stop = async () => {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  };
  return { url: resolvedUrl, port, script, stop };
}
