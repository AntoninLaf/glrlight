/**
 * baseline.ts — how common are these signals anyway?
 *
 *   node --env-file=.env.local --import tsx scripts/baseline.ts
 *   node --env-file=.env.local --import tsx scripts/baseline.ts --size 30
 *
 * The backtest kept showing filing signals firing in ~46% of surviving controls
 * and ~7% of companies that failed. Three independent rules produced the same
 * split, which is not how independent evidence behaves — one underlying thing
 * is driving all three.
 *
 * Two explanations remain, and they lead to opposite conclusions:
 *
 *   REAL        — a large share of "active" UK companies are semi-dormant
 *                 shells that chronically file late and never fail, while small
 *                 trading companies often collapse abruptly from a compliant
 *                 position. Late filing would then genuinely be MORE common
 *                 among survivors.
 *
 *   ARTEFACT    — something in the control selection or the rewind still treats
 *                 the two groups differently.
 *
 * This script separates them with no case-matching at all: take ordinary active
 * companies, score them at a historical cutoff, and measure how often each
 * signal fires in the general population.
 *
 *   ~46% firing  → the signal is simply COMMON. Not predictive, not an artefact.
 *   ~10% firing  → our control selection is broken and the backtest is wrong.
 *
 * Either answer ends the investigation, which is the point of running it.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { advancedSearch, buildDossier } from "../lib/ch/client";
import { assess } from "../lib/risk/engine";
import { rewind } from "../lib/risk/rewind";

const args = process.argv.slice(2);
const flag = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};

const SAMPLE_SIZE = flag("size", 30);
const PAUSE_MS = flag("pause", 5000);
const MIN_AGE_MONTHS = 48; // same floor as the backtest, so results compare

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Random cutoff in the same era as the backtest's cases, for comparability. */
function randomCutoff(): Date {
  const start = new Date("2018-01-01").getTime();
  const end = new Date("2023-06-01").getTime();
  return new Date(start + Math.random() * (end - start));
}

async function main() {
  console.log(`\nBaseline firing rates in the general population`);
  console.log(`  Sampling ${SAMPLE_SIZE} ordinary active companies`);
  console.log(`  No case matching, no failure involved\n`);

  // A random offset into the register, since advanced search returns a fixed
  // ordering and would otherwise hand us the same slice every run.
  const pool = await advancedSearch({
    companyStatus: ["active"],
    incorporatedFrom: "2000-01-01",
    incorporatedTo: "2016-01-01",
    size: 200,
    startIndex: Math.floor(Math.random() * 3000),
  });

  console.log(`  ${pool.length} candidates found\n`);

  const rows: { name: string; band: string; score: number; signalIds: string[] }[] = [];
  let skipped = 0;

  for (const candidate of pool) {
    if (rows.length >= SAMPLE_SIZE) break;

    try {
      const current = await buildDossier(candidate.companyNumber);
      const cutoff = randomCutoff();

      const incorporated = current.profile.incorporatedOn;
      if (!incorporated) {
        skipped++;
        continue;
      }

      const ageMonths =
        (cutoff.getTime() - new Date(incorporated).getTime()) / (1000 * 60 * 60 * 24 * 30.44);
      if (ageMonths < MIN_AGE_MONTHS) {
        skipped++;
        await sleep(PAUSE_MS);
        continue;
      }

      const filingsBefore = current.filings.filter((f) => new Date(f.date) <= cutoff);
      if (filingsBefore.length < 6) {
        skipped++;
        await sleep(PAUSE_MS);
        continue;
      }

      const { dossier } = rewind(current, cutoff);
      const result = assess(dossier);

      rows.push({
        name: current.profile.name,
        band: result.band,
        score: result.score,
        signalIds: result.signals.map((s) => s.id),
      });

      console.log(
        `  ${current.profile.name.slice(0, 40).padEnd(42)} ${result.band.padEnd(6)} score ${String(result.score).padStart(2)}  (as of ${cutoff.toISOString().slice(0, 10)})`
      );
    } catch {
      skipped++;
    }

    await sleep(PAUSE_MS);
  }

  if (rows.length === 0) {
    console.log("\nNo usable companies sampled. Try again — the offset is random.");
    return;
  }

  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
  const rate = (test: (r: (typeof rows)[0]) => boolean) =>
    rows.filter(test).length / rows.length;

  const allSignals = [...new Set(rows.flatMap((r) => r.signalIds))];

  /* Pull the failed-company rates from the last backtest, if it is there, so
     the two populations can be read side by side. */
  let failedRates: Record<string, number> = {};
  try {
    const prior = JSON.parse(readFileSync("backtest-results.json", "utf8"));
    const failedRows = (prior.rows ?? []).filter((r: any) => r.group === "failed");
    if (failedRows.length > 0) {
      for (const id of allSignals) {
        failedRates[id] =
          failedRows.filter((r: any) => r.signalIds.includes(id)).length / failedRows.length;
      }
    }
  } catch {
    // No prior backtest to compare against; not a problem.
  }

  console.log("\n" + "=".repeat(70));
  console.log(`BASELINE — ${rows.length} ordinary active companies`);
  console.log("=".repeat(70));

  console.log(`\nBand distribution in the general population:`);
  console.log(`  green   ${pct(rate((r) => r.band === "green"))}`);
  console.log(`  amber   ${pct(rate((r) => r.band === "amber"))}`);
  console.log(`  red     ${pct(rate((r) => r.band === "red"))}`);

  const hasComparison = Object.keys(failedRates).length > 0;

  console.log(`\nSignal firing rates:`);
  console.log(
    `  ${"signal".padEnd(30)} ${"population".padStart(10)}${hasComparison ? "  " + "failed".padStart(8) : ""}`
  );

  for (const id of allSignals.sort((a, b) => rate((r) => r.signalIds.includes(b)) - rate((r) => r.signalIds.includes(a)))) {
    const popRate = rate((r) => r.signalIds.includes(id));
    const comparison = hasComparison
      ? `  ${pct(failedRates[id] ?? 0).padStart(8)}`
      : "";
    console.log(`  ${id.padEnd(30)} ${pct(popRate).padStart(10)}${comparison}`);
  }

  console.log(`\n${skipped} companies skipped (too young, or too little history)`);

  console.log(`\nHow to read this:`);
  console.log(`  If the filing signals fire in roughly 40-50% of ordinary companies,`);
  console.log(`  they are COMMON rather than predictive — the backtest was measuring`);
  console.log(`  a real property of the register, not a broken control group.`);
  console.log(`  If they fire in roughly 10%, control selection is at fault.\n`);

  writeFileSync(
    "baseline-results.json",
    JSON.stringify({ runAt: new Date().toISOString(), rows, failedRates }, null, 2)
  );

  console.log(`Written: baseline-results.json\n`);
}

main().catch((error) => {
  console.log("\n✗ Baseline failed:");
  console.log(`  ${error.message}`);
});