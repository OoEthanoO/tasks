import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState as RNAppState,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { DEFAULT_END_TIME, emptyState, shouldOfferMigration } from "../lib/app-state";
import { formatDueDate, todayKey } from "../lib/dates";
import { ApiError, api, setApiBase } from "../lib/remote";
import { generateSchedule, scheduleStaleReason } from "../lib/schedule";
import { shouldAdoptRemote } from "../lib/sync";
import { AppState, Recommendation, Schedule, Task, User } from "../lib/types";
import { REST_WEIGHT, buildWeightTable, formatProbability } from "../lib/weights";
import AccountSheet from "./src/components/AccountSheet";
import AuthSheet from "./src/components/AuthSheet";
import ScheduleCard from "./src/components/ScheduleCard";
import TaskListView from "./src/components/TaskListView";
import TaskSheet, { TaskDraft } from "./src/components/TaskSheet";
import ThemeChip from "./src/components/ThemeChip";
import { Banner, Btn, Card, CardHead } from "./src/components/ui";
import { API_BASE } from "./src/config";
import { guestStore, newId } from "./src/store";
import { ThemeProvider, radius, themed, useStyles, useTheme } from "./src/theme";

setApiBase(API_BASE);

/** Identifies which store the in-memory state belongs to. */
function storeKey(user: User | null): string {
  return user ? `remote:${user.id}` : "local";
}

const SAVE_DEBOUNCE_MS = 500;
/** How often a foregrounded app asks whether anything changed elsewhere. */
const REFRESH_MS = 30_000;

