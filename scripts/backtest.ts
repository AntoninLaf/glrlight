/**
 * backtest.ts — Phase 7
 *
 * Does GLRlight flag companies BEFORE they fail?
 *
 *   node --env-file=.env.local --import tsx scripts/backtest.ts
 *   node --env-file=.env.local --import tsx scripts/backtest.ts --size 30 --lead 12
 *
 * Method
 *   1. Sample companies now in liquidation, administration or receivership.
 *   2. Find when their insolvency actually began (earliest insolvency filing).
 *   3. Rewind the register to N months before that, stripping out everything
 *      that happened afterwards (see lib/risk/rewind.ts).
 *   4. Score the rewound dossier.
 *   5. Do the same for surviving companies matched on sector and age.
 *   6. Compare.
 *
 * Writes backtest-results.json and BACKTEST.md.
 */

import { writeFileSync } from "node:fs";
import { advancedSearch, buildDossier } from "../lib/ch/client";
import { assess, type Band } from "../lib/risk/engine";
import { rewind, insolvencyOnset } from "../lib/risk/rewind";

/* ---------------- Settings ---------------- */

const args = process.argv.slice(2);
const flag = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};

const SAMPLE_SIZE = flag("size", 20);   // companies per group
const LEAD_MONTHS = flag("lead", 12);   // how far ahead we are asking it to see

/**
 * Only test insolvencies that began on or after this year.
 *
 * Without it the sample fills with dormant property companies whose
 * liquidations have been grinding on since 2004 — the first run produced
 * cutoffs from 2002 to 2015. Filing behaviour, the PSC regime and the
 * register itself have all changed since. Recent failures are the ones whose
 * behaviour resembles what a user would be screening today.
 */
const SINCE_YEAR = flag("since", 2018);

/**
 * Minimum company age at the cutoff, in months, applied to BOTH groups.
 *
 * This exists because of a confound that inverted an earlier run. Controls were
 * required to be established at the cutoff; cases were not. Several signals —
 * accounts overdue, confirmation overdue — need at least two prior filings to
 * fire at all, so young companies are structurally incapable of tripping them.
 *
 * The result: controls (old, eligible) lit up, cases (young, ineligible) scored
 * zero, and the test appeared to show that late filing predicts SURVIVAL. It was
 * measuring age, not failure — a classic confounding variable, where the groups
 * differ systematically on something other than the thing being studied.
 *
 * Applying the same floor to both sides is what makes the comparison honest. It
 * also narrows what the test can claim: this measures companies with a filing
 * history, and says nothing about start-ups.
 */
const MIN_AGE_MONTHS = 48;

/**
 * How often UK companies actually enter insolvency in a year. Roughly half a
 * percent. This number does not affect detection — it affects what detection
 * MEANS, which is the whole point of the base-rate section below.
 */
const REAL_BASE_RATE = 0.005;

/**
 * Companies House allows 600 requests per five minutes across all endpoints,
 * and each company costs about ten. Pausing between companies keeps us inside
 * it without needing a token bucket.
 */
const PAUSE_MS = flag("pause", 5000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------------- Result shapes ---------------- */

interface Row {
  companyNumber: string;
  companyName: string;
  group: "failed" | "survived";
  cutoff: string;
  band: Band;
  score: number;
  signalIds: string[];
}

function monthsBefore(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() - months);
  return d;
}

/* ---------------- Running one company ---------------- */

async function scoreAtCutoff(
  companyNumber: string,
  group: "failed" | "survived",
  cutoff: Date
): Promise<Row | null> {
  const current = await buildDossier(companyNumber);

  // The same age floor for both groups. See MIN_AGE_MONTHS above: without this
  // the test measures age rather than failure.
  const incorporated = current.profile.incorporatedOn;
  if (!incorporated) return null;

  const ageMonths =
    (cutoff.getTime() - new Date(incorporated).getTime()) / (1000 * 60 * 60 * 24 * 30.44);

  if (ageMonths < MIN_AGE_MONTHS) return null;

  // Filing history before the cutoff is what the time-based rules read.
  const filingsBefore = current.filings.filter((f) => new Date(f.date) <= cutoff);
  if (filingsBefore.length < 6) return null;

  const { dossier } = rewind(current, cutoff);
  const result = assess(dossier);

  return {
    companyNumber,
    companyName: current.profile.name,
    group,
    cutoff: cutoff.toISOString().slice(0, 10),
    band: result.band,
    score: result.score,
    signalIds: result.signals.map((s) => s.id),
  };
}

