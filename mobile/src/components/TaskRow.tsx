import { Pressable, Text, View } from "react-native";
import { DateKey, formatDueDate } from "../../../lib/dates";
import { dueBucket, type TaskMoveDirection } from "../../../lib/grouping";
import { TaskProgress, formatDuration } from "../../../lib/tracking";
import { Task } from "../../../lib/types";
import { themed, useStyles, useTheme } from "../theme";

export default function TaskRow({
  task,
  today,
  progress,
  active,
  onToggle,
  onEdit,
  canMoveUp,
  canMoveDown,
  onMove,
}: {
  task: Task;
  today: DateKey;
  progress?: TaskProgress;
  active: boolean;
  onToggle: () => void;
  onEdit: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: TaskMoveDirection) => void;
}) {
  const { c } = useTheme();
  const s = useStyles(styles);
  const dueColor = { overdue: c.danger, today: c.warn, upcoming: c.dim, done: c.faint }[dueBucket(task, today)];

  return (
    <View style={[s.row, active && !task.completed && s.active]}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: task.completed }}
        accessibilityLabel={task.completed ? `Reopen ${task.title}` : `Complete ${task.title}`}
        style={({ pressed }) => [s.checkTarget, pressed && s.pressed]}
      >
        <View style={[s.check, task.completed && s.checkDone]}>
          {task.completed && <Text style={s.checkMark}>✓</Text>}
        </View>
      </Pressable>

      <View style={s.main}>
        <Text style={[s.title, task.completed && s.titleDone]} numberOfLines={2}>
          {task.title}
        </Text>
        {task.description ? <Text style={s.desc} numberOfLines={2}>{task.description}</Text> : null}
        <View style={s.meta}>
          <Text style={[s.metaText, { color: dueColor }]}>{formatDueDate(task.dueDate, today)}</Text>
          {progress && <Text style={s.metaText}>· {formatDuration(progress.trackedMs)} today</Text>}
        </View>
        {progress && !task.completed && (active || progress.partialTurn) && (
          <Text style={[s.metaText, active && s.currentTurn]}>
            {active ? "Tracking" : "Paused"} · {formatDuration(progress.remainingMs, true)} left of {formatDuration(progress.turnDurationMs, true)}
          </Text>
        )}
      </View>

      <View style={s.actions}>
        <Pressable
          onPress={onEdit}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${task.title}`}
          style={({ pressed }) => [s.edit, pressed && s.pressed]}
        >
          <Text style={s.editText}>Edit</Text>
        </Pressable>
        {(canMoveUp || canMoveDown) && (
          <View style={s.order}>
            {(["up", "down"] as const).map(direction => {
              const disabled = direction === "up" ? !canMoveUp : !canMoveDown;
              return (
                <Pressable
                  key={direction}
                  onPress={() => onMove(direction)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${task.title} ${direction}`}
                  accessibilityHint="Reorders tasks with the same due date"
                  accessibilityState={{ disabled }}
                  style={({ pressed }) => [s.edit, disabled && s.disabled, pressed && s.pressed]}
                >
                  <Text style={s.arrow}>{direction === "up" ? "↑" : "↓"}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = themed(c => ({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 12,
    borderLeftWidth: 3,
    borderLeftColor: "transparent",
    borderBottomWidth: 1,
    borderBottomColor: c.lineSoft,
  },
  active: { borderLeftColor: c.accent, backgroundColor: c.elev2 },
  checkTarget: { width: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: c.line,
    alignItems: "center",
    justifyContent: "center",
  },
  checkDone: { backgroundColor: c.accent, borderColor: c.accent },
  checkMark: { color: c.onAccent, fontSize: 13, fontWeight: "800", lineHeight: 16 },
  main: { flex: 1, minWidth: 0, gap: 4 },
  title: { color: c.text, fontSize: 16, fontWeight: "600" },
  titleDone: { color: c.faint, textDecorationLine: "line-through" },
  desc: { color: c.dim, fontSize: 13, lineHeight: 18 },
  meta: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  metaText: { color: c.faint, fontSize: 12, lineHeight: 18 },
  currentTurn: { color: c.accentText },
  actions: { alignItems: "flex-end" },
  order: { flexDirection: "row" },
  arrow: { color: c.accentText, fontSize: 20 },
  disabled: { opacity: 0.25 },
  edit: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  editText: { color: c.accentText, fontSize: 13, fontWeight: "600" },
  pressed: { opacity: 0.7 },
}));
