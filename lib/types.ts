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

/**
 * Advanced rest: the kinds a rest block can turn out to be.
 *
 * This never touches how often Rest is drawn — see REST_WEIGHT. It only splits
 * a slice that has already been won, so turning it on changes what rest looks
 * like, not how much of it you get.
 */
export type RestMode = {
  /** When false every rest block reads simply "Rest", and `types` is kept. */
  advanced: boolean;
  /** Drawn evenly: two types are 50/50, three are a third each. */
  types: string[];
};

export type User = {
  id: string;
  username: string;
  createdAt: string;
};

/**
 * Everything the app persists for one user. Guest mode keeps this in
 * localStorage; a signed-in user keeps it on the server.
 */
export type AppState = {
  tasks: Task[];
  recommendation: Recommendation | null;
  schedule: Schedule | null;
  endTime: string;
  restMode: RestMode;
};
