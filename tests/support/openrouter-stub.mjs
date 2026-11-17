// Only loaded by the isolated production browser-test server; never shipped in Docker.
if (
  process.env.TASKFLOW_TEST_PROVIDER !== 'true' ||
  process.env.OPENROUTER_API_KEY !== 'test-production-key'
)
  throw new Error('Isolated test provider configuration required.');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url) !== 'https://openrouter.ai/api/v1/chat/completions') return realFetch(url, options);
  const request = JSON.parse(options.body);
  const lastUser =
    [...request.messages].reverse().find((message) => message.role === 'user')?.content || '';
  const last = request.messages.at(-1);
  let delta;
  if (last.role === 'tool') delta = { content: '**Saved** in your guest workspace.' };
  else {
    const snapshot = JSON.parse(request.messages[1].content.split('\n').slice(1).join('\n'));
    const existing = snapshot.find(
      (task) => task.title === 'Production AI task' || task.title === 'Updated production AI task',
    );
    let name = 'create_task',
      args = { title: 'Production AI task' };
    if (lastUser.includes('edit')) {
      name = 'update_task';
      args = { id: existing.id, patch: { title: 'Updated production AI task', priority: 'high' } };
    } else if (lastUser.includes('move')) {
      name = 'move_task';
      args = { id: existing.id, status: 'inprogress' };
    } else if (lastUser.includes('delete')) {
      name = 'delete_task';
      args = { id: existing.id };
    }
    delta = {
      tool_calls: [
        { index: 0, id: `production-${name}`, function: { name, arguments: JSON.stringify(args) } },
      ],
    };
  }
  return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
};
