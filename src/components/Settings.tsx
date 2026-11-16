import { GUEST_ID } from '../session';
import { useState } from 'react';
import { backupSchema, tasksSchema } from '../../server/schema.mjs';
import { STORAGE_KEY, type Task } from '../domain/tasks';
import { logout } from '../auth-client';
export default function Settings({
  tasks,
  save,
  clear,
  email,
  onCleared,
  userId,
  disabled,
  onSignIn,
}: {
  tasks: Task[];
  save: (tasks: Task[]) => Promise<void>;
  clear: () => Promise<void>;
  email: string;
  userId: string;
  disabled: boolean;
  onSignIn: () => void;
  onCleared: () => void;
}) {
  const guest = userId === GUEST_ID;
  const target = guest ? 'this browser’s guest workspace' : 'your signed-in account';
  const [incoming, setIncoming] = useState<Task[] | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [mode, setMode] = useState('merge');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [clearError, setClearError] = useState('');
  function exportTasks() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { format: 'taskflow', version: 1, exportedAt: new Date().toISOString(), tasks },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `taskflow-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function readFile(file?: File) {
    setIncoming(null);
    setLegacy(false);
    setMessage('');
    if (!file) return;
    try {
      if (file.size > 900000) throw new Error('File must be smaller than 900 KB.');
      setIncoming(backupSchema.parse(JSON.parse(await file.text())).tasks);
    } catch {
      setMessage(
        'Invalid backup. Use a TaskFlow version 1 JSON export with valid tasks and unique IDs (maximum 250 tasks).',
      );
    }
  }
  function migrate() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) throw new Error('No saved browser tasks found.');
      setLegacy(true);
      setIncoming(tasksSchema.parse(JSON.parse(raw)));
      setMode('merge');
      setMessage(
        'Review these browser tasks before importing. They may include old sample tasks. The original browser data will be kept.',
      );
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : 'Invalid legacy data. Export it manually before changing anything.',
      );
    }
  }
  async function applyImport() {
    if (!incoming) return;
    if (
      mode === 'replace' &&
      !window.confirm(`Replace all tasks in ${target} with this file? Export a backup first.`)
    )
      return;
    setBusy(true);
    try {
      const ids = new Set(tasks.map((t) => t.id));
      const merged =
        mode === 'replace'
          ? incoming
          : [
              ...tasks,
              ...incoming.map((task) => ({
                ...task,
                id: ids.has(task.id) ? crypto.randomUUID() : task.id,
              })),
            ];
      await save(tasksSchema.parse(merged));
      if (legacy) {
        try {
          localStorage.setItem('taskflow:legacy-owner', userId);
        } catch {
          /* Preserve the unclaimed browser copy if storage is unavailable. */
        }
      }
      setIncoming(null);
      setMessage(
        guest
          ? 'Tasks imported and saved in this browser.'
          : 'Tasks imported and saved to your account.',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }
  async function clearData() {
    if (busy || disabled) return;
    setClearError('');
    setBusy(true);
    try {
      await clear();
      // Only this app's legacy browser keys are removed, after cloud success.
      try {
        if (localStorage.getItem('taskflow:legacy-owner') === userId) {
          for (const key of [
            STORAGE_KEY,
            'taskflow:chat:v1',
            'taskflow:feed:v1',
            'taskflow:legacy-owner',
          ])
            localStorage.removeItem(key);
        }
      } catch {
        /* The confirmed cloud deletion is complete; leave inaccessible local storage untouched. */
      }
      onCleared();
      setConfirming(false);
      setMessage(
        guest
          ? 'Guest tasks and chat were deleted from this browser.'
          : 'Your tasks and saved chat were deleted. Your account remains active.',
      );
    } catch (e) {
      setClearError(
        `Could not delete your data. ${e instanceof Error ? e.message : 'Please try again.'}`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-card">
      <h2>Account and data</h2>
      {guest ? (
        <>
          <p>
            Guest mode. Tasks and chat stay in this browser only. They do not sync across devices. Export
            a backup before clearing browser data.
          </p>
          <button className="secondary-button" onClick={onSignIn}>
            Cloud sign-in (optional)
          </button>
        </>
      ) : (
        <>
          <p>
            Signed in as <b>{email}</b>
          </p>
          <button className="secondary-button" onClick={() => void logout()}>
            Sign out
          </button>
        </>
      )}
      <h3>Your task backups</h3>
      <p>
        Backups include all task fields, but no credentials. Keep a backup before replacing or deleting
        tasks.
      </p>
      <div className="settings-actions">
        <button className="secondary-button" disabled={busy || disabled} onClick={exportTasks}>
          Export tasks
        </button>
        <label className="secondary-button">
          Import tasks
          <input
            aria-label="Import tasks"
            type="file"
            accept="application/json,.json"
            disabled={busy || disabled}
            onChange={(e) => {
              void readFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <button className="secondary-button" disabled={busy || disabled} onClick={migrate}>
          Review browser migration
        </button>
      </div>
      {incoming && (
        <div className="import-review">
          <h3>Review import: {incoming.length} tasks</h3>
          <ul>
            {incoming.map((t) => (
              <li key={t.id}>{t.title}</li>
            ))}
          </ul>
          <label>
            Import mode
            <select aria-label="Import mode" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="merge">Merge (keep existing tasks; copy matching IDs as new tasks)</option>
              <option value="replace">Replace my tasks</option>
            </select>
          </label>
          <button
            className="primary-button"
            disabled={busy || disabled}
            onClick={() => void applyImport()}
          >
            Save import
          </button>
          <button
            className="secondary-button"
            disabled={busy || disabled}
            onClick={() => setIncoming(null)}
          >
            Cancel import
          </button>
        </div>
      )}
      <h3>Clear All Data</h3>
      <p>
        {guest
          ? 'Deletes only this browser’s guest tasks and saved Copilot chat. Cloud accounts and unclaimed legacy browser data are kept.'
          : 'Deletes all tasks and saved Copilot chat in your signed-in account on every device. Your account is kept. Other open tabs reset their chat on the next sync. Claimed legacy browser copies are also cleared; unclaimed copies are kept.'}
      </p>
      <button
        className="danger-primary"
        disabled={busy || disabled}
        onClick={() => {
          setClearError('');
          setConfirming(true);
        }}
      >
        Clear All Data
      </button>
      {confirming && (
        <div className="modal-backdrop topmost">
          <section
            className="modal delete-modal"
            role="alertdialog"
            aria-label="Clear all data confirmation"
          >
            <h2>Clear All Data?</h2>
            <p>
              Are you sure you want to delete all your tasks and chat history? This action cannot be
              undone.
            </p>
            {clearError && <p role="alert">{clearError}</p>}
            <div className="approval-actions">
              <button
                className="secondary-button"
                disabled={busy || disabled}
                onClick={() => {
                  setConfirming(false);
                  setClearError('');
                }}
              >
                Cancel
              </button>
              <button
                className="danger-primary"
                disabled={busy || disabled}
                onClick={() => void clearData()}
              >
                Confirm Delete
              </button>
            </div>
          </section>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
