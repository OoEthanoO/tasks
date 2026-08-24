import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { formatDateTime, formatTime } from "../../../lib/dates";
import { sanitizeEndTime } from "../../../lib/app-state";
import {
  StaleReason,
  indexTasks,
  resolveBlock,
  staleMessage,
} from "../../../lib/schedule";
import { Schedule, Task } from "../../../lib/types";
import { radius, themed, useStyles, useTheme } from "../theme";
import { Banner, Btn, Card, CardHead, Empty } from "./ui";

const PRESETS = ["21:00", "22:00", "23:00", "23:59"];

export default function ScheduleCard({
  schedule,
  tasks,
  endTime,
  now,
  staleReason,
  onEndTimeChange,
  onGenerate,
}: {
  schedule: Schedule | null;
  tasks: Task[];
  endTime: string;
  now: Date;
  staleReason: StaleReason;
  onEndTimeChange: (value: string) => void;
  onGenerate: () => void;
}) {
  const { c } = useTheme();
  const s = useStyles(styles);
  const byId = indexTasks(tasks);
  const [draftEnd, setDraftEnd] = useState(endTime);

  // Only the blocks that are still ahead are worth scrolling on a phone; the
  // finished ones collapse behind a count.
  const [showPast, setShowPast] = useState(false);
  const blocks = schedule?.blocks ?? [];
  const pastCount = blocks.filter((b) => new Date(b.end) <= now).length;
  const visible = showPast
    ? blocks
    : blocks.filter((b) => new Date(b.end) > now);

  function commitEndTime(value: string) {
    const clean = sanitizeEndTime(value);
    setDraftEnd(clean);
    onEndTimeChange(clean);
  }

  return (
    <Card>
      <CardHead
        title="Today's schedule"
        right={
          <Btn label={schedule ? "Regenerate" : "Generate"} onPress={onGenerate} />
        }
      />

      <View style={s.controls}>
        <Text style={s.controlLabel}>Work day ends at</Text>
        <TextInput
          style={s.timeInput}
          value={draftEnd}
          onChangeText={setDraftEnd}
          onEndEditing={(e) => commitEndTime(e.nativeEvent.text)}
          onBlur={() => commitEndTime(draftEnd)}
          keyboardType="numbers-and-punctuation"
          maxLength={5}
          accessibilityLabel="Work day end time, 24 hour clock"
        />
        <View style={s.presets}>
          {PRESETS.map((p) => (
            <Pressable
              key={p}
              onPress={() => commitEndTime(p)}
              style={[s.preset, p === endTime && s.presetActive]}
            >
              <Text style={[s.presetText, p === endTime && s.presetTextActive]}>
                {formatTime(new Date(2020, 0, 1, Number(p.slice(0, 2)), Number(p.slice(3))))}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {staleReason && (
        <Banner tone="warn">
          {`${staleMessage(staleReason)} Regenerate it for fresh picks.`}
        </Banner>
      )}

      {!schedule ? (
        <Empty lines={["No schedule yet.", "Generate one to block out the rest of your day."]} />
      ) : blocks.length === 0 ? (
        <Empty
          lines={[
            "The work day was already over when this was generated.",
            "Push the end time later and regenerate.",
          ]}
        />
      ) : (
        <>
          {!showPast && pastCount > 0 && (
            <Pressable onPress={() => setShowPast(true)} style={s.showPast}>
              <Text style={s.showPastText}>
                Show {pastCount} finished block{pastCount === 1 ? "" : "s"}
              </Text>
            </Pressable>
          )}

          <View style={s.blocks}>
            {visible.map((block) => {
              const start = new Date(block.start);
              const end = new Date(block.end);
              const isPast = end <= now;
              const isNow = !isPast && start <= now;
              const { title, isRest, isMissing } = resolveBlock(block, byId);

              return (
                <View
                  key={block.start}
                  style={[s.block, isNow && s.blockNow, isPast && s.blockPast]}
                >
                  <Text style={s.blockTime}>
                    {formatTime(start)} – {formatTime(end)}
                  </Text>
                  <Text
                    style={[
                      s.blockTask,
                      isRest && { color: c.ok },
                      isMissing && s.blockGone,
                    ]}
                    numberOfLines={1}
                  >
                    {title}
                  </Text>
                  {isNow && <Text style={s.nowTag}>NOW</Text>}
                </View>
              );
            })}
          </View>

          <View style={s.stats}>
            <Text style={s.stat}>Generated {formatDateTime(schedule.generatedAt)}</Text>
            <Text style={s.stat}>{blocks.length} blocks</Text>
            <Text style={s.stat}>
              {blocks.filter((b) => b.taskId === null).length} rest
            </Text>
          </View>
        </>
      )}
    </Card>
  );
}

const styles = themed((c) => ({
  controls: { marginBottom: 12, gap: 8 },
  controlLabel: { color: c.dim, fontSize: 13 },
  timeInput: {
    backgroundColor: c.bg,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: radius.sm,
    color: c.text,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 16,
    fontVariant: ["tabular-nums"],
    alignSelf: "flex-start",
    minWidth: 96,
  },
  presets: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  preset: {
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.elev2,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  presetActive: { borderColor: c.accent, backgroundColor: c.accentSoft },
  presetText: { color: c.dim, fontSize: 12 },
  presetTextActive: { color: c.accent, fontWeight: "700" },
  showPast: { paddingVertical: 8 },
  showPastText: { color: c.faint, fontSize: 12 },
  blocks: { gap: 6 },
  block: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: c.bg,
  },
  blockNow: { borderColor: c.accent, backgroundColor: c.accentSoft },
  blockPast: { opacity: 0.45 },
  blockTime: {
    color: c.dim,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    minWidth: 132,
  },
  blockTask: { color: c.text, fontSize: 14, flex: 1 },
  blockGone: { color: c.faint, textDecorationLine: "line-through" },
  nowTag: { color: c.accent, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: c.lineSoft,
  },
  stat: { color: c.faint, fontSize: 12 },
}));
