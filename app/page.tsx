"use client";

/**
 * app/page.tsx — the GLRlight interface.
 *
 * "use client" marks this as a client component: it runs in the visitor's
 * browser, which is what lets it respond to typing and clicking. Because it
 * runs in the browser it holds no secrets — it only knows how to call our own
 * /api routes. The API keys stay on the server.
 *
 * DESIGN NOTES
 *
 * The verdict is the one loud element. Everything else is deliberately quiet.
 *
 * Findings are set as a LEDGER, not as cards: each one's point contribution
 * sits in the left rail and runs down to the total. The reader watches the
 * score being built, which is the auditability argument of this project made
 * visible rather than asserted.
 *
 * The rules engine answers in about a second; the written briefing takes
 * several. So the verdict renders immediately and the briefing is fetched
 * separately, on request. A page that is useful at once beats a page that is
 * complete eventually.
 */

import { useState } from "react";

/* ------------------------------------------------------------------ */
/* Types — mirroring what the API returns                              */
/* ------------------------------------------------------------------ */

type Band = "green" | "amber" | "red";
type Severity = "info" | "low" | "medium" | "high";

interface Signal {
  id: string;
  label: string;
  severity: Severity;
  detail: string;
  benign: string;
  source: string;
}

interface Assessment {
  companyNumber: string;
  companyName: string;
  band: Band;
  score: number;
  signals: Signal[];
  override?: string;
  dataGaps: string[];
  assessedAt: string;
}

interface ApiResponse {
  assessment: Assessment;
  alternatives: { companyNumber: string; name: string; status: string }[];
  context: {
    status: string;
    statusDetail: string | null;
    incorporatedOn: string | null;
    type: string;
    activeOfficers: number;
    outstandingCharges: number;
    accountsNextDue: string | null;
    lastAccountsMadeUpTo: string | null;
  };
}

/* ------------------------------------------------------------------ */
/* Design tokens                                                       */
/* ------------------------------------------------------------------ */

/**
 * The traffic light rendered as enamel signage rather than as bright UI
 * colour: deep, matte, institutional. The verdict panel is the only place
 * colour appears at any size.
 */
const BAND = {
  green: {
    word: "Green",
    panel: "bg-[#1F6F4A] text-[#EEF3EE]",
    quiet: "text-[#1F6F4A]",
    line: "Nothing adverse on the public register",
  },
  amber: {
    word: "Amber",
    panel: "bg-[#E0A32E] text-[#20180A]",
    quiet: "text-[#8A5F0B]",
    line: "Worth asking questions before you commit",
  },
  red: {
    word: "Red",
    panel: "bg-[#A82A2A] text-[#F6EDED]",
    quiet: "text-[#A82A2A]",
    line: "Serious findings on the record",
  },
} as const;

const POINTS: Record<Severity, number> = { info: 0, low: 1, medium: 3, high: 5 };

const SEVERITY_WORD: Record<Severity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Context",
};

const EXAMPLES = [
  { label: "Greggs", query: "greggs", note: "a healthy retailer" },
  { label: "Carillion", query: "carillion", note: "collapsed in 2018" },
  { label: "Tesco", query: "tesco", note: "a large plc" },
];

/* ------------------------------------------------------------------ */

