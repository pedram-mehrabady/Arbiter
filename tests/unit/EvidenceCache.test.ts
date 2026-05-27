import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EvidenceCache, parseBlastRadius } from '../../src/evidence/EvidenceCache';
import { BlastRadius } from '../../src/types/index';

const makeRoot = () => fs.mkdtemp(path.join(os.tmpdir(), 'arbiter-cache-'));

function safeBlastRadius(overrides: Partial<BlastRadius> = {}): BlastRadius {
  return {
    modules_touched: ['auth', 'user'],
    new_modules_created: [],
    cross_module_contracts_changed: false,
    new_data_schemas: false,
    new_cryptographic_surfaces: false,
    new_external_integrations: false,
    architectural_boundary_crossed: false,
    ...overrides,
  };
}

describe('EvidenceCache', () => {
  let root: string;
  let cache: EvidenceCache;
  let designPath: string;
  let criticPath: string;

  beforeEach(async () => {
    root = await makeRoot();
    cache = new EvidenceCache(root);
    // Create fake artifact files so existence check passes
    const taskDir = path.join(root, 'task');
    await fs.mkdir(taskDir, { recursive: true });
    designPath = path.join(taskDir, 'design.md');
    criticPath = path.join(taskDir, 'critic.md');
    await fs.writeFile(designPath, '# Design', 'utf-8');
    await fs.writeFile(criticPath, '# Critique', 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  describe('shouldSkipDesignPhase — hard no-skip conditions', () => {
    it('does not skip when new_modules_created is non-empty', async () => {
      const br = safeBlastRadius({ new_modules_created: ['payments'] });
      const result = await cache.shouldSkipDesignPhase(br);
      expect(result.skip).toBe(false);
      expect(result.reason).toBe('new_module');
    });

    it('does not skip when cross_module_contracts_changed', async () => {
      const br = safeBlastRadius({ cross_module_contracts_changed: true });
      const result = await cache.shouldSkipDesignPhase(br);
      expect(result.skip).toBe(false);
      expect(result.reason).toBe('contract_changed');
    });

    it('does not skip when new_data_schemas', async () => {
      const br = safeBlastRadius({ new_data_schemas: true });
      const result = await cache.shouldSkipDesignPhase(br);
      expect(result.skip).toBe(false);
      expect(result.reason).toBe('new_schema');
    });

    it('does not skip when new_cryptographic_surfaces', async () => {
      const br = safeBlastRadius({ new_cryptographic_surfaces: true });
      const result = await cache.shouldSkipDesignPhase(br);
      expect(result.skip).toBe(false);
      expect(result.reason).toBe('crypto_surface');
    });

    it('does not skip when new_external_integrations', async () => {
      const br = safeBlastRadius({ new_external_integrations: true });
      const result = await cache.shouldSkipDesignPhase(br);
      expect(result.skip).toBe(false);
      expect(result.reason).toBe('external_integration');
    });

    it('does not skip when architectural_boundary_crossed', async () => {
      const br = safeBlastRadius({ architectural_boundary_crossed: true });
      const result = await cache.shouldSkipDesignPhase(br);
      expect(result.skip).toBe(false);
      expect(result.reason).toBe('boundary_crossed');
    });

    it('does not skip when modules_touched is empty', async () => {
      const br = safeBlastRadius({ modules_touched: [] });
      const result = await cache.shouldSkipDesignPhase(br);
      expect(result.skip).toBe(false);
      expect(result.reason).toBe('no_modules_touched');
    });
  });

  describe('shouldSkipDesignPhase — cache miss before store', () => {
    it('returns skip=false with no_cache reason when nothing stored', async () => {
      const br = safeBlastRadius();
      const result = await cache.shouldSkipDesignPhase(br);
      expect(result.skip).toBe(false);
      expect(result.reason).toBe('no_cache');
    });
  });

  describe('store and shouldSkipDesignPhase — cache hit', () => {
    it('returns skip=true after storing matching entry', async () => {
      const br = safeBlastRadius();
      await cache.store(br, designPath, criticPath, 'receipt-1');
      const result = await cache.shouldSkipDesignPhase(br);
      expect(result.skip).toBe(true);
      expect(result.reason).toContain('cache_hit');
      expect(result.cached?.receiptId).toBe('receipt-1');
    });

    it('cache key is order-insensitive (sorted modules)', async () => {
      const br1 = safeBlastRadius({ modules_touched: ['auth', 'user'] });
      const br2 = safeBlastRadius({ modules_touched: ['user', 'auth'] });
      await cache.store(br1, designPath, criticPath, 'receipt-1');
      const result = await cache.shouldSkipDesignPhase(br2);
      expect(result.skip).toBe(true);
    });

    it('cache miss when artifact files are deleted', async () => {
      const br = safeBlastRadius();
      await cache.store(br, designPath, criticPath, 'receipt-1');
      await fs.unlink(designPath);
      const result = await cache.shouldSkipDesignPhase(br);
      expect(result.skip).toBe(false);
      expect(result.reason).toBe('cached_artifacts_missing');
    });
  });

  describe('invalidate', () => {
    it('removes all entries when no pattern given', async () => {
      const br = safeBlastRadius();
      await cache.store(br, designPath, criticPath, 'receipt-1');
      const result = await cache.invalidate();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBe(1);

      // Should be cache miss now
      const check = await cache.shouldSkipDesignPhase(br);
      expect(check.skip).toBe(false);
    });

    it('removes only matching entries when pattern given', async () => {
      const br1 = safeBlastRadius({ modules_touched: ['auth'] });
      const br2 = safeBlastRadius({ modules_touched: ['billing'] });
      await cache.store(br1, designPath, criticPath, 'r1');
      await cache.store(br2, designPath, criticPath, 'r2');

      const result = await cache.invalidate('auth');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBe(1);

      // billing entry should still be a hit
      const billingCheck = await cache.shouldSkipDesignPhase(br2);
      expect(billingCheck.skip).toBe(true);
    });

    it('returns 0 when nothing to invalidate', async () => {
      const result = await cache.invalidate();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBe(0);
    });
  });
});

describe('parseBlastRadius', () => {
  it('extracts blast_radius from a JSON fence', () => {
    const content = `
Some research output.

\`\`\`json
{
  "blast_radius": {
    "modules_touched": ["auth", "user"],
    "new_modules_created": [],
    "cross_module_contracts_changed": false,
    "new_data_schemas": false,
    "new_cryptographic_surfaces": false,
    "new_external_integrations": false,
    "architectural_boundary_crossed": false
  }
}
\`\`\`
`;
    const result = parseBlastRadius(content);
    expect(result).not.toBeNull();
    expect(result?.modules_touched).toEqual(['auth', 'user']);
  });

  it('returns null when no blast_radius block found', () => {
    const result = parseBlastRadius('no json here');
    expect(result).toBeNull();
  });

  it('returns null when JSON block exists but has no blast_radius key', () => {
    const content = '```json\n{"other": "data"}\n```';
    const result = parseBlastRadius(content);
    expect(result).toBeNull();
  });

  it('scans multiple fences and picks the one with blast_radius', () => {
    const content = `
\`\`\`json
{"not_blast_radius": true}
\`\`\`

\`\`\`json
{
  "blast_radius": {
    "modules_touched": ["payments"],
    "new_modules_created": [],
    "cross_module_contracts_changed": false,
    "new_data_schemas": true,
    "new_cryptographic_surfaces": false,
    "new_external_integrations": false,
    "architectural_boundary_crossed": false
  }
}
\`\`\`
`;
    const result = parseBlastRadius(content);
    expect(result?.modules_touched).toEqual(['payments']);
    expect(result?.new_data_schemas).toBe(true);
  });
});
