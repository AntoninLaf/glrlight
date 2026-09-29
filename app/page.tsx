"use client";

/**
 * app/page.tsx — the GLRlight interface.
 *
 * "use client" means this runs in the visitor's browser, which is what lets it
 * respond to typing and clicking. Because it runs in the browser it holds no
 * secrets: it knows only how to call our own /api routes. The API keys live on
 * the server and never reach this file.
 *
 * ── STRUCTURE ────────────────────────────────────────────────────────────
 *
 * A dark masthead states plainly what the tool does, then a capability strip,
 * then an explanation of the two halves — rules that judge, an agent that
 * investigates. After a search, a sticky verdict and four tabs, so each view is
 * roughly one screen rather than a five-screen scroll. Investigation and
 * Briefing load only when opened, because each costs a model call.
 *
 * ── EXPLAINERS ───────────────────────────────────────────────────────────
 *
 * This is a tool that needs understanding, not a product being sold. The "?"
 * markers open short panels explaining how the score is built, why the rules
 * decide and the model only writes, and what green does and does not mean.
 */

import { useEffect, useRef, useState } from "react";

/* ================================================================== */
/* Types                                                              */
/* ================================================================== */

type Band = "green" | "amber" | "red";
type Severity = "info" | "low" | "medium" | "high";
type Tab = "verdict" | "findings" | "investigation" | "briefing";

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

interface TrailStep {
  step: number;
  thought?: string;
  tool: string;
  args?: Record<string, unknown>;
  found: string;
}

interface Investigation {
  trail: TrailStep[];
  conclusion: string;
  model: string;
  steps: number;
}

/* ================================================================== */
/* Design tokens                                                      */
/* ================================================================== */

/**
 * The traffic light as enamel signage — deep and matte, the colours of printed
 * forms and station signs, rather than bright interface colours. A risk tool
 * that looks cheerful is not credible.
 */
const BAND = {
  green: {
    word: "Green",
    ink: "#1F6F4A",
    glow: "#7FD3A8",
    panel: "bg-[#1F6F4A] text-[#EEF3EE]",
    line: "Nothing adverse found on the public register",
  },
  amber: {
    word: "Amber",
    ink: "#B07C12",
    glow: "#F0C368",
    panel: "bg-[#E0A32E] text-[#20180A]",
    line: "Worth asking questions before you commit",
  },
  red: {
    word: "Red",
    ink: "#A82A2A",
    glow: "#F09292",
    panel: "bg-[#A82A2A] text-[#F6EDED]",
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
  { label: "Greggs", query: "greggs", note: "healthy retailer" },
  { label: "Carillion", query: "carillion", note: "collapsed in 2018" },
  { label: "Tesco", query: "tesco", note: "large plc" },
];

/** Plain-English names for the agent's tools, for the investigation trail. */
const TOOL_LABEL: Record<string, string> = {
  get_company_profile: "Company profile",
  get_officers: "Directors and secretaries",
  get_filing_history: "Filing history",
  get_charges: "Secured lending",
  get_ownership: "Ownership and control",
  trace_director: "Director's other companies",
};
/** Register status codes are database values; these are what people say. */
const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  dissolved: "Dissolved",
  liquidation: "In liquidation",
  administration: "In administration",
  receivership: "In receivership",
  "voluntary-arrangement": "Voluntary arrangement",
  "insolvency-proceedings": "Insolvency proceedings",
  "converted-closed": "Converted or re-registered",
  removed: "Removed from the register",
  closed: "Closed",
  open: "Open",
  registered: "Registered",
};

/* ================================================================== */
/* Page                                                               */
/* ================================================================== */

