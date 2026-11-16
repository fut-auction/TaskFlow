import { GUEST_ID } from './session';
import { readLocalTasks, writeLocalTasks } from './local-store';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Task } from './domain/tasks';
import { authHeaders } from './auth-client';
export type Snapshot = { tasks: Task[]; revision: number; epoch?: number };
export async function dataRequest(
  method = 'GET',
  body?: unknown,
  path = '/api/tasks',
  expectedUid?: string,
): Promise<Snapshot> {
  if (expectedUid === GUEST_ID) {
    if (method === 'GET') return readLocalTasks();
    const input = body as { tasks?: Task[]; revision: number };
    return writeLocalTasks(input.tasks || [], input.revision, method === 'DELETE');
  }
  const response = await fetch(path, {
    method,
    headers: { ...(await authHeaders(expectedUid)), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not save tasks. Please retry.');
  return data;
}
export function useTaskStore(userId: string) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [epoch, setEpoch] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const snapshot = useRef<Snapshot>({ tasks: [], revision: 0 });
  const busy = useRef(false);
  const apply = useCallback((next: Snapshot) => {
    snapshot.current = next;
    setTasks(next.tasks);
    setEpoch(next.epoch || 0);
  }, []);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      apply(await dataRequest('GET', undefined, '/api/tasks', userId));
      setLoaded(true);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load cloud data.');
    } finally {
      busy.current = false;
    }
  }, [apply, userId]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    window.addEventListener('storage', focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', focus);
      window.removeEventListener('storage', focus);
    };
  }, [refresh]);
  const commitTasks = async (updated: Task[], clear = false) => {
    if (busy.current || !loaded) {
      setError('Sync is busy. Please try again.');
      throw new Error('Sync is busy. Please try again.');
    }
    busy.current = true;
    setPending(true);
    setError('');
    try {
      apply(
        await dataRequest(
          clear ? 'DELETE' : 'PUT',
          clear
            ? { revision: snapshot.current.revision, confirmation: 'DELETE' }
            : { tasks: updated, revision: snapshot.current.revision },
          clear ? '/api/data' : '/api/tasks',
          userId,
        ),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Save failed.';
      setError(message);
      // Reconcile a conflict or an uncertain network response; never replay a stale write.
      try {
        apply(await dataRequest('GET', undefined, '/api/tasks', userId));
      } catch {
        /* Retain the last confirmed snapshot. */
      }
      throw new Error(message);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return {
    tasks,
    epoch,
    loaded,
    pending,
    error,
    refresh,
    commitTasks,
    getTasks: () => snapshot.current.tasks,
  };
}
