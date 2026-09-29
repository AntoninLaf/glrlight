/**
 * lib/risk/engine.ts
 *
 * Turns a Dossier (raw facts from Companies House) into an Assessment (scored
 * signals plus a green/amber/red band).
 *
 * DESIGN RULE: no AI in this file, ever. Everything here is deterministic —
 * the same dossier always produces the same score. That is what makes the
 * output auditable, testable, and defensible. The AI layer only explains what
 * this file decided; it never changes the number.
 *
 * ── CALIBRATION HISTORY ──────────────────────────────────────────────────
 *
 * v1 rated Greggs and Tesco amber — both entirely healthy. Four assumptions
 * were wrong, each a domain error rather than a coding bug:
 *   1. Dissolution was counted as company failure. It usually is not.
 *   2. Listed companies were penalised for having no PSC. They are exempt.
 *   3. Director departures were counted absolutely, not against board size.
 *   4. Name changes had no recency window, so 1980s rebrands still scored.
 *
 * v3 came out of the backtest (scripts/backtest.ts), which surfaced a defect
 * rather than a miscalibration:
 *   5. AS-OF DATE. Every time-window rule compared dates against Date.now().
 *      Scoring a company as it stood in 2008 therefore asked "did anyone
 *      resign in the last 12 months of 2026?" — so half the engine silently
 *      never fired during the entire backtest. Rules now take an explicit
 *      `asOf` date.
 *   6. PSC ANACHRONISM. The PSC register did not exist before 6 April 2016.
 *      The rule was flagging every company in Britain for not complying with
 *      a law that had not been written.
 *   7. TWO RULES CARRIED NO INFORMATION. `stale_accounts` fired in 95% of
 *      failures and 100% of survivors; `heavy_charge_load` was 10% vs 22%,
 *      i.e. mildly backwards. Both now score zero and remain only as context.
 *      A signal that fires equally in both groups has zero discriminating
 *      power by definition — demoting it is principled, not curve-fitting.
 */

import type { Dossier } from "../ch/types";

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

export type Severity = "info" | "low" | "medium" | "high";
export type Band = "green" | "amber" | "red";

const POINTS: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 3,
  high: 5,
};

const AMBER_AT = 4;
const RED_AT = 8;

/**
 * The PSC (people with significant control) register came into force on
 * 6 April 2016. Before that date, no company had one — so the absence of a
 * PSC entry says nothing at all.
 */
const PSC_REGISTER_START = new Date("2016-04-06");

export interface Signal {
  id: string;
  label: string;
  severity: Severity;
  /** What we actually found, with dates. This is the evidence. */
  detail: string;
  /** The boring explanation that is usually the true one. */
  benign: string;
  /** Which part of the public register supports this. */
  source: string;
}

