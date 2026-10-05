import { useEffect, useState } from "react";
import { Pressable, Switch, Text, TextInput, View, type StyleProp, type TextStyle } from "react-native";
import { sanitizeEndTime } from "../../../lib/app-state";
import { formatDuration, RESET_PROGRESS_CONFIRMATION } from "../../../lib/tracking";
import { describeFocus } from "../../../lib/focus";
import { clampWhole, DayPlan, sanitizeClockTime, SPLIT_PARTS } from "../../../lib/plan";
import { MINIMUM_MINUTES } from "../../../lib/minimum";
import { Tracker } from "../useTracking";
import { themed, useStyles, useTheme } from "../theme";
import { Banner, Btn, Card, CardHead } from "./ui";
import ConfirmSheet from "./ConfirmSheet";

/** A whole-number field that commits when editing ends, so typing "25" never saves a passing "2". */
function WholeField({ label, value, range, onCommit, style }: { label: string; value: number; range: { min: number; max: number }; onCommit: (value: number) => void; style: StyleProp<TextStyle> }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <TextInput style={style} value={draft} onChangeText={setDraft} keyboardType="number-pad" maxLength={String(range.max).length} accessibilityLabel={label}
    onEndEditing={() => {
      const next = draft.trim() === "" ? value : clampWhole(Number(draft), range, value);
      setDraft(String(next));
      if (next !== value) onCommit(next);
    }} />;
}

/** A 24-hour "HH:MM" field that commits when editing ends. */
function TimeField({ label, value, onCommit, style }: { label: string; value: string; onCommit: (value: string) => void; style: StyleProp<TextStyle> }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <TextInput style={style} value={draft} onChangeText={setDraft} accessibilityLabel={label} maxLength={5} keyboardType="numbers-and-punctuation"
    onEndEditing={e => { const clean = sanitizeClockTime(e.nativeEvent.text, value); setDraft(clean); if (clean !== value) onCommit(clean); }} />;
}

