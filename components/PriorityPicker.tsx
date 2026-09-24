"use client";

import { Priority } from "@/lib/types";
import { PRIORITIES, PRIORITY_LABEL, PRIORITY_MULTIPLIER } from "@/lib/weights";

/** Low / Medium / High, styled like the theme switch. */
export default function PriorityPicker({
  value,
  onChange,
  labelledBy,
}: {
  value: Priority;
  onChange: (value: Priority) => void;
  labelledBy?: string;
}) {
  return (
    <div className="priority-picker" role="group" aria-labelledby={labelledBy}>
      {PRIORITIES.map((option) => (
        <button
          key={option}
          type="button"
          className={`priority-option${option === value ? " is-active" : ""}`}
          aria-pressed={option === value}
          title={`Weight ×${PRIORITY_MULTIPLIER[option]}`}
          onClick={() => onChange(option)}
        >
          {PRIORITY_LABEL[option]}
        </button>
      ))}
    </div>
  );
}
