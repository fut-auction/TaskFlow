import { test, expect, type Page } from '@playwright/test';
const localKey = 'taskflow:guest:v1';
const guestBackend = 'http://127.0.0.1:18188';
test.beforeEach(async ({ page, request }) => {
  // Reuse an existing Vite instance safely; force only its config read to the real no-Firebase test backend.
  await page.route('**/api/config', async (route) =>
    route.fulfill({ response: await request.get(guestBackend + '/api/config') }),
  );
});
async function create(page: Page, title = 'Guest work') {
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByLabel('Task title').fill(title);
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
}
test('real localhost:5173 opens without Firebase and preserves guest tasks on reload', async ({
  page,
  request,
}) => {
  const config = await (await request.get(guestBackend + '/api/config')).json();
  expect(config.firebase).toBeNull();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'No tasks yet' })).toBeVisible();
  await expect(page.getByText('do not sync across devices', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await create(page);
  await page.getByRole('button', { name: 'Edit Guest work' }).click();
  await page.getByLabel('Task title').fill('Edited guest work');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edited guest work', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByRole('navigation')).toBeHidden();
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overdue tasks: 0' })).toBeVisible();
  await page.getByRole('button', { name: 'All Tasks', exact: true }).click();
  await expect(page.getByRole('table')).toContainText('Edited guest work');
});
test('guest export/import and confirmed clear work without a backend task API and keep legacy data', async ({
  page,
}) => {
  await page.goto('/');
  await create(page);
  await page.evaluate(() => {
    localStorage.setItem('taskflow:tasks:v1', 'old user data');
    localStorage.setItem('unrelated', 'keep');
  });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export tasks' }).click();
  const backup = await downloaded;
  await page.getByLabel('Import tasks', { exact: true }).setInputFiles((await backup.path())!);
  await page.getByRole('button', { name: 'Save import' }).click();
  await expect(page.getByRole('status')).toContainText('saved in this browser');
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).tasks.length, localKey),
  ).toBe(2);
  await page.getByLabel('Import tasks', { exact: true }).setInputFiles((await backup.path())!);
  await page.getByLabel('Import mode').selectOption('replace');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Save import' }).click();
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).tasks.length, localKey),
  ).toBe(2);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Save import' }).click();
  await expect(page.getByRole('status')).toContainText('saved in this browser');
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).tasks.length, localKey),
  ).toBe(1);
  await page.getByRole('button', { name: 'Cloud sign-in (optional)' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await page.getByRole('button', { name: 'Clear All Data', exact: true }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(
    confirmation.getByRole('heading', { name: 'Clear All Data?', exact: true }),
  ).toBeVisible();
  await expect(
    confirmation.getByText(
      'Are you sure you want to delete all your tasks and chat history? This action cannot be undone.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(confirmation.getByRole('textbox')).toHaveCount(0);
  await expect(confirmation.getByRole('button')).toHaveCount(2);
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).tasks.length, localKey),
  ).toBe(1);
  await page.getByRole('button', { name: 'Clear All Data', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm Delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No tasks yet' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'No tasks yet' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('taskflow:tasks:v1'))).toBe('old user data');
  expect(await page.evaluate(() => localStorage.getItem('unrelated'))).toBe('keep');
});
test('guest Copilot uses local tasks, safe Markdown, and persistent local chat', async ({ page }) => {
  await page.route('**/api/guest/agent/step', async (route) => {
    const input = route.request().postDataJSON();
    expect(input.snapshot).toBeInstanceOf(Array);
    expect(route.request().headers().authorization).toBeUndefined();
    const delta = input.messages.some((m: { role: string }) => m.role === 'tool')
      ? { content: '**Saved locally** تم الحفظ\n\n- Guest task\n\n<script>alert(1)</script>' }
      : {
          tool_calls: [
            {
              index: 0,
              id: 'guest-call',
              function: { name: 'create_task', arguments: JSON.stringify({ title: 'AI guest task' }) },
            },
          ],
        };
    await route.fulfill({
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`,
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'AI Assistant', exact: true }).click();
  await page.getByLabel('Ask your copilot').fill('Create a task');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.markdown-message strong')).toHaveText('Saved locally');
  await expect(page.getByLabel('Ask your copilot')).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('button', { name: 'AI guest task', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'AI Assistant', exact: true }).click();
  await expect(page.locator('.markdown-message strong')).toHaveText('Saved locally');
  await expect(page.locator('.markdown-message script')).toHaveCount(0);
  const assistant = page.getByRole('button', { name: 'AI Assistant', exact: true });
  await assistant.click();
  await expect(assistant).toHaveAttribute('aria-expanded', 'false');
  await assistant.click();
  await expect(page.locator('.markdown-message strong')).toHaveText('Saved locally');
  await assistant.click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Clear All Data', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm Delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No tasks yet' })).toBeVisible();
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).chat.feed.length, localKey),
  ).toBe(0);
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).chat.history.length, localKey),
  ).toBe(0);
});
test('real guest AI endpoint needs an OpenRouter key, not Firebase; private cloud APIs remain protected', async ({
  request,
}) => {
  const result = await request.post(guestBackend + '/api/guest/agent/step', {
    data: { snapshot: [], messages: [{ role: 'user', content: 'Hello' }] },
  });
  expect(result.status()).toBe(503);
  expect((await result.json()).error).toContain('OPENROUTER_API_KEY');
  expect((await request.get(guestBackend + '/api/tasks')).status()).toBe(503);
});

test('guest task management works when the backend is unavailable', async ({ page }) => {
  await page.route('**/api/config', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'No tasks yet' })).toBeVisible();
  await create(page, 'Offline backend task');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Offline backend task', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/guest-local-review.png', fullPage: true });
});

test('guest workspaces stay independent across separate browser contexts', async ({ page, browser }) => {
  await page.goto('/');
  await create(page, 'Only in this browser');
  const other = await browser.newContext();
  await other.route('**/api/config', (route) =>
    route.fulfill({ json: { firebase: null, mode: 'guest' } }),
  );
  const phone = await other.newPage();
  await phone.goto('http://localhost:5173');
  await expect(phone.getByRole('heading', { name: 'No tasks yet' })).toBeVisible();
  await expect(phone.getByRole('button', { name: 'Only in this browser', exact: true })).toHaveCount(0);
  await other.close();
});
