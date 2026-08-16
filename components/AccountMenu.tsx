"use client";

import { User } from "@/lib/types";

type Props = {
  user: User | null;
  loading: boolean;
  syncing: boolean;
  syncError: string | null;
  onSignIn: () => void;
  onSignUp: () => void;
  onSignOut: () => void;
  onDeleteAccount: () => void;
};

export default function AccountMenu({
  user,
  loading,
  syncing,
  syncError,
  onSignIn,
  onSignUp,
  onSignOut,
  onDeleteAccount,
}: Props) {
  if (loading) {
    return <span className="account-chip is-quiet">…</span>;
  }

  if (!user) {
    return (
      <div className="account">
        <span
          className="account-chip is-quiet"
          title="Your tasks are saved in this browser only"
        >
          On this device
        </span>
        <button type="button" className="btn btn-ghost" onClick={onSignIn}>
          Sign in
        </button>
        <button type="button" className="btn" onClick={onSignUp}>
          Create account
        </button>
      </div>
    );
  }

  return (
    <div className="account">
      <span
        className={`account-chip${syncError ? " is-error" : ""}`}
        title={
          syncError
            ? syncError
            : syncing
              ? "Saving to your account…"
              : `Signed in as ${user.username} — synced to your account`
        }
      >
        <span
          className={`sync-dot${syncing ? " is-busy" : ""}${syncError ? " is-error" : ""}`}
          aria-hidden="true"
        />
        {user.username}
      </span>
      <button type="button" className="btn btn-ghost" onClick={onSignOut}>
        Sign out
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={onDeleteAccount}
        title="Permanently erase this account and everything in it"
      >
        Delete account
      </button>
    </div>
  );
}