function YanTasks() {
  const insets = useSafeAreaInsets();
  const { c, scheme } = useTheme();
  const s = useStyles(styles);

  const [ready, setReady] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [endTime, setEndTime] = useState(DEFAULT_END_TIME);
  const [now, setNow] = useState(() => new Date());

  const [account, setAccount] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authSheet, setAuthSheet] = useState<"signin" | "signup" | null>(null);
  const [accountSheet, setAccountSheet] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
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
    loadedForRef.current = key;
    lastSavedRef.current = JSON.stringify(state);
    setReady(true);
  }, []);

  // Decide where this device's data lives, then load it.
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
      applyState(await guestStore.load(), storeKey(null));
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
  // refresh poller needs the values as they are now, not as they were when it
  // was defined.
  const accountRef = useRef<User | null>(account);
  accountRef.current = account;
  const syncingRef = useRef(false);
  syncingRef.current = syncing;

  const flushRemote = useCallback(async () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const state = pendingRef.current;
    if (!state) return;
    pendingRef.current = null;

    setSyncing(true);
    try {
      await api.saveState(state);
      lastSavedRef.current = JSON.stringify(state);
      setSyncError(null);
    } catch (error) {
      // A dead session must not keep silently dropping edits on the floor.
      if (error instanceof ApiError && error.status === 401) {
        setAccount(null);
        applyState(await guestStore.load(), storeKey(null));
        setNotice("Your session expired. You're working on this device again.");
        return;
      }
      // Put it back so the next flush, or Retry, picks it up again.
      pendingRef.current = state;
      setSyncError(
        error instanceof Error ? error.message : "Could not save to your account.",
      );
    } finally {
      setSyncing(false);
    }
  }, [applyState]);

  useEffect(() => {
    if (!ready) return;

    const key = storeKey(account);
    // Ignore the render in between swapping stores.
    if (loadedForRef.current !== key) return;

    const state: AppState = { tasks, recommendation, schedule, endTime };
    const serialized = JSON.stringify(state);
    if (serialized === lastSavedRef.current) return;

    if (!account) {
      void guestStore.save(state);
      lastSavedRef.current = serialized;
      return;
    }

    pendingRef.current = state;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flushRemote(), SAVE_DEBOUNCE_MS);
  }, [tasks, recommendation, schedule, endTime, ready, account, flushRemote]);

  /**
   * Pull the account's copy back down, so edits made on the website (or another
   * phone) show up without tugging the list. Same rule as the web client: an
   * unsent edit here is newer than anything the server can return.
   */
  const refreshFromServer = useCallback(async () => {
    if (!accountRef.current) return;

    let remote: AppState;
    try {
      remote = await api.loadState();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAccount(null);
        applyState(await guestStore.load(), storeKey(null));
        setNotice("Your session expired. You're working on this device again.");
      }
      // Anything else is a bad moment on the network; the next tick retries.
      return;
    }

    const user = accountRef.current;
    if (!user) return;

    if (
      !shouldAdoptRemote({
        hasPendingWrite: pendingRef.current !== null,
        saveInFlight: syncingRef.current,
        local: lastSavedRef.current ?? "",
        remote: JSON.stringify(remote),
      })
    ) {
      return;
    }

    applyState(remote, storeKey(user));
    setNotice("Updated with changes from another device.");
  }, [applyState]);

  // Backgrounding the app is the phone's version of closing the tab: flush the
  // tail of a debounce before iOS stops giving us time to run. Coming back is
  // the moment another device's edits are most likely to be waiting.
  useEffect(() => {
    if (!account) return;

    const sub = RNAppState.addEventListener("change", (next) => {
      if (next === "active") void refreshFromServer();
      else if (pendingRef.current) void flushRemote();
    });
    const id = setInterval(() => {
      if (RNAppState.currentState === "active") void refreshFromServer();
    }, REFRESH_MS);

    return () => {
      sub.remove();
      clearInterval(id);
    };
  }, [account, flushRemote, refreshFromServer]);

  /** Pull to refresh: take the account copy as authoritative again. */
  const refresh = useCallback(async () => {
    if (!account) return;
    setRefreshing(true);
    try {
      await flushRemote();
      const state = await api.loadState();
      applyState(state, storeKey(account));
      setSyncError(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAccount(null);
        applyState(await guestStore.load(), storeKey(null));
        setNotice("Your session expired. You're working on this device again.");
      }
    } finally {
      setRefreshing(false);
    }
  }, [account, applyState, flushRemote]);

  /* ---------- accounts ---------- */

  const stateRef = useRef<AppState>(emptyState());
  stateRef.current = { tasks, recommendation, schedule, endTime };

  const [guestSnapshot, setGuestSnapshot] = useState<AppState>(emptyState());
  useEffect(() => {
    // The sheet needs the device copy up front, and reading it is async.
    if (authSheet) void guestStore.load().then(setGuestSnapshot);
  }, [authSheet]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      // Read the device copy before signing in swaps the active store. Signing
      // in never writes to the device store, so it is still there afterwards.
      const local = await guestStore.load();
      const { user, state } = await api.signIn(username, password);
      setAccount(user);
      applyState(state, storeKey(user));
      setSyncError(null);

      if (shouldOfferMigration(state, local)) {
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
        setNotice(`Signed in as ${user.username}. Your device copy stayed where it was.`);
        return;
      }

      const local = await guestStore.load();
      await api.saveState(local);
      // Only clear the device copy once the server confirms it took it.
      await guestStore.clear();
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
        importState: migrate ? stateRef.current : null,
      });
      if (migrated) await guestStore.clear();

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
   * Erase the account outright. Required by App Store guideline 5.1.1(v), and
   * the pending save is dropped first so an in-flight write cannot recreate
   * rows for a user who no longer exists.
   */
  const deleteAccount = useCallback(async () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;

    await api.deleteAccount();
    setAccount(null);
    setSyncError(null);
    applyState(await guestStore.load(), storeKey(null));
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
    applyState(await guestStore.load(), storeKey(null));
    setNotice("Signed out. You're back to the data saved on this device.");
  }, [applyState, flushRemote]);

  /* ---------- task state ---------- */

  // Keeps the "Now" block, weights, and day rollover honest without a reload.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(id);
  }, []);

  const today = useMemo(() => todayKey(), [now]);
  const table = useMemo(() => buildWeightTable(tasks, today), [tasks, today]);
  const maxProbability = useMemo(
    () => table.entries.reduce((max, e) => Math.max(max, e.probability), 0),
    [table],
  );
  const staleReason = useMemo(
    () => scheduleStaleReason(schedule, tasks, endTime, now),
    [schedule, tasks, endTime, now],
  );

  const addTask = useCallback((draft: TaskDraft) => {
    const task: Task = {
      id: newId(),
      title: draft.title,
      description: draft.description,
      dueDate: draft.dueDate,
      completed: false,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    setTasks((prev) => [...prev, task]);
  }, []);

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

  const regenerateSchedule = useCallback(() => {
    setSchedule(generateSchedule(tasks, table, endTime, new Date()));
  }, [tasks, table, endTime]);

  // Notices are informational; they should not pile up.
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(id);
  }, [notice]);

  const openCount = tasks.filter((t) => !t.completed).length;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <StatusBar
        barStyle={scheme === "light" ? "dark-content" : "light-content"}
        backgroundColor={c.bg}
      />

      <View style={s.topbar}>
        <View style={{ flex: 1 }}>
          <Text style={s.brand}>
            YanTasks<Text style={{ color: c.accent }}>.</Text>
          </Text>
          <Text style={s.tagline}>
            {ready ? formatDueDate(today, today) + " · " + fullDate(today) : "…"}
          </Text>
        </View>

        <ThemeChip />

        <Pressable
          onPress={() => (account ? setAccountSheet(true) : setAuthSheet("signin"))}
          style={s.accountChip}
          accessibilityRole="button"
          accessibilityLabel={
            account ? `Signed in as ${account.username}. Account options.` : "Sign in"
          }
        >
          <View
            style={[
              s.dot,
              {
                backgroundColor: syncError
                  ? c.danger
                  : syncing
                    ? c.warn
                    : account
                      ? c.ok
                      : c.faint,
              },
            ]}
          />
          <Text style={s.accountText}>
            {authLoading ? "…" : account ? account.username : "Sign in"}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 96 }]}
        refreshControl={
          account ? (
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.dim} />
          ) : undefined
        }
      >
        {notice && <Banner tone="ok">{notice}</Banner>}
        {syncError && account && (
          <Banner
            tone="danger"
            action={<Btn label="Retry" tone="ghost" onPress={() => void flushRemote()} />}
          >
            Not saved. {syncError}
          </Banner>
        )}
        {!account && !authLoading && (
          <Banner tone="warn">
            Working on this device only. Sign in to sync with the web app.
          </Banner>
        )}

        <ScheduleCard
          schedule={ready ? schedule : null}
          tasks={tasks}
          endTime={endTime}
          now={now}
          staleReason={staleReason}
          onEndTimeChange={setEndTime}
          onGenerate={regenerateSchedule}
        />

        <Card>
          <CardHead
            title={ready && openCount > 0 ? `Tasks · ${openCount} open` : "Tasks"}
            right={
              <Text style={s.restHint}>
                Rest holds {formatProbability(table.restProbability)}
              </Text>
            }
          />

          {ready ? (
            <TaskListView
              entries={table.entries}
              today={today}
              maxProbability={maxProbability}
              onToggle={toggleTask}
              onEdit={setEditing}
            />
          ) : (
            <Text style={s.loading}>Loading…</Text>
          )}

          {ready && tasks.length > 0 && (
            <View style={s.stats}>
              <Text style={s.stat}>Total weight {table.total.toFixed(3)}</Text>
              <Text style={s.stat}>Tasks {table.taskTotal.toFixed(3)}</Text>
              <Text style={s.stat}>Rest {REST_WEIGHT.toFixed(3)}</Text>
            </View>
          )}
        </Card>
      </ScrollView>

      <Pressable
        onPress={() => setAdding(true)}
        accessibilityRole="button"
        accessibilityLabel="New task"
        style={({ pressed }) => [
          s.fab,
          { bottom: insets.bottom + 24 },
          pressed && { opacity: 0.8 },
        ]}
      >
        <Text style={s.fabText}>+</Text>
      </Pressable>

      {adding && (
        <TaskSheet
          task={null}
          onSubmit={(draft) => {
            addTask(draft);
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      )}

      {editing && (
        <TaskSheet
          task={editing}
          onSubmit={(draft) => {
            updateTask(editing.id, draft);
            setEditing(null);
          }}
          onDelete={() => {
            deleteTask(editing.id);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {accountSheet && account && (
        <AccountSheet
          user={account}
          state={stateRef.current}
          onSignOut={signOut}
          onDeleteAccount={deleteAccount}
          onClose={() => setAccountSheet(false)}
        />
      )}

      {authSheet && (
        <AuthSheet
          initialMode={authSheet}
          localState={guestSnapshot}
          onSignIn={signIn}
          onSignUp={signUp}
          onAdoptLocal={adoptLocal}
          onClose={() => setAuthSheet(null)}
        />
      )}
    </View>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <YanTasks />
      </SafeAreaProvider>
    </ThemeProvider>
  );
}

function fullDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

const styles = themed((c) => ({
  root: { flex: 1, backgroundColor: c.bg },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.lineSoft,
    gap: 12,
  },
  brand: { color: c.text, fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  tagline: { color: c.faint, fontSize: 12, marginTop: 1 },
  accountChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.elev,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  accountText: { color: c.text, fontSize: 13, fontWeight: "600" },
  scroll: { padding: 14 },
  restHint: { color: c.faint, fontSize: 12 },
  loading: { color: c.dim, textAlign: "center", paddingVertical: 24 },
  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: c.lineSoft,
  },
  stat: { color: c.faint, fontSize: 12, fontVariant: ["tabular-nums"] },
  fab: {
    position: "absolute",
    right: 20,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: c.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: c.shadow,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  fabText: {
    color: c.onAccent,
    fontSize: 30,
    fontWeight: "500",
    lineHeight: Platform.OS === "ios" ? 34 : 36,
    marginTop: -2,
  },
}));
