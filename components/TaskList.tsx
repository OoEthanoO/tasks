"use client";

import { useId, useState } from "react";
import { type DateKey, formatDueDate } from "@/lib/dates";
import { compareCompletedOrder, compareListOrder, dueBucket, type TaskMoveDirection } from "@/lib/grouping";
import type { Task } from "@/lib/types";
import { type TaskProgress, formatDuration } from "@/lib/tracking";

type Props = {
  entries: TaskProgress[];
  today: DateKey;
  activeId: string | null;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Task>) => void;
  onMove: (id: string, direction: TaskMoveDirection) => void;
};

export default function TaskList({ entries, today, activeId, onToggle, onDelete, onUpdate, onMove }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [moveNotice, setMoveNotice] = useState("");

  if (entries.length === 0) {
    return (
      <div className="empty">
        <p>No tasks yet.</p>
        <p>Add a task to start your rotation.</p>
      </div>
    );
  }

  const open = entries.filter(entry => !entry.task.completed).sort((a, b) => compareListOrder(a.task, b.task));
  const completed = entries.filter(entry => entry.task.completed).sort((a, b) => compareCompletedOrder(a.task, b.task));
  const renderEntry = (entry: TaskProgress, index: number) => (
    <li key={entry.task.id}>
      {editingId === entry.task.id ? (
        <TaskEditor
          task={entry.task}
          onCancel={() => setEditingId(null)}
          onSave={patch => {
            onUpdate(entry.task.id, patch);
            setEditingId(null);
          }}
          onDelete={() => {
            onDelete(entry.task.id);
            setEditingId(null);
          }}
        />
      ) : (
        <TaskRow
          entry={entry}
          today={today}
          active={activeId === entry.task.id && !entry.task.completed}
          onToggle={() => onToggle(entry.task.id)}
          onEdit={() => setEditingId(entry.task.id)}
          canMoveUp={!entry.task.completed && open[index - 1]?.task.dueDate === entry.task.dueDate}
          canMoveDown={!entry.task.completed && open[index + 1]?.task.dueDate === entry.task.dueDate}
          onMove={direction => {
            onMove(entry.task.id, direction);
            setMoveNotice(`Moved ${entry.task.title} ${direction} among tasks due ${formatDueDate(entry.task.dueDate, today)}.`);
          }}
        />
      )}
    </li>
  );

  return (
    <>
      <span className="sr-only" role="status">{moveNotice}</span>
      {open.length > 0 ? (
        <ul className="task-list" aria-label="Open tasks, ordered by due date">{open.map(renderEntry)}</ul>
      ) : (
        <div className="empty"><p>All tasks completed.</p></div>
      )}
      {completed.length > 0 && (
        <details className="completed-tasks">
          <summary>Completed · {completed.length}</summary>
          <p className="hint">Newest first · Automatically deleted after one month.</p>
          <ul className="task-list" aria-label="Completed tasks, newest first">{completed.map(renderEntry)}</ul>
        </details>
      )}
    </>
  );
}

function TaskRow({ entry, today, active, onToggle, onEdit, canMoveUp, canMoveDown, onMove }: {
  entry: TaskProgress;
  today: DateKey;
  active: boolean;
  onToggle: () => void;
  onEdit: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: TaskMoveDirection) => void;
}) {
  const { task, trackedMs } = entry;
  const bucket = dueBucket(task, today);
  const dueClass = bucket === "overdue" ? " is-overdue" : bucket === "today" ? " is-today" : "";

  return (
    <div className={`task${task.completed ? " is-done" : ""}${active ? " is-active" : ""}`}>
      <input
        type="checkbox"
        className="check"
        checked={task.completed}
        onChange={onToggle}
        aria-label={task.completed ? `Reopen ${task.title}` : `Complete ${task.title}`}
      />
      <div className="task-main">
        <div className="task-title">{task.title}</div>
        {task.description && <p className="task-desc">{task.description}</p>}
        <div className="task-meta">
          <time className={`due${dueClass}`} dateTime={task.dueDate} title={`Due ${task.dueDate}`}>
            {formatDueDate(task.dueDate, today)}
          </time>
          <span className="sep" aria-hidden="true">·</span>
          <span className="task-total" title="Resets at local midnight">{formatDuration(trackedMs)} tracked today</span>
          {active && <span className="task-current">Tracking</span>}
        </div>
      </div>
      <div className="task-actions">
        {(canMoveUp || canMoveDown) && (
          <div className="task-order" role="group" aria-label={`Reorder ${task.title} within its due date`}>
            {(["up", "down"] as const).map(direction => (
              <button
                key={direction}
                type="button"
                className="icon-btn task-move"
                disabled={direction === "up" ? !canMoveUp : !canMoveDown}
                onClick={() => onMove(direction)}
                aria-label={`Move ${task.title} ${direction}`}
                title={`Move ${direction} (same due date)`}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={direction === "up" ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"} />
                </svg>
              </button>
            ))}
          </div>
        )}
        <button type="button" className="icon-btn" onClick={onEdit} aria-label={`Edit ${task.title}`}>
          Edit
        </button>
      </div>
    </div>
  );
}

function TaskEditor({ task, onSave, onCancel, onDelete }: {
  task: Task;
  onSave: (patch: Partial<Task>) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const id = useId();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [dueDate, setDueDate] = useState(task.dueDate);

  return (
    <form
      className="task editor"
      aria-label={`Edit ${task.title}`}
      onSubmit={e => {
        e.preventDefault();
        if (title.trim() && dueDate) onSave({ title: title.trim(), description: description.trim(), dueDate });
      }}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      }}
    >
      <div className="field">
        <label htmlFor={`${id}-title`}>Title</label>
        <input id={`${id}-title`} className="input" value={title} required autoFocus onChange={e => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-date`}>Due date</label>
        <input id={`${id}-date`} type="date" className="input" value={dueDate} required onChange={e => setDueDate(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-description`}>Description (optional)</label>
        <textarea id={`${id}-description`} className="textarea" value={description} onChange={e => setDescription(e.target.value)} />
      </div>
      <div className="editor-actions">
        <button type="submit" className="btn btn-primary" disabled={!title.trim() || !dueDate}>Save</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <div className="spacer" />
        <button type="button" className="btn btn-danger" onClick={onDelete}>Delete</button>
      </div>
    </form>
  );
}