export default function Home() {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [memo, setMemo] = useState<string | null>(null);
  const [memoLoading, setMemoLoading] = useState(false);
  const [memoError, setMemoError] = useState<string | null>(null);

  async function runAssessment(term: string) {
    if (!term.trim()) return;

    setLoading(true);
    setError(null);
    setData(null);
    setMemo(null);
    setMemoError(null);

    try {
      const res = await fetch(`/api/assess?q=${encodeURIComponent(term)}`);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "The check could not be completed.");
        return;
      }
      setData(body);
    } catch {
      setError("The server did not respond. Check that it is still running.");
    } finally {
      // Runs whether or not the code above threw, so the loading state always
      // clears. Forgetting this leaves people staring at a dead screen.
      setLoading(false);
    }
  }

  async function loadMemo() {
    if (!data) return;
    setMemoLoading(true);
    setMemoError(null);
    try {
      const res = await fetch(
        `/api/memo?company=${encodeURIComponent(data.assessment.companyNumber)}`
      );
      const body = await res.json();
      if (!res.ok) {
        setMemoError(body.error ?? "The briefing could not be written.");
        return;
      }
      setMemo(body.memo);
    } catch {
      setMemoError("The server did not respond.");
    } finally {
      setMemoLoading(false);
    }
  }

  const band = data ? BAND[data.assessment.band] : null;

  return (
    <div className="min-h-screen bg-[#E8EAE6] text-[#131A22] font-[family-name:var(--font-archivo)]">
      <div className="mx-auto max-w-[46rem] px-6 pb-24 pt-14 sm:pt-20">
        {/* ---------------- Masthead ---------------- */}
        <header>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#1F6F4A]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#E0A32E]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#A82A2A]" />
            <span className="ml-2 text-[15px] font-semibold tracking-tight">GLRlight</span>
          </div>

          <h1 className="mt-10 max-w-[18ch] text-[2.6rem] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[3.4rem]">
            Before you invoice them, check how they file.
          </h1>

          <p className="mt-5 max-w-[58ch] font-[family-name:var(--font-serif)] text-[1.0625rem] leading-[1.7] text-[#3C464F]">
            Companies in difficulty behave differently on the public register long
            before anyone announces it. They file late, directors leave together,
            lenders take security. GLRlight reads that record and tells you what it
            suggests.
          </p>
        </header>

        {/* ---------------- Search ---------------- */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runAssessment(query);
          }}
          className="mt-10 flex gap-2"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Company name or number"
            aria-label="Company name or number"
            className="min-w-0 flex-1 rounded-sm border border-[#C1C6BE] bg-[#F5F6F3] px-4 py-3 text-[1.0625rem] outline-none transition placeholder:text-[#8B9289] focus:border-[#131A22] focus:ring-2 focus:ring-[#131A22]/15"
          />
          <button
            type="submit"
            disabled={loading}
            className="shrink-0 rounded-sm bg-[#131A22] px-6 py-3 text-[1.0625rem] font-medium text-[#F1F2EE] transition hover:bg-[#2A3540] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#131A22]/40 disabled:opacity-40"
          >
            {loading ? "Checking" : "Check"}
          </button>
        </form>

        <p className="mt-4 font-[family-name:var(--font-serif)] text-[0.95rem] text-[#5A6069]">
          <span className="text-[#5A6069]">Start with </span>
          {EXAMPLES.map((ex, i) => (
            <span key={ex.query}>
              <button
                onClick={() => {
                  setQuery(ex.query);
                  runAssessment(ex.query);
                }}
                className="underline decoration-[#AFB5AC] underline-offset-4 transition hover:decoration-[#131A22]"
              >
                {ex.label}
              </button>
              <span className="text-[#8B9289]"> ({ex.note})</span>
              {i < EXAMPLES.length - 1 && <span className="text-[#5A6069]">, </span>}
            </span>
          ))}
        </p>

        {/* ---------------- Error ---------------- */}
        {error && (
          <p className="mt-10 border-l-2 border-[#A82A2A] bg-[#F5F6F3] py-4 pl-4 font-[family-name:var(--font-serif)] text-[1.0625rem] text-[#131A22]">
            {error}
          </p>
        )}

        {/* ---------------- Loading ---------------- */}
        {loading && (
          <div className="mt-12 space-y-px">
            <div className="h-44 animate-pulse bg-[#D8DBD5]" />
            <div className="h-20 animate-pulse bg-[#DEE1DB]" />
            <div className="h-20 animate-pulse bg-[#E1E4DE]" />
          </div>
        )}

        {/* ---------------- Result ---------------- */}
        {data && band && (
          <section className="mt-12">
            {/* The verdict: the one loud element on the page */}
            <div
              className={`${band.panel} rounded-sm px-7 py-8 motion-safe:animate-[fadeIn_.35s_ease-out]`}
            >
              <p className="text-[0.95rem] font-medium opacity-80">
                {data.assessment.companyName}
              </p>
              <p className="mt-2 text-[4rem] font-semibold leading-none tracking-[-0.04em] sm:text-[5rem]">
                {band.word}
              </p>
              <p className="mt-4 max-w-[46ch] font-[family-name:var(--font-serif)] text-[1.0625rem] leading-[1.6] opacity-90">
                {data.assessment.override ?? band.line}
              </p>
            </div>

            {/* Register facts — background, not findings */}
            <dl className="mt-px grid grid-cols-2 gap-px bg-[#C7CBC4] sm:grid-cols-4">
              <Fact label="Status" value={data.context.status} />
              <Fact label="Incorporated" value={data.context.incorporatedOn ?? "Unknown"} />
              <Fact label="Active officers" value={data.context.activeOfficers} />
              <Fact label="Charges outstanding" value={data.context.outstandingCharges} />
            </dl>

            {data.alternatives.length > 0 && (
              <p className="mt-4 font-[family-name:var(--font-serif)] text-[0.95rem] text-[#5A6069]">
                Looking for a different company?{" "}
                {data.alternatives.map((alt, i) => (
                  <span key={alt.companyNumber}>
                    <button
                      onClick={() => runAssessment(alt.companyNumber)}
                      className="underline decoration-[#AFB5AC] underline-offset-4 transition hover:decoration-[#131A22]"
                    >
                      {alt.name}
                    </button>
                    {i < data.alternatives.length - 1 && ", "}
                  </span>
                ))}
              </p>
            )}

            {/* ---------------- The ledger ---------------- */}
            {data.assessment.signals.length > 0 ? (
              <div className="mt-14">
                <h2 className="text-[1.05rem] font-semibold tracking-tight">
                  How the score was reached
                </h2>

                <ol className="mt-6">
                  {data.assessment.signals.map((s) => (
                    <li
                      key={s.id}
                      className="grid grid-cols-[3.5rem_1fr] gap-x-5 border-t border-[#C7CBC4] py-6"
                    >
                      {/* Left rail: the arithmetic, in the open */}
                      <div className="pt-0.5 text-right">
                        <span
                          className={`text-[1.5rem] font-semibold leading-none tracking-tight ${
                            POINTS[s.severity] === 0 ? "text-[#9BA298]" : band.quiet
                          }`}
                        >
                          {POINTS[s.severity] === 0 ? "—" : `+${POINTS[s.severity]}`}
                        </span>
                        <span className="mt-1.5 block text-[0.8rem] text-[#7C837A]">
                          {SEVERITY_WORD[s.severity]}
                        </span>
                      </div>

                      <div className="min-w-0">
                        <h3 className="text-[1.0625rem] font-semibold tracking-tight">
                          {s.label}
                        </h3>

                        <p className="mt-2 font-[family-name:var(--font-serif)] text-[1.0625rem] leading-[1.65] text-[#242C34]">
                          {s.detail}
                        </p>

                        {/* The innocent reading, always alongside the finding.
                            A tool that only ever says "concerning" teaches
                            people to stop reading it. */}
                        <p className="mt-3 font-[family-name:var(--font-serif)] text-[0.98rem] italic leading-[1.6] text-[#5A6069]">
                          {s.benign}
                        </p>

                        <p className="mt-3 text-[0.8rem] text-[#8B9289]">
                          Drawn from {s.source.toLowerCase()}
                        </p>
                      </div>
                    </li>
                  ))}

                  {/* The total, where a ledger puts it */}
                  <li className="grid grid-cols-[3.5rem_1fr] gap-x-5 border-t-2 border-[#131A22] pt-5">
                    <div className="text-right text-[1.5rem] font-semibold leading-none tracking-tight">
                      {data.assessment.score}
                    </div>
                    <div className="font-[family-name:var(--font-serif)] text-[1.0625rem] leading-none text-[#3C464F]">
                      Total. Four or more is amber, eight or more is red.
                    </div>
                  </li>
                </ol>
              </div>
            ) : (
              <div className="mt-14 border-t border-[#C7CBC4] pt-6">
                <h2 className="text-[1.05rem] font-semibold tracking-tight">
                  Nothing fired
                </h2>
                <p className="mt-3 max-w-[58ch] font-[family-name:var(--font-serif)] text-[1.0625rem] leading-[1.7] text-[#242C34]">
                  No warning signs appear on this company&rsquo;s public register. That is
                  not the same as evidence it is financially sound — filings can be
                  perfectly punctual while the business underneath is struggling.
                </p>
              </div>
            )}

            {data.assessment.dataGaps.length > 0 && (
              <p className="mt-6 border-l-2 border-[#E0A32E] bg-[#F5F6F3] py-4 pl-4 font-[family-name:var(--font-serif)] text-[0.98rem] text-[#131A22]">
                Some records could not be retrieved ({data.assessment.dataGaps.join(", ")}).
                The verdict reflects only what was read.
              </p>
            )}

            {/* ---------------- Briefing ---------------- */}
            <div className="mt-14 border-t border-[#C7CBC4] pt-6">
              {!memo && !memoLoading && !memoError && (
                <div className="flex flex-wrap items-baseline justify-between gap-4">
                  <p className="max-w-[44ch] font-[family-name:var(--font-serif)] text-[1.0625rem] leading-[1.6] text-[#3C464F]">
                    Turn these findings into a short briefing you could send to a
                    colleague.
                  </p>
                  <button
                    onClick={loadMemo}
                    className="rounded-sm border border-[#131A22] px-5 py-2.5 text-[0.98rem] font-medium transition hover:bg-[#131A22] hover:text-[#F1F2EE] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#131A22]/40"
                  >
                    Write the briefing
                  </button>
                </div>
              )}

              {memoLoading && (
                <p className="font-[family-name:var(--font-serif)] text-[1.0625rem] text-[#5A6069]">
                  Writing. This takes a few seconds.
                </p>
              )}

              {memoError && (
                <div>
                  <p className="font-[family-name:var(--font-serif)] text-[1.0625rem] text-[#131A22]">
                    {memoError}
                  </p>
                  <button
                    onClick={loadMemo}
                    className="mt-3 text-[0.98rem] underline decoration-[#AFB5AC] underline-offset-4 hover:decoration-[#131A22]"
                  >
                    Try again
                  </button>
                </div>
              )}

              {memo && (
                <article className="max-w-[62ch] whitespace-pre-wrap font-[family-name:var(--font-serif)] text-[1.0625rem] leading-[1.75] text-[#242C34]">
                  {memo}
                </article>
              )}
            </div>
          </section>
        )}

        {/* ---------------- Footer ---------------- */}
        <footer className="mt-24 border-t border-[#C7CBC4] pt-6 font-[family-name:var(--font-serif)] text-[0.875rem] leading-[1.65] text-[#6B7269]">
          <p className="max-w-[70ch]">
            Company information comes from Companies House under the Open Government
            Licence v3.0. GLRlight is not affiliated with or endorsed by Companies
            House.
          </p>
          <p className="mt-3 max-w-[70ch]">
            This is a screening tool, not a credit reference agency, and it does not
            give regulated advice. Treat it as a prompt to ask better questions, never
            as the sole basis for a commercial decision.
          </p>
        </footer>
      </div>

      {/* One motion moment, on the verdict only, and skipped for anyone who has
          asked their system to reduce motion. */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: none; }
        }
      `}</style>
    </div>
  );
}

/** One register fact. Set on the grid's gap colour so hairlines appear between. */
function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-[#F5F6F3] px-4 py-4">
      <dt className="text-[0.8rem] text-[#7C837A]">{label}</dt>
      <dd className="mt-1 text-[1.0625rem] font-medium tracking-tight">{value}</dd>
    </div>
  );
}