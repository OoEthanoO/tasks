import { View } from "react-native";
import { DateKey, diffDays } from "../../../lib/dates";
import { Task } from "../../../lib/types";
import { WeightedTask } from "../../../lib/weights";
import TaskRow from "./TaskRow";
import { Empty, GroupLabel } from "./ui";

type Group = {
  key: string;
  label: string;
  tone?: "overdue";
  items: WeightedTask[];
};

/** Same four buckets, in the same order, as the web list. */
function groupTasks(entries: WeightedTask[], today: DateKey): Group[] {
  const overdue: WeightedTask[] = [];
  const dueToday: WeightedTask[] = [];
  const upcoming: WeightedTask[] = [];
  const done: WeightedTask[] = [];

  for (const entry of entries) {
    if (entry.task.completed) {
      done.push(entry);
      continue;
    }
    const delta = diffDays(entry.task.dueDate, today);
    if (delta < 0) overdue.push(entry);
    else if (delta === 0) dueToday.push(entry);
    else upcoming.push(entry);
  }

  const byDue = (a: WeightedTask, b: WeightedTask) =>
    a.task.dueDate.localeCompare(b.task.dueDate) ||
    a.task.createdAt.localeCompare(b.task.createdAt);

  overdue.sort(byDue);
  dueToday.sort(byDue);
  upcoming.sort(byDue);
  done.sort((a, b) => (b.task.completedAt ?? "").localeCompare(a.task.completedAt ?? ""));

  return [
    { key: "overdue", label: "Overdue", tone: "overdue" as const, items: overdue },
    { key: "today", label: "Today", items: dueToday },
    { key: "upcoming", label: "Upcoming", items: upcoming },
    { key: "done", label: "Completed", items: done },
  ].filter((g) => g.items.length > 0);
}

export default function TaskListView({
  entries,
  today,
  maxProbability,
  onToggle,
  onEdit,
}: {
  entries: WeightedTask[];
  today: DateKey;
  maxProbability: number;
  onToggle: (id: string) => void;
  onEdit: (task: Task) => void;
}) {
  if (entries.length === 0) {
    return <Empty lines={["No tasks yet.", "Tap + to add your first one."]} />;
  }

  return (
    <View>
      {groupTasks(entries, today).map((group) => (
        <View key={group.key}>
          <GroupLabel label={group.label} count={group.items.length} tone={group.tone} />
          {group.items.map((entry) => (
            <TaskRow
              key={entry.task.id}
              entry={entry}
              today={today}
              maxProbability={maxProbability}
              onToggle={() => onToggle(entry.task.id)}
              onEdit={() => onEdit(entry.task)}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
