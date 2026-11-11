import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/'); await page.evaluate(() => localStorage.clear()); await page.reload(); });

test('board, list, search and create task work together', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'My tasks' })).toBeVisible();
  await expect(page.getByText('Ship dashboard improvements')).toBeVisible();
await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByLabel('Task title').fill('E2E smoke task');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByText('E2E smoke task')).toBeVisible();
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.getByRole('table').getByText('E2E smoke task')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search tasks' }).fill('E2E smoke');
  await expect(page.getByRole('row')).toHaveCount(2);
});

test('task edits persist after reload', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit Ship dashboard improvements' }).click();
  await page.getByLabel('Task title').fill('Updated dashboard');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.reload();
  await expect(page.getByText('Updated dashboard')).toBeVisible();
});
