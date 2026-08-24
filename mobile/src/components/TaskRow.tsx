import { Pressable, Text, View } from "react-native";
import { DateKey, describeDelta, formatDueDate } from "../../../lib/dates";
import { dueBucket } from "../../../lib/grouping";
import {
  WeightedTask,
  formatProbability,
  formatWeight,
} from "../../../lib/weights";
import { radius, themed, useStyles, useTheme } from "../theme";

export default function TaskRow({
  entry,
  today,
  maxProbability,
  onToggle,
  onEdit,
}: {
  entry: WeightedTask;
  today: DateKey;
  maxProbability: number;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const { c } = useTheme();
  const s = useStyles(styles);
  const { task, weight, probability } = entry;
  const DUE_COLOR = { overdue: c.danger, today: c.warn, upcoming: c.dim, done: c.faint };
  const dueColor = DUE_COLOR[dueBucket(task, today)];

  const barWidth =
    maxProbability > 0 ? Math.max(3, (probability / maxProbability) * 100) : 0;

  return (
    <Pressable
      onPress={onEdit}
      accessibilityRole="button"
      accessibilityLabel={`Edit ${task.title}`}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: c.elev2 }]}
    >
      <Pressable
        onPress={onToggle}
        hitSlop={10}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: task.completed }}
        accessibilityLabel={
          task.completed ? `Reopen ${task.title}` : `Complete ${task.title}`
        }
        style={[s.check, task.completed && s.checkDone]}
      >
        {task.completed ? <Text style={s.checkMark}>✓</Text> : null}
      </Pressable>

      <View style={s.main}>
        <Text
          style={[s.title, task.completed && s.titleDone]}
          numberOfLines={2}
        >
          {task.title}
        </Text>
        {task.description ? (
          <Text style={s.desc} numberOfLines={2}>
            {task.description}
          </Text>
        ) : null}
        <View style={s.meta}>
          <Text style={[s.metaText, { color: dueColor }]}>
            {formatDueDate(task.dueDate, today)}
          </Text>
          {!task.completed && (
            <>
              <Text style={s.sep}>·</Text>
              <Text style={s.metaText}>{describeDelta(task.dueDate, today)}</Text>
              <Text style={s.sep}>·</Text>
              <Text style={s.metaText}>weight {formatWeight(weight)}</Text>
            </>
          )}
        </View>
      </View>

      <View style={s.prob}>
        <Text
          style={[s.probValue, probability <= 0 && { color: c.faint }]}
          accessibilityLabel={
            task.completed
              ? "Completed tasks are never picked"
              : `${formatProbability(probability)} chance of being drawn`
          }
        >
          {task.completed ? "—" : formatProbability(probability)}
        </Text>
        {!task.completed && (
          <View style={s.probBar}>
            <View style={[s.probFill, { width: `${barWidth}%` }]} />
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = themed((c) => ({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: c.lineSoft,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: c.line,
    marginTop: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  checkDone: { backgroundColor: c.accent, borderColor: c.accent },
  checkMark: { color: c.onAccent, fontSize: 13, fontWeight: "800", lineHeight: 16 },
  main: { flex: 1, gap: 3 },
  title: { color: c.text, fontSize: 16, fontWeight: "600" },
  titleDone: { color: c.faint, textDecorationLine: "line-through" },
  desc: { color: c.dim, fontSize: 13, lineHeight: 18 },
  meta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 5 },
  metaText: { color: c.faint, fontSize: 12 },
  sep: { color: c.line, fontSize: 12 },
  prob: { alignItems: "flex-end", gap: 5, minWidth: 56 },
  probValue: {
    color: c.text,
    fontSize: 14,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  probBar: {
    width: 48,
    height: 3,
    borderRadius: radius.sm,
    backgroundColor: c.line,
    overflow: "hidden",
  },
  probFill: { height: 3, backgroundColor: c.accent },
}));
