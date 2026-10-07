import { pruneCompletedTasks, scheduleCompletedTaskCleanup } from "./task-retention";
import type { Task } from "./types";

/** Account cleanup is server-owned; guests expire locally without a reload. */
// Inject the host's hooks: web and Expo deliberately use different React versions.
export function createTaskRetentionHook(hooks: { useEffect: (effect: () => void | (() => void), deps: unknown[]) => void }) {
  return function useTaskRetention(tasks: Task[], setTasks: (value: Task[] | ((current: Task[]) => Task[])) => void, enabled: boolean): void {
    hooks.useEffect(() => {
      if (!enabled) return;
      const retained = pruneCompletedTasks(tasks);
      if (retained !== tasks) { setTasks(retained); return; }
      return scheduleCompletedTaskCleanup(tasks, () => setTasks(current => pruneCompletedTasks(current)));
    }, [tasks, setTasks, enabled]);
  };
}
