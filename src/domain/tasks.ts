export type Status = 'todo' | 'inprogress' | 'done';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type ChecklistItem = { id: string; text: string; done: boolean };
export type Task = {
  id: string;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  dueDate: string | null;
  tags: string[];
  checklist: ChecklistItem[];
  notes: string[];
  createdAt: string;
  updatedAt: string;
  order: number;
};
export type TaskPatch = Partial<
  Pick<
    Task,
    'title' | 'description' | 'status' | 'priority' | 'dueDate' | 'tags' | 'checklist' | 'notes'
  >
>;
export const STATUSES: Status[] = ['todo', 'inprogress', 'done'];
export const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];
export const STATUS_LABEL: Record<Status, string> = {
  todo: 'To Do',
  inprogress: 'In Progress',
  done: 'Done',
};
export const STORAGE_KEY = 'taskflow:tasks:v1';
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
export function makeTask(input: Partial<Task> & Pick<Task, 'title'>, tasks: Task[]): Task {
  const stamp = now();
  return {
    id: id(),
    title: input.title.trim().slice(0, 200),
    description: input.description || '',
    status: input.status || 'todo',
    priority: input.priority || 'medium',
    dueDate: input.dueDate || null,
    tags: input.tags || [],
    checklist: input.checklist || [],
    notes: input.notes || [],
    createdAt: stamp,
    updatedAt: stamp,
    order: tasks.filter((t) => t.status === (input.status || 'todo')).length,
  };
}
export function updateTask(tasks: Task[], taskId: string, patch: TaskPatch): Task[] {
  return tasks.map((task) => (task.id === taskId ? { ...task, ...patch, updatedAt: now() } : task));
}
export function moveTask(tasks: Task[], taskId: string, status: Status, beforeId?: string): Task[] {
  const moving = tasks.find((t) => t.id === taskId);
  if (!moving || !STATUSES.includes(status)) return tasks;
  const others = tasks.filter((t) => t.id !== taskId);
  const column = others.filter((t) => t.status === status).sort((a, b) => a.order - b.order);
  let index = beforeId ? column.findIndex((t) => t.id === beforeId) : -1;
  if (index < 0) index = column.length;
  column.splice(index, 0, { ...moving, status, updatedAt: now() });
  const positions = new Map(column.map((task, order) => [task.id, order]));
  return [...others, { ...moving, status, updatedAt: now() }].map((task) =>
    positions.has(task.id) ? { ...task, order: positions.get(task.id)! } : task,
  );
}
export function isOverdue(task: Task, reference = new Date()): boolean {
  const today = reference.toLocaleDateString('en-CA');
  return task.status !== 'done' && !!task.dueDate && task.dueDate < today;
}
export function checklistProgress(task: Task): string | null {
  if (!task.checklist.length) return null;
  return `${task.checklist.filter((item) => item.done).length}/${task.checklist.length}`;
}
export function sortTasks(tasks: Task[], sort: 'board' | 'due' | 'priority' | 'newest'): Task[] {
  const weight: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  return [...tasks].sort((a, b) => {
    if (sort === 'due') return (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31');
    if (sort === 'priority') return weight[a.priority] - weight[b.priority];
    if (sort === 'newest') return b.createdAt.localeCompare(a.createdAt);
    return a.order - b.order;
  });
}
