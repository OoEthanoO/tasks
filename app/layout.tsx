import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "YanTasks",
  description: "Work through your tasks in one-hour turns. Start, pause, and begin fresh each day.",
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
