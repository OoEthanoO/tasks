import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { DateKey, addDays, formatDueDate, fromKey, toKey, todayKey } from "../../../lib/dates";
import { parseTrailingDate } from "../../../lib/parse-date";
import { Task } from "../../../lib/types";
import { radius, themed, useStyles, useTheme } from "../theme";
import { Btn, Field, useInputStyle } from "./ui";

export type TaskDraft = { title: string; description: string; dueDate: DateKey };

type Props = {
  /** An existing task to edit, or null to create a new one. */
  task: Task | null;
  onSubmit: (draft: TaskDraft) => void;
  onDelete?: () => void;
  onClose: () => void;
};

const QUICK: Array<{ label: string; days: number }> = [
  { label: "Today", days: 0 },
  { label: "Tomorrow", days: 1 },
  { label: "In 3 days", days: 3 },
  { label: "Next week", days: 7 },
];

export default function TaskSheet({ task, onSubmit, onDelete, onClose }: Props) {
  const { c } = useTheme();
  const s = useStyles(styles);
  const inputStyle = useInputStyle();
  const editing = task !== null;
  const today = todayKey();

  const [raw, setRaw] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  // Null until the user picks a date explicitly; new tasks let the text decide.
  const [pickedDate, setPickedDate] = useState<DateKey | null>(
    task ? task.dueDate : null,
  );

  // The same trailing-date parser the web quick-add uses: "essay tomorrow"
  // becomes a task called "essay" due tomorrow, and the title loses the phrase.
  const parsed = useMemo(() => parseTrailingDate(raw, new Date()), [raw]);
  const titleFromText = editing ? raw.trim() : parsed.title;
  const dueDate = pickedDate ?? parsed.dueDate ?? today;
  const parserClaimedDate = !editing && pickedDate === null && parsed.dueDate !== null;

  const canSave = titleFromText.length > 0;

  function submit() {
    if (!canSave) return;
    onSubmit({
      title: titleFromText,
      description: description.trim(),
      dueDate,
    });
  }

  function shiftDate(days: number) {
    setPickedDate(toKey(addDays(fromKey(dueDate), days)));
  }

  return (
    <Modal
      visible
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={s.backdrop} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={s.sheetWrap}
      >
        <View style={s.sheet}>
          <View style={s.grabber} />
          <Text style={s.heading}>{editing ? "Edit task" : "New task"}</Text>

          <ScrollView keyboardShouldPersistTaps="handled">
            <Field
              label="Title"
              hint={
                editing
                  ? undefined
                  : "Trail it with a date — “essay tomorrow”, “rent aug 28”, “ship it in 3 days”."
              }
            >
              <TextInput
                style={inputStyle}
                value={raw}
                onChangeText={setRaw}
                autoFocus
                placeholder="What needs doing?"
                placeholderTextColor={c.faint}
                returnKeyType="done"
                onSubmitEditing={submit}
              />
            </Field>

            {parserClaimedDate && (
              <Text style={s.parsed}>
                Reading that as <Text style={s.parsedStrong}>{parsed.title}</Text>, due{" "}
                <Text style={s.parsedStrong}>{formatDueDate(dueDate, today)}</Text>.
              </Text>
            )}

            <Field label="Due">
              <View style={s.dateRow}>
                <Pressable
                  onPress={() => shiftDate(-1)}
                  hitSlop={8}
                  accessibilityLabel="One day earlier"
                  style={s.stepper}
                >
                  <Text style={s.stepperText}>−</Text>
                </Pressable>
                <View style={s.dateValue}>
                  <Text style={s.dateText}>{formatDueDate(dueDate, today)}</Text>
                  <Text style={s.dateSub}>{dueDate}</Text>
                </View>
                <Pressable
                  onPress={() => shiftDate(1)}
                  hitSlop={8}
                  accessibilityLabel="One day later"
                  style={s.stepper}
                >
                  <Text style={s.stepperText}>+</Text>
                </Pressable>
              </View>

              <View style={s.chips}>
                {QUICK.map((q) => {
                  const key = toKey(addDays(new Date(), q.days));
                  const active = key === dueDate;
                  return (
                    <Pressable
                      key={q.label}
                      onPress={() => setPickedDate(key)}
                      style={[s.chip, active && s.chipActive]}
                    >
                      <Text style={[s.chipText, active && s.chipTextActive]}>
                        {q.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Field>

            <Field label="Description">
              <TextInput
                style={[inputStyle, s.textarea]}
                value={description}
                onChangeText={setDescription}
                multiline
                placeholder="Optional"
                placeholderTextColor={c.faint}
              />
            </Field>
          </ScrollView>

          <View style={s.actions}>
            <Btn
              label={editing ? "Save" : "Add task"}
              tone="primary"
              onPress={submit}
              disabled={!canSave}
              style={{ flex: 1 }}
            />
            <Btn label="Cancel" onPress={onClose} />
            {editing && onDelete ? (
              <Btn label="Delete" tone="danger" onPress={onDelete} />
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = themed((c) => ({
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: c.scrim,
  },
  sheetWrap: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: c.elev,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: c.line,
    padding: 18,
    paddingBottom: 34,
    maxHeight: "88%",
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.line,
    alignSelf: "center",
    marginBottom: 12,
  },
  heading: {
    color: c.text,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 16,
  },
  parsed: {
    color: c.dim,
    fontSize: 13,
    marginTop: -6,
    marginBottom: 14,
    lineHeight: 19,
  },
  parsedStrong: { color: c.accent, fontWeight: "700" },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepper: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.elev2,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperText: { color: c.text, fontSize: 20, fontWeight: "600", lineHeight: 24 },
  dateValue: { flex: 1, alignItems: "center" },
  dateText: { color: c.text, fontSize: 16, fontWeight: "600" },
  dateSub: { color: c.faint, fontSize: 12, fontVariant: ["tabular-nums"] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  chip: {
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.elev2,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipActive: { borderColor: c.accent, backgroundColor: c.accentSoft },
  chipText: { color: c.dim, fontSize: 13 },
  chipTextActive: { color: c.accent, fontWeight: "700" },
  textarea: { minHeight: 76, textAlignVertical: "top" },
  actions: { flexDirection: "row", gap: 10, marginTop: 14, alignItems: "center" },
}));
