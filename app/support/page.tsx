import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Support — YanTasks",
  description: "How YanTasks works, and how to get help with it.",
};

const CONTACT = "ethanxucoder@gmail.com";

export default function SupportPage() {
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <h1>
            YanTasks<span className="dot">.</span>
          </h1>
          <span className="tagline">support</span>
        </div>
        <div className="topbar-actions">
          <Link className="btn btn-ghost" href="/">
            Back to app
          </Link>
        </div>
      </header>

      <section className="card" style={{ maxWidth: 760, margin: "0 auto" }}>
        <h2 className="card-title">Getting help</h2>
        <p>
          Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. Include what you were
          doing and, if something went wrong, roughly when — that is usually enough to
          find it. Bug reports and feature requests are both welcome.
        </p>

        <h2 className="card-title" style={{ marginTop: 26 }}>
          One-hour turns
        </h2>
        <p>Tasks appear by due date, then by when they were created. Press Start to work on the task chosen by the rotation. The timer advances automatically after each hour. Press Pause when you stop working; Start resumes the remaining time in your turn.</p>
        <p>Tracked time is for today only. At midnight in your timer’s time zone, task times and unfinished turns reset and tracking pauses. Press Start the next day to begin at the top again. This also works after the app has been closed or your device has been asleep.</p>
        <p>A new task starts at zero and catches up to the task before it. For example, with today’s totals of 2 hours, 0 hours, and 2 hours in list order, the middle task gets two consecutive one-hour turns. Normal turns end at the next hour mark: 50 minutes tracked leaves 10 minutes, not another full hour. A shorter catch-up may repair a fractional gap after reordering tasks.</p>
        <p>The nightly reset never deletes tasks or changes their completion checkboxes. Only checking a task’s box marks it complete. Use Edit to change its title, description, or due date, or to delete it. Completed tasks stay in the Completed section until one month after completion; uncheck one to reopen it.</p>
        <h2 className="card-title" style={{ marginTop: 26 }}>Notifications</h2>
        <p>Use Enable notifications beneath the timer to allow turn alerts. Browser notifications need this page open. Alerts follow the device that last controlled tracking, and your browser or operating system may silence them.</p>

        <h2 className="card-title" style={{ marginTop: 26 }}>
          Typing dates
        </h2>
        <p>
          Put the date at the end of the title and it is read automatically:{" "}
          <code>finish the essay tomorrow</code> becomes a task called &ldquo;finish
          the essay&rdquo;, due tomorrow. Also understood: <code>tmr</code>,{" "}
          <code>today</code>, <code>yesterday</code>, <code>next friday</code>,{" "}
          <code>aug 28</code>, <code>8/28</code>, <code>2026-09-01</code>,{" "}
          <code>in 3 days</code>, <code>in 2 weeks</code>, and{" "}
          <code>5 days ago</code> for something already late.
        </p>

        <h2 className="card-title" style={{ marginTop: 26 }}>
          Accounts and syncing
        </h2>
        <p>
          You do not need an account. Without one, everything stays on the device you
          typed it on. Sign in and your tasks, today’s tracked time, and active timer sync between
          your devices. If you already have tasks on a device and
          sign in to an empty account, you will be asked before anything moves.
        </p>
        <p>
          If the app says <strong>Not saved</strong>, keep the page open and press Retry
          to save your pending edits. Changing a synced timer requires a server connection.
        </p>

        <h2 className="card-title" style={{ marginTop: 26 }}>
          Deleting your account
        </h2>
        <p>
          In the iPhone app, tap your username, then <strong>Delete account</strong>. On
          this website, use <strong>Delete account</strong> beside your username. It is
          immediate and permanent — the account and every task, preference, tracked time and
          session belonging to it are erased. If you cannot reach your account, email the
          address above.
        </p>

        <h2 className="card-title" style={{ marginTop: 26 }}>
          Privacy
        </h2>
        <p>
          No ads, no analytics, no tracking, and nothing sold or shared. The{" "}
          <Link href="/privacy">privacy policy</Link> lists exactly what is stored.
        </p>
      </section>
    </main>
  );
}
