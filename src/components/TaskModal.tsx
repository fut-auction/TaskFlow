import { useEffect, useState, type FormEvent } from 'react';
import { Check, Plus, Trash2, X } from 'lucide-react';
import type { Task, ChecklistItem, Status, Priority } from '../domain/tasks';

type Draft = Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'dueDate' | 'tags' | 'checklist' | 'notes'>;
const emptyDraft: Draft = { title: '', description: '', status: 'todo', priority: 'medium', dueDate: null, tags: [], checklist: [], notes: [] };
export default function TaskModal({ task, initialStatus = 'todo', onClose, onSave, onDelete }: {
  task: Task | null; initialStatus?: Status; onClose: () => void; onSave: (draft: Draft) => void; onDelete?: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => task ? { ...task, tags: [...task.tags], checklist: [...task.checklist], notes: [...task.notes] } : { ...emptyDraft, status: initialStatus });
  const [tagText, setTagText] = useState(task?.tags.join(', ') || '');
  const [newCheck, setNewCheck] = useState('');
  const [newNote, setNewNote] = useState('');
  useEffect(() => { function esc(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); } window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc); }, [onClose]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(d => ({ ...d, [key]: value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim()) return;
    onSave({ ...draft, title: draft.title.trim(), tags: [...new Set(tagText.split(',').map(x => x.trim()).filter(Boolean))], notes: newNote.trim() ? [...draft.notes, newNote.trim()] : draft.notes });
  };
  const toggleCheck = (id: string) => set('checklist', draft.checklist.map(item => item.id === id ? { ...item, done: !item.done } : item));
  const addCheck = () => {
    if (!newCheck.trim()) return;
    set('checklist', [...draft.checklist, { id: crypto.randomUUID(), text: newCheck.trim(), done: false }]); setNewCheck('');
  };
  const removeCheck = (id: string) => set('checklist', draft.checklist.filter(item => item.id !== id));
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal task-modal" role="dialog" aria-modal="true" aria-labelledby="task-title">
      <div className="modal-header"><div><span className="eyebrow">TASK DETAILS</span><h2 id="task-title">{task ? 'Edit task' : 'Create task'}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close editor"><X size={19} /></button></div>
      <form onSubmit={submit} className="modal-content">
        <label className="field-label" htmlFor="task-name">Task title <span className="required">*</span></label>
        <input autoFocus id="task-name" required maxLength={200} placeholder="What needs to be done?" value={draft.title} onChange={e => set('title', e.target.value)} />
        <label className="field-label" htmlFor="task-description">Description</label>
        <textarea id="task-description" rows={3} placeholder="Add helpful context..." value={draft.description} onChange={e => set('description', e.target.value)} />
        <div className="form-grid"><div><label className="field-label" htmlFor="task-status">Status</label><select id="task-status" value={draft.status} onChange={e => set('status', e.target.value as Status)}><option value="todo">To Do</option><option value="inprogress">In Progress</option><option value="done">Done</option></select></div><div><label className="field-label" htmlFor="task-priority">Priority</label><select id="task-priority" value={draft.priority} onChange={e => set('priority', e.target.value as Priority)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></div></div>
        <div className="form-grid"><div><label className="field-label" htmlFor="task-due">Due date</label><input
  id="task-due"
  type="date"
  lang="en-US"
  dir="ltr"
  value={draft.dueDate || ''}
  onChange={e => set('dueDate', e.target.value || null)}
/></div><div><label className="field-label" htmlFor="task-tags">Labels (comma separated)</label><input id="task-tags" placeholder="Design, Sprint" value={tagText} onChange={e => setTagText(e.target.value)} /></div></div>
        <div className="field-head"><span className="field-label">Checklist</span><span className="small-muted">{draft.checklist.filter(c => c.done).length}/{draft.checklist.length} complete</span></div>
        <div className="checklist-edit">{draft.checklist.map((item: ChecklistItem) => <div className="checklist-row" key={item.id}><label className="check-label"><input type="checkbox" checked={item.done} onChange={() => toggleCheck(item.id)} /><span className={item.done ? 'line-through' : ''}>{item.text}</span></label><button type="button" className="icon-button mini" aria-label={`Remove ${item.text}`} onClick={() => removeCheck(item.id)}><Trash2 size={15}/></button></div>)}<div className="inline-input"><input aria-label="New checklist item" placeholder="Add checklist item" value={newCheck} onChange={e => setNewCheck(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCheck(); } }} /><button type="button" className="secondary-button" onClick={addCheck}><Plus size={15}/> Add</button></div></div>
        <label className="field-label" htmlFor="new-note">Notes</label>
        {draft.notes.map((note, index) => <div className="note-row" key={`${index}-${note.slice(0, 8)}`}><span>{note}</span><button type="button" className="icon-button mini" onClick={() => set('notes', draft.notes.filter((_, i) => i !== index))} aria-label="Remove note"><X size={14}/></button></div>)}
        <textarea rows={2} id="new-note" value={newNote} placeholder="Add a note to this task" onChange={e => setNewNote(e.target.value)} />
        {task && <div className="timestamp">Created {new Date(task.createdAt).toLocaleString()} · Updated {new Date(task.updatedAt).toLocaleString()}</div>}
        <div className="modal-footer">{task && onDelete && <button type="button" className="danger-button" onClick={onDelete}><Trash2 size={16}/> Delete</button>}<div className="footer-right"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button"><Check size={16}/>{task ? 'Save changes' : 'Create task'}</button></div></div>
      </form>
    </div>
  </div>;
}