/* ---------------- Main ---------------- */

async function main() {
  console.log(`\nGLRlight backtest`);
  console.log(`  Sample: ${SAMPLE_SIZE} failed + ${SAMPLE_SIZE} surviving`);
  console.log(`  Asking the engine to see ${LEAD_MONTHS} months ahead`);
  console.log(`  Estimated run time: ${Math.round((SAMPLE_SIZE * 2 * PAUSE_MS) / 60000)} minutes\n`);

  /* --- Find failed companies --- */
  // Restricted to companies incorporated before 2018 so they have enough
  // filing history to judge at the cutoff.
  console.log("Sampling companies in insolvency...");
  const failedPool = await advancedSearch({
    companyStatus: ["liquidation", "administration", "receivership"],
    incorporatedFrom: "2000-01-01",
    incorporatedTo: "2018-01-01",
    size: 200,
    // Advanced search returns a fixed ordering, so every run drew the same
    // slice of the register — the first samples were almost entirely Northern
    // Irish construction firms. A random offset spreads it out.
    startIndex: Math.floor(Math.random() * 1500),
  });

  console.log(`  ${failedPool.length} candidates found\n`);

  const rows: Row[] = [];
  const skipped: string[] = [];
  const usedControls = new Set<string>();

  for (const candidate of failedPool) {
    if (rows.filter((r) => r.group === "failed").length >= SAMPLE_SIZE) break;

    try {
      const current = await buildDossier(candidate.companyNumber);
      const onset = insolvencyOnset(current);

      if (!onset) {
        skipped.push(`${candidate.name}: no dated insolvency filing`);
        await sleep(PAUSE_MS);
        continue;
      }

      if (onset.getFullYear() < SINCE_YEAR) {
        skipped.push(`${candidate.name}: insolvency began ${onset.getFullYear()}, before cutoff year`);
        await sleep(PAUSE_MS);
        continue;
      }

      const cutoff = monthsBefore(onset, LEAD_MONTHS);
      const row = await scoreAtCutoff(candidate.companyNumber, "failed", cutoff);

      if (!row) {
        skipped.push(`${candidate.name}: too young at cutoff, or too little filing history`);
        await sleep(PAUSE_MS);
        continue;
      }

      rows.push(row);
      console.log(
        `  [failed]   ${row.companyName.slice(0, 38).padEnd(40)} ${row.band.padEnd(6)} score ${row.score}  (as of ${row.cutoff})`
      );

      /* --- Find a matched control --- */
      // Same sector, similar age, still trading. Matching matters: without it
      // you end up comparing failed builders against surviving law firms and
      // measuring the sector, not the signals.
      const sic = current.profile.sicCodes[0];
      const incorporated = current.profile.incorporatedOn;

      if (sic && incorporated) {
        const year = Number(incorporated.slice(0, 4));

        // Try a sector-matched control first. If the sector is too narrow to
        // yield one, fall back to age-matching alone rather than dropping the
        // case — a weaker match still beats an empty control group, and the
        // first run lost half its controls this way.
        let controlPool = await advancedSearch({
          companyStatus: ["active"],
          sicCodes: [sic],
          // Age-matched to the CASE, not to the cutoff. The case has already
          // passed the MIN_AGE_MONTHS floor, so a control within a few years of
          // its incorporation date is comparably established. Anchoring the
          // window to the cutoff instead is what produced the age confound.
          incorporatedFrom: `${year - 3}-01-01`,
          incorporatedTo: `${year + 3}-12-31`,
          size: 20,
        });

        if (controlPool.every((c) => usedControls.has(c.companyNumber))) {
          controlPool = await advancedSearch({
            companyStatus: ["active"],
            incorporatedFrom: `${year - 3}-01-01`,
            incorporatedTo: `${year + 3}-12-31`,
            size: 40,
          });
        }

        const control = controlPool.find((c) => !usedControls.has(c.companyNumber));

        if (control) {
          usedControls.add(control.companyNumber);
          // Same calendar cutoff as its matched case, so both are judged
          // against the same economic conditions.
          const controlRow = await scoreAtCutoff(control.companyNumber, "survived", cutoff);

          if (controlRow) {
            rows.push(controlRow);
            console.log(
              `  [survived] ${controlRow.companyName.slice(0, 38).padEnd(40)} ${controlRow.band.padEnd(6)} score ${controlRow.score}`
            );
          }
        }
      }
    } catch (error) {
      skipped.push(`${candidate.name}: ${(error as Error).message}`);
    }

    await sleep(PAUSE_MS);
  }

  /* ---------------- Metrics ---------------- */

  const failed = rows.filter((r) => r.group === "failed");
  const survived = rows.filter((r) => r.group === "survived");

  if (failed.length === 0) {
    console.log("\nNo usable cases. Try a larger --size or a shorter --lead.");
    return;
  }

  const rate = (list: Row[], test: (r: Row) => boolean) =>
    list.length === 0 ? 0 : list.filter(test).length / list.length;

  const flaggedAmber = (r: Row) => r.band !== "green";
  const flaggedRed = (r: Row) => r.band === "red";

  const detectionAmber = rate(failed, flaggedAmber);
  const detectionRed = rate(failed, flaggedRed);
  const falseAmber = rate(survived, flaggedAmber);
  const falseRed = rate(survived, flaggedRed);

  /**
   * What the numbers actually mean in the wild.
   *
   * Our sample is half failures by construction. Reality is about 0.5%. So a
   * detector that catches 70% of failures while flagging 10% of survivors
   * looks strong here and is mostly wrong in production — of every 100 amber
   * verdicts, only a handful are companies that will fail.
   *
   * This is Bayes' theorem, and it is the single most important thing to
   * understand about any rare-event detector.
   */
  const impliedPrecision = (tpr: number, fpr: number) => {
    const truePositives = tpr * REAL_BASE_RATE;
    const falsePositives = fpr * (1 - REAL_BASE_RATE);
    return truePositives + falsePositives === 0
      ? 0
      : truePositives / (truePositives + falsePositives);
  };

  /* --- Which signals actually discriminate? --- */
  const allSignals = [...new Set(rows.flatMap((r) => r.signalIds))];
  const signalTable = allSignals
    .map((id) => ({
      id,
      inFailed: rate(failed, (r) => r.signalIds.includes(id)),
      inSurvived: rate(survived, (r) => r.signalIds.includes(id)),
    }))
    .map((s) => ({ ...s, lift: s.inSurvived === 0 ? Infinity : s.inFailed / s.inSurvived }))
    .sort((a, b) => b.lift - a.lift);

  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
  // The base rate is well under 1%, so it needs a decimal place — rounding it
  // to "1%" would misstate the very number the precision figures rest on.
  const pctFine = (n: number) => `${(n * 100).toFixed(1)}%`;

  /* ---------------- Report ---------------- */

  console.log("\n" + "=".repeat(66));
  console.log(`RESULTS — ${failed.length} failed, ${survived.length} surviving`);
  console.log("=".repeat(66));
  console.log(`\nDetection ${LEAD_MONTHS} months before insolvency began:`);
  console.log(`  Flagged amber or red      ${pct(detectionAmber)}`);
  console.log(`  Flagged red               ${pct(detectionRed)}`);
  console.log(`\nFalse alarms on survivors:`);
  console.log(`  Flagged amber or red      ${pct(falseAmber)}`);
  console.log(`  Flagged red               ${pct(falseRed)}`);
  console.log(`\nAt the real base rate (${pctFine(REAL_BASE_RATE)} annual insolvency):`);
  console.log(`  Precision of an amber     ${pct(impliedPrecision(detectionAmber, falseAmber))}`);
  console.log(`  Precision of a red        ${pct(impliedPrecision(detectionRed, falseRed))}`);

  console.log(`\nSignals ranked by how well they separate the groups:`);
  for (const s of signalTable) {
    const lift = s.lift === Infinity ? "only in failures" : `${s.lift.toFixed(1)}x`;
    console.log(`  ${s.id.padEnd(30)} ${pct(s.inFailed).padStart(4)} vs ${pct(s.inSurvived).padStart(4)}   ${lift}`);
  }

  if (skipped.length > 0) {
    console.log(`\n${skipped.length} companies skipped (see JSON for reasons)`);
  }

  /* ---------------- Write it down ---------------- */

  writeFileSync(
    "backtest-results.json",
    JSON.stringify(
      { runAt: new Date().toISOString(), leadMonths: LEAD_MONTHS, rows, skipped },
      null,
      2
    )
  );

  const md = `# Backtest results

Run ${new Date().toISOString().slice(0, 10)} · ${failed.length} failed companies, ${survived.length} matched survivors · lead time ${LEAD_MONTHS} months

## Method

Companies currently in liquidation, administration or receivership were sampled from
the register. For each, the date insolvency began was taken from the earliest
insolvency-related filing, and the register was reconstructed as it stood
${LEAD_MONTHS} months before that date — with company status, insolvency flags,
later resignations, later charge satisfactions and all subsequent filings removed
(\`lib/risk/rewind.ts\`). Controls were matched on SIC code and incorporation
window and scored at the same calendar date.

## Results

| Measure | Amber or red | Red only |
|---|---|---|
| Detected ${LEAD_MONTHS} months early | ${pct(detectionAmber)} | ${pct(detectionRed)} |
| False alarms on survivors | ${pct(falseAmber)} | ${pct(falseRed)} |
| Precision at real base rate | ${pct(impliedPrecision(detectionAmber, falseAmber))} | ${pct(impliedPrecision(detectionRed, falseRed))} |

The final row is the one that matters. This sample is half failures by
construction; real UK insolvency runs at roughly ${pctFine(REAL_BASE_RATE)} a year. A
detector can look strong on a balanced sample and still be wrong most of the time
in production, because almost every company it examines is fine. That is why
GLRlight is positioned as a triage tool that prompts questions, not as a verdict.

## Which signals discriminate

| Signal | Fired in failures | Fired in survivors | Lift |
|---|---|---|---|
${signalTable
  .map(
    (s) =>
      `| \`${s.id}\` | ${pct(s.inFailed)} | ${pct(s.inSurvived)} | ${s.lift === Infinity ? "only in failures" : s.lift.toFixed(1) + "x"} |`
  )
  .join("\n")}

