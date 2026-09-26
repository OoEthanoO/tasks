"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AccountMenu from "@/components/AccountMenu";
import AuthDialog from "@/components/AuthDialog";
import QuickAdd from "@/components/QuickAdd";
import TrackingPanel from "@/components/TrackingPanel";
import { useTracking } from "@/components/useTracking";
import { restOwed, taskProgress } from "@/lib/tracking";
import TaskList from "@/components/TaskList";
import ThemeToggle from "@/components/ThemeToggle";
import { DEFAULT_END_TIME, emptyState, shouldOfferMigration } from "@/lib/app-state";
import { DEFAULT_REST, RestSettings } from "@/lib/rest";
import { formatDueDate, todayKey } from "@/lib/dates";
import { ApiError, api, getStateRefreshInterval } from "@/lib/remote";
import { localStore, newId } from "@/lib/storage";
import { shouldAdoptRemote } from "@/lib/sync";
import { AppState, Priority, Recommendation, Schedule, Task, User } from "@/lib/types";

/** Identifies which store the in-memory state belongs to. */
function storeKey(user: User | null): string {
  return user ? `remote:${user.id}` : "local";
}

const SAVE_DEBOUNCE_MS = 500;

export default function Page() {
  const [ready, setReady] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [endTime, setEndTime] = useState(DEFAULT_END_TIME);
  const [rest, setRest] = useState<RestSettings>({ ...DEFAULT_REST });
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const [account, setAccount] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authDialog, setAuthDialog] = useState<"signin" | "signup" | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Which store the current state came from, and what was last written to it.
  // Together these stop a load from echoing straight back out as a save, and
  // stop guest data from being written into an account (or the reverse).
  const loadedForRef = useRef<string | null>(null);
  const lastSavedRef = useRef<string | null>(null);

  const applyState = useCallback((state: AppState, key: string) => {
    setTasks(state.tasks);
    setRecommendation(state.recommendation);
    setSchedule(state.schedule);
    setEndTime(state.endTime);
    setRest(state.rest);
    loadedForRef.current = key;
    lastSavedRef.current = JSON.stringify(state);
    setReady(true);
  }, []);

  // Decide where this browser's data lives, then load it.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      let user: User | null = null;
      try {
        user = await api.me();
      } catch {
        // Server unreachable — carry on as a guest rather than showing nothing.
      }
      if (cancelled) return;

      if (user) {
        try {
          const state = await api.loadState();
          if (cancelled) return;
          setAccount(user);
          applyState(state, storeKey(user));
          setAuthLoading(false);
          return;
        } catch {
          if (cancelled) return;
        }
      }

      setAccount(null);
      applyState(localStore.load(), storeKey(null));
      setAuthLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [applyState]);

  /* ---------- persistence ---------- */

  const pendingRef = useRef<AppState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read by callbacks that outlive the render they were created in — the
  // refresh poller and the save flush both need the current values, not the
  // ones captured when they were defined.
  const accountRef = useRef<User | null>(account);
  accountRef.current = account;
  const syncingRef = useRef(false);
  syncingRef.current = syncing;

  const flushRemote = useCallback(
    async (opts: { keepalive?: boolean } = {}) => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const state = pendingRef.current;
      if (!state) return;
      pendingRef.current = null;

      setSyncing(true);
      try {
        await api.saveState(state, opts);
        lastSavedRef.current = JSON.stringify(state);
        setSyncError(null);
      } catch (error) {
        // A dead session must not keep silently dropping edits on the floor.
        if (error instanceof ApiError && error.status === 401) {
          setAccount(null);
          applyState(localStore.load(), storeKey(null));
          setNotice("Your session expired. You're working on this device again.");
          return;
        }
        // Put the state back so it is still queued: without this the edits are
        // dropped on the floor and the Retry button has nothing to send, which
        // makes it look like retrying does nothing at all.
        pendingRef.current = state;
        setSyncError(
          error instanceof Error ? error.message : "Could not save to your account.",
        );
      } finally {
        setSyncing(false);
      }
    },
    [applyState],
  );

  useEffect(() => {
    if (!ready) return;

    const key = storeKey(account);
    // Ignore the render in between swapping stores.
    if (loadedForRef.current !== key) return;

    const state: AppState = { tasks, recommendation, schedule, endTime, rest };
    const serialized = JSON.stringify(state);
    if (serialized === lastSavedRef.current) return;

    if (!account) {
      localStore.save(state);
      lastSavedRef.current = serialized;
      return;
    }

    pendingRef.current = state;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flushRemote(), SAVE_DEBOUNCE_MS);
  }, [tasks, recommendation, schedule, endTime, rest, ready, account, flushRemote]);

  /**
   * Pull the account's copy back down, so edits made on the phone (or another
   * tab) show up here without a reload. Runs when the tab is looked at again
   * and on a slow timer while it is visible — a poll rather than a push,
   * because the server is serverless and has nowhere to hold a connection.
   */
  const refreshFromServer = useCallback(async () => {
    if (!accountRef.current || document.visibilityState !== "visible") return;

    let remote: AppState;
    try {
      remote = await api.loadState();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAccount(null);
        applyState(localStore.load(), storeKey(null));
        setNotice("Your session expired. You're working on this device again.");
      }
      // Anything else is a bad moment on the network; the next tick tries again.
      return;
    }

    const account = accountRef.current;
    if (!account) return;

    const serialized = JSON.stringify(remote);
    if (
      !shouldAdoptRemote({
        hasPendingWrite: pendingRef.current !== null,
        saveInFlight: syncingRef.current,
        local: lastSavedRef.current ?? "",
        remote: serialized,
      })
    ) {
      return;
    }

    applyState(remote, storeKey(account));
    setNotice("Updated with changes from another device.");
  }, [applyState]);

  useEffect(() => {
    if (!account) return;

    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshFromServer();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const id = setInterval(() => void refreshFromServer(), getStateRefreshInterval());

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      clearInterval(id);
    };
  }, [account, refreshFromServer]);

  // Don't lose the tail of a debounce when the tab goes away.
  useEffect(() => {
    if (!account) return;
    const onHide = () => {
      if (pendingRef.current) void flushRemote({ keepalive: true });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [account, flushRemote]);

  /* ---------- accounts ---------- */

  const stateRef = useRef<AppState>(emptyState());
  stateRef.current = { tasks, recommendation, schedule, endTime, rest };

  const signIn = useCallback(
    async (username: string, password: string) => {
      // Read the device copy before signing in swaps the active store. Signing
      // in never writes to localStorage, so it is still there afterwards.
      const local = localStore.load();
      const { user, state } = await api.signIn(username, password);
      setAccount(user);
      applyState(state, storeKey(user));
      setSyncError(null);

      if (shouldOfferMigration(state, local)) {
        // Leave the dialog open on the migrate step rather than announcing a
        // sign-in the user is about to make a decision about.
        return { needsMigrationChoice: true };
      }

      setNotice(`Signed in as ${user.username}.`);
      return { needsMigrationChoice: false };
    },
    [applyState],
  );

  /** Answer to "your account is empty — fill it from this device?". */
  const adoptLocal = useCallback(
    async (migrate: boolean) => {
      const user = accountRef.current;
      if (!user) return;

      if (!migrate) {
        setNotice(
          `Signed in as ${user.username}. Your device copy stayed where it was.`,
        );
        return;
      }

      const local = localStore.load();
      await api.saveState(local);
      // Only clear the device copy once the server confirms it took it.
      localStore.clear();
      applyState(local, storeKey(user));
      setSyncError(null);
      setNotice(`Your local data moved into ${user.username}'s account.`);
    },
    [applyState],
  );

  const signUp = useCallback(
    async (username: string, password: string, migrate: boolean) => {
      const { user, state, migrated } = await api.signUp({
        username,
        password,
        importState: migrate ? { ...stateRef.current, tracking: localStore.load().tracking } : null,
      });
      // Only clear the device copy once the server confirms it took it.
      if (migrated) localStore.clear();

      setAccount(user);
      applyState(state, storeKey(user));
      setSyncError(null);
      setNotice(
        migrated
          ? `Welcome, ${user.username} — your local data moved into the account.`
          : `Welcome, ${user.username}.`,
      );
    },
    [applyState],
  );

  /**
   * Erase the account outright — the same deletion the iOS app offers, which
   * App Store guideline 5.1.1(v) requires to exist in the app itself. The
   * pending save is dropped first so an in-flight write cannot recreate rows
   * for a user who no longer exists.
   */
  const deleteAccount = useCallback(async () => {
    const user = accountRef.current;
    if (!user) return;
    if (
      !window.confirm(
        `Permanently delete ${user.username}? Every task, your tracked time and your ` +
          `sign-in are erased from the server. This cannot be undone.`,
      )
    ) {
      return;
    }

    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;

    try {
      await api.deleteAccount();
    } catch (error) {
      setSyncError(
        error instanceof Error ? error.message : "Could not delete the account.",
      );
      return;
    }

    setAccount(null);
    setSyncError(null);
    applyState(localStore.load(), storeKey(null));
    setNotice("Your account and everything in it were deleted.");
  }, [applyState]);

  const signOut = useCallback(async () => {
    await flushRemote();
    try {
      await api.signOut();
    } catch {
      // The cookie may already be gone; drop to guest mode either way.
    }
    setAccount(null);
    setSyncError(null);
    applyState(localStore.load(), storeKey(null));
    setNotice("Signed out. You're back to the data saved on this device.");
  }, [applyState, flushRemote]);

  /* ---------- task state ---------- */

  const beforeTrack = useCallback(async () => {
    if (!account) return;
    await flushRemote();
    if (pendingRef.current || syncingRef.current) throw new Error("Wait for your task changes to sync, then try again.");
  }, [account, flushRemote]);
  const tracker = useTracking(tasks, endTime, rest, account?.id ?? null, ready && !authLoading, beforeTrack);
  const today = tracker.state.dayKey;
  const entries = taskProgress({ ...tracker.state, tasks, endTime, rest });
  const table = { entries, taskTotal: entries.reduce((sum, e) => sum + e.weight, 0) };
  const maxProbability = Math.max(0, ...entries.map(e => e.probability));

  const addTask = useCallback(
    (input: { title: string; description: string; dueDate: string; priority: Priority }) => {
      const task: Task = {
        id: newId(),
        title: input.title,
        description: input.description,
        dueDate: input.dueDate,
        priority: input.priority,
        completed: false,
        createdAt: new Date().toISOString(),
        completedAt: null,
      };
      setTasks((prev) => [...prev, task]);
    },
    [],
  );

  const toggleTask = useCallback((id: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              completed: !t.completed,
              completedAt: t.completed ? null : new Date().toISOString(),
            }
          : t,
      ),
    );
  }, []);

  const deleteTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const updateTask = useCallback((id: string, patch: Partial<Task>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  // Global hotkeys. Typing in a field always wins over a shortcut.
  const modalOpen = quickAddOpen || authDialog !== null;
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if (e.key === "Escape") {
        setQuickAddOpen(false);
        setHelpOpen(false);
        return;
      }
      if (typing || modalOpen) return;

      const key = e.key.toLowerCase();
      if (key === "q") {
        e.preventDefault();
        setQuickAddOpen(true);
      } else if (key === "g") {
        e.preventDefault();
        void tracker.command({ type: tracker.state.mode === "idle" ? "start" : "pause" });
      } else if (e.key === "?") {
        e.preventDefault();
        setHelpOpen((v) => !v);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalOpen, tracker.command, tracker.state.mode]);

  // Notices are informational; they should not pile up.
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(id);
  }, [notice]);

  const openCount = tasks.filter((t) => !t.completed).length;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <h1>
            YanTasks<span className="dot">.</span>
          </h1>
          <span className="tagline">weighted work tracker</span>
        </div>
        <div className="topbar-actions">
          <span className="today-chip">
            {ready ? formatDueDate(today, today) + " · " + formatFullDate(today) : "…"}
          </span>
          <ThemeToggle />
          <AccountMenu
            user={account}
            loading={authLoading}
            syncing={syncing}
            syncError={syncError}
            onSignIn={() => setAuthDialog("signin")}
            onSignUp={() => setAuthDialog("signup")}
            onSignOut={() => void signOut()}
            onDeleteAccount={() => void deleteAccount()}
          />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setHelpOpen(true)}
            title="Keyboard shortcuts"
          >
            <span className="kbd">?</span>
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setQuickAddOpen(true)}
          >
            New task <span className="kbd">Q</span>
          </button>
        </div>
      </header>

      {notice && (
        <div className="banner ok toast" role="status">
          {notice}
        </div>
      )}
      {syncError && account && (
        <div className="banner danger toast" role="alert">
          <span>
            <strong>Not saved.</strong> {syncError}
          </span>
          <div className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={() => void flushRemote()}>
            Retry
          </button>
        </div>
      )}

      <div className="columns">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">
              Tasks {ready && openCount > 0 && <span>· {openCount} open</span>}
            </h2>
            <span className="hint">
              Daily work share
            </span>
          </div>

          {ready ? (
            <TaskList
              entries={table.entries}
              today={today}
              maxProbability={maxProbability}
              progress={entries}
              activeId={tracker.state.taskId}
              trackingDisabled={!tracker.ready || tracker.busy || restOwed(tracker.state)}
              onTrack={id => void tracker.command({ type: "start", taskId: id })}
              onToggle={toggleTask}
              onDelete={deleteTask}
              onUpdate={updateTask}
            />
          ) : (
            <div className="empty">Loading…</div>
          )}

          {ready && tasks.length > 0 && (
            <div className="stats">
              <span>
                Task weight <b>{table.taskTotal.toFixed(3)}</b>
              </span>
            </div>
          )}
        </section>

        <div className="stack">
          <TrackingPanel tracker={tracker} endTime={endTime} onEndTimeChange={setEndTime} rest={rest} onRestChange={setRest} />
        </div>
      </div>

      {quickAddOpen && (
        <QuickAdd onCreate={addTask} onClose={() => setQuickAddOpen(false)} />
      )}

      {authDialog && (
        <AuthDialog
          initialMode={authDialog}
          localState={stateRef.current}
          onSignIn={signIn}
          onSignUp={signUp}
          onAdoptLocal={adoptLocal}
          onClose={() => setAuthDialog(null)}
        />
      )}

      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
    </main>
  );
}

