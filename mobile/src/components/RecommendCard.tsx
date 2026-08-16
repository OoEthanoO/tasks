import { StyleSheet, Text, View } from "react-native";
import { DateKey, describeDelta, formatDateTime, formatDueDate } from "../../../lib/dates";
import { Recommendation, Task } from "../../../lib/types";
import { REST_LABEL, formatProbability } from "../../../lib/weights";
import { c } from "../theme";
import { Btn, Card, CardHead } from "./ui";

export default function RecommendCard({
  recommendation,
  tasks,
  today,
  probabilityOf,
  onRecommend,
  canRecommend,
}: {
  recommendation: Recommendation | null;
  tasks: Task[];
  today: DateKey;
  probabilityOf: (taskId: string) => number;
  onRecommend: () => void;
  canRecommend: boolean;
}) {
  const task = recommendation?.taskId
    ? (tasks.find((t) => t.id === recommendation.taskId) ?? null)
    : null;
  const isRest = recommendation !== null && recommendation.taskId === null;
  const wasDeleted = recommendation?.taskId != null && task === null;

  return (
    <Card>
      <CardHead
        title="Up next"
        right={
          <Btn
            label={recommendation ? "Draw again" : "Recommend"}
            tone="primary"
            onPress={onRecommend}
            disabled={!canRecommend}
          />
        }
      />

      {!recommendation ? (
        <View style={s.body}>
          <Text style={s.empty}>
            No recommendation yet — tap Recommend to spin the wheel.
          </Text>
        </View>
      ) : (
        <View style={s.body}>
          <Text style={s.label}>{isRest ? "TAKE A BREAK" : "WORK ON THIS"}</Text>
          <Text style={[s.title, isRest && { color: c.ok }]}>
            {isRest ? REST_LABEL : recommendation.title}
          </Text>

          {task?.description ? <Text style={s.desc}>{task.description}</Text> : null}

          <View style={s.meta}>
            {task && (
              <>
                <Text style={s.metaText}>
                  Due {formatDueDate(task.dueDate, today).toLowerCase()}
                </Text>
                <Text style={s.metaText}>{describeDelta(task.dueDate, today)}</Text>
                <Text style={s.metaText}>
                  {formatProbability(probabilityOf(task.id))} chance
                </Text>
              </>
            )}
            {isRest && (
              <Text style={s.metaText}>
                The hidden Rest task came up — step away for a bit.
              </Text>
            )}
            <Text style={[s.metaText, { color: c.faint }]}>
              Drawn {formatDateTime(recommendation.generatedAt)}
            </Text>
          </View>

          {wasDeleted && <Text style={s.note}>This task has since been deleted.</Text>}
          {task?.completed && (
            <Text style={s.note}>You have completed this one — draw again.</Text>
          )}
        </View>
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  body: { gap: 6, paddingVertical: 4 },
  empty: { color: c.dim, fontSize: 14, paddingVertical: 18, textAlign: "center" },
  label: { color: c.faint, fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  title: { color: c.text, fontSize: 24, fontWeight: "800", lineHeight: 30 },
  desc: { color: c.dim, fontSize: 14, lineHeight: 20 },
  meta: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 4 },
  metaText: { color: c.dim, fontSize: 12 },
  note: { color: c.warn, fontSize: 12, marginTop: 6 },
});
