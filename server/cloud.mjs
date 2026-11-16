import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { tasksSchema, validateSize, chatSchema } from './schema.mjs';

export function createCloudServices(env = process.env) {
  const projectId = env.FIREBASE_PROJECT_ID;
  const emulated = Boolean(env.FIREBASE_AUTH_EMULATOR_HOST || env.FIRESTORE_EMULATOR_HOST);
  if (
    emulated &&
    (env.NODE_ENV === 'production' ||
      !projectId?.startsWith('demo-') ||
      !env.FIREBASE_AUTH_EMULATOR_HOST ||
      !env.FIRESTORE_EMULATOR_HOST)
  ) {
    throw new Error('Emulators require a demo- project, both emulator hosts, and non-production mode.');
  }
  if (
    emulated &&
    ![env.FIREBASE_AUTH_EMULATOR_HOST, env.FIRESTORE_EMULATOR_HOST].every((host) =>
      /^127\.0\.0\.1:\d+$/.test(host),
    )
  )
    throw new Error('Only localhost emulators are allowed.');
  if (!projectId) return null;
  const app = getApps()[0] || initializeApp({ projectId });
  const db = getFirestore(app);
  const auth = getAuth(app);
  const ref = (uid) => db.collection('taskflowUsers').doc(uid);
  return {
    verify: (token) => auth.verifyIdToken(token, true),
    read: async (uid) => {
      const doc = await ref(uid).get();
      return doc.exists
        ? { tasks: doc.data().tasks, revision: doc.data().revision, epoch: doc.data().epoch || 0 }
        : { tasks: [], revision: 0, epoch: 0 };
    },
    write: (uid, tasks, revision) =>
      db.runTransaction(async (transaction) => {
        tasksSchema.parse(tasks);
        validateSize(tasks);
        const doc = await transaction.get(ref(uid));
        const current = doc.exists ? doc.data().revision : 0;
        if (revision !== current)
          throw Object.assign(new Error('Tasks changed on another device. Refresh and try again.'), {
            status: 409,
          });
        const next = {
          ...(doc.data() || {}),
          tasks,
          revision: current + 1,
          epoch: doc.data()?.epoch || 0,
        };
        validateDocument(next);
        transaction.set(ref(uid), next);
        return { tasks: next.tasks, revision: next.revision, epoch: next.epoch };
      }),

    readChat: async (uid) => {
      const doc = await ref(uid).get();
      const data = doc.data() || {};
      return {
        feed: data.chat?.feed || [],
        history: data.chat?.history || [],
        chatRevision: data.chatRevision || 0,
        epoch: data.epoch || 0,
      };
    },
    writeChat: (uid, chat, epoch, chatRevision) =>
      db.runTransaction(async (transaction) => {
        chatSchema.parse(chat);
        const doc = await transaction.get(ref(uid));
        const data = doc.data() || {};
        if ((data.epoch || 0) !== epoch || (data.chatRevision || 0) !== chatRevision)
          throw Object.assign(
            new Error('Chat changed on another device. Reload to view saved history.'),
            { status: 409 },
          );
        const next = { tasks: [], revision: 0, ...data, chat, epoch, chatRevision: chatRevision + 1 };
        validateDocument(next);
        transaction.set(ref(uid), next);
        return { ...chat, epoch, chatRevision: next.chatRevision };
      }),
    clear: (uid, revision) =>
      db.runTransaction(async (transaction) => {
        const doc = await transaction.get(ref(uid));
        const data = doc.data() || {};
        if ((data.revision || 0) !== revision)
          throw Object.assign(new Error('Tasks changed on another device. Refresh and try again.'), {
            status: 409,
          });
        const next = { tasks: [], revision: revision + 1, epoch: (data.epoch || 0) + 1 };
        transaction.set(ref(uid), next);
        return next;
      }),
  };
}

function validateDocument(data) {
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > 900000)
    throw Object.assign(new Error('Account data is too large. Export and reduce tasks or chat.'), {
      status: 413,
    });
}
