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
        <p>
          Every open task gets a weight from its due date, and each pick is drawn at
          random in proportion to those weights.
        </p>
        <ul className="help-list">
          <li>
            Due <strong>tomorrow</strong> weighs 1, the day after 1/2, three days out
            1/3, and so on.
          </li>
          <li>
            Due <strong>today</strong> weighs 2. Each day it goes past due adds one —
            yesterday 3, the day before 4.
          </li>
          <li>
            <strong>Completed</strong> tasks weigh 0 and can never be drawn.
          </li>
          <li>
            A hidden <strong>Rest</strong> slice always sits in the pool, weighted the
            same as one task due tomorrow. When Rest wins, take a break. Its share
            shrinks as your list grows and returns as you finish things.
          </li>
        </ul>
        <p>
          The percentage beside each task is its exact chance of being drawn on the
          next spin, so the numbers always add up to what you see.
        </p>

        <h2 className="card-title" style={{ marginTop: 26 }}>
          Today&apos;s schedule
        </h2>
        <p>
          Generating a schedule spins the wheel once for every half hour between now
          and the end of your work day, which you set with &ldquo;Work day ends
          at&rdquo;. Blocks that land on Rest are breaks. An end time in the small
          hours means the night ahead, so setting 12:00 AM in the morning plans your
          day through to midnight.
        </p>
        <p>
          A schedule only means anything while it matches the weights it was drawn
          from, so it tells you when it is out of date: once it has run to its last
          block, when the date changes, when you move the end of your work day, or
          when you add, finish, delete or re-date a task. The date counts on its own —
          every weight is measured against today, so at midnight they all move.
          Renaming a task is the one edit that does not, since the weighting is
          unchanged; the block just shows the new name.
        </p>

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
          typed it on. Sign in and your tasks, schedule and preferences sync between
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
          immediate and permanent — the account and every task, preference, schedule and
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
