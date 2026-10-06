import { View } from "react-native";
import { DateKey } from "../../../lib/dates";
import { groupTasks } from "../../../lib/grouping";
import { Task } from "../../../lib/types";
import { TaskProgress } from "../../../lib/tracking";
import TaskRow from "./TaskRow";
import { Empty, GroupLabel } from "./ui";

export default function TaskListView({
  entries,
  today,
  showProgress,
  activeId,
  onToggle,
  onEdit,
}: {
  entries: TaskProgress[];
  today: DateKey;
  showProgress: boolean;
  activeId: string | null;
  onToggle: (id: string) => void;
  onEdit: (task: Task) => void;
}) {
  if (entries.length === 0) {
    return <Empty lines={["No tasks yet.", "Tap + to add your first one."]} />;
  }
  const progressById = new Map(entries.map(entry => [entry.task.id, entry]));

  return (
    <View>
      {groupTasks(entries, today).map((group) => (
        <View key={group.key}>
          <GroupLabel label={group.label} count={group.items.length} tone={group.tone} />
          {group.items.map((entry) => (
            <TaskRow
              key={entry.task.id}
              task={entry.task}
              today={today}
              progress={showProgress ? progressById.get(entry.task.id) : undefined}
              active={activeId === entry.task.id}
              onToggle={() => onToggle(entry.task.id)}
              onEdit={() => onEdit(entry.task)}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
