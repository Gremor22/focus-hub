import { expect, test } from '@playwright/test';
import { continueLocalMode } from './helpers.js';

test.describe('Focus Hub mobile smoke', () => {
  test('bottom navigation switches views with a single tap', async ({ page }) => {
    await continueLocalMode(page);

    await page.getByRole('button', { name: 'Otwórz Dziennik' }).click();
    await expect(page.locator('#page-journal')).toBeVisible();

    await page.getByRole('button', { name: 'Otwórz Hub' }).click();
    await expect(page.locator('#page-hub')).toBeVisible();

    await page.getByRole('button', { name: 'Otwórz Plan' }).click();
    await expect(page.locator('#page-upcoming')).toBeVisible();

    await page.getByRole('button', { name: 'Otwórz Dziś' }).click();
    await expect(page.locator('#page-daily')).toBeVisible();
  });
});