export default function TrackingCard({ tracker: t, endTime, onEndTimeChange, plan, onPlanChange, unweighted, onUnweightedChange, minimumEnabled, onMinimumChange, minimumMinutes, onMinimumMinutesChange }: {
  tracker: Tracker; endTime: string; onEndTimeChange: (value: string) => void; plan: DayPlan; onPlanChange: (value: DayPlan) => void;
  unweighted: boolean; onUnweightedChange: (value: boolean) => void;
  minimumEnabled: boolean; onMinimumChange: (value: boolean) => void;
  minimumMinutes: number; onMinimumMinutesChange: (value: number) => void;
}) {
  const s = useStyles(styles);
  const { c } = useTheme();
  const state = t.state;
  const [confirmReset, setConfirmReset] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => { if (!t.ready) setConfirmReset(false); }, [t.ready]);
  const f = describeFocus(state, t.progress, t.ready);
  const working = f.working;
  return <Card>
    <CardHead title="Today’s focus" />
    <Text style={s.hint}>Work day {plan.startTime}–{endTime}</Text>
    <Text style={[s.label, !working && { color: c.dim }]}>{f.label}</Text>
    <Text style={s.title}>{f.title}</Text>
    <Text style={s.clock} accessibilityRole="timer" accessibilityLabel={f.clockLabel}>{formatDuration(f.clock, true)}</Text>
    <Text style={s.hint}>{f.hint}</Text>
    {f.advice && <Banner tone="warn">{f.advice}</Banner>}
    <Btn style={{ marginVertical: 16 }} tone="primary" disabled={!t.ready || t.busy || (!working && !f.canStart)} label={t.busy ? "Syncing…" : working ? "Pause tracking" : "Start working"} onPress={() => void t.command({ type: working ? "pause" : "start" })} />
    {t.error && <Banner tone="danger" action={<Btn label="Refresh timer" onPress={() => void t.refresh()} />}>{t.error}</Banner>}
    {t.message && <Banner tone="ok" action={<Btn label="Dismiss" onPress={t.dismissMessage} />}>{t.message}</Banner>}
    <View style={s.totals}>
      <View><Text style={s.hint}>Worked today</Text><Text style={s.total}>{formatDuration(state.workMs, true)}</Text></View>
      <View><Text style={s.hint}>Work left</Text><Text style={s.total}>{formatDuration(f.workLeft)}</Text></View>
      <View><Text style={s.hint}>{f.idleStat.label}</Text><Text style={s.total}>{formatDuration(f.idleStat.value)}</Text></View>
    </View>
    <Pressable style={s.settingsHeader} accessibilityRole="button" accessibilityLabel="Day settings" accessibilityState={{ expanded: settingsOpen }} onPress={() => setSettingsOpen(!settingsOpen)}>
      <View style={{ flex: 1 }}><Text style={s.settingsTitle}>Day settings</Text><Text style={s.hint}>{plan.workParts}:{plan.idleParts} work:idle · {unweighted ? "Equal weights" : "Weighted"} · {minimumEnabled ? `${minimumMinutes}m minimum` : "No minimum"}</Text></View>
      <Text style={s.settingsTitle}>{settingsOpen ? "−" : "+"}</Text>
    </Pressable>
    {settingsOpen && <View style={s.settingsBody}>
    <View style={s.controls}>
      <Text style={s.hint}>Work day starts at</Text>
      <TimeField style={s.input} label="Work day start time, 24 hour clock" value={plan.startTime} onCommit={startTime => onPlanChange({ ...plan, startTime })} />
    </View>
    <View style={s.controls}>
      <Text style={s.hint}>Work day ends at</Text>
      <TimeField style={s.input} label="Work day end time, 24 hour clock" value={endTime} onCommit={value => onEndTimeChange(sanitizeEndTime(value))} />
    </View>
    <View style={[s.controls, s.wrap]}>
      <Text style={s.hint}>Work : idle</Text>
      <WholeField style={[s.input, s.minutes]} label="Work parts of the ratio" value={plan.workParts} range={SPLIT_PARTS} onCommit={workParts => onPlanChange({ ...plan, workParts })} />
      <Text style={s.hint}>:</Text>
      <WholeField style={[s.input, s.minutes]} label="Idle parts of the ratio" value={plan.idleParts} range={SPLIT_PARTS} onCommit={idleParts => onPlanChange({ ...plan, idleParts })} />
    </View>
    <Text style={s.hint}>Untracked time is idle. 1:1 is recommended.</Text>
    <View style={s.controls}>
      <Text style={s.hint}>Unweighted</Text>
      <Switch value={unweighted} onValueChange={onUnweightedChange} accessibilityLabel="Unweighted" accessibilityHint="Give every open task equal weight." trackColor={{ true: c.accent, false: c.line }} />
    </View>
    <Text style={s.hint}>Give every open task equal weight.</Text>
    <View style={s.controls}>
      <Text style={s.hint}>Daily minimum</Text>
      <Switch value={minimumEnabled} onValueChange={onMinimumChange} accessibilityLabel="Daily minimum" accessibilityHint={`Skip tasks whose daily target is under ${minimumMinutes} minutes. The first eligible task is always kept.`} trackColor={{ true: c.accent, false: c.line }} />
    </View>
    <View style={s.controls}>
      <WholeField style={[s.input, s.minutes]} label="Minimum daily target in minutes" value={minimumMinutes} range={MINIMUM_MINUTES} onCommit={onMinimumMinutesChange} />
      <Text style={s.hint}>min per task</Text>
    </View>
    <Text style={s.hint}>Skip daily targets below {minimumMinutes} minutes. The first eligible task is always kept.</Text>
    <Text style={s.hint}>{state.timeZone} · settings save automatically</Text>
    <View style={s.settingsSection}>
      <Btn tone="ghost" label={t.permission} onPress={() => void t.enableNotifications()} />
      <Text style={s.hint}>Alerts follow the device that last started, paused or reset tracking; until one has, every device alerts. Open this app to refresh alerts after changing the timer elsewhere.</Text>
    </View>
    <View style={s.settingsSection}>
      <Text style={s.explainer}>Targets divide today’s work time between your tasks. Settings change future targets, never time already logged. Daily progress resets at midnight; borrowed idle carries over as work.</Text>
      <Btn tone="ghost" label="Reset today’s progress…" disabled={!t.ready || t.busy} onPress={() => setConfirmReset(true)} />
    </View>
    </View>}
    {confirmReset && <ConfirmSheet title="Reset today’s progress?" body={RESET_PROGRESS_CONFIRMATION} confirmLabel="Reset progress" cancelLabel="Keep progress" onCancel={() => setConfirmReset(false)} onConfirm={() => { setConfirmReset(false); void t.command({ type: "reset" }); }} />}
  </Card>;
}
const styles = themed(c => ({
  settingsHeader: { flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: 1, borderColor: c.line, paddingTop: 16, minHeight: 60 },
  settingsTitle: { color: c.text, fontSize: 14, fontWeight: "600", marginBottom: 4 },
  settingsBody: { paddingTop: 20, gap: 10 },
  settingsSection: { borderTopWidth: 1, borderColor: c.line, paddingTop: 14, marginTop: 8 },
  controls: { flexWrap: "wrap", flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  wrap: { flexWrap: "wrap", gap: 8 },
  minutes: { width: 80, minWidth: 0, textAlign: "center" },
  input: { color: c.text, backgroundColor: c.bg, borderWidth: 1, borderColor: c.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, minWidth: 90, fontSize: 16 },
  label: { color: c.accent, fontSize: 11, fontWeight: "700", letterSpacing: 1.5, marginTop: 18 },
  title: { color: c.text, fontSize: 25, fontWeight: "700", marginTop: 8 },
  clock: { color: c.text, fontSize: 46, fontWeight: "600", fontVariant: ["tabular-nums"], marginVertical: 8 },
  hint: { color: c.dim, fontSize: 12, lineHeight: 18 },
  totals: { flexDirection: "row", flexWrap: "wrap", gap: 18, paddingVertical: 20 },
  total: { color: c.text, fontSize: 17, fontWeight: "600", fontVariant: ["tabular-nums"], marginTop: 4 },
  explainer: { color: c.faint, fontSize: 12, lineHeight: 18, marginBottom: 12 },
}));
