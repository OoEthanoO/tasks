"use client";

import { useEffect, useRef, useState } from "react";
import { isEmptyState, summarizeState } from "@/lib/app-state";
import { validatePassword, validateUsername } from "@/lib/auth-rules";
import { AppState } from "@/lib/types";

type Mode = "signin" | "signup";
type Step = "form" | "migrate";

type Props = {
  initialMode: Mode;
  /** The signed-out data sitting in this browser, if any. */
  localState: AppState;
  onSignIn: (username: string, password: string) => Promise<void>;
  onSignUp: (username: string, password: string, migrate: boolean) => Promise<void>;
  onClose: () => void;
};

export default function AuthDialog({
  initialMode,
  localState,
  onSignIn,
  onSignUp,
  onClose,
}: Props) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [step, setStep] = useState<Step>("form");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  const hasLocalData = !isEmptyState(localState);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStep("form");
    } finally {
      setBusy(false);
    }
  }

  function submitForm() {
    if (busy) return;

    if (mode === "signup") {
      const problem = validateUsername(username) ?? validatePassword(password);
      if (problem) {
        setError(problem);
        return;
      }
      // The whole point of this dialog: never silently strand local data.
      if (hasLocalData) {
        setError(null);
        setStep("migrate");
        return;
      }
      void run(() => onSignUp(username, password, false));
      return;
    }

    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }
    void run(() => onSignIn(username, password));
  }

  function switchMode(next: Mode) {
    setMode(next);
    setStep("form");
    setError(null);
  }

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="auth-panel"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "signup" ? "Create an account" : "Sign in"}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.preventDefault();
            onClose();
          }
        }}
      >
        {step === "migrate" ? (
          <MigrateStep
            localState={localState}
            busy={busy}
            onBack={() => setStep("form")}
            onChoose={(migrate) => run(() => onSignUp(username, password, migrate))}
          />
        ) : (
          <>
            <div className="auth-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signin"}
                className={`auth-tab${mode === "signin" ? " is-active" : ""}`}
                onClick={() => switchMode("signin")}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signup"}
                className={`auth-tab${mode === "signup" ? " is-active" : ""}`}
                onClick={() => switchMode("signup")}
              >
                Create account
              </button>
            </div>

            <form
              className="auth-body"
              onSubmit={(e) => {
                e.preventDefault();
                submitForm();
              }}
            >
              <div className="field">
                <label htmlFor="auth-username">Username</label>
                <input
                  id="auth-username"
                  ref={usernameRef}
                  className="input"
                  value={username}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="auth-password">Password</label>
                <input
                  id="auth-password"
                  className="input"
                  type="password"
                  value={password}
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                  onChange={(e) => setPassword(e.target.value)}
                />
                {mode === "signup" && (
                  <span className="hint">At least 8 characters.</span>
                )}
              </div>

              {error && (
                <div className="banner danger" role="alert">
                  {error}
                </div>
              )}

              {mode === "signup" && hasLocalData && (
                <p className="auth-note">
                  You have {summarizeState(localState)} saved on this device.
                  We&apos;ll ask what to do with it next.
                </p>
              )}

              <div className="auth-foot">
                <span className="hint">
                  <span className="kbd">Esc</span> cancel
                </span>
                <div className="spacer" />
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy
                    ? "Working…"
                    : mode === "signup"
                      ? "Create account"
                      : "Sign in"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function MigrateStep({
  localState,
  busy,
  onBack,
  onChoose,
}: {
  localState: AppState;
  busy: boolean;
  onBack: () => void;
  onChoose: (migrate: boolean) => void;
}) {
  return (
    <div className="auth-body">
      <h2 className="auth-title">Bring your local data along?</h2>
      <p className="auth-lede">
        This browser is holding <strong>{summarizeState(localState)}</strong> from
        before you had an account.
      </p>

      <div className="auth-choices">
        <button
          type="button"
          className="auth-choice is-primary"
          aria-label="Move my local data into my account"
          disabled={busy}
          onClick={() => onChoose(true)}
        >
          <span className="auth-choice-title">Move it into my account</span>
          <span className="auth-choice-sub">
            Everything is copied to the account and cleared from this device.
          </span>
        </button>

        <button
          type="button"
          className="auth-choice"
          aria-label="Start fresh and leave my local data on this device"
          disabled={busy}
          onClick={() => onChoose(false)}
        >
          <span className="auth-choice-title">Start fresh</span>
          <span className="auth-choice-sub">
            The account begins empty. This device keeps its copy, and you&apos;ll see
            it again when you sign out.
          </span>
        </button>
      </div>

      <div className="auth-foot">
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onBack}>
          ← Back
        </button>
        <div className="spacer" />
        {busy && <span className="hint">Creating your account…</span>}
      </div>
    </div>
  );
}
