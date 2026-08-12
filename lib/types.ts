import { DateKey } from "./dates";

export type Task = {
  id: string;
  title: string;
  description: string;
  dueDate: DateKey;
  completed: boolean;
  createdAt: string;
  completedAt: string | null;
};

export type Recommendation = {
  /** null means the hidden "Rest" task was drawn. */
  taskId: string | null;
  /** Snapshot of the title so a deleted task still renders sensibly. */
  title: string;
  generatedAt: string;
};

export type ScheduleBlock = {
  start: string;
  end: string;
  taskId: string | null;
  title: string;
};

export type Schedule = {
  blocks: ScheduleBlock[];
  generatedAt: string;
  /** Calendar day the schedule was built for. */
  dayKey: DateKey;
  /** Fingerprint of the task list at generation time. */
  signature: string;
  endTime: string;
};
