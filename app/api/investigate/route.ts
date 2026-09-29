/**
 * app/api/investigate/route.ts
 *
 * Runs the investigating agent and returns its trail, its written summary, and
 * the deterministic verdict.
 *
 * Separate from /api/assess because it is slow (10–15 seconds, several model
 * turns) and optional. The interface loads it only when someone opens the
 * Investigation tab, so an ordinary lookup never pays for it.
 */

import { NextRequest, NextResponse } from "next/server";
import { investigate } from "@/lib/ai/agent";

export const runtime = "nodejs";
// Agent loops take several model round-trips; the default serverless timeout is
// not generous enough.
export const maxDuration = 60;

/**
 * Investigations are expensive in both time and quota, so a company is only
 * investigated once while the server is running.
 *
 * In memory, which means it is lost on restart and not shared between server
 * instances. Fine for a demo, and stated plainly rather than dressed up — a
 * real deployment would use a database.
 */
const cache = new Map<string, { payload: unknown; at: number }>();
const TTL_MS = 1000 * 60 * 60 * 24;

export async function GET(request: NextRequest) {
  const companyNumber = request.nextUrl.searchParams.get("company")?.trim();

  if (!companyNumber) {
    return NextResponse.json({ error: "Provide a company number." }, { status: 400 });
  }

  const cached = cache.get(companyNumber);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json({ ...(cached.payload as object), cached: true });
  }

  try {
    const result = await investigate(companyNumber);

    const payload = {
      trail: result.trail,
      conclusion: result.conclusion,
      band: result.assessment.band,
      score: result.assessment.score,
      model: result.model,
      steps: result.steps,
    };

    cache.set(companyNumber, { payload, at: Date.now() });
    return NextResponse.json({ ...payload, cached: false });
  } catch (error) {
    console.error("Investigation failed:", error);
    return NextResponse.json(
      { error: "The investigation could not be completed right now." },
      { status: 503 }
    );
  }
}