import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy — YanTasks",
  description: "What YanTasks stores, why, and how to get rid of it.",
};

const UPDATED = "August 16, 2026";
const CONTACT = "ethanxucoder@gmail.com";

export default function PrivacyPage() {
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <h1>
            YanTasks<span className="dot">.</span>
          </h1>
          <span className="tagline">privacy policy</span>
        </div>
        <div className="topbar-actions">
          <Link className="btn btn-ghost" href="/">
            Back to app
          </Link>
        </div>
      </header>

      <section className="card" style={{ maxWidth: 760, margin: "0 auto" }}>
        <p className="hint">Last updated {UPDATED}</p>

        <h2 className="card-title" style={{ marginTop: 20 }}>
          The short version
        </h2>
        <p>
          YanTasks stores the tasks you type and the account you sign in with. That is
          all. There is no analytics, no advertising, no tracking, and nothing is sold
          or handed to anyone else. You can delete your account, and everything in it,
          from inside the app at any time.
        </p>

        <h2 className="card-title" style={{ marginTop: 24 }}>
          Without an account
        </h2>
        <p>
          If you never sign in, nothing leaves your device. Tasks live in your
          browser&apos;s local storage, or in the app&apos;s own storage on iOS, and are
          never sent to the server. Clearing your browser data, or deleting the app,
          erases them.
        </p>

        <h2 className="card-title" style={{ marginTop: 24 }}>
          With an account
        </h2>
        <p>Signing in stores the following on the server:</p>
        <ul className="help-list">
          <li>
            <strong>Your username</strong>, as you typed it and in lowercase, so names
            can be compared without case getting in the way.
          </li>
          <li>
            <strong>A hash of your password</strong> — scrypt, with a random salt. The
            password itself is never written down and cannot be recovered from the hash.
          </li>
          <li>
            <strong>Your tasks</strong>: title, description, due date, and whether each
            is done. Whatever you type into a task is stored verbatim, so treat the
            description field the way you would any note you keep online.
          </li>
          <li>
            <strong>Your schedule and preferences</strong>: the generated day plan, your
            last recommendation, and the time your work day ends.
          </li>
          <li>
            <strong>Session tokens</strong>, stored only as a SHA-256 digest, so a copy
            of the database cannot be replayed as a live login.
          </li>
        </ul>
        <p>
          No email address, phone number, real name, contacts, location, photos, or
          device identifiers are collected. The app asks for no system permissions.
        </p>

        <h2 className="card-title" style={{ marginTop: 24 }}>
          Sign-in throttling
        </h2>
        <p>
          To limit password guessing, failed sign-in and sign-up attempts are counted
          against the requesting IP address for fifteen minutes. Those counters are
          deleted automatically once the window passes.
        </p>

        <h2 className="card-title" style={{ marginTop: 24 }}>
          Where it is kept
        </h2>
        <p>
          The app runs on Vercel and stores data in a Neon Postgres database. Both act
          as processors for this app and nothing is shared with them beyond what is
          needed to run it. All traffic is over HTTPS.
        </p>

        <h2 className="card-title" style={{ marginTop: 24 }}>
          Deleting your account
        </h2>
        <p>
          In the iOS app, tap your username, then <strong>Delete account</strong>. On the
          web, use <strong>Delete account</strong> beside your username. Deletion is
          immediate and permanent: the account row and every task, preference, schedule
          and session belonging to it are removed from the database. There is no
          soft-delete, no archive, and no way to restore it afterwards.
        </p>

        <h2 className="card-title" style={{ marginTop: 24 }}>
          Children
        </h2>
        <p>
          YanTasks is a general-audience task manager and is not directed at children
          under 13.
        </p>

        <h2 className="card-title" style={{ marginTop: 24 }}>
          Changes and contact
        </h2>
        <p>
          If this policy changes, the date at the top changes with it. Questions, or a
          request to delete data you can no longer reach: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </section>
    </main>
  );
}
