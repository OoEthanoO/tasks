import { useState } from "react";
import { Linking, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { AppState, User } from "../../../lib/types";
import { summarizeState } from "../../../lib/app-state";
import { themed, useStyles } from "../theme";
import { Banner, Btn } from "./ui";

const PRIVACY_URL = "https://tasks.ethanyanxu.com/privacy";

export default function AccountSheet({
  user,
  state,
  onSignOut,
  onDeleteAccount,
  onClose,
}: {
  user: User;
  /** What the account currently holds, for the deletion warning. */
  state: AppState;
  onSignOut: () => Promise<void>;
  onDeleteAccount: () => Promise<void>;
  onClose: () => void;
}) {
  const s = useStyles(styles);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={s.backdrop} onPress={() => !busy && onClose()} />
      <View style={s.sheetWrap}>
        <View style={s.sheet}>
          <View style={s.grabber} />
          <ScrollView>
            <Text style={s.heading}>{user.username}</Text>
            <Text style={s.lede}>
              Signed in and syncing. This account holds {summarizeState(state)}.
            </Text>

            {error && <Banner tone="danger">{error}</Banner>}

            {!confirming ? (
              <>
                <Btn
                  label="Sign out"
                  onPress={() => void run(onSignOut)}
                  disabled={busy}
                  style={s.action}
                />
                <Pressable
                  onPress={() => Linking.openURL(PRIVACY_URL)}
                  style={s.link}
                  accessibilityRole="link"
                >
                  <Text style={s.linkText}>Privacy policy</Text>
                </Pressable>

                <View style={s.divider} />

                <Text style={s.dangerLabel}>DANGER ZONE</Text>
                <Text style={s.dangerBody}>
                  Deleting your account erases it from the server for good — every task,
                  your schedule, and your sign-in. It cannot be undone.
                </Text>
                <Btn
                  label="Delete account"
                  tone="danger"
                  onPress={() => setConfirming(true)}
                  disabled={busy}
                  style={s.action}
                />
              </>
            ) : (
              <>
                <Banner tone="danger">
                  Permanently delete {user.username}, including {summarizeState(state)}? This
                  cannot be undone.
                </Banner>
                <Btn
                  label={busy ? "Deleting…" : "Yes, delete my account"}
                  tone="danger"
                  onPress={() => void run(onDeleteAccount)}
                  disabled={busy}
                  style={s.action}
                />
                <Btn
                  label="Keep my account"
                  tone="primary"
                  onPress={() => setConfirming(false)}
                  disabled={busy}
                  style={s.action}
                />
              </>
            )}

            <Btn label="Close" tone="ghost" onPress={onClose} disabled={busy} style={s.action} />
          </ScrollView>
        </View>
      </View>
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
    marginBottom: 14,
  },
  heading: { color: c.text, fontSize: 22, fontWeight: "800" },
  lede: { color: c.dim, fontSize: 14, lineHeight: 20, marginTop: 4, marginBottom: 18 },
  action: { marginBottom: 10 },
  link: { paddingVertical: 8, marginBottom: 4 },
  linkText: { color: c.accent, fontSize: 14, fontWeight: "600" },
  divider: {
    height: 1,
    backgroundColor: c.lineSoft,
    marginVertical: 14,
  },
  dangerLabel: {
    color: c.danger,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  dangerBody: { color: c.dim, fontSize: 13, lineHeight: 19, marginBottom: 12 },
}));
