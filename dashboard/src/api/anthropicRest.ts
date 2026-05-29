// Browser-safe Anthropic Messages call via fetch.
//
// We deliberately do NOT use @anthropic-ai/sdk here: the Node SDK pulls
// node:fs / node:crypto / agent-toolset into the client bundle, which breaks
// the production build. The REST endpoint works directly from the browser with
// the anthropic-dangerous-direct-browser-access header.

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnthropicCallOpts {
  apiKey: string;
  model: string;
  maxTokens: number;
  system?: string;
  messages: AnthropicMessage[];
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

/** Send a Messages request and return the concatenated text of the response. */
export async function anthropicCreateMessage(opts: AnthropicCallOpts): Promise<string> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens,
      ...(opts.system ? { system: opts.system } : {}),
      messages: opts.messages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json() as { content?: Array<{ type: string; text?: string }> };
  return (data.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
}