export default function Home() {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("verdict");

  const [memo, setMemo] = useState<string | null>(null);
  const [memoLoading, setMemoLoading] = useState(false);
  const [memoError, setMemoError] = useState<string | null>(null);

  const [inv, setInv] = useState<Investigation | null>(null);
  const [invLoading, setInvLoading] = useState(false);
  const [invError, setInvError] = useState<string | null>(null);

  const resultsRef = useRef<HTMLDivElement>(null);

  async function runAssessment(term: string) {
    if (!term.trim()) return;

    setLoading(true);
    setError(null);
    setData(null);
    setMemo(null);
    setMemoError(null);
    setInv(null);
    setInvError(null);
    setTab("verdict");

    try {
      const res = await fetch(`/api/assess?q=${encodeURIComponent(term)}`);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "The check could not be completed.");
        return;
      }
      setData(body);
      setTimeout(
        () => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        80
      );
    } catch {
      setError("The server did not respond. Check that it is still running.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMemo() {
    if (!data || memo || memoLoading) return;
    setMemoLoading(true);
    setMemoError(null);
    try {
      const res = await fetch(`/api/memo?company=${data.assessment.companyNumber}`);
      const body = await res.json();
      if (!res.ok) setMemoError(body.error ?? "The briefing could not be written.");
      else setMemo(body.memo);
    } catch {
      setMemoError("The server did not respond.");
    } finally {
      setMemoLoading(false);
    }
  }

  async function loadInvestigation() {
    if (!data || inv || invLoading) return;
    setInvLoading(true);
    setInvError(null);
    try {
      const res = await fetch(`/api/investigate?company=${data.assessment.companyNumber}`);
      const body = await res.json();
      if (!res.ok) setInvError(body.error ?? "The investigation could not be completed.");
      else setInv(body);
    } catch {
      setInvError("The server did not respond.");
    } finally {
      setInvLoading(false);
    }
  }

  const band = data ? BAND[data.assessment.band] : null;

  return (
    <div className="min-h-screen bg-[#E8EAE6] text-[#131A22] font-[family-name:var(--font-archivo)]">
      {/* ============ Masthead ============ */}
      <header className="relative overflow-hidden bg-[#0C1116] text-[#E8EAE6]">
        {/* A slow wash of colour behind the headline: the three bands, barely
            present. Gives the dark ground depth without decoration. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 left-1/2 h-[34rem] w-[64rem] -translate-x-1/2 opacity-[0.18] blur-3xl"
          style={{
            background:
              "radial-gradient(38% 52% at 22% 45%, #1F6F4A 0%, transparent 70%), radial-gradient(34% 46% at 55% 35%, #E0A32E 0%, transparent 70%), radial-gradient(38% 50% at 82% 50%, #A82A2A 0%, transparent 70%)",
          }}
        />

        <div className="relative mx-auto max-w-[56rem] px-6 pt-10 pb-14 sm:pt-14">
          <div className="flex items-center gap-2">
            <Lamp colour="#1F6F4A" delay="0s" />
            <Lamp colour="#E0A32E" delay=".5s" />
            <Lamp colour="#A82A2A" delay="1s" />
            <span className="ml-2 text-[15px] font-semibold tracking-tight">GLRlight</span>
          </div>

          <h1 className="mt-10 max-w-[19ch] text-[2.7rem] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-[3.9rem]">
            Read a UK company&rsquo;s entire filing record in one second.
          </h1>

          <p className="mt-6 max-w-[58ch] font-[family-name:var(--font-serif)] text-[1.125rem] leading-[1.7] text-[#AEB7BF]">
            Type a company name. GLRlight pulls six Companies House registers, runs
            sixteen risk rules over them, and returns a green, amber or red verdict with
            every finding dated, sourced, and shown alongside its innocent explanation.
            Then an AI agent goes back and investigates whatever looked unusual.
          </p>

          {/* Search */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runAssessment(query);
            }}
            className="mt-9 flex gap-2"
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Company name or number"
              aria-label="Company name or number"
              className="min-w-0 flex-1 rounded-sm border border-[#2C3740] bg-[#141C23] px-5 py-4 text-[1.125rem] text-[#E8EAE6] outline-none transition placeholder:text-[#6B767F] focus:border-[#8C979F] focus:bg-[#19222A]"
            />
            <button
              type="submit"
              disabled={loading}
              className="shrink-0 rounded-sm bg-[#E8EAE6] px-7 py-4 text-[1.125rem] font-medium text-[#0C1116] transition hover:bg-white disabled:opacity-40"
            >
              {loading ? "Reading" : "Read the register"}
            </button>
          </form>

          <p className="mt-4 font-[family-name:var(--font-serif)] text-[0.98rem] text-[#8A959D]">
            Start with{" "}
            {EXAMPLES.map((ex, i) => (
              <span key={ex.query}>
                <button
                  onClick={() => {
                    setQuery(ex.query);
                    runAssessment(ex.query);
                  }}
                  className="text-[#E8EAE6] underline decoration-[#4E5A63] underline-offset-4 transition hover:decoration-[#E8EAE6]"
                >
                  {ex.label}
                </button>
                <span className="text-[#6B767F]"> ({ex.note})</span>
                {i < EXAMPLES.length - 1 && ", "}
              </span>
            ))}
          </p>
        </div>

        {/* Capability strip — concrete numbers, not adjectives */}
        <div className="relative border-t border-[#1E2831]">
          <dl className="mx-auto grid max-w-[56rem] grid-cols-2 sm:grid-cols-4">
            <Metric value="6" label="public registers read" accent="#7FD3A8" />
            <Metric value="16" label="risk rules, no AI" accent="#F0C368" />
            <Metric value="1s" label="to a sourced verdict" accent="#F09292" />
            <Metric value="9" label="agent tool calls, max" accent="#9FB4C4" />
          </dl>
        </div>
      </header>

      <main className="mx-auto max-w-[56rem] px-6 pb-24">
        {/* ============ Landing explanation ============ */}
        {!data && !loading && !error && (
          <section className="motion-safe:animate-[rise_.5s_ease-out] py-16">
            {/* The two halves */}
            <div className="grid gap-px bg-[#C7CBC4] md:grid-cols-2">
              <div className="bg-[#F5F6F3] p-7">
                <span className="text-[0.8rem] font-medium" style={{ color: "#1F6F4A" }}>
                  Half one
                </span>
                <h2 className="mt-2 text-[1.35rem] font-semibold tracking-tight">
                  Rules decide the verdict
                </h2>
                <p className="mt-3 font-[family-name:var(--font-serif)] text-[1.0625rem] leading-[1.7] text-[#3C464F]">
                  Sixteen rules written in ordinary code. Overdue accounts, a board that
                  emptied out, a lender taking security, an auditor walking away. Each fires
                  with a date and a source and adds a fixed number of points.
                </p>
                <p className="mt-3 font-[family-name:var(--font-serif)] text-[1.0625rem] leading-[1.7] text-[#3C464F]">
                  No model touches this. The same company always scores the same, and every
                  point can be traced to a line you can read.
                </p>
              </div>

              <div className="bg-[#F5F6F3] p-7">
                <span className="text-[0.8rem] font-medium" style={{ color: "#A82A2A" }}>
                  Half two
                </span>
                <h2 className="mt-2 text-[1.35rem] font-semibold tracking-tight">
                  An agent decides what to investigate
                </h2>
                <p className="mt-3 font-[family-name:var(--font-serif)] text-[1.0625rem] leading-[1.7] text-[#3C464F]">
                  Six tools, a goal, and no script. It reads the profile, decides what looks
                  worth chasing, follows that thread, and stops when it has enough. Every
                  company gets a different investigation.
                </p>
                <p className="mt-3 font-[family-name:var(--font-serif)] text-[1.0625rem] leading-[1.7] text-[#3C464F]">
                  It has no say in the verdict. None of its tools return a score — only facts.
                </p>
              </div>
            </div>

            {/* What the agent actually caught — concrete, from a real run */}
            <div className="mt-10 border border-[#131A22] bg-[#0C1116] p-7 text-[#D6DAD5]">
              <div className="flex items-center gap-2">
                <h2 className="text-[1.05rem] font-semibold tracking-tight text-[#E8EAE6]">
                  What an agent finds that rules cannot
                </h2>
                <Explainer title="Pipeline versus agent" dark>
                  A pipeline fetches six things in a fixed order and scores them. Every company
                  is treated identically and it cannot surprise you.
                  <br />
                  <br />
                  An agent is given a goal and a set of tools and decides for itself which to
                  use, in what order, and when it has learnt enough. It loops: act, read the
                  result, choose the next move. The rules engine sees facts one at a time; the
                  agent sees them in relation to each other.
                </Explainer>
              </div>

              <p className="mt-4 max-w-[64ch] font-[family-name:var(--font-serif)] text-[1.0625rem] leading-[1.75] text-[#AEB7BF]">
                The rules engine fires each signal independently. It sees &ldquo;new
                charges&rdquo; and &ldquo;directors departed&rdquo; as two separate facts.
                Investigating Carillion, the agent noticed they happened in the same fortnight:
              </p>

              <blockquote className="mt-5 border-l-2 border-[#A82A2A] pl-5 font-[family-name:var(--font-serif)] text-[1.0625rem] leading-[1.75] text-[#E8EAE6]">
                A cluster of five charges was granted within a two-day window in October 2017
                to a security trustee, coinciding with emergency board appointments and
                following the sudden departures of the CEO and CFO.
              </blockquote>

              <p className="mt-5 max-w-[64ch] font-[family-name:var(--font-serif)] text-[1.0625rem] leading-[1.75] text-[#8A959D]">
                That is a connection between three separate registers, drawn together by
                timing. No fixed rule was written to look for it. Open the Investigation tab on
                any result to watch the agent decide, step by step.
              </p>
            </div>

            {/* Honesty panel */}
            <div className="mt-10 border-l-2 border-[#131A22] bg-[#F5F6F3] py-5 pl-5 pr-5">
              <p className="max-w-[68ch] font-[family-name:var(--font-serif)] text-[1.0625rem] leading-[1.7] text-[#242C34]">
                <strong className="font-semibold">This does not predict insolvency.</strong> I
                built a backtest to find out whether it could — reconstructing the register as
                it stood a year before companies collapsed — and the attempt failed for
                methodological reasons documented in full in the repository. A green verdict
                means nothing adverse was found on the public record. It is not a statement
                about a company&rsquo;s health.
              </p>
            </div>
          </section>
        )}

        {error && (
          <p className="mt-10 border-l-2 border-[#A82A2A] bg-[#F5F6F3] py-4 pl-4 font-[family-name:var(--font-serif)] text-[1.0625rem]">
            {error}
          </p>
        )}

        {loading && (
          <div className="mt-10 space-y-px">
            <div className="h-36 animate-pulse bg-[#D8DBD5]" />
            <div className="h-14 animate-pulse bg-[#DEE1DB]" />
            <div className="h-56 animate-pulse bg-[#E1E4DE]" />
          </div>
        )}

        {/* ============ Result ============ */}
        {data && band && (
          <div ref={resultsRef} className="pt-10">
            <div className="sticky top-0 z-20 -mx-6 px-6 pt-4 pb-3 backdrop-blur-sm">
              <div
                className={`${band.panel} motion-safe:animate-[rise_.4s_ease-out] rounded-sm px-6 py-5`}
              >
                <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
                  <div className="min-w-0">
                    <p className="truncate text-[0.9rem] font-medium opacity-80">
                      {data.assessment.companyName}
                    </p>
                    <p className="mt-1 text-[2.6rem] font-semibold leading-none tracking-[-0.03em] sm:text-[3.2rem]">
                      {band.word}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[0.8rem] opacity-70">Score</p>
                    <p className="text-[2rem] font-semibold leading-none tracking-tight">
                      <CountUp to={data.assessment.score} />
                    </p>
                  </div>
                </div>
                <p className="mt-3 max-w-[52ch] font-[family-name:var(--font-serif)] text-[1rem] leading-[1.55] opacity-90">
                  {data.assessment.override ?? band.line}
                </p>
              </div>
            </div>

            <nav className="mt-5 flex flex-wrap gap-px bg-[#C7CBC4]">
              <TabButton active={tab === "verdict"} onClick={() => setTab("verdict")}>
                Verdict
              </TabButton>
              <TabButton active={tab === "findings"} onClick={() => setTab("findings")}>
                Findings <span className="opacity-50">{data.assessment.signals.length}</span>
              </TabButton>
              <TabButton
                active={tab === "investigation"}
                onClick={() => {
                  setTab("investigation");
                  loadInvestigation();
                }}
              >
                Investigation
              </TabButton>
              <TabButton
                active={tab === "briefing"}
                onClick={() => {
                  setTab("briefing");
                  loadMemo();
                }}
              >
                Briefing
              </TabButton>
            </nav>

            <section
              key={tab}
              className="min-h-[24rem] border-x border-b border-[#C7CBC4] bg-[#F5F6F3] px-6 py-8 motion-safe:animate-[fade_.3s_ease-out]"
            >
              {tab === "verdict" && <VerdictTab data={data} />}
              {tab === "findings" && <FindingsTab data={data} bandInk={band.ink} />}
              {tab === "investigation" && (
                <InvestigationTab
                  inv={inv}
                  loading={invLoading}
                  error={invError}
                  onRetry={loadInvestigation}
                />
              )}
              {tab === "briefing" && (
                <BriefingTab memo={memo} loading={memoLoading} error={memoError} onRetry={loadMemo} />
              )}
            </section>

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
          </div>
        )}

        <footer className="mt-20 border-t border-[#C7CBC4] pt-6 font-[family-name:var(--font-serif)] text-[0.875rem] leading-[1.65] text-[#6B7269]">
          <p className="max-w-[70ch]">
            Company information from Companies House under the Open Government Licence v3.0.
            Not affiliated with or endorsed by Companies House.
          </p>
          <p className="mt-3 max-w-[70ch]">
            A screening tool, not a credit reference agency, and not regulated advice.
            Predictive validity is untested &mdash; the attempt and its failure are documented
            in the repository. Treat this as a prompt to ask better questions, never as the
            sole basis for a commercial decision.
          </p>
        </footer>
      </main>

      <style>{`
        @keyframes rise { from { opacity:0; transform: translateY(10px); } to { opacity:1; transform:none; } }
        @keyframes fade { from { opacity:0; } to { opacity:1; } }
        @keyframes slide { from { opacity:0; transform: translateX(-8px); } to { opacity:1; transform:none; } }
        @keyframes lamp { 0%,100% { opacity:.35; } 18% { opacity:1; } 40% { opacity:.35; } }
      `}</style>
    </div>
  );
}

