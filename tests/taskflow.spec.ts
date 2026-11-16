import { test, expect, type BrowserContext, type Page } from '@playwright/test';
const base = 'http://127.0.0.1:4173';
function token(uid: string) {
  return `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: uid, user_id: uid, aud: 'demo-taskflow', iss: 'https://securetoken.google.com/demo-taskflow', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, email: `${uid}@example.test`, firebase: { sign_in_provider: 'password' } })).toString('base64url')}.test`;
}
async function login(context: BrowserContext, uid = 'alice') {
  await context.route('https://identitytoolkit.googleapis.com/**', async (route) => {
    const isLookup = route.request().url().includes('lookup');
    await route.fulfill({
      json: isLookup
        ? {
            users: [
              {
                localId: uid,
                email: `${uid}@example.test`,
                emailVerified: true,
                providerUserInfo: [{ providerId: 'password', email: `${uid}@example.test` }],
              },
            ],
          }
        : {
            localId: uid,
            email: `${uid}@example.test`,
            idToken: token(uid),
            refreshToken: 'test-refresh',
            expiresIn: '3600',
          },
    });
  });
  const page = await context.newPage();
  await page.goto(base);
  if ((page.viewportSize()?.width || 1280) <= 870)
    await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Cloud sign-in (optional)' }).click();
  await page.getByLabel('Email', { exact: true }).fill(`${uid}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No tasks yet' })).toBeVisible();
  return page;
}
async function create(page: Page, title = 'Real user task') {
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByLabel('Task title').fill(title);
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
}
test.beforeEach(async ({ request }) => {
  await request.post(`${base}/__test/reset`);
});
test('empty account, create, edit, list, refresh, navigation and sidebar', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await login(context);
  await expect(page.getByRole('navigation').locator('.nav-link')).toHaveText([
    'Dashboard',
    'Board',
    'All Tasks',
    'Settings',
  ]);
  const assistant = page.getByRole('button', { name: 'AI Assistant', exact: true });
  await expect(assistant).toHaveAttribute('aria-expanded', 'false');
  await assistant.click();
  await expect(assistant).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.copilot-panel')).toHaveClass(/is-open/);
  await assistant.click();
  await expect(assistant).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.copilot-panel')).not.toHaveClass(/is-open/);
  await create(page);
  await page.getByRole('button', { name: 'Edit Real user task', exact: true }).click();
  await page.getByLabel('Task title').fill('Updated real task');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Updated real task', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Updated real task', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByRole('navigation')).toBeHidden();
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overdue tasks: 0' })).toBeVisible();
  await page.getByRole('button', { name: 'All Tasks', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search tasks' }).fill('Updated real');
  await expect(page.getByRole('row')).toHaveCount(2);
  await context.close();
});
test('export, invalid import, merge, replacement confirmation, clear all and no restoration', async ({
  browser,
}) => {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await login(context);
  await create(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export tasks' }).click();
  const saved = await download;
  const path = await saved.path();
  expect(path).toBeTruthy();
  await page.getByLabel('Import tasks', { exact: true }).setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"version":9}'),
  });
  await expect(page.getByRole('status')).toContainText('Invalid backup');
  await page.getByLabel('Import tasks', { exact: true }).setInputFiles(path!);
  await page.getByRole('button', { name: 'Save import' }).click();
  await expect(page.getByRole('status')).toContainText('saved to your account');
  await page.getByLabel('Import tasks', { exact: true }).setInputFiles(path!);
  await page.getByLabel('Import mode').selectOption('replace');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Save import' }).click();
  await expect(page.getByRole('heading', { name: 'Review import: 1 tasks' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Save import' }).click();
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
  await page.getByRole('button', { name: 'Clear All Data', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm Delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No tasks yet' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'No tasks yet' })).toBeVisible();
  await context.close();
});
test('same account in two contexts synchronizes; other account stays private', async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const c = await browser.newContext();
  const first = await login(a);
  const second = await login(b);
  const other = await login(c, 'bob');
  await create(first, 'Private Alice task');
  await expect(second.getByRole('button', { name: 'Private Alice task', exact: true })).toBeVisible({
    timeout: 12000,
  });
  await other.reload();
  await expect(other.getByRole('heading', { name: 'No tasks yet' })).toBeVisible();
  await expect(other.getByText('Private Alice task')).toHaveCount(0);
  await create(other, 'Private Bob task');
  await first.getByRole('button', { name: 'Settings', exact: true }).click();
  await first.getByRole('button', { name: 'Clear All Data', exact: true }).click();
  await first.getByRole('button', { name: 'Confirm Delete', exact: true }).click();
  await expect(first.getByRole('heading', { name: 'No tasks yet' })).toBeVisible();
  await other.reload();
  await expect(other.getByRole('button', { name: 'Private Bob task', exact: true })).toBeVisible();

  await a.close();
  await b.close();
  await c.close();
});
test('Copilot persists task actions and safely renders English/Arabic Markdown', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await login(context);
  await page.getByRole('button', { name: 'AI Assistant', exact: true }).click();
  await page.getByLabel('Ask your copilot').fill('Create a task');
  await page.getByRole('button', { name: 'Send message' }).click();
  const markdown = page.locator('.markdown-message');
  await expect(markdown.locator('strong')).toHaveText('Saved');
  await expect(markdown.getByRole('heading', { name: 'Summary' })).toBeVisible();
  await expect(markdown.locator('table')).toBeVisible();
  await expect(markdown.locator('pre code')).toContainText('const ok');
  await expect(markdown.locator('script')).toHaveCount(0);
  expect(await markdown.getByRole('link', { name: 'unsafe' }).getAttribute('href')).not.toContain(
    'javascript:',
  );
  await expect(page.getByLabel('Ask your copilot')).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Copilot test task', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'AI Assistant', exact: true }).click();
  await expect(page.locator('.markdown-message strong')).toHaveText('Saved');
  await context.close();
});
test('mobile navigation and data controls fit the screen', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await login(context);
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export tasks' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'AI Assistant', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open AI copilot', exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-review.png', fullPage: true });
  await context.close();
});

test('failed save does not report success or discard the draft', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await login(context);
  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() === 'PUT')
      await route.fulfill({ status: 503, json: { error: 'Storage unavailable for test' } });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByLabel('Task title').fill('Unsaved draft');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Task title')).toHaveValue('Unsaved draft');
  await expect(page.locator('.modal-error')).toContainText('Storage unavailable');
  await context.close();
});
test('dragging tasks persists status and ordering', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await login(context);
  await create(page, 'Task one');
  await create(page, 'Task two');
  await page
    .getByRole('article', { name: 'Task: Task one', exact: true })
    .dragTo(page.locator('.kanban-column.inprogress'));
  await expect(page.locator('.kanban-column.inprogress')).toContainText('Task one');
  await page
    .getByRole('article', { name: 'Task: Task two', exact: true })
    .dragTo(page.getByRole('article', { name: 'Task: Task one', exact: true }));
  await expect(page.locator('.kanban-column.inprogress .card-title')).toHaveText([
    'Task two',
    'Task one',
  ]);
  await page.reload();
  await expect(page.locator('.kanban-column.inprogress .card-title')).toHaveText([
    'Task two',
    'Task one',
  ]);
  await page.screenshot({ path: 'test-results/desktop-review.png', fullPage: true });
  await context.close();
});

test('failed deletion shows an error in the confirmation dialog and keeps saved data', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await login(context);
  await create(page, 'Keep after failed deletion');
  let deletes = 0;
  await page.route('**/api/data', async (route) => {
    deletes++;
    await route.fulfill({ status: 503, json: { error: 'Storage unavailable for deletion' } });
  });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Clear All Data', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(deletes).toBe(0);
  await page.getByRole('button', { name: 'Clear All Data', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm Delete', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText(
    'Could not delete your data. Storage unavailable for deletion',
  );
  await expect(dialog.getByRole('button', { name: 'Confirm Delete', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(deletes).toBe(1);
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Keep after failed deletion', exact: true }),
  ).toBeVisible();
  await context.close();
});
