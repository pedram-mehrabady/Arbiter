import http from 'node:http';
import { URL } from 'node:url';
import { OrchestratorDispatcher } from '../orchestrator/OrchestratorDispatcher';

export const ORCHESTRATOR_PORT = 7474;

export class OrchestratorHttpApi {
  private server: http.Server | null = null;

  constructor(private readonly dispatcher: OrchestratorDispatcher) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handle(req, res).catch(err => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        });
      });

      this.server.listen(ORCHESTRATOR_PORT, '127.0.0.1', () => resolve());
      this.server.once('error', reject);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://localhost:${ORCHESTRATOR_PORT}`);

    // POST /api/orchestrator/chat
    if (req.method === 'POST' && url.pathname === '/api/orchestrator/chat') {
      const body = await readBody(req);
      let parsed: { taskId?: string; message?: string };
      try {
        parsed = JSON.parse(body) as { taskId?: string; message?: string };
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        return;
      }

      const { taskId, message } = parsed;
      if (!taskId || !message) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: 'taskId and message required' }));
        return;
      }

      const response = await this.dispatcher.wake(taskId, 'user_chat', { message });
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, reply: response.content }));
      return;
    }

    // GET /api/orchestrator/history?taskId=X
    if (req.method === 'GET' && url.pathname === '/api/orchestrator/history') {
      const taskId = url.searchParams.get('taskId');
      if (!taskId) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: 'taskId required' }));
        return;
      }

      const history = this.dispatcher.getChatHistory(taskId);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, history }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ ok: false, error: 'Not found' }));
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}
