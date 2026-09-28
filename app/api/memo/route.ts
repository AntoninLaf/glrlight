/**
 * app/api/memo/route.ts
 *
 * A second endpoint, separate from /api/assess on purpose.
 *
 * The rules engine returns in about a second. Memo generation takes several.
 * Bundling them would make every lookup as slow as the slowest part, so the
 * interface calls this one only when the user asks for a briefing.
 *
 * Splitting slow, optional work away from fast, essential work is a general
 * interface principle, not a detail of this app.
 */

import { NextRequest, NextResponse } from "next/server";
import { buildDossier } from "@/lib/ch/client";
import { assess } from "@/lib/risk/engine";
import { writeMemo } from "@/lib/ai/memo";

export const runtime = "nodejs";

/**
 * Generation is slow AND metered, so the same company is never written twice
 * while the server is running.
 *
 * This cache lives in memory, which means it is lost on restart and not shared
 * between servers. That is fine for a demo and deliberately simple — a real
 * deployment would use a database, and the README says so rather than
 * pretending this is production-grade.
 */
const memoCache = new Map<string, { memo: string; model: string; at: number }>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // a day; the register moves slowly

export async function GET(request: NextRequest) {
  const companyNumber = request.nextUrl.searchParams.get("company")?.trim();

  if (!companyNumber) {
    return NextResponse.json({ error: "Provide a company number." }, { status: 400 });
  }

  const cached = memoCache.get(companyNumber);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ memo: cached.memo, model: cached.model, cached: true });
  }

  try {
    const dossier = await buildDossier(companyNumber);
    const assessment = assess(dossier);
    const { memo, model } = await writeMemo(assessment);

    memoCache.set(companyNumber, { memo, model, at: Date.now() });

    return NextResponse.json({ memo, model, cached: false });
  } catch (error) {
    console.error("Memo generation failed:", error);
    return NextResponse.json(
      { error: "Could not write the briefing right now. Please try again shortly." },
      { status: 503 }
    );
  }
}