/**
 * test-connection.ts — Phase 0
 *
 * Goal: prove we can talk to the Companies House API before building anything
 * on top of it. Once this works, credentials and networking are ruled out as
 * the cause of every future bug.
 *
 * Run with:
 *   node --env-file=.env.local --import tsx scripts/test-connection.ts
 */

// ---------------------------------------------------------------------------
// READING THE SECRET
// ---------------------------------------------------------------------------
// process.env is the environment — a scratchpad the operating system keeps for
// the running program. The --env-file flag loads .env.local into it before our
// code starts.
//
// Python equivalent: os.getenv("COMPANIES_HOUSE_API_KEY")
//
// The key never appears in this file, which is exactly why this file can be
// public on GitHub while still working on your machine.

const API_KEY = process.env.COMPANIES_HOUSE_API_KEY;

// `const` declares a value that won't be reassigned. JavaScript also has `let`
// for values that change. Prefer const — if you never reassign something, the
// compiler can catch it when you accidentally do.

if (!API_KEY) {
  console.log("✗ No API key found.");
  console.log("  Check .env.local exists in the project root and contains:");
  console.log("  COMPANIES_HOUSE_API_KEY=your_key_here");
  process.exit(1); // exit code 1 = "stopped because something went wrong"
}

// Print only the first few characters, never the whole secret to your screen.
console.log(`✓ Key loaded (starts with '${API_KEY.slice(0, 6)}...')`);

// Backticks create a template literal — `${...}` inserts a value.
// This is JavaScript's f-string.


// ---------------------------------------------------------------------------
// BUILDING THE AUTHENTICATION HEADER
// ---------------------------------------------------------------------------
// Companies House uses HTTP Basic Authentication. Normally that takes a
// username and password; this API takes the API KEY as the username and
// ignores the password entirely.
//
// The format is the word "Basic", a space, then "username:password" encoded in
// base64 — a reversible text encoding, NOT encryption. It is a formatting
// convention, not a security measure. The security comes from HTTPS.
//
// In Python, `requests` hides this: you write auth=(key, ""). JavaScript's
// fetch has no such helper, so we build the header by hand. Note the trailing
// colon with nothing after it — that is the empty password. Omit it and you
// get a 401, which is where most people lose their first hour.

const credentials = Buffer.from(`${API_KEY}:`).toString("base64");
const authHeader = `Basic ${credentials}`;


// ---------------------------------------------------------------------------
// MAKING THE REQUEST
// ---------------------------------------------------------------------------

const BASE_URL = "https://api.company-information.service.gov.uk";
const COMPANY_NUMBER = "00000006"; // one of the oldest companies on the register

// Everything below lives inside an async function.
//
// Network calls take time. Rather than freezing the whole program while it
// waits, JavaScript hands the work off and continues. `await` means "pause
// HERE until this finishes" — and `await` is only allowed inside a function
// marked `async`.
//
// Python has the exact same async/await keywords, so this should feel familiar.
// The difference is that in JavaScript, asynchronous is the default way to do
// anything involving the network.

async function main() {
  console.log(`\n→ Asking Companies House about company ${COMPANY_NUMBER}...`);

  const response = await fetch(`${BASE_URL}/company/${COMPANY_NUMBER}`, {
    headers: { Authorization: authHeader },
  });

  // `fetch` is built into Node now — no library to install, unlike Python
  // where you'd reach for `requests`.

  // -------------------------------------------------------------------------
  // HANDLING THE ANSWER
  // -------------------------------------------------------------------------
  // Every web response carries a status code:
  //   200 = fine
  //   401 = "I don't know who you are"   (bad key, or wrong auth style)
  //   404 = "that doesn't exist"
  //   429 = "you're asking too fast"     (rate limit)
  //
  // Naming each case separately turns a cryptic crash into a message that
  // tells you what to fix. This habit matters more than any clever code.

  if (response.status === 401) {
    console.log("✗ 401 Unauthorized — the key was rejected.");
    console.log("  Check for stray spaces or quotes in .env.local,");
    console.log("  and that you created a 'Live' key rather than a 'Test' one.");
    return;
  }

  if (response.status === 429) {
    console.log("✗ 429 Rate limited — 600 requests per 5 minutes. Wait, then retry.");
    return;
  }

  if (!response.ok) {
    console.log(`✗ Unexpected status ${response.status}`);
    return;
  }

  // -------------------------------------------------------------------------
  // READING THE DATA
  // -------------------------------------------------------------------------
  // The reply arrives as JSON — text structured as labelled boxes inside boxes.
  // .json() parses it into a JavaScript object, which behaves like a Python
  // dictionary: you ask for a label, you get a value.

  const company = await response.json();

  console.log("✓ Connected.\n");
  console.log("─".repeat(50));
  console.log(`Name:         ${company.company_name}`);
  console.log(`Number:       ${company.company_number}`);
  console.log(`Status:       ${company.company_status}`);
  console.log(`Incorporated: ${company.date_of_creation ?? "unknown"}`);
  console.log("─".repeat(50));

  // `??` is the nullish coalescing operator: "use the left side, unless it's
  // missing, in which case use the right side."
  //
  // Python equivalent: company.get("date_of_creation", "unknown")
  //
  // Real-world data is full of holes. Deciding field by field whether something
  // MUST be present or MIGHT be missing is most of what defensive coding is.

  // -------------------------------------------------------------------------
  // WATCHING THE BUDGET
  // -------------------------------------------------------------------------
  // The API reports how much of our allowance is left in the response headers —
  // extra information sent alongside the data. Reading it from day one means we
  // design around the constraint instead of discovering it in production.

  const remaining = response.headers.get("x-ratelimit-remain");
  if (remaining) {
    console.log(`\nRate limit: ${remaining} of 600 requests left this 5-minute window.`);
  }

  console.log("\nPhase 0 complete. The pipe works.\n");
}

// Defining main() above does not run it. This line does.
// .catch() handles anything that breaks — a dropped connection, a typo in the
// URL — so you get a readable message instead of a wall of red text.
main().catch((error) => {
  console.log("✗ Something went wrong:");
  console.log(`  ${error.message}`);
});