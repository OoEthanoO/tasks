import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ImageStyle,
  StyleSheet,
  TextStyle,
  ViewStyle,
  useColorScheme,
} from "react-native";
import {
  ColorScheme,
  THEME_KEY,
  ThemePreference,
  resolveColorScheme,
  sanitizeThemePreference,
} from "../../lib/theme";

export type Palette = {
  bg: string;
  elev: string;
  elev2: string;
  /** One step toward the viewer from `bg` — an active tab, not a control. */
  raised: string;
  line: string;
  lineSoft: string;
  text: string;
  dim: string;
  faint: string;
  accent: string;
  accentSoft: string;
  accentText: string;
  /** Sits on a filled accent surface, so it tracks the accent, not the page. */
  onAccent: string;
  danger: string;
  dangerSoft: string;
  warn: string;
  warnSoft: string;
  warnLine: string;
  ok: string;
  okSoft: string;
  okLine: string;
  /** Behind a modal sheet. */
  scrim: string;
  shadow: string;
};

/**
 * The web app's palettes, lifted from app/globals.css so the two match. Note
 * that elevation runs the other way in light: a card is white and the page
 * behind it is grey, where in dark the card is the lighter of the two.
 */
export const palettes: Record<ColorScheme, Palette> = {
  dark: {
    bg: "#0a0b0e",
    elev: "#14161c",
    elev2: "#1b1e26",
    raised: "#1b1e26",
    line: "#262a34",
    lineSoft: "#1e222a",
    text: "#e7e9ee",
    dim: "#9aa1b1",
    faint: "#6b7383",
    accent: "#7c6cff",
    accentSoft: "#7c6cff22",
    accentText: "#b6adff",
    onAccent: "#fff",
    danger: "#ff6b6b",
    dangerSoft: "#ff6b6b1f",
    warn: "#ffb454",
    warnSoft: "#ffb45418",
    warnLine: "#ffb45455",
    ok: "#4ade80",
    okSoft: "#4ade8018",
    okLine: "#4ade8055",
    scrim: "#000000aa",
    shadow: "#000",
  },
  light: {
    bg: "#f6f7f9",
    elev: "#ffffff",
    elev2: "#eef0f4",
    raised: "#ffffff",
    line: "#d5d9e2",
    lineSoft: "#e4e7ee",
    text: "#1a1d24",
    dim: "#5b6373",
    faint: "#6e7686",
    // The accent and the status hues are darkened here so they still carry
    // 4.5:1 against white; the dark palette's versions are far too pale.
    accent: "#5b4bd6",
    accentSoft: "#5b4bd614",
    accentText: "#4d3ec4",
    onAccent: "#fff",
    danger: "#c8302f",
    dangerSoft: "#c8302f14",
    warn: "#a86412",
    warnSoft: "#a8641214",
    warnLine: "#a8641255",
    ok: "#197a45",
    okSoft: "#197a4514",
    okLine: "#197a4555",
    scrim: "#171a2166",
    shadow: "#2c3242",
  },
};

export const radius = { lg: 14, md: 12, sm: 8 } as const;

export const mono =
  // The web UI sets times and percentages in a monospace face; these are the
  // iOS and Android equivalents.
  { fontFamily: undefined as string | undefined, fontVariant: ["tabular-nums" as const] };

/* ---------- provider ---------- */

type ThemeValue = {
  /** The live palette. Named `c` so call sites read as they did before. */
  c: Palette;
  scheme: ColorScheme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Null until the OS says, which `resolveColorScheme` reads as "stay dark".
  // This only reports anything at all because app.json asks for "automatic".
  const system = useColorScheme();
  const [preference, setStored] = useState<ThemePreference>("system");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(THEME_KEY);
        if (!cancelled) setStored(sanitizeThemePreference(raw));
      } catch {
        // Device storage unavailable — this session follows the system.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setStored(next);
    AsyncStorage.setItem(THEME_KEY, next).catch(() => {
      // The choice still holds for this session.
    });
  }, []);

  const scheme = resolveColorScheme(
    preference,
    system === "light" || system === "dark" ? system : null,
  );

  const value = useMemo(
    () => ({ c: palettes[scheme], scheme, preference, setPreference }),
    [scheme, preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme needs a <ThemeProvider> above it.");
  return value;
}

/* ---------- themed stylesheets ---------- */

type NamedStyles = Record<string, ViewStyle | TextStyle | ImageStyle>;

/**
 * `StyleSheet.create` runs at import time, which is far too early to know the
 * scheme. This builds one sheet per palette up front and `useStyles` hands
 * back the live one, so call sites still read a plain `s.thing`. There are
 * only ever two sheets per module, so building both eagerly is cheaper than
 * rebuilding one on every theme change.
 */
export function themed<T extends NamedStyles>(
  build: (c: Palette) => T,
): Record<ColorScheme, T> {
  return {
    dark: StyleSheet.create(build(palettes.dark)),
    light: StyleSheet.create(build(palettes.light)),
  };
}

export function useStyles<T extends NamedStyles>(
  sheets: Record<ColorScheme, T>,
): T {
  return sheets[useTheme().scheme];
}
