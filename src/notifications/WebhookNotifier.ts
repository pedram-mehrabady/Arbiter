import { createHmac } from 'node:crypto';
import { NotificationsConfig } from '../types/index';

export type WebhookEvent =
  | 'gate_created'
  | 'task_complete'
  | 'task_failed'
  | 'pr_comment_received'
  | 'ci_result_received'
  | 'gate_timeout_warn'
  | 'gate_timeout_escalate';

export interface WebhookPayload {
  event: WebhookEvent;
  task_id: string;
  gate_id?: string;
  gate_type?: string;
  context?: string;
  ts: string;
}

export class WebhookNotifier {
  constructor(private readonly config: NotificationsConfig) {}

  async notify(event: WebhookEvent, payload: Omit<WebhookPayload, 'event' | 'ts'>): Promise<void> {
    if (!this.shouldSend(event)) return;

    const body: WebhookPayload = { event, ts: new Date().toISOString(), ...payload };
    const json = JSON.stringify(body);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.secret) {
      headers['X-Arbiter-Signature'] = `sha256=${sign(json, this.config.secret)}`;
    }

    try {
      const resp = await fetch(this.config.webhook_url, { method: 'POST', headers, body: json });
      if (!resp.ok) {
        console.warn(`  ⚠ Webhook delivery failed (${resp.status}) for event "${event}"`);
      }
    } catch (err) {
      console.warn(`  ⚠ Webhook delivery error for event "${event}": ${String(err)}`);
    }
  }

  private shouldSend(event: WebhookEvent): boolean {
    if (event === 'gate_created')  return this.config.on_gate     !== false;
    if (event === 'task_complete') return this.config.on_complete !== false;
    if (event === 'task_failed')   return this.config.on_failure  !== false;
    return true;
  }
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}
