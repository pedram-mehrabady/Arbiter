import { test, expect } from '@playwright/test';

// Pre-seed localStorage to bypass DeveloperSetupModal (which shows when name is null)
async function seedStorage(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    localStorage.setItem('arbiter-dev-name', 'Test User');
  });
}

test.describe('AssistantChat', () => {
  test('chat FAB button is visible on the dashboard', async ({ page }) => {
    await seedStorage(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const fab = page.locator('button[aria-label*="assistant"], button[title*="assistant"]').first();
    await expect(fab).toBeVisible({ timeout: 5000 });
  });

  test('clicking FAB opens the chat panel', async ({ page }) => {
    await seedStorage(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const fab = page.locator('button[aria-label*="assistant"], button[title*="assistant"]').first();
    await fab.click();

    const panel = page.locator('[class*="panel"]').filter({ hasText: 'AI Assistant' }).first();
    await expect(panel).toBeVisible({ timeout: 5000 });
  });

  test('chat panel shows input or "no provider" notice', async ({ page }) => {
    await seedStorage(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const fab = page.locator('button[aria-label*="assistant"], button[title*="assistant"]').first();
    await fab.click();

    const panel = page.locator('[class*="panel"]').filter({ hasText: 'AI Assistant' }).first();
    await expect(panel).toBeVisible({ timeout: 5000 });

    const hasNotice = await page.locator('text=No assistant configured').isVisible().catch(() => false);
    const hasInput  = await page.locator('textarea').isVisible().catch(() => false);
    expect(hasNotice || hasInput).toBe(true);
  });

  test('chat panel close button dismisses the panel', async ({ page }) => {
    await seedStorage(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const fab = page.locator('button[aria-label*="assistant"], button[title*="assistant"]').first();
    await fab.click();

    const panel = page.locator('[class*="panel"]').filter({ hasText: 'AI Assistant' }).first();
    await expect(panel).toBeVisible({ timeout: 5000 });

    const closeBtn = panel.locator('button').filter({ hasText: '✕' }).last();
    await closeBtn.click();

    await expect(panel).not.toBeVisible({ timeout: 3000 });
  });
});
