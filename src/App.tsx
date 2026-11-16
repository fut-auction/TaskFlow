import { useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownAZ,
  CalendarDays,
  CheckCheck,
  ChevronDown,
  Circle,
  CircleCheck,
  Clock3,
  Command,
  Columns3,
  Filter,
  GripVertical,
  LayoutDashboard,
  List,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Tags,
  Trash2,
  X,
} from 'lucide-react';
import {
  checklistProgress,
  isOverdue,
  makeTask,
  moveTask,
  sortTasks,
  STATUS_LABEL,
  STATUSES,
  type Priority,
  type Status,
  type Task,
} from './domain/tasks';
import TaskModal from './components/TaskModal';
import Copilot from './components/Copilot';
import AuthGate from './auth';
import { logout } from './auth-client';
import Settings from './components/Settings';
import { useTaskStore } from './store';
import { GUEST_ID } from './session';

const priorityLabel: Record<Priority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};
const statusIcon: Record<Status, typeof Circle> = {
  todo: Circle,
  inprogress: Activity,
  done: CircleCheck,
};
const formatDue = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
function TaskCard({
  task,
  onOpen,
  onDropTask,
  onStartDrag,
}: {
  task: Task;
  onOpen: () => void;
  onDropTask: (task: Task) => void;
  onStartDrag: () => void;
}) {
  return (
    <article
      className="task-card"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.effectAllowed = 'move';
        onStartDrag();
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDropTask(task);
      }}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
      aria-label={`Task: ${task.title}`}
    >
      <div className="card-top">
        <span className={`priority-chip ${task.priority}`}>
          <span className="priority-dot" />
          {priorityLabel[task.priority]}
        </span>
        <button className="icon-button mini" aria-label={`Edit ${task.title}`} onClick={onOpen}>
          <MoreHorizontal size={19} />
        </button>
      </div>
      <button className="card-title" onClick={onOpen}>
        {task.title}
      </button>
      {task.description && <p className="card-desc">{task.description}</p>}
      {task.tags.length > 0 && (
        <div className="tag-list">
          {task.tags.slice(0, 3).map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="card-bottom">
        <div className={`due ${isOverdue(task) ? 'overdue' : ''}`}>
          <CalendarDays size={14} />
          {task.dueDate ? formatDue(task.dueDate) : 'No due date'}
        </div>
        {checklistProgress(task) && (
          <div className="card-checks">
            <CheckCheck size={14} />
            {checklistProgress(task)}
          </div>
        )}
        <GripVertical className="drag-handle" size={17} />
      </div>
    </article>
  );
}
export default function App() {
  return (
    <AuthGate>
      {(user, onSignIn) => (
        <Workspace key={user.uid} email={user.email || 'Guest'} userId={user.uid} onSignIn={onSignIn} />
      )}
    </AuthGate>
  );
}
function Workspace({
  email,
  userId,
  onSignIn,
}: {
  email: string;
  userId: string;
  onSignIn: () => void;
}) {
  const { tasks, epoch, loaded, pending, error, refresh, commitTasks, getTasks } = useTaskStore(userId);
  const guest = userId === GUEST_ID;
  const [collapsed, setCollapsed] = useState(false);
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [chatVersion, setChatVersion] = useState(0);
  const [activeNav, setActiveNav] = useState('board');
  const view = activeNav === 'all' ? 'list' : 'board';
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'board' | 'due' | 'priority' | 'newest'>('board');
  const [editId, setEditId] = useState<string | null>(null);
  const [newStatus, setNewStatus] = useState<Status>('todo');
  const [showModal, setShowModal] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Task | null>(null);
  const dragId = useRef<string | null>(null);
  const edited = tasks.find((t) => t.id === editId) || null;
  const filtered = useMemo(
    () =>
      sortTasks(
        tasks.filter((t) => {
          const matchesSearch = `${t.title} ${t.description} ${t.tags.join(' ')} ${t.notes.join(' ')}`
            .toLowerCase()
            .includes(query.toLowerCase());
          return (
            matchesSearch &&
            (statusFilter === 'all' || t.status === statusFilter) &&
            (priorityFilter === 'all' || t.priority === priorityFilter)
          );
        }),
        sortBy,
      ),
    [tasks, query, statusFilter, priorityFilter, sortBy],
  );
  const todo = tasks.filter((t) => t.status === 'todo').length;
  const doing = tasks.filter((t) => t.status === 'inprogress').length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const overdue = tasks.filter((t) => isOverdue(t)).length;
  function openCreate(status: Status = 'todo') {
    setEditId(null);
    setNewStatus(status);
    setShowModal(true);
  }
  function openEdit(task: Task) {
    setEditId(task.id);
    setShowModal(true);
  }
  async function saveTask(
    draft: Pick<
      Task,
      'title' | 'description' | 'status' | 'priority' | 'dueDate' | 'tags' | 'checklist' | 'notes'
    >,
  ) {
    const before = getTasks();
    if (editId && before.some((t) => t.id === editId)) {
      const previous = before.find((t) => t.id === editId)!;
      const updated = before.map((t) =>
        t.id === editId ? { ...t, ...draft, updatedAt: new Date().toISOString() } : t,
      );
      await commitTasks(
        previous.status !== draft.status ? moveTask(updated, editId, draft.status) : updated,
      );
    } else await commitTasks([...before, makeTask(draft, before)]);
    setShowModal(false);
  }
  function dropTask(status: Status, beforeId?: string) {
    if (!dragId.current || dragId.current === beforeId) return;
    void commitTasks(moveTask(getTasks(), dragId.current, status, beforeId)).catch(() => {});
    dragId.current = null;
  }
  async function confirmDelete() {
    if (!deleteConfirm) return;
    await commitTasks(getTasks().filter((t) => t.id !== deleteConfirm.id));
    setDeleteConfirm(null);
    setShowModal(false);
  }
  if (!loaded)
    return (
      <main className="auth-screen">
        <section className="settings-card">
          <h1>Your tasks</h1>
          <p role="status">
            {error || (guest ? 'Loading local tasks…' : 'Loading your private cloud tasks…')}
          </p>
          <button className="primary-button" onClick={() => void refresh()}>
            Retry
          </button>
          <button className="secondary-button" onClick={() => void logout()}>
            Sign out
          </button>
        </section>
      </main>
    );
  return (
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`} aria-busy={pending}>
      <nav className={`side-nav ${mobileNavOpen ? 'mobile-open' : ''}`} aria-label="Main navigation">
        <div className="brand">
          <div className="brand-mark">
            <span>✳</span>
          </div>
          <div>
            <strong>
              Task<span>Flow</span>
            </strong>
            <small>TASK MANAGEMENT</small>
          </div>
          <button
            className="icon-button nav-close"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation"
          >
            <X size={19} />
          </button>
        </div>
        <div className="nav-section-caption">WORKSPACE</div>
        {[
          ['overview', 'Dashboard', LayoutDashboard],
          ['board', 'Board', Columns3],
          ['all', 'All Tasks', List],
          ['settings', 'Settings', SlidersHorizontal],
        ].map(([id, label, Icon]) => {
          const NavIcon = Icon as typeof LayoutDashboard;
          return (
            <button
              key={String(id)}
              className={activeNav === id ? 'nav-link active' : 'nav-link'}
              onClick={() => {
                setActiveNav(String(id));
                setQuery('');
                setStatusFilter('all');
                setPriorityFilter('all');
                setMobileNavOpen(false);
              }}
            >
              <NavIcon size={19} />
              {String(label)}
            </button>
          );
        })}
        <div className="nav-spacer" />
        <div className="sidebar-footer">
          <div className="footer-icon">
            <Command size={18} />
          </div>
          <div>
            <strong>TaskFlow Workspace</strong>
            <small>{guest ? 'Local guest workspace' : 'Private cloud storage'}</small>
          </div>
        </div>
      </nav>
      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button sidebar-toggle"
              aria-label={
                window.matchMedia('(max-width: 870px)').matches
                  ? mobileNavOpen
                    ? 'Close sidebar'
                    : 'Open sidebar'
                  : collapsed
                    ? 'Expand sidebar'
                    : 'Collapse sidebar'
              }
              aria-expanded={
                window.matchMedia('(max-width: 870px)').matches ? mobileNavOpen : !collapsed
              }
              onClick={() => {
                if (window.matchMedia('(max-width: 870px)').matches) setMobileNavOpen((v) => !v);
                else setCollapsed((v) => !v);
              }}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <span className="breadcrumb">/</span>
            <strong>
              {
                {
                  overview: 'Dashboard',
                  board: 'Board',
                  all: 'All Tasks',
                  settings: 'Settings',
                }[activeNav]
              }
            </strong>
          </div>
          <div className="topbar-right">
            <span className="today-date">
              <Sun size={17} />
              {new Date().toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })}
            </span>
            <button
              className="ai-header-button"
              aria-expanded={copilotOpen}
              onClick={() => setCopilotOpen((v) => !v)}
            >
              <Sparkles size={17} /> AI Assistant
            </button>
          </div>
        </header>
        <div className="workspace-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow page-eyebrow">TASK MANAGEMENT</div>
              <h1>
                {
                  {
                    overview: 'Dashboard',
                    board: 'Board',
                    all: 'All Tasks',
                    settings: 'Settings',
                  }[activeNav]
                }
              </h1>
              <p>Track work, update priorities, and manage your tasks in one place.</p>
            </div>
            <button className="primary-button create-main" onClick={() => openCreate()}>
              <Plus size={19} /> New task
            </button>
          </div>
          {error && (
            <div role="alert" className="sync-error">
              {error}
              <button onClick={() => void refresh()}>Refresh tasks</button>
            </div>
          )}
          {pending && (
            <p role="status">{guest ? 'Saving in this browser…' : 'Saving to your account…'}</p>
          )}
          {guest && (
            <p className="guest-notice">
              Guest mode · Tasks are saved only in this browser and do not sync across devices.
            </p>
          )}
          {activeNav === 'settings' && (
            <Settings
              onSignIn={onSignIn}
              disabled={pending || copilotBusy}
              userId={userId}
              email={email}
              tasks={tasks}
              save={commitTasks}
              clear={() => commitTasks([], true)}
              onCleared={() => {
                setChatVersion((v) => v + 1);
                setActiveNav('board');
              }}
            />
          )}
          {activeNav === 'overview' && (
            <section className="stats-grid" aria-label="Task statistics">
              <div className="stat-card">
                <div className="stat-heading">
                  <span>Total tasks</span>
                  <div className="stat-icon blue">
                    <LayoutDashboard size={19} />
                  </div>
                </div>
                <strong>{tasks.length}</strong>
                <small>Across your workspace</small>
              </div>
              <div className="stat-card">
                <div className="stat-heading">
                  <span>To do</span>
                  <div className="stat-icon purple">
                    <Circle size={19} />
                  </div>
                </div>
                <strong>{todo}</strong>
                <small>Ready to get started</small>
              </div>
              <div className="stat-card">
                <div className="stat-heading">
                  <span>In progress</span>
                  <div className="stat-icon orange">
                    <Clock3 size={19} />
                  </div>
                </div>
                <strong>{doing}</strong>
                <small>Moving forward</small>
              </div>
              <div className="stat-card">
                <div className="stat-heading">
                  <span>Completed</span>
                  <div className="stat-icon green">
                    <CheckCheck size={19} />
                  </div>
                </div>
                <strong>{done}</strong>
                <small>
                  {overdue
                    ? `${overdue} task${overdue === 1 ? '' : 's'} overdue`
                    : 'All caught up on deadlines'}
                </small>
              </div>
            </section>
          )}
          {activeNav === 'overview' && (
            <section className="settings-card">
              <h2>Overdue tasks: {overdue}</h2>
              <p>Review deadlines and choose your next action.</p>
              <button
                className="secondary-button"
                onClick={() => {
                  setActiveNav('all');
                  setSortBy('due');
                }}
              >
                Review tasks by due date
              </button>
            </section>
          )}
          {(activeNav === 'board' || activeNav === 'all') && (
            <>
              {!tasks.length && (
                <section className="settings-card empty-state">
                  <h2>No tasks yet</h2>
                  <p>
                    Create your first task to get started.{' '}
                    {guest
                      ? 'Your tasks will be saved in this browser.'
                      : 'Your tasks will be saved to your account.'}
                  </p>
                  <button className="primary-button" onClick={() => openCreate()}>
                    Create first task
                  </button>
                </section>
              )}
              <section className="board-section">
                <div className="section-heading">
                  <div>
                    <h2>My tasks</h2>
                    <p>A clear view of everything on your plate</p>
                  </div>
                </div>
                <div className="toolbar">
                  <label className="search-field">
                    <Search size={18} />
                    <input
                      aria-label="Search tasks"
                      value={query}
                      placeholder="Search tasks, labels, notes..."
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    {query && (
                      <button
                        className="icon-button mini"
                        onClick={() => setQuery('')}
                        aria-label="Clear search"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </label>
                  <div className="toolbar-filters">
                    <div className="filter-select">
                      <Filter size={16} />
                      <select
                        aria-label="Filter by status"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                      >
                        <option value="all">All statuses</option>
                        {STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {STATUS_LABEL[status]}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={14} />
                    </div>
                    <div className="filter-select">
                      <SlidersHorizontal size={16} />
                      <select
                        aria-label="Filter by priority"
                        value={priorityFilter}
                        onChange={(e) => setPriorityFilter(e.target.value)}
                      >
                        <option value="all">All priorities</option>
                        {(['low', 'medium', 'high', 'urgent'] as Priority[]).map((priority) => (
                          <option key={priority} value={priority}>
                            {priorityLabel[priority]}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={14} />
                    </div>
                    <div className="filter-select">
                      <ArrowDownAZ size={16} />
                      <select
                        aria-label="Sort tasks"
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                      >
                        <option value="board">Board order</option>
                        <option value="due">Due date</option>
                        <option value="priority">Priority</option>
                        <option value="newest">Newest</option>
                      </select>
                      <ChevronDown size={14} />
                    </div>
                  </div>
                </div>
                {view === 'board' ? (
                  <div className="kanban-board">
                    {STATUSES.map((status) => {
                      const StatusIcon = statusIcon[status];
                      const items = filtered.filter((t) => t.status === status);
                      return (
                        <section
                          className={`kanban-column ${status}`}
                          key={status}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            dropTask(status);
                          }}
                        >
                          <div className="column-header">
                            <div className="column-label">
                              <StatusIcon size={18} />
                              <strong>{STATUS_LABEL[status]}</strong>
                              <span className="column-count">{items.length}</span>
                            </div>
                            <button
                              className="icon-button mini"
                              aria-label={`Add task to ${STATUS_LABEL[status]}`}
                              onClick={() => openCreate(status)}
                            >
                              <Plus size={17} />
                            </button>
                          </div>
                          <div className="column-tasks">
                            {items.length ? (
                              items.map((task) => (
                                <TaskCard
                                  key={task.id}
                                  task={task}
                                  onOpen={() => openEdit(task)}
                                  onStartDrag={() => {
                                    dragId.current = task.id;
                                  }}
                                  onDropTask={(target) => dropTask(target.status, target.id)}
                                />
                              ))
                            ) : (
                              <div className="empty-column">
                                <Circle size={23} />
                                <span>No tasks here</span>
                                <small>Drag a task here or create one</small>
                              </div>
                            )}
                          </div>
                          <button className="add-column" onClick={() => openCreate(status)}>
                            <Plus size={16} /> Add new task
                          </button>
                        </section>
                      );
                    })}
                  </div>
                ) : (
                  <div className="task-table-wrap">
                    <table className="task-table">
                      <thead>
                        <tr>
                          <th>Task</th>
                          <th>Status</th>
                          <th>Priority</th>
                          <th>Due date</th>
                          <th>Labels</th>
                          <th aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((task) => (
                          <tr key={task.id}>
                            <td>
                              <button className="table-task-name" onClick={() => openEdit(task)}>
                                {task.title}
                              </button>
                              <small>{task.description || 'No description'}</small>
                            </td>
                            <td>
                              <span className={`table-status ${task.status}`}>
                                {STATUS_LABEL[task.status]}
                              </span>
                            </td>
                            <td>
                              <span className={`priority-chip ${task.priority}`}>
                                <span className="priority-dot" />
                                {priorityLabel[task.priority]}
                              </span>
                            </td>
                            <td>
                              {task.dueDate ? (
                                <span className={isOverdue(task) ? 'due overdue' : 'due'}>
                                  <CalendarDays size={14} />
                                  {formatDue(task.dueDate)}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td>
                              <div className="tag-list">
                                {task.tags.map((tag) => (
                                  <span className="tag" key={tag}>
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td>
                              <button
                                className="icon-button"
                                onClick={() => openEdit(task)}
                                aria-label={`Edit ${task.title}`}
                              >
                                <MoreHorizontal size={17} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!filtered.length && (
                      <div className="empty-column large">No tasks match your filters.</div>
                    )}
                  </div>
                )}
                <div className="board-footer">
                  <span>
                    <Tags size={15} /> Showing {filtered.length} of {tasks.length} tasks
                  </span>
                  <button
                    onClick={() => {
                      setStatusFilter('all');
                      setPriorityFilter('all');
                      setQuery('');
                    }}
                  >
                    <SlidersHorizontal size={15} /> Reset filters
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      </main>
      {copilotOpen && (
        <button
          className="mobile-copilot-shade"
          aria-label="Close AI copilot"
          onClick={() => setCopilotOpen(false)}
        />
      )}
      <Copilot
        userId={userId}
        onBusyChange={setCopilotBusy}
        key={`${chatVersion}:${epoch}`}
        getTasks={getTasks}
        commitTasks={commitTasks}
        open={copilotOpen}
        onToggle={() => setCopilotOpen(false)}
      />
      {showModal && error && (
        <div className="modal-error" role="alert">
          {error}
        </div>
      )}
      {showModal && (
        <TaskModal
          pending={pending}
          key={editId || `new-${newStatus}`}
          task={edited}
          initialStatus={newStatus}
          onClose={() => setShowModal(false)}
          onSave={(draft) => {
            void saveTask(draft).catch(() => {});
          }}
          onDelete={edited ? () => setDeleteConfirm(edited) : undefined}
        />
      )}
      {deleteConfirm && (
        <div className="modal-backdrop topmost">
          <div
            className="modal delete-modal"
            role="alertdialog"
            aria-modal="true"
            aria-label="Delete task confirmation"
          >
            <div className="danger-badge">
              <Trash2 size={23} />
            </div>
            <h2>Delete this task?</h2>
            <p>
              “{deleteConfirm.title}” will be permanently removed from{' '}
              {guest ? 'this guest workspace' : 'your account'}. This cannot be undone.
            </p>
            <div className="approval-actions">
              <button className="secondary-button" onClick={() => setDeleteConfirm(null)}>
                Keep task
              </button>
              <button className="danger-primary" onClick={() => void confirmDelete().catch(() => {})}>
                <Trash2 size={16} /> Delete task
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
