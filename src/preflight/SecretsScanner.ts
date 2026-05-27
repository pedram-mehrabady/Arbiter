import fs from 'node:fs/promises';
import { ServiceResult } from '../types/index';

export interface SecretMatch {
  file: string;
  line: number;
  pattern: string;
  excerpt: string;
}

// Patterns that indicate hardcoded secrets.
// Tuned to avoid false positives in documentation and test fixtures.
const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'anthropic_api_key', pattern: /sk-ant-[a-zA-Z0-9\-_]{20,}/g },
  { name: 'openai_api_key', pattern: /sk-[a-zA-Z0-9]{20,}/g },
  { name: 'generic_api_key', pattern: /api[_-]?key\s*[:=]\s*["'][a-zA-Z0-9\-_]{16,}["']/gi },
  { name: 'bearer_token', pattern: /bearer\s+[a-zA-Z0-9\-_\.]{20,}/gi },
  { name: 'private_key_pem', pattern: /-----BEGIN (RSA |EC |OPENSSH |)?PRIVATE KEY-----/g },
  { name: 'aws_access_key', pattern: /AKIA[0-9A-Z]{16}/g },
  { name: 'password_literal', pattern: /password\s*[:=]\s*["'][^"']{8,}["']/gi },
  { name: 'secret_literal', pattern: /secret\s*[:=]\s*["'][^"']{8,}["']/gi },
  { name: 'connection_string', pattern: /postgresql:\/\/[^:]+:[^@]{4,}@/gi },
];

export class SecretsScanner {
  async scanFile(filePath: string): Promise<ServiceResult<SecretMatch[]>> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const matches: SecretMatch[] = [];

      for (const { name, pattern } of SECRET_PATTERNS) {
        // Reset lastIndex for global patterns
        pattern.lastIndex = 0;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;
          const linePattern = new RegExp(pattern.source, pattern.flags);
          if (linePattern.test(line)) {
            matches.push({
              file: filePath,
              line: i + 1,
              pattern: name,
              excerpt: line.slice(0, 120).replace(/["'][^"']{4,}["']/g, '"[REDACTED]"'),
            });
          }
        }
      }

      return { ok: true, value: matches };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ok: true, value: [] };
      }
      return { ok: false, error: `Scan failed for ${filePath}: ${String(err)}` };
    }
  }

  async scanFiles(filePaths: string[]): Promise<ServiceResult<SecretMatch[]>> {
    const allMatches: SecretMatch[] = [];

    for (const filePath of filePaths) {
      const result = await this.scanFile(filePath);
      if (!result.ok) return result;
      allMatches.push(...result.value);
    }

    return { ok: true, value: allMatches };
  }

  formatViolations(matches: SecretMatch[]): string {
    return matches
      .map(m => `  ${m.file}:${m.line} [${m.pattern}] — ${m.excerpt}`)
      .join('\n');
  }
}
