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
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Accidental Enter must not confirm a destructive action.
  useEffect(() => {
    const previous = document.activeElement;
    cancelRef.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  return (
    <div
      className="overlay"
      onKeyDown={(e) => {
        // Keep page shortcuts and keyboard focus behind the confirmation inert.
        e.stopPropagation();
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        if (e.key === "Tab") {
          e.preventDefault();
          if (document.activeElement === cancelRef.current) confirmRef.current?.focus();
          else cancelRef.current?.focus();
        }
      }}
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
          <button type="button" className="btn btn-primary" ref={confirmRef} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
