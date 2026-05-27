import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BlastRadius, ServiceResult } from '../types/index';

// Current schema version — bump when the Design output template changes.
// A version mismatch forces a cache miss so stale layouts don't pass through.
const DESIGN_SCHEMA_VERSION = '1';

export interface CachedDesign {
  cacheKey: string;
  designPath: string;
  criticPath: string;
  receiptId: string;
  approvedAt: string;
  schemaVersion: string;
}

export interface CacheCheckResult {
  skip: boolean;
  reason: string;
  cached?: CachedDesign;
}

export interface CacheEntry {
  cache_key: string;
  design_path: string;
  critic_path: string;
  receipt_id: string;
  approved_at: string;
  schema_version: string;
  modules_covered: string[];
}

// EvidenceCache stores approved design artifacts keyed by the sorted module set
// they cover. When blast-radius analysis shows a new task touches only previously
// approved modules with no new contracts or schemas, the design phase is skipped
// and the cached artifacts are re-used — providing consistency evidence to audit
// evaluators rather than regenerating a predetermined result.

export class EvidenceCache {
  private readonly cacheDir: string;

  constructor(workspaceRoot: string) {
    this.cacheDir = path.join(workspaceRoot, '.arbiter', 'evidence-cache', 'design');
  }

  // ── Cache lookup ─────────────────────────────────────────────────────────

  async shouldSkipDesignPhase(blastRadius: BlastRadius): Promise<CacheCheckResult> {
    // Hard no-skip conditions — any of these means design must run
    if (blastRadius.new_modules_created.length > 0) {
      return { skip: false, reason: 'new_module' };
    }
    if (blastRadius.cross_module_contracts_changed) {
      return { skip: false, reason: 'contract_changed' };
    }
    if (blastRadius.new_data_schemas) {
      return { skip: false, reason: 'new_schema' };
    }
    if (blastRadius.new_cryptographic_surfaces) {
      return { skip: false, reason: 'crypto_surface' };
    }
    if (blastRadius.new_external_integrations) {
      return { skip: false, reason: 'external_integration' };
    }
    if (blastRadius.architectural_boundary_crossed) {
      return { skip: false, reason: 'boundary_crossed' };
    }

    // All clear — check cache for the exact module set
    const cacheKey = this.deriveCacheKey(blastRadius.modules_touched);
    if (!cacheKey) {
      return { skip: false, reason: 'no_modules_touched' };
    }

    const lookup = await this.lookup(cacheKey);
    if (!lookup.ok) return { skip: false, reason: 'cache_read_error' };
    if (!lookup.value) return { skip: false, reason: 'no_cache' };

    const cached = lookup.value;

    // Schema version check — stale layout → cache miss
    if (cached.schemaVersion !== DESIGN_SCHEMA_VERSION) {
      return { skip: false, reason: `schema_version_mismatch:${cached.schemaVersion}!=${DESIGN_SCHEMA_VERSION}` };
    }

    // Verify the artifacts still exist on disk
    const [designExists, criticExists] = await Promise.all([
      fs.access(cached.designPath).then(() => true).catch(() => false),
      fs.access(cached.criticPath).then(() => true).catch(() => false),
    ]);

    if (!designExists || !criticExists) {
      return { skip: false, reason: 'cached_artifacts_missing' };
    }

    return {
      skip: true,
      reason: `cache_hit:${cacheKey},approved:${cached.approvedAt}`,
      cached,
    };
  }

  // ── Cache write (called after Design + Design-Critic complete) ────────────

  async store(
    blastRadius: BlastRadius,
    designPath: string,
    criticPath: string,
    receiptId: string,
  ): Promise<ServiceResult<void>> {
    const cacheKey = this.deriveCacheKey(blastRadius.modules_touched);
    if (!cacheKey) {
      return { ok: false, error: 'Cannot cache design for empty module set' };
    }

    await fs.mkdir(this.cacheDir, { recursive: true });
    const entryPath = path.join(this.cacheDir, `${cacheKey}.json`);

    const entry: CacheEntry = {
      cache_key: cacheKey,
      design_path: designPath,
      critic_path: criticPath,
      receipt_id: receiptId,
      approved_at: new Date().toISOString(),
      schema_version: DESIGN_SCHEMA_VERSION,
      modules_covered: [...blastRadius.modules_touched].sort(),
    };

    try {
      const tmp = `${entryPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
      await fs.writeFile(tmp, JSON.stringify(entry, null, 2), 'utf-8');
      await fs.rename(tmp, entryPath);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: `Evidence cache write failed: ${String(err)}` };
    }
  }

  // ── Cache invalidation ────────────────────────────────────────────────────

  async invalidate(modulePattern?: string): Promise<ServiceResult<number>> {
    try {
      const entries = await fs.readdir(this.cacheDir).catch(() => [] as string[]);
      let count = 0;
      for (const file of entries) {
        if (!file.endsWith('.json')) continue;
        if (modulePattern) {
          const content = await fs.readFile(path.join(this.cacheDir, file), 'utf-8');
          const entry = JSON.parse(content) as CacheEntry;
          if (!entry.modules_covered.some(m => m.includes(modulePattern))) continue;
        }
        await fs.unlink(path.join(this.cacheDir, file));
        count++;
      }
      return { ok: true, value: count };
    } catch (err) {
      return { ok: false, error: `Evidence cache invalidation failed: ${String(err)}` };
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async lookup(cacheKey: string): Promise<ServiceResult<CachedDesign | null>> {
    const entryPath = path.join(this.cacheDir, `${cacheKey}.json`);
    try {
      const raw = await fs.readFile(entryPath, 'utf-8');
      const entry = JSON.parse(raw) as CacheEntry;
      return {
        ok: true,
        value: {
          cacheKey: entry.cache_key,
          designPath: entry.design_path,
          criticPath: entry.critic_path,
          receiptId: entry.receipt_id,
          approvedAt: entry.approved_at,
          schemaVersion: entry.schema_version,
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ok: true, value: null };
      }
      return { ok: false, error: `Evidence cache read failed: ${String(err)}` };
    }
  }

  // Stable cache key: sha256 of sorted module list (collision-free, human-readable in log)
  private deriveCacheKey(modules: string[]): string {
    if (modules.length === 0) return '';
    const sorted = [...modules].sort().join('+');
    return createHash('sha256').update(sorted).digest('hex').slice(0, 16);
  }
}

// Parse blast-radius JSON block from research agent output.
// The research agent embeds a ```json { "blast_radius": {...} } ``` block.
const BLAST_RADIUS_FENCE = /```(?:json)?\s*\n([\s\S]*?)\n```/g;

export function parseBlastRadius(researchContent: string): BlastRadius | null {
  BLAST_RADIUS_FENCE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = BLAST_RADIUS_FENCE.exec(researchContent)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      const br = (parsed as Record<string, unknown>)['blast_radius'] as BlastRadius | undefined;
      if (br && Array.isArray(br.modules_touched)) return br;
    } catch {
      // not a blast_radius block — keep scanning
    }
  }

  // Fallback: if no blast_radius block found, return a maximally conservative value
  // so the design phase always runs rather than incorrectly skipping it.
  return null;
}
