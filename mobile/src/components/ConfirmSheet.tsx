import { Modal, Pressable, Text, View } from "react-native";
import { themed, useStyles } from "../theme";
import { Btn } from "./ui";

/**
 * A two-answer question. This is a sheet rather than `Alert.alert` because
 * react-native-web stubs Alert out to a no-op — the phone would ask, and the
 * same code under `npm run web` would silently do nothing. It also keeps the
 * question inside the app's own palette, like every other sheet here.
 */
export default function ConfirmSheet({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const s = useStyles(styles);

  return (
    <Modal
      visible
      animationType="fade"
      transparent
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <Pressable style={s.backdrop} onPress={onCancel} />
      <View style={s.wrap} pointerEvents="box-none">
        <View style={s.panel} accessibilityViewIsModal accessibilityRole="alert">
          <Text style={s.heading}>{title}</Text>
          <Text style={s.body}>{body}</Text>
          <View style={s.actions}>
            <Btn label={cancelLabel} onPress={onCancel} style={{ flex: 1 }} />
            <Btn
              label={confirmLabel}
              tone="primary"
              onPress={onConfirm}
              style={{ flex: 1 }}
            />
          </View>
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
  wrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  panel: {
    backgroundColor: c.elev,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: c.line,
    padding: 20,
  },
  heading: { color: c.text, fontSize: 18, fontWeight: "700", marginBottom: 8 },
  body: { color: c.dim, fontSize: 14, lineHeight: 20, marginBottom: 18 },
  actions: { flexDirection: "row", gap: 10 },
}));