/* ================================================================== */
/* Tabs                                                               */
/* ================================================================== */

function VerdictTab({ data }: { data: ApiResponse }) {
  const a = data.assessment;
  return (
    <div>
      <div className="flex items-center gap-2">
        <h2 className="text-[1.05rem] font-semibold tracking-tight">How this score was reached</h2>
        <Explainer title="The scoring rule">
          Sixteen rules run against the register. Each fires only if its specific condition is
          met, and contributes a fixed number of points: five for a high-severity finding,
          three for medium, one for low, none for context. Four points or more is amber; eight
          or more is red. A handful of facts &mdash; liquidation, dissolution, an active
          strike-off proposal &mdash; override the arithmetic entirely, because a scoring
          system that can average away a fatal fact is dangerous.
        </Explainer>
      </div>

      {a.signals.length > 0 ? (
        <ol className="mt-6">
          {a.signals.map((s, i) => (
            <li
              key={s.id}
              style={{ animationDelay: `${i * 45}ms` }}
              className="grid grid-cols-[3rem_1fr] gap-x-5 border-t border-[#C7CBC4] py-4 motion-safe:animate-[slide_.35s_ease-out_both]"
            >
              <span
                className={`text-right text-[1.3rem] font-semibold leading-tight tracking-tight ${
                  POINTS[s.severity] === 0 ? "text-[#9BA298]" : "text-[#131A22]"
                }`}
              >
                {POINTS[s.severity] === 0 ? "—" : `+${POINTS[s.severity]}`}
              </span>
              <span className="text-[1.0625rem] leading-snug">{s.label}</span>
            </li>
          ))}
          <li className="grid grid-cols-[3rem_1fr] gap-x-5 border-t-2 border-[#131A22] pt-4">
            <span className="text-right text-[1.3rem] font-semibold leading-tight tracking-tight">
              {a.score}
            </span>
            <span className="font-[family-name:var(--font-serif)] text-[1.0625rem] text-[#3C464F]">
              Total. Four or more is amber, eight or more is red.
            </span>
          </li>
        </ol>
      ) : (
        <div className="mt-5">
                    <p className="max-w-[58ch] font-[family-name:var(--font-serif)] text-[1.0625rem] leading-[1.7] text-[#242C34]">
            {a.override
              ? "No scoring rule fired. The verdict above comes from the company's status on the register, which overrides the arithmetic."
              : "No rule fired. Nothing unusual appears on this company's public register."}
          </p>
          {!a.override && <div className="mt-4 flex items-start gap-2">
            <p className="max-w-[58ch] font-[family-name:var(--font-serif)] text-[1.0625rem] leading-[1.7] text-[#5A6069]">
              That is not the same as evidence it is financially sound. Filings can be
              perfectly punctual while the business underneath is struggling.
            </p>
            <Explainer title="What green means">
              Green means the public register shows nothing adverse. It is a statement about
              the record, not about the company. A business can file on time and go under; the
              register carries no bank data, no trade payment history and no management
              accounts. This distinction is written into the model&rsquo;s instructions as a
              hard rule, because the reassuring misreading is the one that would cost someone
              money.
            </Explainer>
          </div>}
        </div>
      )}

      <dl className="mt-10 grid grid-cols-2 gap-px border-t border-[#C7CBC4] bg-[#C7CBC4] pt-px sm:grid-cols-4">
        <Fact label="Status" value={STATUS_LABEL[data.context.status] ?? data.context.status} />
        <Fact label="Incorporated" value={data.context.incorporatedOn ?? "Unknown"} />
        <Fact label="Active officers" value={data.context.activeOfficers} />
        <Fact label="Charges outstanding" value={data.context.outstandingCharges} />
      </dl>

      {a.dataGaps.length > 0 && (
        <p className="mt-6 border-l-2 border-[#E0A32E] bg-[#EFEFEA] py-3 pl-4 font-[family-name:var(--font-serif)] text-[0.98rem]">
          Some records could not be retrieved ({a.dataGaps.join(", ")}). The verdict reflects
          only what was read.
        </p>
      )}
    </div>
  );
}

