"use client";

import { useEffect, useState } from "react";
import {
  ColorScheme,
  THEME_KEY,
  THEME_PREFERENCES,
  ThemePreference,
  describeThemePreference,
  resolveColorScheme,
  sanitizeThemePreference,
  themePreferenceLabel,
} from "@/lib/theme";

/** What the OS is asking for, or null if it will not say. */
function readSystemScheme(): ColorScheme | null {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  if (window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
  if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  return null;
}

export default function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>("system");
  const [system, setSystem] = useState<ColorScheme | null>(null);
  // The server has no way to know the stored choice, so the first paint of the
  // control shows nothing selected rather than guessing wrong and hydrating
  // over it. The page itself is already the right colour by then — the script
  // in <head> saw to that before anything rendered.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setPreference(
        sanitizeThemePreference(window.localStorage.getItem(THEME_KEY)),
      );
    } catch {
      // Storage blocked — this session just follows the system.
    }
    setSystem(readSystemScheme());
    setReady(true);
  }, []);

  // Someone flipping their OS theme should be followed live, not at next load.
  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setSystem(readSystemScheme());
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const scheme = resolveColorScheme(preference, system);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.setAttribute("data-theme", scheme);
  }, [ready, scheme]);

  function choose(next: ThemePreference) {
    setPreference(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // The choice still holds for this session.
    }
  }

  return (
    <div
      className="theme-toggle"
      role="group"
      aria-label={describeThemePreference(preference, scheme)}
    >
      {THEME_PREFERENCES.map((option) => {
        const active = ready && option === preference;
        return (
          <button
            key={option}
            type="button"
            className={`theme-option${active ? " is-active" : ""}`}
            aria-pressed={active}
            onClick={() => choose(option)}
            title={describeThemePreference(
              option,
              resolveColorScheme(option, system),
            )}
          >
            {themePreferenceLabel(option)}
          </button>
        );
      })}
    </div>
  );
}
