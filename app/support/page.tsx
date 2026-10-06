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
          A daily recommendation, not a quota
        </h2>
        <p>Each unfinished task adds 60 minutes divided by (days until due + 1). Tasks due today or overdue count as zero days away. Add these contributions, round up to 30 minutes, and cap at 3 hours. The same rule applies every day; all future tasks count. This is pacing advice, not an estimate of the time needed to finish everything.</p>
        <h2 className="card-title" style={{ marginTop: 26 }}>Track when you can</h2>
        <p>Start suggested task begins a 30-minute turn, or resumes a partly worked turn. Every task remains in a fair rotation across days. Near deadlines get at most a 2× boost, so distant tasks keep getting opportunities. Choose any open task manually if you prefer. A turn finishing pauses tracking and asks you to choose the next task or continue the same one.</p>
        <p>Waiting never drains idle time, adds work, or creates debt. Reaching the recommendation pauses tracking; extra work remains optional. Only a task’s checkbox completes it. Daily tracked counters reset at midnight in the shared timer’s time zone, but rotation history stays. Upgrading checkpoints the old timer first, preserving work already earned and its notification owner.</p>
        <h2 className="card-title" style={{ marginTop: 26 }}>Optional outings</h2>
        <p>Can I go out now? subtracts your remaining recommendation, round-trip travel and other time you reserve from the time until bedtime. The rest is how long you can spend there if you leave now and work afterward. This does not guarantee real tasks will be finished. Bedtime is for this advice only, not a tracking cutoff.</p>
        <h2 className="card-title" style={{ marginTop: 26 }}>Alerts</h2>
        <p>Enable alerts for turn completion, reaching today’s recommendation, and tracking crossing midnight. Browser alerts need the page open; phone alerts can fire while locked; Windows alerts need an awake PC and running app. Alerts follow the last device that controlled tracking. If you change the timer elsewhere while the phone is suspended, reopen the phone app to refresh scheduled alerts. OS settings may silence delivery.</p>

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
