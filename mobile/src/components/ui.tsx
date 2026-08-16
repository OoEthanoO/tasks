import { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";
import { c, radius } from "../theme";

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function CardHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={s.cardHead}>
      <Text style={s.cardTitle}>{title}</Text>
      <View style={s.spacer} />
      {right}
    </View>
  );
}

type BtnProps = {
  label: string;
  onPress: () => void;
  tone?: "primary" | "plain" | "ghost" | "danger";
  disabled?: boolean;
  style?: ViewStyle;
};

export function Btn({ label, onPress, tone = "plain", disabled, style }: BtnProps) {
  const toneStyle =
    tone === "primary"
      ? { backgroundColor: c.accent, borderColor: c.accent }
      : tone === "danger"
        ? { backgroundColor: c.dangerSoft, borderColor: c.danger }
        : tone === "ghost"
          ? { backgroundColor: "transparent", borderColor: "transparent" }
          : { backgroundColor: c.elev2, borderColor: c.line };

  const textColor =
    tone === "primary" ? "#fff" : tone === "danger" ? c.danger : c.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.btn,
        toneStyle,
        (pressed || disabled) && { opacity: disabled ? 0.45 : 0.7 },
        style,
      ]}
    >
      <Text style={[s.btnText, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
}

export function Banner({
  tone,
  children,
  action,
}: {
  tone: "danger" | "ok" | "warn";
  children: ReactNode;
  action?: ReactNode;
}) {
  const palette = {
    danger: { bg: c.dangerSoft, border: c.danger, fg: c.danger },
    ok: { bg: "#4ade8018", border: "#4ade8055", fg: c.ok },
    warn: { bg: "#ffb45418", border: "#ffb45455", fg: c.warn },
  }[tone];

  return (
    <View
      accessibilityRole={tone === "danger" ? "alert" : "text"}
      style={[s.banner, { backgroundColor: palette.bg, borderColor: palette.border }]}
    >
      <Text style={[s.bannerText, { color: palette.fg }]}>{children}</Text>
      {action}
    </View>
  );
}

export function GroupLabel({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone?: "overdue";
}) {
  return (
    <View style={s.groupLabel}>
      <Text
        style={[s.groupLabelText, tone === "overdue" && { color: c.danger }]}
      >
        {label.toUpperCase()}
      </Text>
      <Text style={s.groupCount}>{count}</Text>
    </View>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      {children}
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Empty({ lines }: { lines: string[] }) {
  return (
    <View style={s.empty}>
      {lines.map((line, i) => (
        <Text key={i} style={[s.emptyText, i > 0 && { color: c.faint }]}>
          {line}
        </Text>
      ))}
    </View>
  );
}

export const inputStyle: TextStyle = {
  backgroundColor: c.bg,
  borderWidth: 1,
  borderColor: c.line,
  borderRadius: radius.sm,
  color: c.text,
  paddingHorizontal: 12,
  paddingVertical: 10,
  fontSize: 16,
};

const s = StyleSheet.create({
  card: {
    backgroundColor: c.elev,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.lineSoft,
    padding: 14,
    marginBottom: 14,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 8,
  },
  cardTitle: {
    color: c.text,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  spacer: { flex: 1 },
  btn: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { fontSize: 14, fontWeight: "600" },
  banner: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  bannerText: { flex: 1, fontSize: 14, lineHeight: 20 },
  groupLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
    marginBottom: 6,
  },
  groupLabelText: {
    color: c.faint,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.1,
  },
  groupCount: { color: c.faint, fontSize: 11 },
  field: { marginBottom: 14 },
  fieldLabel: {
    color: c.dim,
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
  },
  hint: { color: c.faint, fontSize: 12, marginTop: 6 },
  empty: { paddingVertical: 26, alignItems: "center", gap: 4 },
  emptyText: { color: c.dim, fontSize: 14, textAlign: "center" },
});
