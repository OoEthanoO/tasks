import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { coverageDays, formatDuration, MAX_COVERAGE_DAYS, parseCoverageDaysInput, RESET_PROGRESS_CONFIRMATION } from "../../../lib/tracking";
import { describeFocus } from "../../../lib/focus";
import { Tracker } from "../useTracking";
import { themed, useStyles, useTheme } from "../theme";
import { Banner, Btn, Card, CardHead, useInputStyle } from "./ui";
import ConfirmSheet from "./ConfirmSheet";

export default function TrackingCard({ tracker: t }: { tracker: Tracker }) {
  const s = useStyles(styles), { c } = useTheme();
  const [confirmReset, setConfirmReset] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const inputStyle = useInputStyle();
  const [daysDraft, setDaysDraft] = useState(() => String(coverageDays(t.state)));
  const days = coverageDays(t.state), draft = parseCoverageDaysInput(daysDraft);
  useEffect(() => { setDaysDraft(String(days)); }, [days, t.ready]);
  useEffect(() => { if (!t.ready) setConfirmReset(false); }, [t.ready]);
  const f = describeFocus(t.state, t.progress, t.ready);
  return <Card>
    <CardHead title="Today’s focus" />
    <Text style={s.hint}>Due through {f.cutoff}</Text>
    <Text style={[s.label, !f.working && { color: c.dim }]}>{f.label}</Text>
    <Text style={s.title}>{f.title}</Text>
    <Text style={s.clock} accessibilityRole="timer" accessibilityLabel={f.clockLabel}>{formatDuration(f.clock, true)}</Text>
    <Text style={s.hint}>{f.hint}</Text>
    <Btn style={{ marginVertical: 16 }} tone="primary" disabled={!t.ready || t.busy || (!f.working && !f.canStart)} label={t.busy ? "Syncing…" : f.working ? "Pause tracking" : "Start working"} onPress={() => void t.command({ type: f.working ? "pause" : "start" })} />
    {t.error && <Banner tone="danger" action={<Btn label="Refresh timer" onPress={() => void t.refresh()} />}>{t.error}</Banner>}
    {t.message && <Banner tone="ok" action={<Btn label="Dismiss" onPress={t.dismissMessage} />}>{t.message}</Banner>}
    <View style={s.totals}>
      <View><Text style={s.hint}>Worked today</Text><Text style={s.total}>{formatDuration(t.state.workMs, true)}</Text></View>
      <View><Text style={s.hint}>Work left</Text><Text style={s.total}>{formatDuration(f.workLeft)}</Text></View>
      <View><Text style={s.hint}>Daily goal</Text><Text style={s.total}>{formatDuration(f.budgetMs)}</Text></View>
    </View>
    <Text style={s.explainer}>Weighted time for {f.includedCount} open {f.includedCount === 1 ? "task" : "tasks"} due {f.rangeLabel}{f.days > 0 ? ", including overdue tasks." : "."} Every included task gets at least 30 minutes. Later tasks are excluded.</Text>
    <Pressable style={s.settingsHeader} accessibilityRole="button" accessibilityLabel="Tracking options" accessibilityState={{ expanded: optionsOpen }} onPress={() => setOptionsOpen(!optionsOpen)}>
      <View style={{ flex: 1 }}><Text style={s.settingsTitle}>Tracking options</Text><Text style={s.hint}>{days} {days === 1 ? "day" : "days"} ahead · Alerts and progress</Text></View>
      <Text style={s.settingsTitle}>{optionsOpen ? "−" : "+"}</Text>
    </Pressable>
    {optionsOpen && <View style={s.settingsBody}>
      <View style={s.settingsRow}>
        <View style={{ flex: 1 }}><Text style={s.settingsTitle}>Days ahead</Text><Text style={s.hint}>Include tasks due this many days from today.</Text></View>
        <TextInput accessibilityLabel="Days ahead" style={[inputStyle, { width: 74, textAlign: "center" }]} keyboardType="number-pad" value={daysDraft} onChangeText={setDaysDraft} editable={t.ready && !t.busy} />
        <Btn label={draft === days ? "Saved" : "Apply"} disabled={!t.ready || t.busy || draft === null || draft === days} onPress={() => { if (draft !== null) void t.command({ type: "set-coverage-days", days: draft }); }} />
      </View>
      <Text style={s.hint}>{draft === null ? `Enter a whole number from 0 to ${MAX_COVERAGE_DAYS}. ` : ""}Default: 3. Set 0 for today and overdue tasks only. Changes sync across devices and preserve tracked work.</Text>
      <Btn tone="ghost" label={t.permission} onPress={() => void t.enableNotifications()} />
      <Text style={s.hint}>Completion alerts follow the device that last started, paused or reset tracking. Open this app to refresh alerts after changing the timer elsewhere.</Text>
      <View style={s.settingsSection}>
        <Text style={s.explainer}>Work is counted only while tracking. Task edits recalculate future targets without changing logged time. Daily totals reset at midnight ({t.state.timeZone}).</Text>
        <Btn tone="ghost" label="Reset today’s progress…" disabled={!t.ready || t.busy} onPress={() => setConfirmReset(true)} />
      </View>
    </View>}
    {confirmReset && <ConfirmSheet title="Reset today’s progress?" body={RESET_PROGRESS_CONFIRMATION} confirmLabel="Reset progress" cancelLabel="Keep progress" onCancel={() => setConfirmReset(false)} onConfirm={() => { setConfirmReset(false); void t.command({ type: "reset" }); }} />}
  </Card>;
}
const styles = themed(c => ({
  settingsRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  settingsHeader: { flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: 1, borderColor: c.line, paddingTop: 16, minHeight: 60 },
  settingsTitle: { color: c.text, fontSize: 14, fontWeight: "600", marginBottom: 4 },
  settingsBody: { paddingTop: 20, gap: 10 },
  settingsSection: { borderTopWidth: 1, borderColor: c.line, paddingTop: 14, marginTop: 8 },
  label: { color: c.accent, fontSize: 11, fontWeight: "700", letterSpacing: 1.5, marginTop: 18 },
  title: { color: c.text, fontSize: 25, fontWeight: "700", marginTop: 8 },
  clock: { color: c.text, fontSize: 46, fontWeight: "600", fontVariant: ["tabular-nums"], marginVertical: 8 },
  hint: { color: c.dim, fontSize: 12, lineHeight: 18 },
  totals: { flexDirection: "row", flexWrap: "wrap", gap: 18, paddingVertical: 20 },
  total: { color: c.text, fontSize: 17, fontWeight: "600", fontVariant: ["tabular-nums"], marginTop: 4 },
  explainer: { color: c.faint, fontSize: 12, lineHeight: 18, marginBottom: 12 },
}));
