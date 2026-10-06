import { Text, View } from "react-native";
import { formatDuration } from "../../../lib/tracking";
import { describeFocus } from "../../../lib/focus";
import { Tracker } from "../useTracking";
import { themed, useStyles } from "../theme";
import { Banner, Btn, Card, CardHead } from "./ui";

export default function TrackingCard({ tracker: t }: { tracker: Tracker }) {
  const s = useStyles(styles);
  const f = describeFocus(t.state, t.progress, t.ready);

  return (
    <Card>
      <CardHead title="Tracker" />
      <Text style={[s.label, !f.working && s.paused]}>{f.label}</Text>
      <Text style={s.title}>{f.title}</Text>
      <Text style={s.clock} accessibilityRole="timer" accessibilityLabel={f.clockLabel}>
        {t.ready && !f.done ? formatDuration(f.clock, true) : "—"}
      </Text>
      <Text style={s.hint}>{f.hint}</Text>
      <Btn
        style={s.toggle}
        tone="primary"
        disabled={!t.ready || t.busy || (!f.working && !f.canStart)}
        label={f.working ? "Pause" : "Start"}
        onPress={() => void t.command({ type: f.working ? "pause" : "start" })}
      />
      {t.error && (
        <Banner tone="danger" action={<Btn label="Retry" onPress={() => void t.refresh()} />}>
          {t.error}
        </Banner>
      )}
      {t.message && (
        <Banner tone="ok" action={<Btn label="Dismiss" onPress={t.dismissMessage} />}>
          {t.message}
        </Banner>
      )}
      <View style={s.footer}>
        <Text style={s.hint}>
          Tracked today · {t.ready ? formatDuration(t.state.workMs) : "—"}
        </Text>
        <Btn tone="ghost" label={t.permission} onPress={() => void t.enableNotifications()} />
      </View>
    </Card>
  );
}

const styles = themed(c => ({
  label: { color: c.accent, fontSize: 11, fontWeight: "700", letterSpacing: 1.5, marginTop: 6 },
  paused: { color: c.dim },
  title: { color: c.text, fontSize: 25, fontWeight: "700", marginTop: 8 },
  clock: { color: c.text, fontSize: 46, fontWeight: "600", fontVariant: ["tabular-nums"], marginVertical: 8 },
  hint: { color: c.dim, fontSize: 12, lineHeight: 18 },
  toggle: { marginVertical: 16, minHeight: 48 },
  footer: { alignItems: "flex-start", gap: 4 },
}));
