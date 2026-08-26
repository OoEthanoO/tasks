import { useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import { sanitizeRestMode } from "../../../lib/app-state";
import { RestMode } from "../../../lib/types";
import { radius, themed, useStyles, useTheme } from "../theme";
import { useInputStyle } from "./ui";

export default function RestKinds({
  restMode,
  onChange,
}: {
  restMode: RestMode;
  onChange: (next: RestMode) => void;
}) {
  const { c } = useTheme();
  const s = useStyles(styles);
  const inputStyle = useInputStyle();
  const [draft, setDraft] = useState("");

  // Every edit goes back through the same coercion storage uses, so the
  // trimming, the length cap and the case-insensitive de-duplication cannot
  // drift between what the UI allows and what survives a save.
  function commit(next: RestMode) {
    onChange(sanitizeRestMode(next));
  }

  function addDraft() {
    const label = draft.trim();
    if (!label) return;
    commit({ ...restMode, types: [...restMode.types, label] });
    setDraft("");
  }

  const share =
    restMode.types.length > 0 ? Math.round(100 / restMode.types.length) : 0;

  return (
    <View style={s.wrap}>
      <View style={s.toggleRow}>
        <Text style={s.toggleLabel}>Advanced rest</Text>
        <Switch
          value={restMode.advanced}
          onValueChange={(advanced) => commit({ ...restMode, advanced })}
          accessibilityLabel="Advanced rest"
          trackColor={{ false: c.line, true: c.accent }}
        />
      </View>

      {restMode.advanced && (
        <View style={s.body}>
          <View style={s.chipRow}>
            {restMode.types.map((kind) => (
              <Pressable
                key={kind}
                onPress={() =>
                  commit({
                    ...restMode,
                    types: restMode.types.filter((k) => k !== kind),
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`Remove ${kind}`}
                style={({ pressed }) => [s.chip, pressed && { opacity: 0.7 }]}
              >
                <Text style={s.chipText}>{kind}</Text>
                <Text style={s.chipX}>×</Text>
              </Pressable>
            ))}
          </View>

          <View style={s.addRow}>
            <TextInput
              style={[inputStyle, s.addInput]}
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={addDraft}
              returnKeyType="done"
              placeholder="Add a kind"
              placeholderTextColor={c.faint}
              maxLength={40}
              accessibilityLabel="New rest kind"
            />
            <Pressable
              onPress={addDraft}
              disabled={!draft.trim()}
              accessibilityRole="button"
              accessibilityLabel="Add rest kind"
              style={({ pressed }) => [
                s.addBtn,
                (pressed || !draft.trim()) && { opacity: draft.trim() ? 0.7 : 0.45 },
              ]}
            >
              <Text style={s.addBtnText}>Add</Text>
            </Pressable>
          </View>

          <Text style={s.hint}>
            {restMode.types.length === 0
              ? "No kinds yet, so rest blocks still read “Rest”."
              : `Drawn evenly — ${share}% each. How often rest comes up at all is unchanged.`}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = themed((c) => ({
  wrap: { marginBottom: 12 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  toggleLabel: { color: c.dim, fontSize: 13, flex: 1 },
  body: { gap: 8, marginTop: 10 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.elev2,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  chipText: { color: c.text, fontSize: 13 },
  chipX: { color: c.faint, fontSize: 15, lineHeight: 17 },
  addRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  addInput: { flex: 1, paddingVertical: 8 },
  addBtn: {
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.elev2,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  addBtnText: { color: c.text, fontSize: 14, fontWeight: "600" },
  hint: { color: c.faint, fontSize: 12, lineHeight: 17 },
}));