Signals with lift near 1.0 are not earning their weight and should be
re-weighted or removed.

## Known limitations

**Director outcomes could not be rewound.** Each past appointment carries the
other company's status as it is *today*. A subsidiary that failed in 2022 shows
as failed even when the cutoff is 2016, which inflates the director-failure
signal in this test. Closing this would require a dated status history the API
does not expose.

**Accounts lateness was inferred**, not read. The API exposes a live overdue flag
with no historical equivalent, so lateness at the cutoff was derived from gaps
between accounts filings (more than 18 months without one).

**Survivorship in the control group.** Controls are companies still active today,
which means they survived the whole period — a slightly easier comparison than
companies that were healthy at the cutoff and may have failed since.

**Controls are matched on age at the cutoff, not on age relative to the case.**
An earlier version applied a minimum-age requirement to controls but not to
cases. Because several signals need two prior filings to fire at all, young
companies were structurally incapable of tripping them — so the older controls
lit up, the younger cases scored zero, and the test appeared to show that late
filing predicts survival. It was measuring age, not failure. Both groups now
carry the same minimum-age floor of ${MIN_AGE_MONTHS} months at the cutoff.

**This therefore says nothing about young companies.** Everything under four
years old at the point of assessment is excluded from the test, in both groups.

**Sample size is small** and drawn from a random offset into the register rather
than a stratified sample of the UK economy.
`;

  writeFileSync("BACKTEST.md", md);
  console.log(`\nWritten: backtest-results.json and BACKTEST.md\n`);
}

main().catch((error) => {
  console.log("\n✗ Backtest failed:");
  console.log(`  ${error.message}`);
});