"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDueDate, todayKey } from "@/lib/dates";
import { parseTrailingDate } from "@/lib/parse-date";

type Props = {
  onCreate: (input: { title: string; description: string; dueDate: string }) => void;
  onClose: () => void;
};

export default function QuickAdd({ onCreate, onClose }: Props) {
  const [raw, setRaw] = useState("");
  const [description, setDescription] = useState("");
  const [manualDate, setManualDate] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement;
    dialog?.showModal();
    inputRef.current?.focus();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  const today = todayKey();
  const parsed = useMemo(() => parseTrailingDate(raw), [raw]);
  const dueDate = manualDate ?? parsed.dueDate ?? today;
  const title = parsed.title.trim();
  const canSubmit = title.length > 0;

  return (
    <dialog
      ref={dialogRef}
      className="quickadd"
      aria-labelledby="quickadd-title"
      onCancel={e => { e.preventDefault(); onClose(); }}
      onKeyDown={e => e.stopPropagation()}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form onSubmit={e => {
        e.preventDefault();
        if (!canSubmit) return;
        onCreate({ title, description: description.trim(), dueDate });
        onClose();
      }}>
        <div className="quickadd-head">
          <h2 id="quickadd-title">New task</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cancel new task">×</button>
        </div>
        <input
          ref={inputRef}
          className="quickadd-input"
          placeholder="Finish the lab report tomorrow"
          value={raw}
          required
          onChange={e => setRaw(e.target.value)}
          aria-label="Task title"
          aria-describedby="quickadd-preview"
        />
        <div id="quickadd-preview" className="quickadd-preview" aria-live="polite">
          <span className="pill">{formatDueDate(dueDate, today)}</span>
          {parsed.matched && <span>Task: <strong>{title || "…"}</strong></span>}
        </div>
        {!raw && <p className="examples">End the title with a date, like <code>tomorrow</code> or <code>next friday</code>.</p>}
        {showDetails && (
          <div id="quickadd-details" className="quickadd-details">
            <div className="field">
              <label htmlFor="qa-date">Due date</label>
              <input
                id="qa-date"
                type="date"
                className="input"
                value={dueDate}
                onChange={e => setManualDate(e.target.value || today)}
              />
            </div>
            <div className="field">
              <label htmlFor="qa-desc">Description (optional)</label>
              <textarea
                id="qa-desc"
                className="textarea"
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>
          </div>
        )}
        <div className="quickadd-foot">
          <button
            type="button"
            className="btn btn-ghost"
            aria-expanded={showDetails}
            aria-controls={showDetails ? "quickadd-details" : undefined}
            onClick={() => setShowDetails(value => !value)}
          >
            {showDetails ? "Hide details" : "Date / description"}
          </button>
          <div className="spacer" />
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>Create</button>
        </div>
      </form>
    </dialog>
  );
}