export interface Assessment {
  companyNumber: string;
  companyName: string;
  band: Band;
  score: number;
  signals: Signal[];
  override?: string;
  dataGaps: string[];
  assessedAt: string;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * How many months before `asOf` was this date?
 *
 * `asOf` is passed in rather than assumed to be now. That one parameter is
 * what makes historical scoring possible — without it every "in the last 12
 * months" rule silently measures from today, which is exactly the defect the
 * backtest exposed.
 */
function monthsBefore(isoDate: string | undefined, asOf: Date): number | null {
  if (!isoDate) return null;
  const then = new Date(isoDate);
  if (Number.isNaN(then.getTime())) return null;
  const msPerMonth = 1000 * 60 * 60 * 24 * 30.44;
  return (asOf.getTime() - then.getTime()) / msPerMonth;
}

const DISTRESSED_STATUSES = [
  "liquidation",
  "administration",
  "receivership",
  "insolvency-proceedings",
  "voluntary-arrangement",
];

/**
 * A company being DISSOLVED usually means it was closed voluntarily and
 * solvently — dormant subsidiaries are struck off as routine housekeeping, and
 * any director of a large group accumulates dozens. Genuine failure is
 * insolvency. Conflating the two was v1's largest false-positive source.
 */
const INSOLVENT_OUTCOMES = [
  "liquidation",
  "administration",
  "receivership",
  "insolvency-proceedings",
];

function isListedCompany(d: Dossier): boolean {
  return d.profile.type?.toLowerCase().includes("plc") ?? false;
}

/** Directors serving during the year before `asOf`, plus those who left in it. */
function boardSize(d: Dossier, asOf: Date): number {
  const active = d.officers.filter((o) => o.active && o.role.includes("director")).length;
  const departed = d.officers.filter((o) => {
    const age = monthsBefore(o.resignedOn, asOf);
    return age !== null && age >= 0 && age <= 12 && o.role.includes("director");
  }).length;
  return active + departed;
}

/** True when a date falls inside the `months` window ending at `asOf`. */
function within(isoDate: string | undefined, months: number, asOf: Date): boolean {
  const age = monthsBefore(isoDate, asOf);
  return age !== null && age >= 0 && age <= months;
}

/* ------------------------------------------------------------------ */
/* The rules                                                           */
/* ------------------------------------------------------------------ */

type Rule = (d: Dossier, asOf: Date) => Signal | null;

// ---- Filing behaviour ----------------------------------------------------

const accountsOverdue: Rule = (d, asOf) => {
  if (!d.profile.accounts.overdue) return null;

  const due = d.profile.accounts.nextDue;
  const late = monthsBefore(due, asOf);
  const howLate = late !== null && late > 0 ? `${late.toFixed(1)} months late` : "overdue";

  return {
    id: "accounts_overdue",
    label: "Annual accounts overdue",
    severity: late !== null && late > 3 ? "high" : "medium",
    detail: `Accounts were due ${due ?? "on an unknown date"} and are ${howLate}.`,
    benign:
      "Often an overloaded bookkeeper or a late auditor rather than distress. " +
      "But late accounts are the most common single precursor to insolvency.",
    source: "Companies House filing deadlines",
  };
};

const confirmationStatementOverdue: Rule = (d) => {
  if (!d.profile.confirmationStatement.overdue) return null;

  return {
    id: "confirmation_overdue",
    label: "Confirmation statement overdue",
    // Backtest: 30% of failures vs 11% of survivors — one of the better
    // discriminators, and cheap to file, so missing it is meaningful.
    severity: "medium",
    detail: `The annual confirmation statement was due ${
      d.profile.confirmationStatement.nextDue ?? "at an unknown date"
    } and had not been filed.`,
    benign:
      "This filing is a formality and costs very little to submit, so missing " +
      "it usually signals inattention rather than difficulty.",
    source: "Companies House filing deadlines",
  };
};

const staleAccounts: Rule = (d, asOf) => {
  const age = monthsBefore(d.profile.accounts.lastMadeUpTo, asOf);
  if (age === null || age < 21) return null;

  return {
    id: "stale_accounts",
    label: "Published figures are unusually old",
    // Scores zero. Backtest: 95% of failures, 100% of survivors — it fires on
    // nearly everything, so it separates nothing. Kept as context for the
    // reader, removed from the arithmetic.
    severity: "info",
    detail: `The most recent accounts cover a period ending ${
      d.profile.accounts.lastMadeUpTo
    }, roughly ${Math.round(age)} months earlier.`,
    benign:
      "Normal filing lag can reach 21 months. This is a caution about how much " +
      "the financial picture can be trusted, not an accusation.",
    source: "Last accounts made-up date",
  };
};

// ---- Register events -----------------------------------------------------

const strikeOffAction: Rule = (d, asOf) => {
  const recent = d.filings.filter((f) => {
    const text = `${f.type} ${f.description ?? ""}`.toLowerCase();
    return within(f.date, 18, asOf) && text.includes("strike-off");
  });

  if (recent.length === 0) return null;

  return {
    id: "strike_off_action",
    label: "Strike-off action on the register",
    severity: "high",
    detail: `${recent.length} strike-off related filing(s) since ${recent[recent.length - 1].date}.`,
    benign:
      "Compulsory strike-off is usually triggered by missed filings and is often " +
      "suspended once the paperwork is caught up. It still means the Registrar " +
      "has moved to close the company.",
    source: "Filing history, Gazette notices",
  };
};

const auditorResignation: Rule = (d, asOf) => {
  // Heuristic: Companies House gives no clean flag, so we match filing text.
  const hits = d.filings.filter((f) => {
    const text = (f.description ?? "").toLowerCase();
    return within(f.date, 24, asOf) && text.includes("auditor") && text.includes("resign");
  });

  if (hits.length === 0) return null;

  return {
    id: "auditor_resignation",
    label: "Auditor resignation filed",
    severity: "medium",
    detail: `Auditor resignation recorded ${hits[0].date}.`,
    benign:
      "Auditors also resign over fee disputes, rotation policy, or because the " +
      "company no longer needs an audit. Worth asking which applies.",
    source: "Filing history (text match — verify against the filing itself)",
  };
};

const previousNames: Rule = (d, asOf) => {
  const recent = d.profile.previousNames.filter((n) => within(n.ceasedOn, 60, asOf));
  if (recent.length < 2) return null;

  return {
    id: "multiple_name_changes",
    label: "Repeated recent name changes",
    severity: "low",
    detail: `${recent.length} name changes in the preceding five years, most recently from ${recent[0]?.name}.`,
    benign:
      "Rebrands, acquisitions and group restructures all cause name changes. " +
      "Only notable when combined with other signals.",
    source: "Previous company names",
  };
};

const undeliverableAddress: Rule = (d) => {
  if (!d.profile.undeliverableRegisteredOffice && !d.profile.registeredOfficeInDispute) {
    return null;
  }

  return {
    id: "registered_office_problem",
    label: "Registered office problem",
    severity: "medium",
    detail: d.profile.registeredOfficeInDispute
      ? "The registered office address is recorded as in dispute."
      : "Post to the registered office has been returned as undeliverable.",
    benign:
      "Companies move and forget to update the register. It does mean official " +
      "correspondence is not reaching them.",
    source: "Registered office status flags",
  };
};

// ---- Governance ----------------------------------------------------------

const directorChurn: Rule = (d, asOf) => {
  const departures = d.officers.filter(
    (o) => within(o.resignedOn, 12, asOf) && o.role.includes("director")
  );

  if (departures.length < 2) return null;

  // Judge departures as a PROPORTION of the board. Three from a ten-person plc
  // board is routine rotation; three from a board of four is the leadership
  // walking out. The absolute number carries no information alone.
  const board = boardSize(d, asOf);
  if (board === 0) return null;

  const share = departures.length / board;
  if (share < 0.34) return null;

  return {
    id: "director_churn",
    label: "Large share of the board departed",
    severity: share >= 0.6 ? "high" : "medium",
    detail: `${departures.length} of roughly ${board} directors resigned within 12 months (${Math.round(
      share * 100
    )}% of the board): ${departures.map((o) => `${o.name} (${o.resignedOn})`).join(", ")}.`,
    benign:
      "Board refreshes, retirements and group reorganisations all cause " +
      "clustered departures. Timing relative to other events is what matters.",
    source: "Officer appointments and resignations",
  };
};

const noActiveDirectors: Rule = (d) => {
  if (d.officers.length === 0) return null; // we failed to load them; say nothing
  const active = d.officers.filter((o) => o.active && o.role.includes("director"));
  if (active.length > 0) return null;

  return {
    id: "no_active_directors",
    label: "No active directors on the register",
    // Backtest: fired only in companies that failed. Rare but clean.
    severity: "high",
    detail: "Every director appointment had been resigned or terminated.",
    benign:
      "Sometimes a filing lag after a restructure. A UK company is legally " +
      "required to have at least one director, so this should not persist.",
    source: "Officer list",
  };
};

// ---- Ownership -----------------------------------------------------------

const noPSC: Rule = (d, asOf) => {
  // The PSC register did not exist before 6 April 2016. Scoring its absence
  // before that date flags every company in the country for not complying with
  // a law that had not been written — which is exactly what the backtest
  // caught (fired in 90% of failures AND 78% of survivors).
  if (asOf < PSC_REGISTER_START) return null;

  if (d.profile.status !== "active") return null;

  // Listed companies are exempt: they disclose ownership through
  // stock-market rules instead.
  if (isListedCompany(d)) return null;

  const activePSCs = d.pscs.filter((p) => !p.ceasedOn);
  if (activePSCs.length > 0) return null;

  return {
    id: "no_psc",
    label: "No person with significant control identified",
    severity: "low",
    detail: "No active PSC was recorded against the company.",
    benign:
      "Can be legitimate where ownership sits with an overseas parent. It does " +
      "reduce transparency about who is actually behind the company.",
    source: "PSC register",
  };
};

const controlChange: Rule = (d, asOf) => {
  const recentlyCeased = d.pscs.filter((p) => within(p.ceasedOn, 12, asOf));
  if (recentlyCeased.length === 0) return null;

  return {
    id: "control_change",
    label: "Recent change of control",
    severity: "medium",
    detail: `${recentlyCeased.length} controlling party/parties ceased within 12 months.`,
    benign:
      "Sales, buyouts and internal group transfers all show up this way. " +
      "Relevant because contracts and creditworthiness may have changed hands.",
    source: "PSC register cease dates",
  };
};

// ---- Secured lending -----------------------------------------------------

const newCharges: Rule = (d, asOf) => {
  const recent = d.charges.filter(
    (c) => within(c.createdOn, 12, asOf) && c.status === "outstanding"
  );

  if (recent.length === 0) return null;

  const holders = [...new Set(recent.flatMap((c) => c.personsEntitled))].slice(0, 3);

  return {
    id: "new_charges",
    label: "New secured borrowing within the year",
    severity: "medium",
    detail: `${recent.length} outstanding charge(s) registered since ${
      recent[recent.length - 1].createdOn
    }${holders.length ? `, held by ${holders.join(", ")}` : ""}.`,
    benign:
      "Taking on secured debt is normal for growth, asset purchases and " +
      "refinancing. It becomes a signal when it coincides with late filings.",
    source: "Charges register",
  };
};

const heavyChargeLoad: Rule = (d) => {
  const outstanding = d.charges.filter((c) => c.status === "outstanding");
  if (outstanding.length < 8) return null;

  return {
    id: "heavy_charge_load",
    label: "Large number of outstanding charges",
    // Scores zero. Backtest: 10% of failures vs 22% of survivors — mildly
    // BACKWARDS, because asset-heavy survivors carry the most charges.
    // Kept as context, removed from the arithmetic.
    severity: "info",
    detail: `${outstanding.length} charges were outstanding against the company.`,
    benign:
      "Asset-heavy businesses such as property and equipment leasing routinely " +
      "carry many charges. Meaningful mainly relative to sector peers.",
    source: "Charges register",
  };
};

// ---- Director track record ----------------------------------------------

const directorFailureHistory: Rule = (d, asOf) => {
  // Ethics boundary: reached only through directors of the company the user
  // searched. There is no path from a person's name.
  //
  // Counts only INSOLVENT outcomes, not dissolutions, judged as a proportion
  // of total appointments. Backtest: fired only in companies that failed.
  const flagged = d.directorHistories
    .map((dir) => {
      const appointments = dir.appointments.filter((a) => {
        const age = monthsBefore(a.appointedOn, asOf);
        return age === null || age >= 0; // exclude appointments after the cutoff
      });
      const total = appointments.length;
      const insolvent = appointments.filter((a) =>
        INSOLVENT_OUTCOMES.includes(a.companyStatus ?? "")
      ).length;
      return { name: dir.name, insolvent, total, share: total > 0 ? insolvent / total : 0 };
    })
    .filter((dir) => dir.insolvent >= 2 && dir.share >= 0.15);

  if (flagged.length === 0) return null;

  const severe = flagged.some((f) => f.insolvent >= 4 && f.share >= 0.25);

  return {
    id: "director_failure_history",
    label: "Directors with prior insolvencies",
    severity: severe ? "high" : "medium",
    detail:
      flagged
        .map(
          (f) =>
            `${f.name}: ${f.insolvent} of ${f.total} past appointments entered insolvency (${Math.round(
              f.share * 100
            )}%)`
        )
        .join("; ") + ".",
    benign:
      "Insolvency practitioners, turnaround specialists and restructuring " +
      "advisers are appointed to failing companies by design, and will show " +
      "this pattern legitimately. Check what the person does for a living.",
    source: "Officer appointment histories",
  };
};

// ---- Context -------------------------------------------------------------

const youngCompany: Rule = (d, asOf) => {
  const age = monthsBefore(d.profile.incorporatedOn, asOf);
  if (age === null || age > 24 || age < 0) return null;

  return {
    id: "young_company",
    label: "Company is less than two years old",
    severity: "info",
    detail: `Incorporated ${d.profile.incorporatedOn}, roughly ${Math.round(age)} months earlier.`,
    benign:
      "Not a risk signal in itself. It does mean there is little filing history " +
      "to judge, so the absence of warnings is weak evidence of health.",
    source: "Incorporation date",
  };
};

const insolvencyHistory: Rule = (d) => {
  if (!d.profile.hasInsolvencyHistory) return null;

  return {
    id: "insolvency_history",
    label: "Prior insolvency events recorded",
    severity: "medium",
    detail: "The register records insolvency history against this company.",
    benign:
      "Companies do emerge from administration or a voluntary arrangement and " +
      "trade successfully afterwards. Check whether the event is resolved.",
    source: "Insolvency history flag",
  };
};

/** Every rule the engine runs. Add a signal by adding a function here. */
const RULES: Rule[] = [
  accountsOverdue,
  confirmationStatementOverdue,
  staleAccounts,
  strikeOffAction,
  auditorResignation,
  previousNames,
  undeliverableAddress,
  directorChurn,
  noActiveDirectors,
  noPSC,
  controlChange,
  newCharges,
  heavyChargeLoad,
  directorFailureHistory,
  youngCompany,
  insolvencyHistory,
];

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

/**
 * Facts so decisive that the arithmetic should not get a vote. Scoring systems
 * that can average away a fatal fact are dangerous.
 */
function findOverride(d: Dossier): { band: Band; reason: string } | null {
  const status = d.profile.status;

  if (DISTRESSED_STATUSES.includes(status)) {
    return {
      band: "red",
      reason: `The company is in ${status}. This is a formal insolvency process, not a warning sign.`,
    };
  }

  if (status === "dissolved") {
    return {
      band: "red",
      reason: `The company was dissolved${
        d.profile.dissolvedOn ? ` on ${d.profile.dissolvedOn}` : ""
      } and no longer legally exists.`,
    };
  }

  if (d.profile.statusDetail?.includes("strike-off")) {
    return {
      band: "red",
      reason: "The Registrar has an active proposal to strike this company off the register.",
    };
  }

  return null;
}

/**
 * Run every rule, total the points, decide the band.
 *
 * `asOf` defaults to the dossier's own fetch time, which means live lookups
 * score against today and rewound dossiers (lib/risk/rewind.ts sets fetchedAt
 * to the cutoff) score against their historical date — with no change needed
 * at any call site.
 *
 * Pure function: same inputs, same assessment, every time.
 */
export function assess(d: Dossier, asOf?: Date): Assessment {
  const at = asOf ?? new Date(d.fetchedAt);

  const signals = RULES.map((rule) => rule(d, at)).filter((s): s is Signal => s !== null);
  const score = signals.reduce((total, s) => total + POINTS[s.severity], 0);

  const override = findOverride(d);

  let band: Band;
  if (override) {
    band = override.band;
  } else if (score >= RED_AT) {
    band = "red";
  } else if (score >= AMBER_AT) {
    band = "amber";
  } else {
    band = "green";
  }

  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
  signals.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    companyNumber: d.profile.companyNumber,
    companyName: d.profile.name,
    band,
    score,
    signals,
    override: override?.reason,
    dataGaps: d.partialFailures,
    assessedAt: at.toISOString(),
  };
}