/**
 * app/api/assess/route.ts
 *
 * A server-side endpoint. Any file at app/api/<name>/route.ts becomes a URL
 * that the browser can call — here, /api/assess?q=greggs
 *
 * WHY THIS FILE EXISTS
 *
 * The browser must never call Companies House or Gemini directly. Code sent to
 * a browser can be read by anyone who opens developer tools, so an API key
 * used there is a public API key. There is no way around this.
 *
 * So the browser talks to us, and we talk to the outside world:
 *
 *     browser  ->  this route  ->  Companies House
 *              <-             <-
 *
 * This file runs only on the server. The visitor receives the assessment and
 * nothing else — not the key, not the raw register data, not our source.
 *
 * Note this route deliberately does NOT generate the memo. That takes 40+
 * seconds; the rules engine takes about one. Splitting them means the page can
 * show a verdict immediately and fill in the prose afterwards.
 */

import { NextRequest, NextResponse } from "next/server";
import { searchCompanies, buildDossier, CompaniesHouseError } from "@/lib/ch/client";
import { assess } from "@/lib/risk/engine";

/**
 * Force the Node.js runtime rather than Edge.
 *
 * Our Companies House client uses Buffer to build the auth header, and Buffer
 * is a Node API that does not exist in the Edge runtime. Being explicit means
 * this breaks loudly at build time rather than mysteriously in production.
 */
export const runtime = "nodejs";

/** UK company numbers are 8 characters: digits, or two letters then six digits. */
const COMPANY_NUMBER = /^[A-Z0-9]{8}$/i;

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();

  if (!query) {
    return NextResponse.json(
      { error: "Provide a company name or number, e.g. /api/assess?q=greggs" },
      { status: 400 }
    );
  }

  try {
    let companyNumber = query;
    let alternatives: { companyNumber: string; name: string; status: string }[] = [];

    // If it doesn't look like a company number, search by name and take the
    // top hit — but return the runners-up so the user can correct us. Search
    // ranking is a guess, and the interface should admit that.
    if (!COMPANY_NUMBER.test(query)) {
      const hits = await searchCompanies(query, 5);

      if (hits.length === 0) {
        return NextResponse.json(
          { error: `No UK company found matching "${query}".` },
          { status: 404 }
        );
      }

      companyNumber = hits[0].companyNumber;
      alternatives = hits.slice(1).map((h) => ({
        companyNumber: h.companyNumber,
        name: h.name,
        status: h.status,
      }));
    }

    const dossier = await buildDossier(companyNumber);
    const assessment = assess(dossier);

    // Send a little raw context alongside the verdict — the interface shows it
    // as factual background, distinct from anything we inferred.
    return NextResponse.json({
      assessment,
      alternatives,
      context: {
        status: dossier.profile.status,
        statusDetail: dossier.profile.statusDetail ?? null,
        incorporatedOn: dossier.profile.incorporatedOn ?? null,
        type: dossier.profile.type,
        activeOfficers: dossier.officers.filter((o) => o.active).length,
        outstandingCharges: dossier.charges.filter((c) => c.status === "outstanding").length,
        accountsNextDue: dossier.profile.accounts.nextDue ?? null,
        lastAccountsMadeUpTo: dossier.profile.accounts.lastMadeUpTo ?? null,
      },
    });
  } catch (error) {
    // Translate internal failures into something the interface can act on,
    // without leaking stack traces or key material to the browser.
    if (error instanceof CompaniesHouseError) {
      if (error.status === 404) {
        return NextResponse.json({ error: "That company number does not exist." }, { status: 404 });
      }
      if (error.status === 429) {
        return NextResponse.json(
          { error: "Companies House rate limit reached. Try again in a few minutes." },
          { status: 429 }
        );
      }
    }

    console.error("Assessment failed:", error);
    return NextResponse.json(
      { error: "Could not complete the assessment. Please try again." },
      { status: 500 }
    );
  }
}