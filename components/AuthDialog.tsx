"use client";

import { useEffect, useRef, useState } from "react";
import { isEmptyState, summarizeState } from "@/lib/app-state";
import { validatePassword, validateUsername } from "@/lib/auth-rules";
import { AppState } from "@/lib/types";

type Mode = "signin" | "signup";
type Step = "form" | "migrate";
/** Which side of the flow raised the migration question. */
type MigrateFor = "signup" | "signin";

type Props = {
  initialMode: Mode;
  /** The signed-out data sitting in this browser, if any. */
  localState: AppState;
  onSignIn: (
    username: string,
    password: string,
  ) => Promise<{ needsMigrationChoice: boolean }>;
  onSignUp: (username: string, password: string, migrate: boolean) => Promise<void>;
  /** Answers the question after signing in to an empty account. */
  onAdoptLocal: (migrate: boolean) => Promise<void>;
  onClose: () => void;
};

export default function AuthDialog({
  initialMode,
  localState,
  onSignIn,
  onSignUp,
  onAdoptLocal,
  onClose,
}: Props) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [step, setStep] = useState<Step>("form");
  const [migrateFor, setMigrateFor] = useState<MigrateFor>("signup");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  // Frozen at open. Signing in swaps the active store out from under the prop,
  // and the migrate step must keep describing the device copy, not the account.
  // Nothing can edit tasks behind a modal, so the snapshot cannot go stale.
  const [deviceState] = useState(localState);
  const hasLocalData = !isEmptyState(deviceState);

  /** `action` resolves true when the dialog's work is done and it should close. */
  async function run(action: () => Promise<boolean>, failStep: Step = "form") {
    setBusy(true);
    setError(null);
    try {
      if (await action()) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStep(failStep);
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
        setMigrateFor("signup");
        setStep("migrate");
        return;
      }
      void run(() => onSignUp(username, password, false).then(() => true));
      return;
    }

    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }
    void run(async () => {
      const { needsMigrationChoice } = await onSignIn(username, password);
      // Signed in to an account with nothing in it, while this device holds
      // something. Stay open and ask before either copy wins.
      if (needsMigrationChoice) {
        setMigrateFor("signin");
        setStep("migrate");
        return false;
      }
      return true;
    });
  }

  function chooseMigration(migrate: boolean) {
    if (migrateFor === "signup") {
      // The account does not exist yet, so a failure goes back to the form —
      // the username may be the thing that needs fixing.
      void run(() => onSignUp(username, password, migrate).then(() => true));
      return;
    }
    // Already signed in; the form is behind us. Stay here and let them retry.
    void run(() => onAdoptLocal(migrate).then(() => true), "migrate");
  }

  function switchMode(next: Mode) {
    setMode(next);
    setStep("form");
    setError(null);
  }

  // After signing in, closing is a real answer: leave the copy on the device.
  // That is already the app's state, so there is nothing to undo.
  const dismissable = !busy;

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissable) onClose();
      }}
    >
      <div
        className="auth-panel"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "signup" ? "Create an account" : "Sign in"}
        onKeyDown={(e) => {
          if (e.key === "Escape" && dismissable) {
            e.preventDefault();
            onClose();
          }
        }}
      >
        {step === "migrate" ? (
          <MigrateStep
            variant={migrateFor}
            username={username.trim()}
            deviceState={deviceState}
            busy={busy}
            error={error}
            onBack={migrateFor === "signup" ? () => setStep("form") : null}
            onChoose={chooseMigration}
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

              {hasLocalData && (
                <p className="auth-note">
                  You have {summarizeState(deviceState)} saved on this device.{" "}
                  {mode === "signup"
                    ? "We'll ask what to do with it next."
                    : "If your account is empty, we'll ask whether to move it in."}
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
  variant,
  username,
  deviceState,
  busy,
  error,
  onBack,
  onChoose,
}: {
  variant: MigrateFor;
  username: string;
  deviceState: AppState;
  busy: boolean;
  error: string | null;
  /** Null once there is no form to go back to — the account already exists. */
  onBack: (() => void) | null;
  onChoose: (migrate: boolean) => void;
}) {
  const signingIn = variant === "signin";
  const summary = summarizeState(deviceState);

  return (
    <div className="auth-body">
      <h2 className="auth-title">
        {signingIn
          ? "Your account is empty. Fill it from this device?"
          : "Bring your local data along?"}
      </h2>
      <p className="auth-lede">
        {signingIn ? (
          <>
            {username ? (
              <>
                Signed in as <strong>{username}</strong> — that account
              </>
            ) : (
              <>Your account</>
            )}{" "}
            has nothing in it yet, and this browser is holding{" "}
            <strong>{summary}</strong>.
          </>
        ) : (
          <>
            This browser is holding <strong>{summary}</strong> from before you had
            an account.
          </>
        )}
      </p>

      {error && (
        <div className="banner danger" role="alert">
          {error}
        </div>
      )}

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
          aria-label={
            signingIn
              ? "Leave my local data on this device"
              : "Start fresh and leave my local data on this device"
          }
          disabled={busy}
          onClick={() => onChoose(false)}
        >
          <span className="auth-choice-title">
            {signingIn ? "Leave it on this device" : "Start fresh"}
          </span>
          <span className="auth-choice-sub">
            {signingIn
              ? "The account stays empty. This device keeps its copy, and you'll see it again when you sign out."
              : "The account begins empty. This device keeps its copy, and you'll see it again when you sign out."}
          </span>
        </button>
      </div>

      <div className="auth-foot">
        {onBack && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onBack}>
            ← Back
          </button>
        )}
        <div className="spacer" />
        {busy && (
          <span className="hint">
            {signingIn ? "Moving your data…" : "Creating your account…"}
          </span>
        )}
      </div>
    </div>
  );
}
