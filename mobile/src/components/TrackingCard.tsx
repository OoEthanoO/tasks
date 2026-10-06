import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View, type StyleProp, type TextStyle } from "react-native";
import { sanitizeEndTime } from "../../../lib/app-state";
import { dayEnd, formatDuration, outingAdvice, RESET_PROGRESS_CONFIRMATION, TURN_MS } from "../../../lib/tracking";
import { describeFocus } from "../../../lib/focus";
import { clampWhole, DayPlan, sanitizeClockTime } from "../../../lib/plan";
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

export default function TrackingCard({ tracker: t, endTime, onEndTimeChange }: {
  tracker: Tracker; endTime: string; onEndTimeChange: (value: string) => void;
  plan?: DayPlan; onPlanChange?: (value: DayPlan) => void;
  unweighted?: boolean; onUnweightedChange?: (value: boolean) => void;
  minimumEnabled?: boolean; onMinimumChange?: (value: boolean) => void;
  minimumMinutes?: number; onMinimumMinutesChange?: (value: number) => void;
}) {
  const s = useStyles(styles);
  const { c } = useTheme();
  const state = t.state;
  const [confirmReset, setConfirmReset] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [outingOpen, setOutingOpen] = useState(false);
  const [travel, setTravel] = useState(0), [reserved, setReserved] = useState(0);
  useEffect(() => { if (!t.ready) setConfirmReset(false); }, [t.ready]);
  const f = describeFocus(state, t.progress, t.ready);
  const last = state.tasks.find(task => task.id === state.pacing?.turn?.taskId && !task.completed);
  const offerContinue = !f.working && last && state.pacing?.turn && state.pacing.turn.elapsedMs >= TURN_MS && last.id !== f.next?.id;
  const outing = outingAdvice(state, state.cursor, travel, reserved);
  const clockTime = (at: number) => new Intl.DateTimeFormat(undefined, { timeZone: state.timeZone, hour: "numeric", minute: "2-digit" }).format(at);
  return <Card>
    <CardHead title="Today’s focus" />
    <Text style={s.hint}>30-minute turns · same rule every day</Text>
    <Text style={[s.label, !f.working && { color: c.dim }]}>{f.label}</Text>
    <Text style={s.title}>{f.title}</Text>
    <Text style={s.clock} accessibilityRole="timer" accessibilityLabel={f.clockLabel}>{formatDuration(f.clock, true)}</Text>
    <Text style={s.hint}>{f.hint}</Text>
    {f.advice && <Banner tone="warn">{f.advice}</Banner>}
    <Btn style={{ marginVertical: 16 }} tone="primary" disabled={!t.ready || t.busy || (!f.working && !f.canStart)} label={t.busy ? "Syncing…" : f.working ? "Pause tracking" : f.done ? "Track extra work" : "Start suggested task"} onPress={() => void t.command({ type: f.working ? "pause" : "start" })} />
    {offerContinue && <Btn label={"Continue " + last.title} disabled={t.busy || !t.ready} onPress={() => void t.command({ type: "continue" })} />}
    {t.error && <Banner tone="danger" action={<Btn label="Refresh timer" onPress={() => void t.refresh()} />}>{t.error}</Banner>}
    {t.message && <Banner tone="ok" action={<Btn label="Dismiss" onPress={t.dismissMessage} />}>{t.message}</Banner>}
    <View style={s.totals}>
      <View><Text style={s.hint}>Worked today</Text><Text style={s.total}>{formatDuration(state.workMs, true)}</Text></View>
      <View><Text style={s.hint}>Recommended left</Text><Text style={s.total}>{t.ready ? formatDuration(f.workLeft) : "—"}</Text></View>
      <View><Text style={s.hint}>Recommended</Text><Text style={s.total}>{t.ready ? f.goalText : "—"}</Text></View>
    </View>
    <Pressable style={s.settingsHeader} accessibilityRole="button" accessibilityState={{ expanded: outingOpen }} onPress={() => setOutingOpen(!outingOpen)}>
      <Text style={s.settingsTitle}>Can I go out now? {outingOpen ? "−" : "+"}</Text>
    </Pressable>
    {outingOpen && <View style={s.settingsBody}>
      <Text style={s.hint}>Travel, round trip (minutes)</Text>
      <WholeField style={s.input} label="Round-trip travel minutes" value={travel} range={{ min: 0, max: 1440 }} onCommit={setTravel} />
      <Text style={s.hint}>Other time to keep free (meals, etc., minutes)</Text>
      <WholeField style={s.input} label="Other reserved minutes" value={reserved} range={{ min: 0, max: 1440 }} onCommit={setReserved} />
      <Text style={s.total}>{state.cursor >= dayEnd(state) ? "Bedtime has passed." : outing.availableMs > 0
        ? "Up to " + formatDuration(outing.availableMs) + " there; leave by " + clockTime(outing.latestReturn + travel * 30_000) + "."
        : "No outing time fits alongside the remaining recommendation."}</Text>
      <Text style={s.hint}>Assumes you leave now, split travel equally each way, and can do the remaining work afterward. This fits your recommendation, not a promise that all tasks will be finished.</Text>
      {f.working && <Text style={s.hint}>Pause tracking before you go.</Text>}
    </View>}
    <Pressable style={s.settingsHeader} accessibilityRole="button" accessibilityLabel="Pacing and settings" accessibilityState={{ expanded: settingsOpen }} onPress={() => setSettingsOpen(!settingsOpen)}>
      <Text style={s.settingsTitle}>Pacing and settings {settingsOpen ? "−" : "+"}</Text>
    </Pressable>
    {settingsOpen && <View style={s.settingsBody}>
      <Text style={s.explainer}>Each unfinished task adds 60 minutes ÷ (days until due + 1). Today and overdue count as zero days. Round up to 30 minutes, capped at 3 hours every day. This is pacing advice, not an estimate of all the work required.</Text>
      <Text style={s.explainer}>All open tasks get turns. Near deadlines receive at most a 2× boost. Rotation continues across days; daily counters reset at midnight. Pausing never adds work or debt. Extra work is always optional.</Text>
      <View style={s.controls}>
        <Text style={s.hint}>Bedtime (outing advice only)</Text>
        <TimeField style={s.input} label="Bedtime, 24 hour clock" value={endTime} onCommit={value => onEndTimeChange(sanitizeEndTime(value))} />
      </View>
      <Text style={s.hint}>{state.timeZone} · settings save automatically</Text>
      <View style={s.settingsSection}>
        <Btn tone="ghost" label={t.permission} onPress={() => void t.enableNotifications()} />
        <Text style={s.hint}>Alerts follow the device that last controlled tracking. Open this app to refresh alerts after changing the timer elsewhere.</Text>
      </View>
      <View style={s.settingsSection}>
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
