/** The web app's palette, lifted from app/globals.css so the two match. */
export const c = {
  bg: "#0a0b0e",
  elev: "#14161c",
  elev2: "#1b1e26",
  line: "#262a34",
  lineSoft: "#1e222a",
  text: "#e7e9ee",
  dim: "#9aa1b1",
  faint: "#6b7383",
  accent: "#7c6cff",
  accentSoft: "#7c6cff22",
  danger: "#ff6b6b",
  dangerSoft: "#ff6b6b1f",
  warn: "#ffb454",
  ok: "#4ade80",
} as const;

export const radius = { lg: 14, md: 12, sm: 8 } as const;

export const mono =
  // The web UI sets times and percentages in a monospace face; these are the
  // iOS and Android equivalents.
  { fontFamily: undefined as string | undefined, fontVariant: ["tabular-nums" as const] };
