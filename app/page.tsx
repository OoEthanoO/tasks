"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QuickAdd from "@/components/QuickAdd";
import RecommendationCard from "@/components/RecommendationCard";
import SchedulePanel from "@/components/SchedulePanel";
import TaskList from "@/components/TaskList";
import { formatDueDate, todayKey } from "@/lib/dates";
import { generateSchedule, scheduleStaleReason } from "@/lib/schedule";
import { newId, storage } from "@/lib/storage";
import { Recommendation, Schedule, Task } from "@/lib/types";
import {
  REST_LABEL,
  buildWeightTable,
  formatProbability,
  pickWeighted,
} from "@/lib/weights";

export default function Page() {
  const [mounted, setMounted] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [endTime, setEndTime] = useState("23:00");
  const [now, setNow] = useState(() => new Date());
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Hydrate from localStorage after mount so server and client markup match.
  useEffect(() => {
    setTasks(storage.loadTasks());
    setRecommendation(storage.loadRecommendation());
    setSchedule(storage.loadSchedule());
    setEndTime(storage.loadEndTime());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) storage.saveTasks(tasks);
  }, [tasks, mounted]);
  useEffect(() => {
    if (mounted) storage.saveRecommendation(recommendation);
  }, [recommendation, mounted]);
  useEffect(() => {
    if (mounted) storage.saveSchedule(schedule);
  }, [schedule, mounted]);
  useEffect(() => {
    if (mounted) storage.saveEndTime(endTime);
  }, [endTime, mounted]);

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
    () => scheduleStaleReason(schedule, tasks, today),
    [schedule, tasks, today],
  );

  const addTask = useCallback(
    (input: { title: string; description: string; dueDate: string }) => {
      const task: Task = {
        id: newId(),
        title: input.title,
        description: input.description,
        dueDate: input.dueDate,
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

  // The table is read through a ref so the hotkey handler never goes stale.
  const tableRef = useRef(table);
  tableRef.current = table;

  const recommend = useCallback(() => {
    const picked = pickWeighted(tableRef.current);
    setRecommendation({
      taskId: picked ? picked.id : null,
      title: picked ? picked.title : REST_LABEL,
      generatedAt: new Date().toISOString(),
    });
  }, []);

  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const endTimeRef = useRef(endTime);
  endTimeRef.current = endTime;

  const regenerateSchedule = useCallback(() => {
    setSchedule(
      generateSchedule(tasksRef.current, tableRef.current, endTimeRef.current, new Date()),
    );
  }, []);

  // Global hotkeys. Typing in a field always wins over a shortcut.
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
      if (typing || quickAddOpen) return;

      const key = e.key.toLowerCase();
      if (key === "q") {
        e.preventDefault();
        setQuickAddOpen(true);
      } else if (key === "r") {
        e.preventDefault();
        recommend();
      } else if (key === "g") {
        e.preventDefault();
        regenerateSchedule();
      } else if (e.key === "?") {
        e.preventDefault();
        setHelpOpen((v) => !v);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [quickAddOpen, recommend, regenerateSchedule]);

  const probabilityOf = useCallback(
    (taskId: string) =>
      table.entries.find((e) => e.task.id === taskId)?.probability ?? 0,
    [table],
  );

  const openCount = tasks.filter((t) => !t.completed).length;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <h1>
            YanTasks<span className="dot">.</span>
          </h1>
          <span className="tagline">weighted task roulette</span>
        </div>
        <div className="topbar-actions">
          <span className="today-chip">
            {mounted ? formatDueDate(today, today) + " · " + formatFullDate(today) : "…"}
          </span>
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

      <div className="columns">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">
              Tasks {mounted && openCount > 0 && <span>· {openCount} open</span>}
            </h2>
            <span className="hint">
              Rest holds {formatProbability(table.restProbability)}
            </span>
          </div>

          {mounted ? (
            <TaskList
              entries={table.entries}
              today={today}
              maxProbability={maxProbability}
              onToggle={toggleTask}
              onDelete={deleteTask}
              onUpdate={updateTask}
            />
          ) : (
            <div className="empty">Loading…</div>
          )}

          {mounted && tasks.length > 0 && (
            <div className="stats">
              <span>
                Total weight <b>{table.total.toFixed(3)}</b>
              </span>
              <span>
                Tasks <b>{table.taskTotal.toFixed(3)}</b>
              </span>
              <span>
                Rest <b>0.143</b>
              </span>
            </div>
          )}
        </section>

        <div className="stack">
          <RecommendationCard
            recommendation={mounted ? recommendation : null}
            tasks={tasks}
            today={today}
            probabilityOf={probabilityOf}
            onRecommend={recommend}
            canRecommend={mounted}
          />

          <SchedulePanel
            schedule={mounted ? schedule : null}
            tasks={tasks}
            endTime={endTime}
            now={now}
            staleReason={staleReason}
            onEndTimeChange={setEndTime}
            onGenerate={regenerateSchedule}
          />
        </div>
      </div>

      {quickAddOpen && (
        <QuickAdd onCreate={addTask} onClose={() => setQuickAddOpen(false)} />
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
            <span className="kbd">R</span> Draw a recommendation
          </li>
          <li>
            <span className="kbd">G</span> Generate today&apos;s schedule
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
              Completed: <code>0</code>. Hidden <code>Rest</code> task: always{" "}
              <code>1/7</code>.
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
