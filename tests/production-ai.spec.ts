import { test, expect } from '@playwright/test';
test('production guest AI creates, edits, moves and confirms deletion without Firebase or login', async ({
  page,
  request,
}) => {
  expect((await (await request.get('/api/config')).json()).firebase).toBeNull();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'No tasks yet' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'AI Assistant', exact: true }).click();
  const send = async (question: string) => {
    await page.getByLabel('Ask your copilot').fill(question);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
  };
  const tasks = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('taskflow:guest:v1') || '{"tasks":[]}').tasks);
  await send('create a task');
  await expect.poll(async () => (await tasks())[0]?.title).toBe('Production AI task');
  await expect(page.getByLabel('Ask your copilot')).toBeEnabled();
  await send('edit the task');
  await expect.poll(async () => (await tasks())[0]?.title).toBe('Updated production AI task');
  await expect(page.getByLabel('Ask your copilot')).toBeEnabled();
  await send('move the task');
  await expect.poll(async () => (await tasks())[0]?.status).toBe('inprogress');
  await expect(page.getByLabel('Ask your copilot')).toBeEnabled();
  await send('delete the task');
  const approval = page.getByRole('alertdialog', { name: 'Confirm AI action' });
  await expect(approval).toBeVisible();
  expect(await tasks()).toHaveLength(1);
  await approval.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Ask your copilot')).toBeEnabled();
  expect(await tasks()).toHaveLength(1);
  await send('delete the task');
  await expect(approval).toBeVisible();
  await approval.getByRole('button', { name: 'Confirm action', exact: true }).click();
  await expect.poll(async () => (await tasks()).length).toBe(0);
  await expect(page.getByLabel('Ask your copilot')).toBeEnabled();
  await expect(page.locator('.markdown-message strong').last()).toHaveText('Saved');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'No tasks yet' })).toBeVisible();
});
