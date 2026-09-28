/**
 * dossier.ts — Phase 1 test harness
 *
 * Runs the data layer by hand so you can see what comes back, before any of it
 * is wired to a web page.
 *
 *   node --env-file=.env.local --import tsx scripts/dossier.ts "greggs"
 *   node --env-file=.env.local --import tsx scripts/dossier.ts 00502851
 *
 * Accepts a company name (searches, uses the top hit) or a company number.
 */

import { buildDossier, searchCompanies } from "../lib/ch/client";

// process.argv is the list of words you typed. Position 0 is node, position 1
// is this file, so position 2 is the first thing YOU typed.
// Python equivalent: sys.argv[1]
const query = process.argv[2];

async function main() {
  if (!query) {
    console.log('Usage: ... scripts/dossier.ts "company name or number"');
    return;
  }

  // UK company numbers are 8 characters, letters and digits. If it looks like
  // one, use it directly. Otherwise treat the input as a name and search.
  const looksLikeNumber = /^[A-Z0-9]{8}$/i.test(query);

  let companyNumber = query;

  if (!looksLikeNumber) {
    console.log(`Searching for "${query}"...\n`);
    const hits = await searchCompanies(query, 5);

    if (hits.length === 0) {
      console.log("No companies found.");
      return;
    }

    hits.forEach((h, i) =>
      console.log(`  ${i === 0 ? "→" : " "} ${h.name} (${h.companyNumber}) · ${h.status}`)
    );

    companyNumber = hits[0].companyNumber;
    console.log(`\nUsing ${companyNumber}\n`);
  }

  const started = Date.now();
  const d = await buildDossier(companyNumber);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  // A small helper so the output lines up. padEnd pads a string with spaces.
  const row = (label: string, value: unknown) =>
    console.log(`  ${label.padEnd(26)} ${value}`);

  console.log("=".repeat(62));
  console.log(d.profile.name);
  console.log("=".repeat(62));

  row("Number", d.profile.companyNumber);
  row("Status", d.profile.status + (d.profile.statusDetail ? ` (${d.profile.statusDetail})` : ""));
  row("Incorporated", d.profile.incorporatedOn ?? "—");
  row("SIC codes", d.profile.sicCodes.join(", ") || "—");

  console.log("\n  Filing position");
  row("Accounts next due", d.profile.accounts.nextDue ?? "—");
  row("Accounts overdue", d.profile.accounts.overdue ? "YES" : "no");
  row("Last accounts type", d.profile.accounts.lastType ?? "—");
  row(
    "Year end",
    d.profile.accounts.accountingReferenceDate
      ? `${d.profile.accounts.accountingReferenceDate.day}/${d.profile.accounts.accountingReferenceDate.month}`
      : "—"
  );
  row("Conf. statement overdue", d.profile.confirmationStatement.overdue ? "YES" : "no");

  console.log("\n  Flags");
  row("Has charges", d.profile.hasCharges);
  row("Insolvency history", d.profile.hasInsolvencyHistory);
  row("Previous names", d.profile.previousNames.length);

  console.log("\n  Volumes pulled");
  row("Officers", `${d.officers.length} (${d.officers.filter((o) => o.active).length} active)`);
  row("Filings", d.filings.length);
  row(
    "Charges",
    `${d.charges.length} (${d.charges.filter((c) => c.status === "outstanding").length} outstanding)`
  );
  row("PSCs", d.pscs.length);
  row("Directors traced", d.directorHistories.length);

  // A preview of the director-history signal we'll score in Phase 2.
  if (d.directorHistories.length > 0) {
    console.log("\n  Director footprint");
    const badOutcomes = ["dissolved", "liquidation", "administration", "receivership"];

    for (const dir of d.directorHistories) {
      const total = dir.appointments.length;
      const bad = dir.appointments.filter((a) =>
        badOutcomes.includes(a.companyStatus ?? "")
      ).length;
      console.log(`    ${dir.name.padEnd(36)} ${total} appointments, ${bad} ended badly`);
    }
  }

  // The most recent register activity — this becomes the timeline in Phase 4.
  console.log("\n  Five most recent filings");
  for (const f of d.filings.slice(0, 5)) {
    console.log(`    ${f.date}  ${f.category.padEnd(22)} ${(f.description ?? "").slice(0, 46)}`);
  }

  if (d.partialFailures.length > 0) {
    console.log(`\n  ! Incomplete: ${d.partialFailures.join(", ")}`);
  }

  console.log(`\n  Built in ${seconds}s · about ${5 + d.directorHistories.length} API requests\n`);
}

main().catch((error) => {
  console.log("✗ Something went wrong:");
  console.log(`  ${error.message}`);
});