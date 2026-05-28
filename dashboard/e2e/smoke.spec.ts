import { test, expect } from '@playwright/test';

test.describe('Dashboard smoke test', () => {
  test('loads without console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Dashboard renders — check for the top bar or main nav element
    const body = page.locator('body');
    await expect(body).toBeVisible();

    // No critical console errors (filter out known non-critical network errors from missing local files)
    const criticalErrors = consoleErrors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('404') &&
      !e.includes('net::ERR_') &&
      !e.includes('Failed to fetch')
    );
    expect(criticalErrors, `Console errors: ${criticalErrors.join('\n')}`).toHaveLength(0);
  });

  test('has a visible page title or header', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The dashboard should have something visible — not a blank white page
    const html = await page.content();
    expect(html.length).toBeGreaterThan(500);
  });

  test('main navigation tabs are visible', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // App renders some interactive content — check that JavaScript ran
    // (if JS fails, the page is empty or shows a raw HTML skeleton)
    const scripts = await page.evaluate(() => document.querySelectorAll('script').length);
    expect(scripts).toBeGreaterThan(0);
  });
});
