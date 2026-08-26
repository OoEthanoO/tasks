"use client";

import { useState } from "react";
import { sanitizeRestMode } from "@/lib/app-state";
import { RestMode } from "@/lib/types";

type Props = {
  restMode: RestMode;
  onChange: (next: RestMode) => void;
};

export default function RestKinds({ restMode, onChange }: Props) {
  const [draft, setDraft] = useState("");

  // Every edit goes back through the same coercion storage uses, so the
  // trimming, the length cap and the case-insensitive de-duplication cannot
  // drift between what the UI allows and what survives a save.
  function commit(next: RestMode) {
    onChange(sanitizeRestMode(next));
  }

  function addDraft() {
    const label = draft.trim();
    if (!label) return;
    commit({ ...restMode, types: [...restMode.types, label] });
    setDraft("");
  }

  const share =
    restMode.types.length > 0 ? Math.round(100 / restMode.types.length) : 0;

  return (
    <div className="rest-kinds">
      <label className="rest-toggle">
        <input
          type="checkbox"
          className="check"
          checked={restMode.advanced}
          onChange={(e) => commit({ ...restMode, advanced: e.target.checked })}
        />
        <span>Advanced rest</span>
      </label>

      {restMode.advanced && (
        <div className="rest-kinds-body">
          <div className="rest-chip-row">
            {restMode.types.map((kind) => (
              <span key={kind} className="pill">
                {kind}
                <button
                  type="button"
                  className="pill-x"
                  aria-label={`Remove ${kind}`}
                  onClick={() =>
                    commit({
                      ...restMode,
                      types: restMode.types.filter((k) => k !== kind),
                    })
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          <div className="rest-add">
            <input
              className="input"
              value={draft}
              placeholder="Add a kind — Code, Game, Walk…"
              aria-label="New rest kind"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDraft();
                }
              }}
            />
            <button type="button" className="btn" onClick={addDraft} disabled={!draft.trim()}>
              Add
            </button>
          </div>

          <p className="hint">
            {restMode.types.length === 0
              ? "No kinds yet, so rest blocks still read “Rest”."
              : `Each rest block is drawn evenly from these — ${share}% each. How often rest comes up at all is unchanged.`}
          </p>
        </div>
      )}
    </div>
  );
}
