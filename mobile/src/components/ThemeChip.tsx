import { Pressable, Text } from "react-native";
import {
  describeThemePreference,
  nextThemePreference,
  themePreferenceLabel,
} from "../../../lib/theme";
import { themed, useStyles, useTheme } from "../theme";

/**
 * The phone's theme control. The web app has room for three side-by-side
 * options in its topbar; this one cycles through the same three in place,
 * which is all a phone topbar has space for.
 */
export default function ThemeChip() {
  const { preference, scheme, setPreference } = useTheme();
  const s = useStyles(styles);

  return (
    <Pressable
      onPress={() => setPreference(nextThemePreference(preference))}
      accessibilityRole="button"
      accessibilityLabel={describeThemePreference(preference, scheme)}
      accessibilityHint={`Switches to ${themePreferenceLabel(
        nextThemePreference(preference),
      ).toLowerCase()}`}
      style={({ pressed }) => [s.chip, pressed && { opacity: 0.7 }]}
    >
      <Text style={s.label}>{themePreferenceLabel(preference)}</Text>
    </Pressable>
  );
}

const styles = themed((c) => ({
  chip: {
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.elev,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  label: { color: c.dim, fontSize: 13, fontWeight: "600" },
}));
