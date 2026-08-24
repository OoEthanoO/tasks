/**
 * What the user picked, and what that resolves to. Shared by the web app and
 * the phone so a preference means the same thing on both — only the palettes
 * themselves are per-platform (CSS custom properties vs. a JS object).
 */

/** The three states of the control: follow the OS, or pin one scheme. */
export type ThemePreference = "system" | "light" | "dark";

/** What actually gets painted, once the preference has been resolved. */
export type ColorScheme = "light" | "dark";

// Unversioned reads elsewhere would be ambiguous; keep the suffix the other
// stored keys use so the whole set reads consistently.
export const THEME_KEY = "yantasks.theme.v1";

/** The cycle order of the control, and the order it lists its options in. */
export const THEME_PREFERENCES: readonly ThemePreference[] = [
  "system",
  "light",
  "dark",
];

/**
 * Anything unrecognised means system: a key written by an older build, a
 * half-written value, or storage that came back empty.
 */
export function sanitizeThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

/**
 * `systemScheme` is null when the platform has no answer — no `matchMedia`, a
 * browser that reports neither preference, or React Native before the OS
 * setting is known. This app was dark long before it was anything else, so an
 * unknown system stays dark rather than flashing a light screen at someone who
 * never asked for one.
 */
export function resolveColorScheme(
  preference: ThemePreference,
  systemScheme: ColorScheme | null,
): ColorScheme {
  if (preference !== "system") return preference;
  return systemScheme ?? "dark";
}

/** Advances the control one step: system → light → dark → system. */
export function nextThemePreference(
  preference: ThemePreference,
): ThemePreference {
  const i = THEME_PREFERENCES.indexOf(preference);
  return THEME_PREFERENCES[(i + 1) % THEME_PREFERENCES.length];
}

/** The word the control shows for each state. */
export function themePreferenceLabel(preference: ThemePreference): string {
  return preference === "system"
    ? "System"
    : preference === "light"
      ? "Light"
      : "Dark";
}

/**
 * What the control says it will do, for a tooltip or a screen reader. It names
 * the resolved scheme too, because "System" alone does not tell you which one
 * you are looking at.
 */
export function describeThemePreference(
  preference: ThemePreference,
  scheme: ColorScheme,
): string {
  return preference === "system"
    ? `Theme: following your system (${scheme})`
    : `Theme: ${scheme}`;
}
