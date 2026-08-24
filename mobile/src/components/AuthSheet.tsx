import { useState } from "react";
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
import { isEmptyState, summarizeState } from "../../../lib/app-state";
import { validatePassword, validateUsername } from "../../../lib/auth-rules";
import { AppState } from "../../../lib/types";
import { radius, themed, useStyles, useTheme } from "../theme";
import { Banner, Btn, Field, useInputStyle } from "./ui";

type Mode = "signin" | "signup";
type Step = "form" | "migrate";
/** Which side of the flow raised the migration question. */
type MigrateFor = "signup" | "signin";

type Props = {
  initialMode: Mode;
  /** The signed-out data sitting on this device, if any. */
  localState: AppState;
  onSignIn: (
    username: string,
    password: string,
  ) => Promise<{ needsMigrationChoice: boolean }>;
  onSignUp: (username: string, password: string, migrate: boolean) => Promise<void>;
  onAdoptLocal: (migrate: boolean) => Promise<void>;
  onClose: () => void;
};

export default function AuthSheet({
  initialMode,
  localState,
  onSignIn,
  onSignUp,
  onAdoptLocal,
  onClose,
}: Props) {
  const { c } = useTheme();
  const s = useStyles(styles);
  const inputStyle = useInputStyle();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [step, setStep] = useState<Step>("form");
  const [migrateFor, setMigrateFor] = useState<MigrateFor>("signup");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Frozen at open. Signing in swaps the active store out from under the prop,
  // and the migrate step must keep describing the device copy.
  const [deviceState] = useState(localState);
  const hasLocalData = !isEmptyState(deviceState);

  /** `action` resolves true when the sheet's work is done and it should close. */
  async function run(action: () => Promise<boolean>, failStep: Step = "form") {
    setBusy(true);
    setError(null);
    try {
      if (await action()) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStep(failStep);
    } finally {
      setBusy(false);
    }
  }

  function submitForm() {
    if (busy) return;

    if (mode === "signup") {
      const problem = validateUsername(username) ?? validatePassword(password);
      if (problem) {
        setError(problem);
        return;
      }
      // Never silently strand what is already on the device.
      if (hasLocalData) {
        setError(null);
        setMigrateFor("signup");
        setStep("migrate");
        return;
      }
      void run(() => onSignUp(username, password, false).then(() => true));
      return;
    }

    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }
    void run(async () => {
      const { needsMigrationChoice } = await onSignIn(username, password);
      if (needsMigrationChoice) {
        setMigrateFor("signin");
        setStep("migrate");
        return false;
      }
      return true;
    });
  }

  function chooseMigration(migrate: boolean) {
    if (migrateFor === "signup") {
      void run(() => onSignUp(username, password, migrate).then(() => true));
      return;
    }
    void run(() => onAdoptLocal(migrate).then(() => true), "migrate");
  }

  const signingIn = migrateFor === "signin";
  const summary = summarizeState(deviceState);

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={s.backdrop} onPress={() => !busy && onClose()} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={s.sheetWrap}
      >
        <View style={s.sheet}>
          <View style={s.grabber} />

          {step === "migrate" ? (
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={s.heading}>
                {signingIn
                  ? "Your account is empty. Fill it from this device?"
                  : "Bring your local data along?"}
              </Text>
              <Text style={s.lede}>
                {signingIn
                  ? `That account has nothing in it yet, and this device is holding ${summary}.`
                  : `This device is holding ${summary} from before you had an account.`}
              </Text>

              {error && <Banner tone="danger">{error}</Banner>}

              <Pressable
                disabled={busy}
                onPress={() => chooseMigration(true)}
                style={({ pressed }) => [s.choice, s.choicePrimary, pressed && s.pressed]}
              >
                <Text style={s.choiceTitle}>Move it into my account</Text>
                <Text style={s.choiceSub}>
                  Everything is copied to the account and cleared from this device.
                </Text>
              </Pressable>

              <Pressable
                disabled={busy}
                onPress={() => chooseMigration(false)}
                style={({ pressed }) => [s.choice, pressed && s.pressed]}
              >
                <Text style={s.choiceTitle}>
                  {signingIn ? "Leave it on this device" : "Start fresh"}
                </Text>
                <Text style={s.choiceSub}>
                  The account stays empty. This device keeps its copy, and you'll see it
                  again when you sign out.
                </Text>
              </Pressable>

              <View style={s.foot}>
                {migrateFor === "signup" && (
                  <Btn label="← Back" tone="ghost" disabled={busy} onPress={() => setStep("form")} />
                )}
                {busy && (
                  <Text style={s.hint}>
                    {signingIn ? "Moving your data…" : "Creating your account…"}
                  </Text>
                )}
              </View>
            </ScrollView>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={s.tabs}>
                {(["signin", "signup"] as const).map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => {
                      setMode(m);
                      setStep("form");
                      setError(null);
                    }}
                    style={[s.tab, mode === m && s.tabActive]}
                  >
                    <Text style={[s.tabText, mode === m && s.tabTextActive]}>
                      {m === "signin" ? "Sign in" : "Create account"}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Field label="Username">
                <TextInput
                  style={inputStyle}
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  textContentType="username"
                  placeholderTextColor={c.faint}
                />
              </Field>

              <Field
                label="Password"
                hint={mode === "signup" ? "At least 8 characters." : undefined}
              >
                <TextInput
                  style={inputStyle}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  textContentType={mode === "signup" ? "newPassword" : "password"}
                  onSubmitEditing={submitForm}
                  returnKeyType="go"
                  placeholderTextColor={c.faint}
                />
              </Field>

              {error && <Banner tone="danger">{error}</Banner>}

              {hasLocalData && (
                <Text style={s.note}>
                  You have {summary} saved on this device.{" "}
                  {mode === "signup"
                    ? "We'll ask what to do with it next."
                    : "If your account is empty, we'll ask whether to move it in."}
                </Text>
              )}

              <View style={s.foot}>
                <Btn label="Cancel" onPress={onClose} disabled={busy} />
                <View style={{ flex: 1 }} />
                <Btn
                  label={busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
                  tone="primary"
                  onPress={submitForm}
                  disabled={busy}
                />
              </View>
            </ScrollView>
          )}
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
    maxHeight: "90%",
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.line,
    alignSelf: "center",
    marginBottom: 14,
  },
  tabs: {
    flexDirection: "row",
    gap: 6,
    backgroundColor: c.bg,
    borderRadius: radius.sm,
    padding: 4,
    marginBottom: 18,
  },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 6, alignItems: "center" },
  tabActive: { backgroundColor: c.raised },
  tabText: { color: c.dim, fontSize: 14, fontWeight: "600" },
  tabTextActive: { color: c.text },
  heading: { color: c.text, fontSize: 19, fontWeight: "700", marginBottom: 8 },
  lede: { color: c.dim, fontSize: 14, lineHeight: 20, marginBottom: 16 },
  choice: {
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.bg,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 10,
    gap: 4,
  },
  choicePrimary: { borderColor: c.accent, backgroundColor: c.accentSoft },
  pressed: { opacity: 0.7 },
  choiceTitle: { color: c.text, fontSize: 15, fontWeight: "700" },
  choiceSub: { color: c.dim, fontSize: 13, lineHeight: 18 },
  note: { color: c.dim, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  hint: { color: c.faint, fontSize: 12 },
  foot: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
}));
