// Isolated test double. Production always uses server/cloud.mjs.
export function createMemoryStore(records = new Map()) {
  const read = async (uid) => structuredClone(records.get(uid) || { tasks: [], revision: 0, epoch: 0 });
  return {
    read,
    write: async (uid, tasks, revision) => {
      const current = await read(uid);
      if (revision !== current.revision)
        throw Object.assign(new Error('Tasks changed on another device. Refresh and try again.'), {
          status: 409,
        });
      const next = { ...current, tasks, revision: revision + 1 };
      records.set(uid, structuredClone(next));
      return { tasks, revision: next.revision, epoch: next.epoch };
    },
    readChat: async (uid) => {
      const current = await read(uid);
      return {
        feed: current.chat?.feed || [],
        history: current.chat?.history || [],
        epoch: current.epoch,
        chatRevision: current.chatRevision || 0,
      };
    },
    writeChat: async (uid, chat, epoch, chatRevision) => {
      const current = await read(uid);
      if (current.epoch !== epoch || (current.chatRevision || 0) !== chatRevision)
        throw Object.assign(new Error('Chat conflict'), { status: 409 });
      records.set(uid, { ...current, chat: structuredClone(chat), chatRevision: chatRevision + 1 });
      return { ...chat, epoch, chatRevision: chatRevision + 1 };
    },
    clear: async (uid, revision) => {
      const current = await read(uid);
      if (current.revision !== revision) throw Object.assign(new Error('Conflict'), { status: 409 });
      const next = { tasks: [], revision: revision + 1, epoch: current.epoch + 1 };
      records.set(uid, next);
      return next;
    },
  };
}
