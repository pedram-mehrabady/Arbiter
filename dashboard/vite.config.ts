import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import type { IncomingMessage, ServerResponse } from 'http';

// Reads .env.arbiter from the project root (one dir up from dashboard/)
function readSoltanCreds(): { token: string; chatId: string } | null {
  const envPath = path.resolve(process.cwd(), '../.env.arbiter');
  if (!fs.existsSync(envPath)) return null;
  const raw = fs.readFileSync(envPath, 'utf-8');
  const token  = raw.match(/^TELEGRAM_TOKEN=(.+)$/m)?.[1]?.trim() ?? '';
  const chatId = raw.match(/^TELEGRAM_CHAT_ID=(.+)$/m)?.[1]?.trim() ?? '';
  if (!token || !chatId) return null;
  return { token, chatId };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function launchInTerminal(cmd: string, args: string[], os: string, cwd?: string): { ok: boolean; error?: string } {
  try {
    if (os === 'win') {
      const cdPart = cwd ? `cd /d ${shq(cwd)} && ` : '';
      const full = cdPart + [cmd, ...args].join(' ');
      spawn('cmd', ['/c', 'start', '""', 'cmd', '/k', full], { detached: true, shell: true }).unref();
    } else {
      const cdPart = cwd ? `cd ${shq(cwd)} && ` : '';
      const shellCmd = cdPart + [cmd, ...args].map(shq).join(' ');
      const appleScript = `tell application "Terminal"\n  do script ${JSON.stringify(shellCmd)}\n  activate\nend tell`;
      spawn('osascript', ['-e', appleScript], { detached: true }).unref();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// Repo root = one directory above dashboard/ (the arbiter project root)
const REPO_ROOT = path.resolve(process.cwd(), '..');

function isConductorRunning(): boolean {
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq bash.exe', '/FO', 'CSV'], { encoding: 'utf-8' });
      return (r.stdout ?? '').includes('bash.exe');
    }
    const r = spawnSync('pgrep', ['-f', 'arbiter'], { encoding: 'utf-8' });
    return r.status === 0 && (r.stdout?.trim().length ?? 0) > 0;
  } catch { return false; }
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  plugins: [
    react(),
    {
      name: 'arbiter-reporter',
      configureServer(server) {
        server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {

          // ── Conductor status check ────────────────────────────────
          if (req.method === 'GET' && req.url === '/api/process-status') {
            return sendJson(res, 200, { running: isConductorRunning() });
          }

          // ── File read ─────────────────────────────────────────────
          if (req.method === 'GET' && req.url?.startsWith('/api/repo-read')) {
            const url = new URL(req.url, 'http://localhost');
            const repoPath = url.searchParams.get('path') ?? '';
            const repoRoot = url.searchParams.get('root') ?? REPO_ROOT;
            const abs = path.resolve(repoRoot, repoPath);
            if (!abs.startsWith(path.resolve(repoRoot))) {
              return sendJson(res, 403, { ok: false, error: 'path traversal denied' });
            }
            try {
              const content = fs.readFileSync(abs, 'utf-8');
              return sendJson(res, 200, { ok: true, content });
            } catch {
              return sendJson(res, 404, { ok: false, error: 'not found' });
            }
          }

          // ── Directory list ─────────────────────────────────────────
          if (req.method === 'GET' && req.url?.startsWith('/api/repo-ls')) {
            const url = new URL(req.url, 'http://localhost');
            const repoPath = url.searchParams.get('path') ?? '';
            const repoRoot = url.searchParams.get('root') ?? REPO_ROOT;
            const abs = path.resolve(repoRoot, repoPath);
            if (!abs.startsWith(path.resolve(repoRoot))) {
              return sendJson(res, 403, { ok: false, error: 'path traversal denied' });
            }
            try {
              const entries = fs.readdirSync(abs, { withFileTypes: true });
              const list = entries.map((e) => {
                const kind = e.isDirectory() ? 'directory' : 'file';
                let mtime_ms = 0;
                try { mtime_ms = fs.statSync(path.join(abs, e.name)).mtimeMs; } catch { /* skip */ }
                return { name: e.name, kind, mtime_ms };
              });
              return sendJson(res, 200, { ok: true, entries: list });
            } catch {
              return sendJson(res, 404, { ok: false, error: 'not found' });
            }
          }

          if (req.method !== 'POST') return next();

          // ── Morning Telegram report ───────────────────────────────
          if (req.url === '/api/morning-report') {
            const creds = readSoltanCreds();
            if (!creds) {
              return sendJson(res, 400, { ok: false, error: 'telegram credentials not found' });
            }
            let payload: { text: string };
            try { payload = JSON.parse(await readBody(req)); }
            catch { return sendJson(res, 400, { ok: false, error: 'bad json' }); }

            if (!payload.text?.trim()) {
              return sendJson(res, 400, { ok: false, error: 'empty message' });
            }

            try {
              const r = await fetch(`https://api.telegram.org/bot${creds.token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: creds.chatId,
                  text: payload.text,
                  parse_mode: 'HTML',
                }),
              });
              const json = await r.json() as { ok: boolean };
              return sendJson(res, json.ok ? 200 : 500, { ok: json.ok });
            } catch (e) {
              return sendJson(res, 500, { ok: false, error: String(e) });
            }
          }

          // ── Start conductor daemon in a new terminal ──────────────
          if (req.url === '/api/start-conductor') {
            const os = process.platform === 'win32' ? 'win' : 'mac';
            const result = launchInTerminal('npx', ['arbiter', 'run'], os, REPO_ROOT);
            return sendJson(res, result.ok ? 200 : 500, result);
          }

          // ── Launch an agent CLI in a new terminal ─────────────────
          if (req.url === '/api/launch-agent') {
            let payload: { cmd: string; args?: string[]; os?: string };
            try { payload = JSON.parse(await readBody(req)); }
            catch { return sendJson(res, 400, { ok: false, error: 'bad json' }); }

            const os = payload.os || (process.platform === 'win32' ? 'win' : 'mac');
            const result = launchInTerminal(payload.cmd, payload.args || [], os, REPO_ROOT);
            return sendJson(res, result.ok ? 200 : 500, result);
          }

          // ── AI assistant chat ─────────────────────────────────────
          if (req.url === '/api/run-assistant') {
            let payload: { provider: string; model: string; messages: Array<{ role: string; content: string }>; apiKey?: string };
            try { payload = JSON.parse(await readBody(req)); }
            catch { return sendJson(res, 400, { ok: false, error: 'bad json' }); }

            const { provider, model, messages, apiKey } = payload;
            const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';

            if (provider === 'claude_max_cli') {
              // Build a minimal context: system + history + latest user turn
              const systemLines = [
                'You are a helpful assistant embedded in Arbiter Pipeline, an AI-driven development pipeline tool.',
                'Be concise and practical.',
              ];
              const historyText = messages.slice(0, -1)
                .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
                .join('\n');
              const prompt = historyText
                ? `${systemLines.join(' ')}\n\nConversation so far:\n${historyText}\n\nUser: ${lastUser}`
                : `${systemLines.join(' ')}\n\nUser: ${lastUser}`;

              const reply = await new Promise<string>((resolve) => {
                const proc = spawn('claude', ['--model', model, '-p', prompt], { env: process.env });
                let out = ''; let err = '';
                proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
                proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
                proc.on('close', (code: number) => {
                  if (code === 0 && out.trim()) resolve(out.trim());
                  else resolve(`Error (exit ${code}): ${err.trim() || 'no output'}`);
                });
                setTimeout(() => { proc.kill(); resolve('Request timed out after 90 seconds.'); }, 90_000);
              });
              return sendJson(res, 200, { ok: true, reply });
            }

            if (provider === 'anthropic_api') {
              if (!apiKey) return sendJson(res, 400, { ok: false, error: 'API key required' });
              try {
                const r = await fetch('https://api.anthropic.com/v1/messages', {
                  method: 'POST',
                  headers: {
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json',
                  },
                  body: JSON.stringify({
                    model,
                    max_tokens: 1024,
                    system: 'You are a helpful assistant embedded in Arbiter Pipeline, an AI-driven development pipeline tool. Be concise and practical.',
                    messages: messages.map((m) => ({ role: m.role, content: m.content })),
                  }),
                });
                const json = await r.json() as { content?: Array<{ text: string }> };
                const reply = json.content?.[0]?.text ?? 'No response';
                return sendJson(res, 200, { ok: true, reply });
              } catch (e) {
                return sendJson(res, 500, { ok: false, error: String(e) });
              }
            }

            return sendJson(res, 400, { ok: false, error: `Unknown provider: ${provider}` });
          }

          // ── File write ─────────────────────────────────────────────
          if (req.url === '/api/repo-write') {
            let payload: { path: string; content: string; root?: string };
            try { payload = JSON.parse(await readBody(req)); }
            catch { return sendJson(res, 400, { ok: false, error: 'bad json' }); }
            const repoRoot = payload.root ?? REPO_ROOT;
            const abs = path.resolve(repoRoot, payload.path);
            if (!abs.startsWith(path.resolve(repoRoot))) {
              return sendJson(res, 403, { ok: false, error: 'path traversal denied' });
            }
            try {
              fs.mkdirSync(path.dirname(abs), { recursive: true });
              fs.writeFileSync(abs, payload.content, 'utf-8');
              return sendJson(res, 200, { ok: true });
            } catch (e) {
              return sendJson(res, 500, { ok: false, error: String(e) });
            }
          }

          // ── Exec-plan folder scan ─────────────────────────────────
          if (req.url?.startsWith('/api/exec-plan-scan')) {
            const urlObj = new URL(req.url, 'http://localhost');
            const stageDir = urlObj.searchParams.get('stage') ?? '';
            const taskId   = urlObj.searchParams.get('task')  ?? '';
            const execPlanDir = urlObj.searchParams.get('execPlanDir') ?? 'compliance/exec-plan';
            const dir = path.join(REPO_ROOT, execPlanDir, stageDir, taskId);
            try {
              const entries = fs.readdirSync(dir, { withFileTypes: true })
                .filter((f) => f.isFile())
                .map((f) => ({
                  name:     f.name,
                  mtime_ms: fs.statSync(path.join(dir, f.name)).mtimeMs,
                }));
              return sendJson(res, 200, { ok: true, entries });
            } catch {
              return sendJson(res, 200, { ok: true, entries: [] });
            }
          }

          next();
        });
      },
    },
  ],
  server: {
    port: 3070,
  },
});
