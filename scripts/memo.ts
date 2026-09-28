/**
 * memo.ts — Phase 3 test harness
 *
 * List the models your key can see:
 *   node --env-file=.env.local --import tsx scripts/memo.ts --models
 *
 * Generate a memo:
 *   node --env-file=.env.local --import tsx scripts/memo.ts "greggs"
 *
 * See exactly what the model is told, without calling it:
 *   node --env-file=.env.local --import tsx scripts/memo.ts "greggs" --prompt
 */

import { buildDossier, searchCompanies } from "../lib/ch/client";
import { assess } from "../lib/risk/engine";
import { writeMemo, listModels, debugPrompt } from "../lib/ai/memo";

const args = process.argv.slice(2);
const query = args.find((a) => !a.startsWith("--"));
const showPromptOnly = args.includes("--prompt");
const listOnly = args.includes("--models");

async function main() {
  if (listOnly) {
    const models = await listModels();
    console.log(`\n${models.length} models listed for your key:\n`);
    for (const m of models) {
      const note = m.endsWith("-latest") ? "   ← aliases tend to work on free tier" : "";
      console.log(`  ${m}${note}`);
    }
    console.log(
      "\nNote: appearing here does NOT guarantee generateContent works for it.\n" +
        "Set a chain in .env.local:\n  GEMINI_MODELS=model-a,model-b,model-c\n"
    );
    return;
  }

  if (!query) {
    console.log('Usage: ... scripts/memo.ts "company name" [--prompt] [--models]');
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
    console.log(`Matched: ${hits[0].name} (${companyNumber})`);
  }

  console.log("Gathering register data...");
  const dossier = await buildDossier(companyNumber);

  console.log("Running risk engine...");
  const assessment = assess(dossier);

  console.log(
    `Verdict: ${assessment.band.toUpperCase()} (score ${assessment.score}, ${assessment.signals.length} signals)\n`
  );

  // --prompt shows the exact instructions and data sent to the model, without
  // spending a request. A bad memo is almost always a bad prompt, and this is
  // the only way to see what was actually asked.
  if (showPromptOnly) {
    const { system, user } = debugPrompt(assessment);
    console.log("=".repeat(66));
    console.log("SYSTEM INSTRUCTION");
    console.log("=".repeat(66));
    console.log(system);
    console.log("\n" + "=".repeat(66));
    console.log("USER MESSAGE");
    console.log("=".repeat(66));
    console.log(user);
    return;
  }

  console.log("Writing memo...");
  const started = Date.now();

  // Pass console.log so the chain narrates which models it tried and why it
  // moved on. Silent fallback is hard to debug and hard to trust.
  const { memo, model } = await writeMemo(assessment, console.log);

  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log("\n" + "=".repeat(66));
  console.log(memo);
  console.log("=".repeat(66));
  console.log(`\nWritten by ${model} in ${seconds}s\n`);
}

main().catch((error) => {
  console.log("\n✗ Something went wrong:");
  console.log(`  ${error.message}`);
});