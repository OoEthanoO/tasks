import type { Metadata } from "next";
import { THEME_KEY } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "YanTasks",
  description: "A task manager that tells you what to work on next.",
};

/**
 * Resolves the theme and stamps it on <html> before the first paint, so nobody
 * sees a dark screen fade to light on the way in. It has to be inline and
 * blocking for that; a module would run too late. Kept deliberately small, and
 * a mirror of `resolveColorScheme` — anything that is not an explicit choice
 * falls through to the OS, and an OS with no answer stays dark.
 */
const THEME_SCRIPT = `(function(){try{
var p=localStorage.getItem(${JSON.stringify(THEME_KEY)});
if(p!=="light"&&p!=="dark"){p=window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";}
document.documentElement.setAttribute("data-theme",p);
}catch(e){document.documentElement.setAttribute("data-theme","dark");}})()`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // The script below stamps data-theme on this element before React
    // hydrates, so the server's markup is expected not to match here.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
