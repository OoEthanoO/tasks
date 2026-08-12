import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "YanTasks",
  description: "A task manager that tells you what to work on next.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
