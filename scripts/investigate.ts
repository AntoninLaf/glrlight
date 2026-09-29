/**
 * investigate.ts — Phase 8 test harness
 *
 *   node --env-file=.env.local --import tsx scripts/investigate.ts "carillion"
 *
 * Runs the agent and prints its investigation trail step by step, then the
 * verdict from the deterministic engine. Watching the two side by side is the
 * point: the agent chose the route, the rules chose the answer.
 */

import { searchCompanies } from "../lib/ch/client";
import { investigate } from "../lib/ai/agent";

const query = process.argv[2];

async function main() {
  if (!query) {
    console.log('Usage: ... scripts/investigate.ts "company name or number"');
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

  console.log("Investigating. The agent decides what to look at.\n");

  const started = Date.now();
  const result = await investigate(companyNumber, console.log);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log("\n" + "=".repeat(70));
  console.log("INVESTIGATION TRAIL");
  console.log("=".repeat(70));

  for (const s of result.trail) {
    console.log(`\n${s.step}. ${s.tool}${s.args?.name ? ` — ${s.args.name}` : ""}`);
    if (s.thought) console.log(`   Why:   ${s.thought}`);
    console.log(`   Found: ${s.found}`);
  }

  console.log("\n" + "=".repeat(70));
  console.log("THE AGENT'S SUMMARY");
  console.log("=".repeat(70));
  console.log(result.conclusion);

  console.log("\n" + "=".repeat(70));
  console.log("THE RULES ENGINE'S VERDICT");
  console.log("=".repeat(70));
  console.log(
    `${result.assessment.band.toUpperCase()}  score ${result.assessment.score}  (${result.assessment.signals.length} signals)`
  );
  for (const sig of result.assessment.signals) {
    const pts = { info: 0, low: 1, medium: 3, high: 5 }[sig.severity];
    console.log(`  +${pts}  ${sig.label}`);
  }

  console.log(`\n${result.steps} tool calls · ${result.model} · ${seconds}s\n`);
}

main().catch((error) => {
  console.log("\n✗ Investigation failed:");
  console.log(`  ${error.message}`);
});