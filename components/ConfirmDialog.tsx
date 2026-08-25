"use client";

import { useEffect, useRef } from "react";

type Props = {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus lands on the way out, not the way through. G is a single unmodified
  // keystroke, so a stray Enter behind it must not be what replaces a schedule
  // this dialog exists to protect.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="confirm-panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
      >
        <h2 id="confirm-title" className="confirm-title">
          {title}
        </h2>
        <p id="confirm-body" className="confirm-body">
          {body}
        </p>
        <div className="confirm-actions">
          <button type="button" className="btn" ref={cancelRef} onClick={onCancel}>
            {cancelLabel}
          </button>
          <div className="spacer" />
          <button type="button" className="btn btn-primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
