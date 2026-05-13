import { expect, test } from '@playwright/test';
import { continueLocalMode, goDesktop, openFreshApp } from './helpers.js';

test.describe('Focus Hub desktop smoke', () => {
  test('renders auth screen', async ({ page }) => {
    await openFreshApp(page);

    await expect(page.locator('#auth-screen')).toBeVisible();
    await expect(page.getByText('E-mail')).toBeVisible();
    await expect(page.getByText('Hasło')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zaloguj' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Załóż konto' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Wejdź lokalnie bez synchronizacji' })).toBeVisible();
  });

  test('continues in local mode and navigates core views', async ({ page }) => {
    await continueLocalMode(page);

    await expect(page.locator('#shell')).toBeVisible();
    await expect(page.locator('#auth-screen')).not.toBeVisible();

    await goDesktop(page, 'Dziś');
    await expect(page.locator('#page-daily')).toBeVisible();

    await goDesktop(page, 'Hub');
    await expect(page.locator('#page-hub')).toBeVisible();

    await goDesktop(page, 'Dziennik');
    await expect(page.locator('#page-journal')).toBeVisible();

    await goDesktop(page, 'Konto');
    await expect(page.locator('#page-account')).toBeVisible();

    await goDesktop(page, 'Nadchodzące');
    await expect(page.locator('#page-upcoming')).toBeVisible();
  });

  test('adds a daily task', async ({ page }) => {
    await continueLocalMode(page);
    await goDesktop(page, 'Dziś');

    const taskText = `E2E zadanie ${Date.now()}`;
    await page.locator('#daily-task-text').fill(taskText);
    await page.locator('#page-daily [data-action="addDailyTask"]').click();

    await expect(page.locator('.daily-task-text', { hasText: taskText })).toBeVisible();
  });

  test('saves a journal entry', async ({ page }) => {
    await continueLocalMode(page);
    await goDesktop(page, 'Dziennik');

    const entryText = `E2E wpis ${Date.now()}`;
    await page.locator('#jr-win').fill(entryText);
    await page.locator('#page-journal [data-action="saveJournalEntry"]').first().click();

    await expect(page.getByText('Wpis zapisany.')).toBeVisible();
    await expect(page.getByText(entryText)).toBeVisible();
  });

  test('opens and closes the new project modal', async ({ page }) => {
    await continueLocalMode(page);

    await page.locator('#tb-add-btn').click();
    await expect(page.locator('#modal-proj')).toBeVisible();
    await expect(page.locator('#modal-proj')).toHaveAttribute('aria-hidden', 'false');

    await page.locator('#modal-proj [data-action="closeModal"]').click();
    await expect(page.locator('#modal-proj')).not.toBeVisible();
    await expect(page.locator('#shell')).toBeVisible();
  });
});
