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

test.describe('Critical path flag', () => {
  test('task with isCriticalPath=true shows red critical banner', async ({ page }) => {
    await mockRoutes(page,
      [{ id: 'FEAT-020', ticket: 'FEAT-020', title: 'Critical blocker task', status: 'building' }],
      {
        'FEAT-020': {
          task_id: 'FEAT-020', tier: 3, profile: 'full-pipeline',
          is_critical_path: true, blocking_count: 3,
          gates: [],
        },
      },
    );
    await seedWithRepo(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=Critical blocker task')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('[class*="criticalBanner"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[class*="criticalBanner"]')).toContainText('CRITICAL PATH');
    await expect(page.locator('[class*="criticalBanner"]')).toContainText('blocking 3 tasks');
  });

  test('task with isCriticalPath=false shows no critical banner', async ({ page }) => {
    await mockRoutes(page,
      [{ id: 'FEAT-021', ticket: 'FEAT-021', title: 'Non-critical task', status: 'building' }],
      {
        'FEAT-021': {
          task_id: 'FEAT-021', tier: 2, profile: 'investigator',
          is_critical_path: false, blocking_count: 0,
          gates: [],
        },
      },
    );
    await seedWithRepo(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=Non-critical task')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('[class*="criticalBanner"]')).not.toBeVisible({ timeout: 2000 });
  });

  test('task with blocking_count=1 shows singular "task" label', async ({ page }) => {
    await mockRoutes(page,
      [{ id: 'FEAT-022', ticket: 'FEAT-022', title: 'Single blocker', status: 'building' }],
      {
        'FEAT-022': {
          task_id: 'FEAT-022', tier: 3, profile: 'full-pipeline',
          is_critical_path: true, blocking_count: 1,
          gates: [],
        },
      },
    );
    await seedWithRepo(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=Single blocker')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('[class*="criticalBanner"]')).toContainText('blocking 1 task', { timeout: 5000 });
  });
});
