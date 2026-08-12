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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const today = todayKey();
  const parsed = useMemo(() => parseTrailingDate(raw), [raw]);
  const dueDate = manualDate ?? parsed.dueDate ?? today;
  const title = parsed.title.trim();
  const canSubmit = title.length > 0;

  function submit() {
    if (!canSubmit) return;
    onCreate({ title, description: description.trim(), dueDate });
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="quickadd" onKeyDown={onKeyDown}>
        <input
          ref={inputRef}
          className="quickadd-input"
          placeholder="Finish the physics lab report tomorrow"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          aria-label="Task title"
        />

        <div className="quickadd-preview">
          {parsed.matched ? (
            <>
              <span className="pill is-auto">
                <span aria-hidden="true">◆</span>
                {formatDueDate(dueDate, today)}
                {manualDate ? " (set manually)" : ""}
              </span>
              <span>
                from <span className="strike">{parsed.matched}</span> — name will be{" "}
                <strong style={{ color: "var(--text-dim)" }}>{title || "…"}</strong>
              </span>
            </>
          ) : (
            <span className="pill">
              {formatDueDate(dueDate, today)}
              {!manualDate && " (default)"}
            </span>
          )}
        </div>

        {!raw && (
          <div className="examples">
            End the name with a date and it gets pulled out automatically:{" "}
            <code>today</code> <code>tdy</code> <code>tmr</code> <code>tomorrow</code>{" "}
            <code>wednesday</code> <code>next fri</code> <code>yesterday</code>{" "}
            <code>aug 28</code> <code>8/28</code> <code>in 3 days</code>
          </div>
        )}

        {showDetails && (
          <div className="quickadd-details">
            <div className="field">
              <label htmlFor="qa-date">Due date</label>
              <input
                id="qa-date"
                type="date"
                className="input time-input"
                value={dueDate}
                onChange={(e) => setManualDate(e.target.value || today)}
              />
            </div>
            <div className="field">
              <label htmlFor="qa-desc">Description (optional)</label>
              <textarea
                id="qa-desc"
                className="textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Anything worth remembering about this task…"
              />
            </div>
          </div>
        )}

        <div className="quickadd-foot">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setShowDetails((v) => !v)}
          >
            {showDetails ? "Hide details" : "Add date / description"}
          </button>
          <div className="spacer" />
          <span className="hint">
            <span className="kbd">Esc</span> cancel
          </span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={!canSubmit}
          >
            Create <span className="kbd">↵</span>
          </button>
        </div>
      </div>
    </div>
  );
}