function FindingsTab({ data, bandInk }: { data: ApiResponse; bandInk: string }) {
  const signals = data.assessment.signals;

  if (signals.length === 0) {
    return (
      <p className="max-w-[58ch] font-[family-name:var(--font-serif)] text-[1.0625rem] leading-[1.7]">
        Nothing to show &mdash; no rule fired for this company.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <h2 className="text-[1.05rem] font-semibold tracking-tight">
          What was found, and what it may not mean
        </h2>
        <Explainer title="Why every finding has a defence">
          Each finding is shown with the ordinary, innocent reason it might have occurred. This
          is deliberate. A tool that only ever says &ldquo;concerning&rdquo; teaches its users
          to stop reading it, and once they do, the real warnings are buried too. Presenting
          the benign reading first is what makes the alarming reading credible when it matters.
        </Explainer>
      </div>

      <div className="mt-6 space-y-px">
        {signals.map((s, i) => (
          <article
            key={s.id}
            style={{ animationDelay: `${i * 60}ms` }}
            className="border-t border-[#C7CBC4] py-6 motion-safe:animate-[slide_.35s_ease-out_both]"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="text-[1.0625rem] font-semibold tracking-tight">{s.label}</h3>
              <span
                className="text-[0.8rem] font-medium"
                style={{ color: POINTS[s.severity] === 0 ? "#7C837A" : bandInk }}
              >
                {SEVERITY_WORD[s.severity]}
                {POINTS[s.severity] > 0 && ` · +${POINTS[s.severity]}`}
              </span>
            </div>

            <p className="mt-2.5 max-w-[62ch] font-[family-name:var(--font-serif)] text-[1.0625rem] leading-[1.65] text-[#242C34]">
              {s.detail}
            </p>

            <p className="mt-3 max-w-[62ch] border-l-2 border-[#C7CBC4] pl-4 font-[family-name:var(--font-serif)] text-[0.98rem] italic leading-[1.6] text-[#5A6069]">
              {s.benign}
            </p>

            <p className="mt-3 text-[0.8rem] text-[#8B9289]">
              Drawn from {s.source.toLowerCase()}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}

function InvestigationTab({
  inv,
  loading,
  error,
  onRetry,
}: {
  inv: Investigation | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <h2 className="text-[1.05rem] font-semibold tracking-tight">
          An agent reads the same register
        </h2>
        <Explainer title="Pipeline versus agent">
          Everything else here is a pipeline: fetch six things in a fixed order, score, done.
          Every company treated identically. An agent is given a goal and a set of tools and
          decides for itself what to look at, in what order, and when it has learnt enough. It
          loops &mdash; act, read the result, choose the next move.
          <br />
          <br />
          The split that matters: the agent chooses <em>what to investigate</em>, and has no
          say in the verdict. None of its tools return a score or an opinion; they return
          facts. The deterministic engine still produces the number, so the investigation can
          be adaptive while the judgement stays reproducible.
        </Explainer>
      </div>

      {loading && (
        <div className="mt-6">
          <p className="font-[family-name:var(--font-serif)] text-[1.0625rem] text-[#5A6069]">
            The agent is deciding what to look at. Ten to fifteen seconds.
          </p>
          <div className="mt-5 space-y-px">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse bg-[#E4E6E1]" />
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-6">
          <p className="font-[family-name:var(--font-serif)] text-[1.0625rem]">{error}</p>
          <button
            onClick={onRetry}
            className="mt-3 text-[0.98rem] underline decoration-[#AFB5AC] underline-offset-4 hover:decoration-[#131A22]"
          >
            Try again
          </button>
        </div>
      )}

      {inv && (
        <div className="mt-6">
          <ol className="space-y-px">
            {inv.trail.map((s, i) => (
              <li
                key={s.step}
                style={{ animationDelay: `${i * 160}ms` }}
                className="grid grid-cols-[2rem_1fr] gap-x-4 border-t border-[#C7CBC4] py-5 motion-safe:animate-[slide_.4s_ease-out_both]"
              >
                <span className="pt-0.5 text-[0.85rem] text-[#8B9289]">{s.step}</span>
                <div className="min-w-0">
                  <h3 className="text-[1.0625rem] font-semibold tracking-tight">
                    {TOOL_LABEL[s.tool] ?? s.tool}
                    {typeof s.args?.name === "string" && (
                      <span className="font-normal text-[#5A6069]"> &mdash; {s.args.name}</span>
                    )}
                  </h3>
                  {s.thought && (
                    <p className="mt-1.5 max-w-[62ch] font-[family-name:var(--font-serif)] text-[1rem] italic leading-[1.6] text-[#5A6069]">
                      {s.thought}
                    </p>
                  )}
                  <p className="mt-2 max-w-[62ch] font-[family-name:var(--font-serif)] text-[1.0625rem] leading-[1.6] text-[#242C34]">
                    {s.found}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-8 border-t-2 border-[#131A22] pt-6">
            <h3 className="text-[1.05rem] font-semibold tracking-tight">
              What the agent concluded
            </h3>
            <div className="mt-4 max-w-[64ch]">
              <Markdown text={inv.conclusion} />
            </div>
            <p className="mt-6 text-[0.8rem] text-[#8B9289]">
              {inv.steps} tool calls · written by {inv.model} · the verdict above came from the
              rules engine, not from this
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function BriefingTab({
  memo,
  loading,
  error,
  onRetry,
}: {
  memo: string | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div>
      <div className="flex items-center gap-2">
        <h2 className="text-[1.05rem] font-semibold tracking-tight">
          A briefing you could send on
        </h2>
        <Explainer title="What the model is allowed to do">
          The model receives the findings as structured data and the verdict as a settled fact.
          Its instructions forbid it from adding any information not supplied &mdash; including
          anything it happens to know about the company &mdash; from inventing figures, from
          disputing the rating, and from implying that a green verdict means a company is
          financially sound.
          <br />
          <br />
          It is also told that the register is public and anyone can file to it, so everything
          supplied is information to report on and never an instruction to follow.
        </Explainer>
      </div>

      {loading && (
        <p className="mt-6 font-[family-name:var(--font-serif)] text-[1.0625rem] text-[#5A6069]">
          Writing. A few seconds.
        </p>
      )}

      {error && (
        <div className="mt-6">
          <p className="font-[family-name:var(--font-serif)] text-[1.0625rem]">{error}</p>
          <button
            onClick={onRetry}
            className="mt-3 text-[0.98rem] underline decoration-[#AFB5AC] underline-offset-4 hover:decoration-[#131A22]"
          >
            Try again
          </button>
        </div>
      )}

      {memo && (
        <div className="mt-6">
          <div className="max-w-[64ch]">
            <Markdown text={memo} />
          </div>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(memo);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }}
            className="mt-7 rounded-sm border border-[#131A22] px-4 py-2 text-[0.95rem] font-medium transition hover:bg-[#131A22] hover:text-[#F1F2EE]"
          >
            {copied ? "Copied" : "Copy briefing"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* Small components                                                   */
/* ================================================================== */

/** A signal lamp, cycling slowly. The brand mark, alive rather than printed. */
function Lamp({ colour, delay }: { colour: string; delay: string }) {
  return (
    <span
      className="h-2.5 w-2.5 rounded-full motion-safe:animate-[lamp_3s_ease-in-out_infinite]"
      style={{ backgroundColor: colour, animationDelay: delay }}
    />
  );
}

function Metric({ value, label, accent }: { value: string; label: string; accent: string }) {
  return (
    <div className="border-r border-[#1E2831] px-6 py-5 last:border-r-0">
      <dd className="text-[1.75rem] font-semibold leading-none tracking-tight" style={{ color: accent }}>
        {value}
      </dd>
      <dt className="mt-1.5 text-[0.85rem] text-[#7E8992]">{label}</dt>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-4 py-3 text-[0.98rem] font-medium transition ${
        active ? "bg-[#F5F6F3] text-[#131A22]" : "bg-[#E1E4DE] text-[#6B7269] hover:bg-[#EAEDE7]"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * An inline explainer. This is a tool that needs understanding, not a product
 * being sold, so the reasoning sits everywhere it applies rather than in a
 * README nobody opens.
 */
function Explainer({
  title,
  children,
  dark = false,
}: {
  title: string;
  children: React.ReactNode;
  dark?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-block align-middle">
      <button
        onClick={() => setOpen(!open)}
        aria-label={`Explain: ${title}`}
        className={`grid h-5 w-5 place-items-center rounded-full border text-[0.7rem] font-semibold transition ${
          open
            ? "border-[#E8EAE6] bg-[#E8EAE6] text-[#0C1116]"
            : dark
            ? "border-[#4E5A63] text-[#8A959D] hover:border-[#E8EAE6] hover:text-[#E8EAE6]"
            : "border-[#9BA298] text-[#5A6069] hover:border-[#131A22] hover:text-[#131A22]"
        }`}
      >
        ?
      </button>

      {open && (
        <>
          <button
            className="fixed inset-0 z-30 cursor-default"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <span className="absolute left-0 top-7 z-40 block w-[min(30rem,80vw)] rounded-sm border border-[#2C3740] bg-[#0C1116] p-5 text-[#C3CAD0] shadow-2xl motion-safe:animate-[rise_.2s_ease-out]">
            <span className="block text-[0.95rem] font-semibold text-[#E8EAE6]">{title}</span>
            <span className="mt-2 block font-[family-name:var(--font-serif)] text-[0.98rem] leading-[1.65]">
              {children}
            </span>
          </span>
        </>
      )}
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-[#F5F6F3] px-4 py-4">
      <dt className="text-[0.8rem] text-[#7C837A]">{label}</dt>
      <dd className="mt-1 text-[1.0625rem] font-medium tracking-tight">{value}</dd>
    </div>
  );
}

/** The score, counting up. One small moment of motion on the thing that matters. */
function CountUp({ to }: { to: number }) {
  const [n, setN] = useState(0);

  useEffect(() => {
    if (to === 0) {
      setN(0);
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setN(to);
      return;
    }
    let current = 0;
    const id = setInterval(() => {
      current += 1;
      setN(current);
      if (current >= to) clearInterval(id);
    }, Math.max(28, 420 / to));
    return () => clearInterval(id);
  }, [to]);

  return <>{n}</>;
}

/**
 * A minimal markdown renderer.
 *
 * The model returns headings, bullets and bold. Rather than adding a dependency
 * — or worse, injecting raw HTML — this builds React elements from the handful
 * of constructs that actually appear. Anything it does not recognise falls
 * through as plain text, which is the safe failure.
 */
function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];

  const flush = () => {
    if (bullets.length === 0) return;
    out.push(
      <ul key={`ul-${out.length}`} className="my-3 space-y-2">
        {bullets.map((b, i) => (
          <li
            key={i}
            className="border-l-2 border-[#C7CBC4] pl-4 font-[family-name:var(--font-serif)] text-[1.0625rem] leading-[1.7] text-[#242C34]"
          >
            {inline(b)}
          </li>
        ))}
      </ul>
    );
    bullets = [];
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) {
      flush();
      continue;
    }

    if (line.startsWith("#")) {
      flush();
      out.push(
        <h4 key={out.length} className="mt-6 mb-2 text-[1rem] font-semibold tracking-tight">
          {inline(line.replace(/^#+\s*/, ""))}
        </h4>
      );
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      bullets.push(line.replace(/^[-*]\s+/, ""));
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      bullets.push(line.replace(/^\d+\.\s+/, ""));
      continue;
    }

    if (/^-{3,}$/.test(line)) {
      flush();
      continue;
    }

    flush();
    out.push(
      <p
        key={out.length}
        className="my-3 font-[family-name:var(--font-serif)] text-[1.0625rem] leading-[1.75] text-[#242C34]"
      >
        {inline(line)}
      </p>
    );
  }

  flush();
  return <>{out}</>;
}

/** Bold runs inside a line. */
function inline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}