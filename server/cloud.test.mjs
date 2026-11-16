import { describe, expect, it, vi, beforeEach } from 'vitest';
const fake = vi.hoisted(() => ({ records: new Map(), verify: vi.fn(async () => ({ uid: 'alice' })) }));
vi.mock('firebase-admin/app', () => ({ getApps: () => [], initializeApp: () => ({}) }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: fake.verify }) }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => {
    const read = async (ref) => ({
      exists: fake.records.has(ref.uid),
      data: () => structuredClone(fake.records.get(ref.uid)),
    });
    return {
      collection: () => ({ doc: (uid) => ({ uid, get: () => read({ uid }) }) }),
      runTransaction: async (action) => {
        let pending;
        const result = await action({
          get: read,
          set: (ref, value) => {
            pending = [ref.uid, structuredClone(value)];
          },
        });
        if (pending) fake.records.set(...pending);
        return result;
      },
    };
  },
}));
import { createCloudServices } from './cloud.mjs';
beforeEach(() => {
  fake.records.clear();
  fake.verify.mockClear();
});
describe('cloud configuration fails closed', () => {
  it('does not create an anonymous or memory backend when configuration is missing', () => {
    expect(createCloudServices({})).toBeNull();
  });
  it('rejects production, real-project and partial emulator configuration', () => {
    for (const env of [
      {
        NODE_ENV: 'production',
        FIREBASE_PROJECT_ID: 'demo-taskflow',
        FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085',
      },
      {
        FIREBASE_PROJECT_ID: 'real-project',
        FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085',
      },
      { FIREBASE_PROJECT_ID: 'demo-taskflow', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
    ])
      expect(() => createCloudServices(env)).toThrow();
  });
});
const task = () => ({
  id: 'a',
  title: 'User task',
  description: '',
  status: 'todo',
  priority: 'medium',
  dueDate: null,
  tags: [],
  checklist: [],
  notes: [],
  order: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
describe('production cloud service with a mocked Firestore transaction boundary', () => {
  it('verifies tokens with revocation checking enabled', async () => {
    const cloud = createCloudServices({ FIREBASE_PROJECT_ID: 'test-taskflow' });
    await cloud.verify('token');
    expect(fake.verify).toHaveBeenCalledWith('token', true);
  });
  it('preserves saved chat on task writes and rejects stale task/chat saves', async () => {
    const cloud = createCloudServices({ FIREBASE_PROJECT_ID: 'test-taskflow' });
    await cloud.write('alice', [task()], 0);
    const chat = {
      feed: [{ who: 'user', text: 'Private chat' }],
      history: [{ role: 'user', content: 'Private chat' }],
    };
    await cloud.writeChat('alice', chat, 0, 0);
    await cloud.write('alice', [{ ...task(), title: 'Updated' }], 1);
    expect((await cloud.readChat('alice')).feed).toEqual(chat.feed);
    await expect(cloud.write('alice', [], 1)).rejects.toMatchObject({ status: 409 });
    await expect(cloud.writeChat('alice', chat, 0, 0)).rejects.toMatchObject({ status: 409 });
    expect((await cloud.read('alice')).tasks[0].title).toBe('Updated');
    expect((await cloud.read('bob')).tasks).toEqual([]);
  });
  it('clears tasks and chat together and rejects history from before deletion', async () => {
    const cloud = createCloudServices({ FIREBASE_PROJECT_ID: 'test-taskflow' });
    await cloud.write('alice', [task()], 0);
    await cloud.write('bob', [task()], 0);
    const chat = { feed: [], history: [] };
    await cloud.writeChat('alice', chat, 0, 0);
    await cloud.clear('alice', 1);
    expect(await cloud.read('alice')).toEqual({ tasks: [], revision: 2, epoch: 1 });
    expect(await cloud.readChat('alice')).toEqual({ feed: [], history: [], chatRevision: 0, epoch: 1 });
    await expect(cloud.writeChat('alice', chat, 0, 1)).rejects.toMatchObject({ status: 409 });
    expect((await cloud.read('bob')).tasks).toHaveLength(1);
  });
  it('rejects oversized storage without changing existing data', async () => {
    const cloud = createCloudServices({ FIREBASE_PROJECT_ID: 'test-taskflow' });
    await cloud.write('alice', [task()], 0);
    const large = Array.from({ length: 80 }, (_, index) => ({
      ...task(),
      id: `task-${index}`,
      description: 'x'.repeat(10000),
    }));
    await expect(cloud.write('alice', large, 1)).rejects.toMatchObject({ status: 413 });
    expect((await cloud.read('alice')).tasks).toHaveLength(1);
  });
});
