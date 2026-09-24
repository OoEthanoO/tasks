import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { sanitizeEndTime } from "../../../lib/app-state";
import { dayEnd, formatDuration, RESET_PROGRESS_CONFIRMATION, REST_CYCLE_MS, restOwed, SKIP_REST_HINT, WORK_CYCLE_MS } from "../../../lib/tracking";
import { Tracker } from "../useTracking";
import { themed, useStyles } from "../theme";
import { Banner, Btn, Card, CardHead } from "./ui";
import ConfirmSheet from "./ConfirmSheet";

export default function TrackingCard({ tracker: t, endTime, onEndTimeChange }: { tracker: Tracker; endTime: string; onEndTimeChange: (value: string) => void }) {
  const s = useStyles(styles);
  const state = t.state;
  const [draftEnd, setDraftEnd] = useState(endTime);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => { if (!t.ready) setConfirmReset(false); }, [t.ready]);
  useEffect(() => setDraftEnd(endTime), [endTime]);
  const current = t.progress.find(p => p.task.id === state.taskId);
  const resting = state.mode === "rest";
  const ended = state.cursor >= dayEnd(state);
  const canStart = !ended && (state.cycleWorkMs >= WORK_CYCLE_MS || t.progress.some(p => p.weight > 0 && !p.doneToday));
  const breakDue = !ended && restOwed(state);
  return <Card>
    <CardHead title="Today’s focus" />
    <View style={s.controls}>
      <Text style={s.hint}>Work day ends at</Text>
      <TextInput style={s.input} value={draftEnd} onChangeText={setDraftEnd} onEndEditing={e => { const clean = sanitizeEndTime(e.nativeEvent.text); setDraftEnd(clean); onEndTimeChange(clean); }} accessibilityLabel="Work day end time, 24 hour clock" maxLength={5} keyboardType="numbers-and-punctuation" />
    </View>
    <Text style={s.hint}>{state.timeZone} · resets at midnight</Text>
    <Text style={s.label}>{!t.ready ? "LOADING TIMER…" : resting ? "RESTING" : state.mode === "work" ? "WORKING ON" : ended ? "DAY COMPLETE" : "PAUSED"}</Text>
    <Text style={s.title}>{resting ? "Take a breather." : current?.task.title ?? (ended ? "You’re done for today." : "Ready when you are.")}</Text>
    <Text style={s.clock} accessibilityRole="timer">{formatDuration(resting ? REST_CYCLE_MS - state.cycleRestMs : current?.trackedMs ?? state.workMs, true)}</Text>
    <Text style={s.hint}>{resting ? "Rest time remaining · work resumes automatically" : current ? `${formatDuration(current.remainingMs)} left to today’s target` : "Start with the highest-weight unfinished task, or choose below."}</Text>
    <Btn style={{ marginVertical: 16 }} tone="primary" disabled={!t.ready || t.busy || (state.mode === "idle" && !canStart)} label={t.busy ? "Syncing…" : state.mode === "idle" ? state.cycleWorkMs >= WORK_CYCLE_MS ? "Resume rest" : "Start working" : "Pause tracking"} onPress={() => void t.command({ type: state.mode === "idle" ? "start" : "pause" })} />
    {breakDue && <Btn tone="ghost" label="Skip break and keep working" disabled={!t.ready || t.busy} onPress={() => void t.command({ type: "skip-rest" })} style={{ marginTop: -8, marginBottom: 8 }} />}
    {breakDue && <Text style={[s.hint, { marginBottom: 12 }]}>{SKIP_REST_HINT}</Text>}
    {!resting && state.cycleWorkMs < WORK_CYCLE_MS && <Text style={s.hint}>Rest after {formatDuration(WORK_CYCLE_MS - state.cycleWorkMs)} more tracked work · 30-minute breaks</Text>}
    {t.error && <Banner tone="danger" action={<Btn label="Refresh timer" onPress={() => void t.refresh()} />}>{t.error}</Banner>}
    {t.message && <Banner tone="ok" action={<Btn label="Dismiss" onPress={t.dismissMessage} />}>{t.message}</Banner>}
    <View style={s.totals}>
      <View><Text style={s.hint}>Worked today</Text><Text style={s.total}>{formatDuration(state.workMs, true)}</Text></View>
      <View><Text style={s.hint}>Rested today</Text><Text style={s.total}>{formatDuration(state.restMs, true)}</Text></View>
      <View><Text style={s.hint}>Work left</Text><Text style={s.total}>{formatDuration(t.remainingWorkMs)}</Text></View>
    </View>
    <Btn tone="danger" label="Reset today’s progress" disabled={!t.ready || t.busy} onPress={() => setConfirmReset(true)} style={{ marginBottom: 12 }} />
    <Text style={s.explainer}>Remaining targets fit the work time left after reserving breaks. Logged time stays fixed; unfinished targets balance by weight.</Text>
    <Btn tone="ghost" label={t.permission} onPress={() => void t.enableNotifications()} />
    <Text style={s.hint}>Alerts follow the device that last started or switched tracking. Open this app to refresh alerts after changing the timer elsewhere.</Text>
    {confirmReset && <ConfirmSheet title="Reset today’s progress?" body={RESET_PROGRESS_CONFIRMATION} confirmLabel="Reset progress" cancelLabel="Keep progress" onCancel={() => setConfirmReset(false)} onConfirm={() => { setConfirmReset(false); void t.command({ type: "reset" }); }} />}
  </Card>;
}
const styles = themed(c => ({
  controls: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  input: { color: c.text, backgroundColor: c.bg, borderWidth: 1, borderColor: c.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, minWidth: 90, fontSize: 16 },
  label: { color: c.accent, fontSize: 11, fontWeight: "700", letterSpacing: 1.5, marginTop: 26 },
  title: { color: c.text, fontSize: 25, fontWeight: "700", marginTop: 8 },
  clock: { color: c.text, fontSize: 46, fontWeight: "600", fontVariant: ["tabular-nums"], marginVertical: 8 },
  hint: { color: c.dim, fontSize: 12, lineHeight: 18 },
  totals: { flexDirection: "row", flexWrap: "wrap", gap: 18, paddingVertical: 20 },
  total: { color: c.text, fontSize: 17, fontWeight: "600", fontVariant: ["tabular-nums"], marginTop: 4 },
  explainer: { color: c.faint, fontSize: 12, lineHeight: 18, marginBottom: 12 },
}));
