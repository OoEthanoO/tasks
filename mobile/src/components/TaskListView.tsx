import { View } from "react-native";
import { DateKey } from "../../../lib/dates";
import { groupTasks } from "../../../lib/grouping";
import { Task } from "../../../lib/types";
import { WeightedTask } from "../../../lib/weights";
import { TaskProgress } from "../../../lib/tracking";
import TaskRow from "./TaskRow";
import { Empty, GroupLabel } from "./ui";

export default function TaskListView({
  entries,
  today,
  maxProbability,
  progress,
  activeId,
  trackingDisabled,
  onTrack,
  onToggle,
  onEdit,
}: {
  entries: WeightedTask[];
  today: DateKey;
  maxProbability: number;
  progress: TaskProgress[];
  activeId: string | null;
  trackingDisabled: boolean;
  onTrack: (id: string) => void;
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
              progress={progress.find(p => p.task.id === entry.task.id)}
              active={activeId === entry.task.id}
              trackingDisabled={trackingDisabled}
              onTrack={() => onTrack(entry.task.id)}
              onToggle={() => onToggle(entry.task.id)}
              onEdit={() => onEdit(entry.task)}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