function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="help-panel">
        <h2>Keyboard shortcuts</h2>
        <ul className="help-list">
          <li>
            <span className="kbd">Q</span> New task — type the name, trail it with a date
          </li>
          <li>
            <span className="kbd">G</span> Start or pause tracking
          </li>
          <li>
            <span className="kbd">↵</span> Create the task
          </li>
          <li>
            <span className="kbd">Esc</span> Close anything
          </li>
          <li>
            <span className="kbd">?</span> This panel
          </li>
        </ul>
        <div className="stats" style={{ marginTop: 18 }}>
          <div className="formula">
            <div>
              <strong style={{ color: "var(--text-dim)" }}>How weights work</strong>
            </div>
            <div>
              Due tomorrow or later: <code>1 / days away</code> — tomorrow 1, day after
              1/2, in 3 days 1/3.
            </div>
            <div>
              Due today or overdue: <code>2 + days overdue</code> — today 2, yesterday 3,
              day before 4.
            </div>
            <div>
              Completed: <code>0</code>.
            </div>
            <div>
              Priority multiplies it: low <code>×1</code>, medium <code>×2</code>, high{" "}
              <code>×4</code>.
            </div>
            <div>
              Open tasks divide tracked work in proportion to their weights. A task whose share would come to under 30 minutes is skipped for the day, and its time goes to more urgent tasks. Breaks follow your setting beside the end time: by default 30 minutes of rest after every 90 minutes of tracked work, or turn them off. Daily targets and time reset at midnight.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatFullDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
