import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function seedWithRepo(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('arbiter-dev-name', 'Test User');
    localStorage.setItem('pipeline-dashboard-settings', JSON.stringify({
      state: {
        settings: {
          repoPath: '/test-repo', os: 'mac',
          anthropicApiKey: '', assistantProvider: '', assistantModel: 'claude-opus-4-7',
        },
        plans: [], dismissedGateIds: [], widgetOrder: [], widgetSizes: {},
      },
      version: 0,
    }));
  });
}

async function mockRoutes(
  page: Page,
  jobs: object[],
  ironFunnelByTaskId: Record<string, object> = {},
) {
  await page.route('**/api/repo-read**', async (route, request) => {
    const p = new URL(request.url()).searchParams.get('path') ?? '';
    if (p.endsWith('mcp-state.json')) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, content: JSON.stringify({ jobs }) }),
      });
    }
    for (const [taskId, data] of Object.entries(ironFunnelByTaskId)) {
      if (p.endsWith(`iron-funnel-${taskId}.json`)) {
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ ok: true, content: JSON.stringify(data) }),
        });
      }
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
  });
  await page.route('**/api/repo-ls**', async (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, entries: [] }) })
  );
}

test.describe('Tier badges', () => {
  test('task card with tier=3 shows T3 badge', async ({ page }) => {
    await mockRoutes(page,
      [{ id: 'FEAT-001', ticket: 'FEAT-001', title: 'Add authentication', status: 'building' }],
      { 'FEAT-001': { task_id: 'FEAT-001', tier: 3, profile: 'full-pipeline', is_critical_path: false, blocking_count: 0, gates: [] } },
    );
    await seedWithRepo(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=Add authentication')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('[class*="tierBadge"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[class*="tier3"]')).toBeVisible({ timeout: 2000 });
    await expect(page.locator('[class*="tierBadge"]').filter({ hasText: 'T3' })).toBeVisible();
  });

  test('task card with tier=1 shows T1 badge', async ({ page }) => {
    await mockRoutes(page,
      [{ id: 'FEAT-002', ticket: 'FEAT-002', title: 'Fix typo in heading', status: 'building' }],
      { 'FEAT-002': { task_id: 'FEAT-002', tier: 1, profile: 'speed', is_critical_path: false, blocking_count: 0, gates: [] } },
    );
    await seedWithRepo(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=Fix typo in heading')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('[class*="tierBadge"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[class*="tier1"]')).toBeVisible({ timeout: 2000 });
    await expect(page.locator('[class*="tierBadge"]').filter({ hasText: 'T1' })).toBeVisible();
  });

  test('task card with no iron-funnel data renders without error (no badge)', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    await mockRoutes(page,
      [{ id: 'OLD-001', ticket: 'OLD-001', title: 'Old task no tier', status: 'building' }],
    );
    await seedWithRepo(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=Old task no tier')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('[class*="tierBadge"]')).not.toBeVisible({ timeout: 2000 });

    const critical = errors.filter((e) =>
      !e.includes('favicon') && !e.includes('404') && !e.includes('net::ERR_') && !e.includes('Failed to fetch'),
    );
    expect(critical).toHaveLength(0);
  });
});
