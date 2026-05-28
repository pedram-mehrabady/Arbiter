import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { SqliteStore } from '../state/SqliteStore';

export const WEBHOOK_PORT = 7475;

export type WebhookEventType = 'workflow_run' | 'pull_request_review_comment' | 'issue_comment' | 'unknown';

export interface WebhookHandlers {
  onCiResult(taskId: string, conclusion: string, prUrl: string, runUrl: string): Promise<void>;
  onPrComment(taskId: string, comment: string, prNumber: number, author: string, isReview: boolean): Promise<void>;
}

export class WebhookReceiver {
  private server: http.Server | null = null;

  constructor(
    private readonly sqliteStore: SqliteStore,
    private readonly secret: string,
    private readonly handlers: WebhookHandlers,
  ) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handle(req, res).catch(() => {
          if (!res.headersSent) {
            res.writeHead(500);
            res.end();
          }
        });
      });
      this.server.listen(WEBHOOK_PORT, '127.0.0.1', () => resolve());
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
    if (req.method !== 'POST' || req.url !== '/webhook') {
      res.writeHead(404);
      res.end();
      return;
    }

    const bodyBuffer = await readBodyBuffer(req);

    // Validate HMAC-SHA256 signature
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    if (!this.validateSignature(bodyBuffer, signature ?? '')) {
      res.writeHead(401);
      res.end('Invalid signature');
      return;
    }

    // Return 200 immediately — handler is async and non-blocking
    res.writeHead(200);
    res.end('OK');

    const eventType = (req.headers['x-github-event'] as string | undefined) ?? 'unknown';
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(bodyBuffer.toString('utf-8')) as Record<string, unknown>;
    } catch {
      return;
    }

    // Write raw event to SqliteStore
    const taskId = extractTaskId(payload);
    if (taskId) {
      this.sqliteStore.appendEvent(taskId, 'inbound_webhook', {
        eventType,
        payloadKeys: Object.keys(payload),
      });
    }

    // Route to handler (fire-and-forget — errors are swallowed, 200 already sent)
    this.routeEvent(eventType, payload, taskId).catch(() => {});
  }

  private async routeEvent(
    eventType: string,
    payload: Record<string, unknown>,
    taskId: string,
  ): Promise<void> {
    if (eventType === 'workflow_run') {
      const run = payload.workflow_run as Record<string, unknown> | undefined;
      const conclusion = String(run?.conclusion ?? 'unknown');
      const prUrl = String((run?.pull_requests as Array<{ url: string }> | undefined)?.[0]?.url ?? '');
      const runUrl = String(run?.html_url ?? '');
      if (taskId) {
        await this.handlers.onCiResult(taskId, conclusion, prUrl, runUrl);
      }
    } else if (eventType === 'pull_request_review_comment' || eventType === 'issue_comment') {
      const comment = payload.comment as Record<string, unknown> | undefined;
      const pr = (payload.pull_request ?? payload.issue) as Record<string, unknown> | undefined;
      const prNumber = typeof pr?.number === 'number' ? pr.number : 0;
      const commentBody = String(comment?.body ?? '');
      const author = String((comment?.user as Record<string, unknown> | undefined)?.login ?? 'unknown');
      const isReview = eventType === 'pull_request_review_comment';
      if (taskId) {
        await this.handlers.onPrComment(taskId, commentBody, prNumber, author, isReview);
      }
    }
  }

  validateSignature(body: Buffer, signature: string): boolean {
    if (!signature || !this.secret) return !this.secret;
    try {
      const expected = `sha256=${createHmac('sha256', this.secret).update(body).digest('hex')}`;
      return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  }
}

function extractTaskId(payload: Record<string, unknown>): string {
  // Extract from PR branch name: feat/arbiter-{taskId}-*
  const branchSources = [
    (payload.workflow_run as Record<string, unknown> | undefined)?.head_branch,
    ((payload.pull_request as Record<string, unknown> | undefined)?.head as Record<string, unknown> | undefined)?.ref,
    (payload.issue as Record<string, unknown> | undefined)?.title,
  ];

  for (const source of branchSources) {
    if (typeof source === 'string') {
      const match = source.match(/arbiter[-/]([A-Z]+-\d+)/i);
      if (match) return match[1];
    }
  }
  return '';
}

function readBodyBuffer(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
