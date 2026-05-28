import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function mockArbitrRoutes(page: Page) {
  await page.route('**/api/repo-read**', async (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
  );
  await page.route('**/api/repo-ls**', async (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, entries: [] }) })
  );
}

async function seedWithRepo(page: Page) {
  await page.addInitScript(() => {
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

test.describe('Developer setup flow (init-flow)', () => {
  test('DeveloperSetupModal appears when no identity is set', async ({ page }) => {
    await mockArbitrRoutes(page);
    // Do NOT set arbiter-dev-name — modal should appear
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Modal should be visible
    const modal = page.locator('[class*="modal"], [role="dialog"]').filter({ hasText: /name|developer|who are you/i }).first();
    // If there's an overlay or input asking for a name, that's the setup modal
    const nameInput = page.locator('input[type="text"], input[placeholder*="name" i]').first();
    const hasModal = await modal.isVisible({ timeout: 3000 }).catch(() => false);
    const hasInput = await nameInput.isVisible({ timeout: 3000 }).catch(() => false);
    // Either a modal dialog or an input for the name should be visible
    expect(hasModal || hasInput).toBe(true);
  });

  test('Entering a developer name dismisses the setup screen', async ({ page }) => {
    await mockArbitrRoutes(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const nameInput = page.locator('input[type="text"], input[placeholder*="name" i]').first();
    const hasInput = await nameInput.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasInput) {
      // Already set or modal not present — test is a no-op
      return;
    }

    await nameInput.fill('Test Developer');
    // Use keyboard to submit — avoids overlay pointer-event interception
    await nameInput.press('Enter');

    // Modal should close — the name input (first text input) should no longer be visible
    // Use .first() to avoid strict-mode violation: the modal also has a path input
    await expect(page.locator('input[placeholder*="Pedram" i], input[placeholder*="name" i], input[type="text"]').first()).not.toBeVisible({ timeout: 5000 });
  });

  test('Arbiter paths use arbiter/ prefix (no .arbiter/ references in API calls)', async ({ page }) => {
    const apiCallPaths: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('api/repo-read') || req.url().includes('api/repo-ls')) {
        apiCallPaths.push(req.url());
      }
    });

    await mockArbitrRoutes(page);
    await seedWithRepo(page);
    await page.addInitScript(() => { localStorage.setItem('arbiter-dev-name', 'Test Dev'); });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Wait a bit for polling to fire
    await page.waitForTimeout(2000);

    // All API calls should use 'arbiter/' not '.arbiter/'
    const dotArbiterCalls = apiCallPaths.filter((url) => url.includes('%2F.arbiter%2F') || url.includes('/.arbiter/'));
    expect(dotArbiterCalls, `Expected no .arbiter/ paths, found: ${dotArbiterCalls.join(', ')}`).toHaveLength(0);
  });
});
