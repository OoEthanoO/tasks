import { NextResponse } from "next/server";
import { getSql } from "@/lib/sql";
import { databaseReady } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Readiness verifies the existing database, without creating tables, sessions,
// or tracking checkpoints. Never expose connection strings or database errors.
export async function GET() {
  const version = {
    commit: process.env.YANTASKS_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "development",
    hosting: process.env.YANTASKS_HOST ?? "vercel",
  };
  const headers = { "Cache-Control": "no-store" };
  try {
    if (!await databaseReady(getSql())) throw new Error("Database unavailable");
    return NextResponse.json({ status: "ok", ...version }, { headers });
  } catch {
    return NextResponse.json({ status: "unavailable", ...version }, { status: 503, headers });
  }
}
