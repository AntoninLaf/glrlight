/**
 * assess.ts — Phase 2 test harness
 *
 *   node --env-file=.env.local --import tsx scripts/assess.ts "greggs"
 *   node --env-file=.env.local --import tsx scripts/assess.ts 00502851
 *
 * Fetches a company, runs the risk engine, and prints the verdict with every
 * signal and its evidence. This is the output the AI layer will later turn
 * into prose — seeing it raw first is the point.
 */

import { buildDossier, searchCompanies } from "../lib/ch/client";
import { assess } from "../lib/risk/engine";

const query = process.argv[2];

async function main() {
  if (!query) {
    console.log('Usage: ... scripts/assess.ts "company name or number"');
    return;
  }

  const looksLikeNumber = /^[A-Z0-9]{8}$/i.test(query);
  let companyNumber = query;

  if (!looksLikeNumber) {
    const hits = await searchCompanies(query, 3);
    if (hits.length === 0) {
      console.log("No companies found.");
      return;
    }
    companyNumber = hits[0].companyNumber;
    console.log(`Matched: ${hits[0].name} (${companyNumber})\n`);
  }

  const dossier = await buildDossier(companyNumber);
  const result = assess(dossier);

  // A coloured band header, because the verdict should be the first thing you see.
  const colour = { green: "\x1b[42m", amber: "\x1b[43m", red: "\x1b[41m" }[result.band];
  const reset = "\x1b[0m";

  console.log("=".repeat(66));
  console.log(`${result.companyName}  (${result.companyNumber})`);
  console.log(`${colour}  ${result.band.toUpperCase()}  ${reset}   score ${result.score}`);
  console.log("=".repeat(66));

  if (result.override) {
    console.log(`\nOVERRIDE: ${result.override}`);
  }

  if (result.signals.length === 0) {
    console.log("\nNo signals fired. Nothing unusual on the public register.");
  }

  for (const s of result.signals) {
    const points = { info: 0, low: 1, medium: 3, high: 5 }[s.severity];
    console.log(`\n[${s.severity.toUpperCase()}  +${points}]  ${s.label}`);
    console.log(`  What:  ${s.detail}`);
    console.log(`  But:   ${s.benign}`);
    console.log(`  From:  ${s.source}`);
  }

  if (result.dataGaps.length > 0) {
    console.log(`\n! Incomplete data — could not load: ${result.dataGaps.join(", ")}`);
    console.log("  The score below reflects only what was retrieved.");
  }

  console.log(`\nAssessed ${result.assessedAt}\n`);
}

main().catch((error) => {
  console.log("✗ Something went wrong:");
  console.log(`  ${error.message}`);
});