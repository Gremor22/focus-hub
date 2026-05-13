import { expect, test } from '@playwright/test';
import { continueLocalMode, goDesktop, openFreshApp } from './helpers.js';

test.describe('Focus Hub WebKit smoke', () => {
  test('renders auth screen', async ({ page }) => {
    await openFreshApp(page);

    await expect(page.locator('#auth-screen')).toBeVisible();
    await expect(page.getByText('E-mail')).toBeVisible();
    await expect(page.getByText('Hasło')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zaloguj' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Załóż konto' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Wejdź lokalnie bez synchronizacji' })).toBeVisible();
  });

  test('continues in local mode', async ({ page }) => {
    await continueLocalMode(page);

    await expect(page.locator('#shell')).toBeVisible();
    await expect(page.locator('#auth-screen')).not.toBeVisible();
  });

  test('navigates core views', async ({ page }) => {
    await continueLocalMode(page);

    await goDesktop(page, 'Hub');
    await expect(page.locator('#page-hub')).toBeVisible();

    await goDesktop(page, 'Dziś');
    await expect(page.locator('#page-daily')).toBeVisible();

    await goDesktop(page, 'Dziennik');
    await expect(page.locator('#page-journal')).toBeVisible();

    await goDesktop(page, 'Konto');
    await expect(page.locator('#page-account')).toBeVisible();

    await goDesktop(page, 'Nadchodzące');
    await expect(page.locator('#page-upcoming')).toBeVisible();
  });
});
