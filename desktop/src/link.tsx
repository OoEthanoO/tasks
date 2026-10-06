import type { AnchorHTMLAttributes } from "react";

/** Shared web footer links open the corresponding public page through IPC.
 * Electron has no Next router, and the sandbox never navigates off its UI. */
export default function Link({ href, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const page = href === "/support" ? "support" : href === "/privacy" ? "privacy" : null;
  return <a {...props} href={page ? `https://tasks.ethanyanxu.com/${page}` : "#"} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    if (page) void window.desktop.window(page);
  }} />;
}
