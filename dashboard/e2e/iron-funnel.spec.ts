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

const FULL_FUNNEL = [
  { gate: 1, name: 'Compiler Airlock', type: 'deterministic', status: 'passed',  elapsed_ms: 1200 },
  { gate: 2, name: 'Test Writer',       type: 'llm',           status: 'passed',  elapsed_ms: 45000 },
  { gate: 3, name: 'Proving Ground',    type: 'deterministic', status: 'running', elapsed_ms: null },
  { gate: 4, name: 'Debugger',          type: 'llm',           status: 'pending' },
  { gate: 5, name: 'Semantic Review',   type: 'llm',           status: 'pending' },
];

test.describe('Iron Funnel progress bar', () => {
  test('5 gate entries visible after expanding a card with iron-funnel data', async ({ page }) => {
    await mockRoutes(page,
      [{ id: 'FEAT-010', ticket: 'FEAT-010', title: 'Feature with funnel', status: 'building' }],
      { 'FEAT-010': { task_id: 'FEAT-010', tier: 3, profile: 'full-pipeline', gates: FULL_FUNNEL } },
    );
    await seedWithRepo(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=Feature with funnel')).toBeVisible({ timeout: 8000 });

    // Expand the card by clicking its header
    await page.locator('[class*="hdr"]').first().click();

    // IRON FUNNEL label should appear in the expanded panel
    await expect(page.locator('text=IRON FUNNEL')).toBeVisible({ timeout: 5000 });
    // All 5 gate groups rendered
    await expect(page.locator('[class*="ironFunnelGroup"]')).toHaveCount(5, { timeout: 3000 });
  });

  test('Gate 1 passed shows green check icon in status', async ({ page }) => {
    await mockRoutes(page,
      [{ id: 'FEAT-011', ticket: 'FEAT-011', title: 'Gate 1 passed task', status: 'building' }],
      { 'FEAT-011': { task_id: 'FEAT-011', tier: 3, profile: 'full-pipeline', gates: FULL_FUNNEL } },
    );
    await seedWithRepo(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=Gate 1 passed task')).toBeVisible({ timeout: 8000 });
    await page.locator('[class*="hdr"]').first().click();

    // Gate 1 passed — should show ✓ and elapsed time
    await expect(page.locator('[class*="gatePassed"]').first()).toBeVisible({ timeout: 5000 });
    // Status text contains ✓ and time
    await expect(page.locator('[class*="ironGateStatus"]').first()).toContainText('✓');
  });

  test('Gate 3 running shows animated pulse class', async ({ page }) => {
    await mockRoutes(page,
      [{ id: 'FEAT-012', ticket: 'FEAT-012', title: 'Gate 3 running task', status: 'building' }],
      { 'FEAT-012': { task_id: 'FEAT-012', tier: 3, profile: 'full-pipeline', gates: FULL_FUNNEL } },
    );
    await seedWithRepo(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=Gate 3 running task')).toBeVisible({ timeout: 8000 });
    await page.locator('[class*="hdr"]').first().click();

    await expect(page.locator('text=IRON FUNNEL')).toBeVisible({ timeout: 5000 });
    // Gate 3 is running — the 3rd ironGate element should have gateRunning class
    const gateRunningEl = page.locator('[class*="gateRunning"]');
    await expect(gateRunningEl).toBeVisible({ timeout: 3000 });
    await expect(gateRunningEl).toContainText('⏳');
  });

  test('Gate 4 skipped shows skip indicator', async ({ page }) => {
    const funnelWithSkip = [
      { gate: 1, name: 'Compiler Airlock', type: 'deterministic', status: 'passed',  elapsed_ms: 800 },
      { gate: 2, name: 'Test Writer',       type: 'llm',           status: 'passed',  elapsed_ms: 30000 },
      { gate: 3, name: 'Proving Ground',    type: 'deterministic', status: 'passed',  elapsed_ms: 5000 },
      { gate: 4, name: 'Debugger',          type: 'llm',           status: 'skipped' },
      { gate: 5, name: 'Semantic Review',   type: 'llm',           status: 'running' },
    ];
    await mockRoutes(page,
      [{ id: 'FEAT-013', ticket: 'FEAT-013', title: 'Gate 4 skipped task', status: 'building' }],
      { 'FEAT-013': { task_id: 'FEAT-013', tier: 3, profile: 'full-pipeline', gates: funnelWithSkip } },
    );
    await seedWithRepo(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=Gate 4 skipped task')).toBeVisible({ timeout: 8000 });
    await page.locator('[class*="hdr"]').first().click();

    await expect(page.locator('text=IRON FUNNEL')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[class*="gateSkipped"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[class*="ironGateStatus"]').nth(3)).toContainText('skip');
  });

  test('card without iron-funnel data shows existing stage history (backward compat)', async ({ page }) => {
    await mockRoutes(page, [
      {
        id: 'OLD-010', ticket: 'OLD-010', title: 'Old task no funnel', status: 'building',
        stage_history: [{ stage: 'plan', duration_s: 30, outcome: 'pass' }],
      },
    ]); // no iron funnel data
    await seedWithRepo(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=Old task no funnel')).toBeVisible({ timeout: 8000 });
    await page.locator('[class*="hdr"]').first().click();

    // Stage history should appear — no iron funnel
    await expect(page.locator('text=IRON FUNNEL')).not.toBeVisible({ timeout: 2000 });
    await expect(page.locator('[class*="histStage"]').first()).toBeVisible({ timeout: 3000 });
  });
});
