"use client";

import { useState } from "react";
import { DateKey, describeDelta, formatDueDate } from "@/lib/dates";
import { dueBucket, groupTasks } from "@/lib/grouping";
import { Task } from "@/lib/types";
import { WeightedTask, formatProbability, formatWeight } from "@/lib/weights";

type Props = {
  entries: WeightedTask[];
  today: DateKey;
  maxProbability: number;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Task>) => void;
};

export default function TaskList({
  entries,
  today,
  maxProbability,
  onToggle,
  onDelete,
  onUpdate,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (entries.length === 0) {
    return (
      <div className="empty">
        <p>No tasks yet.</p>
        <p>
          Press <span className="kbd">Q</span> to add your first one.
        </p>
      </div>
    );
  }

  const groups = groupTasks(entries, today);

  return (
    <div>
      {groups.map((group) => (
        <div key={group.key}>
          <div className={`group-label${group.tone ? ` ${group.tone}` : ""}`}>
            {group.label} <span className="group-count">{group.items.length}</span>
          </div>
          {group.items.map((entry) =>
            editingId === entry.task.id ? (
              <TaskEditor
                key={entry.task.id}
                task={entry.task}
                onCancel={() => setEditingId(null)}
                onSave={(patch) => {
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
                key={entry.task.id}
                entry={entry}
                today={today}
                maxProbability={maxProbability}
                onToggle={() => onToggle(entry.task.id)}
                onEdit={() => setEditingId(entry.task.id)}
                onDelete={() => onDelete(entry.task.id)}
              />
            ),
          )}
        </div>
      ))}
    </div>
  );
}

function TaskRow({
  entry,
  today,
  maxProbability,
  onToggle,
  onEdit,
  onDelete,
}: {
  entry: WeightedTask;
  today: DateKey;
  maxProbability: number;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { task, weight, probability } = entry;
  const DUE_CLASS = { overdue: " is-overdue", today: " is-today", upcoming: "", done: "" };
  const dueClass = DUE_CLASS[dueBucket(task, today)];

  const barWidth =
    maxProbability > 0 ? Math.max(3, (probability / maxProbability) * 100) : 0;

  return (
    <div className={`task${task.completed ? " is-done" : ""}`}>
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
          <span className={`due${dueClass}`}>{formatDueDate(task.dueDate, today)}</span>
          {!task.completed && (
            <>
              <span className="sep">·</span>
              <span>{describeDelta(task.dueDate, today)}</span>
              <span className="sep">·</span>
              <span title="This task's weight in the recommender">
                weight {formatWeight(weight)}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="prob" title={
        task.completed
          ? "Completed tasks have weight 0 and are never picked"
          : `${formatProbability(probability)} chance of being picked on any given draw`
      }>
        <span className={`prob-value${probability <= 0 ? " is-zero" : ""}`}>
          {task.completed ? "—" : formatProbability(probability)}
        </span>
        {!task.completed && (
          <span className="prob-bar">
            <span className="prob-fill" style={{ width: `${barWidth}%` }} />
          </span>
        )}
      </div>

      <div className="task-actions">
        <button type="button" className="icon-btn" onClick={onEdit} title="Edit task">
          Edit
        </button>
        <button
          type="button"
          className="icon-btn danger"
          onClick={onDelete}
          title="Delete task"
          aria-label={`Delete ${task.title}`}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function TaskEditor({
  task,
  onSave,
  onCancel,
  onDelete,
}: {
  task: Task;
  onSave: (patch: Partial<Task>) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [dueDate, setDueDate] = useState(task.dueDate);

  function save() {
    const trimmed = title.trim();
    if (!trimmed) return;
    onSave({ title: trimmed, description: description.trim(), dueDate });
  }

  return (
    <div className="task">
      <div className="editor" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
        <div className="field">
          <label>Title</label>
          <input
            className="input"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </div>
        <div className="field">
          <label>Due date</label>
          <input
            type="date"
            className="input time-input"
            value={dueDate}
            onChange={(e) => e.target.value && setDueDate(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Description</label>
          <textarea
            className="textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="editor-actions">
          <button type="button" className="btn btn-primary" onClick={save}>
            Save
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <div className="spacer" />
          <button type="button" className="btn btn-danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
