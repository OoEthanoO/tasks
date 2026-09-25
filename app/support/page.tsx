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
          How the weighting works
        </h2>
        <p>Open tasks divide 100% of work time by their due-date weights: tomorrow weighs 1, today weighs 2, and each overdue day adds 1. Later tasks weigh 1 divided by days until due. Priority then multiplies that weight: low (the default) ×1, medium ×2, high ×4. Permanently completed tasks weigh zero.</p>
        <h2 className="card-title" style={{ marginTop: 26 }}>Track your work</h2>
        <p>Start working chooses the first task in your list that has not met its daily target; weight decides how much time a task gets, not when. Use Track on another task to switch. The app reserves time for upcoming breaks, then balances final task totals by weight while keeping logged time fixed. Tasks already above their fair share receive no extra time; unfinished targets together fit the work time left. A task whose share of the day would come to under 30 minutes is skipped, and that time goes to more urgent tasks. Reaching a target marks the task Done for today and automatically moves to the next unfinished task in the list.</p>
        <p>Every 90 accumulated work minutes starts 30 minutes of tracked rest, then work resumes. Pausing stops either counter without bypassing an unfinished break. The work-day cutoff stops tracking. At midnight in your shared timer’s time zone, daily time is reset and tracking stays paused until you start again.</p>
        <h2 className="card-title" style={{ marginTop: 26 }}>Alerts</h2>
        <p>Enable alerts for task completion, a five-minute rest warning, rest start and rest completion. Browser alerts need the page open; phone alerts can fire while locked. Alerts follow the device that last started or switched tracking. If you change the timer elsewhere while the phone is suspended, reopen the phone app to refresh its previously scheduled alerts.</p>

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
          typed it on. Sign in and your tasks, tracked time, active timer and preferences sync between
          the iPhone app and this website. If you already have tasks on a device and
          sign in to an empty account, you will be asked before anything moves.
        </p>
        <p>
          If the app ever says <strong>Not saved</strong>, your edits are still on the
          device and nothing is lost — press Retry, or leave it and it will go out with
          the next change.
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
