export async function openFreshApp(page) {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/');
}

export async function continueLocalMode(page) {
  await openFreshApp(page);
  await page.getByRole('button', { name: 'Wejdź lokalnie bez synchronizacji' }).click();
}

export async function goDesktop(page, label) {
  await page.locator('#sidebar').getByRole('button', { name: label }).click();
}
