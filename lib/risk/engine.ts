/**
 * lib/risk/engine.ts
 *
 * The risk engine. Turns a Dossier (raw facts from Companies House) into an
 * Assessment (scored signals plus a green/amber/red band).
 *
 * DESIGN RULE: no AI in this file, ever. Everything here is deterministic —
 * the same dossier always produces the same score. That is what makes the
 * output auditable, testable, and defensible. The AI layer only explains what
 * this file decided; it never changes the number.
 *
 * CALIBRATION HISTORY
 * v1 flagged Greggs PLC and Tesco PLC as amber — both entirely healthy. Four
 * assumptions were wrong, and each fix is marked "CALIBRATION v2" below:
 *   1. Dissolution was counted as company failure. It usually is not.
 *   2. Listed companies were penalised for having no PSC. They are exempt.
 *   3. Director departures were counted absolutely, not relative to board size.
 *   4. Name changes had no recency window, so 1980s rebrands still scored.
 * For a screening tool, false positives are more damaging than misses: users
 * who see healthy companies flagged stop trusting every flag.
 */

import type { Dossier } from "../ch/types";

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

export type Severity = "info" | "low" | "medium" | "high";
export type Band = "green" | "amber" | "red";

/** How many points each severity contributes to the total. */
const POINTS: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 3,
  high: 5,
};

/**
 * Score thresholds.
 *
 * CALIBRATION v2: amber raised from 3 to 4, so a single medium signal no
 * longer tips a company out of green on its own. One notable fact is worth
 * reading; it is not worth a warning.
 */
const AMBER_AT = 4;
const RED_AT = 8;

/**
 * One thing we noticed about the company.
 *
 * Every signal carries a `benign` field. This is deliberate: a tool that only
 * ever says "concerning" trains its users to ignore it. Presenting the
 * innocent explanation alongside the flag is what makes the alarming reading
 * credible when it matters.
 */
export interface Signal {
  /** Stable machine name, e.g. "accounts_overdue". Used in tests and the UI. */
  id: string;
  /** Short human title. */
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
  /** Set when a decisive fact bypassed the arithmetic entirely. */
  override?: string;
  /** Sub-resources that failed to load, so the UI can be honest about gaps. */
  dataGaps: string[];
  assessedAt: string;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * How many months ago was this date? Returns null for missing or unparseable
 * dates, so callers must decide what to do about missing data rather than
 * silently treating it as "now".
 */
function monthsSince(isoDate?: string): number | null {
  if (!isoDate) return null;
  const then = new Date(isoDate);
  if (Number.isNaN(then.getTime())) return null;
  const msPerMonth = 1000 * 60 * 60 * 24 * 30.44; // average month length
  return (Date.now() - then.getTime()) / msPerMonth;
}

/** Statuses meaning the company is already in a formal insolvency process. */
const DISTRESSED_STATUSES = [
  "liquidation",
  "administration",
  "receivership",
  "insolvency-proceedings",
  "voluntary-arrangement",
];

/**
 * CALIBRATION v2 — the most important fix in this file.
 *
 * A company being DISSOLVED usually means it was closed down voluntarily and
 * solvently: dormant subsidiaries get struck off as routine group housekeeping,
 * and any active director of a large group accumulates dozens of them. Treating
 * that as failure made every experienced plc director look like a serial
 * bankrupt, which is what put Tesco in amber.
 *
 * Genuine failure is insolvency: liquidation, administration, receivership.
 */
const INSOLVENT_OUTCOMES = [
  "liquidation",
  "administration",
  "receivership",
  "insolvency-proceedings",
];

/** True for public limited companies, which follow different disclosure rules. */
function isListedCompany(d: Dossier): boolean {
  return d.profile.type?.toLowerCase().includes("plc") ?? false;
}

/**
 * The size of the board over the last year: directors still serving, plus
 * those who left during the period. Used to judge departures proportionally.
 */
function boardSizeLastYear(d: Dossier): number {
  const active = d.officers.filter((o) => o.active && o.role.includes("director")).length;
  const departed = d.officers.filter((o) => {
    const age = monthsSince(o.resignedOn);
    return age !== null && age <= 12 && o.role.includes("director");
  }).length;
  return active + departed;
}

/* ------------------------------------------------------------------ */
/* The rules                                                           */
/* ------------------------------------------------------------------ */
/*
 * Each rule is a function that takes the dossier and returns either a Signal
 * or null (meaning "nothing to report"). They are deliberately small and
 * independent: adding a new signal means writing one function and adding it to
 * the RULES list at the bottom. Nothing else changes.
 */

type Rule = (d: Dossier) => Signal | null;

// ---- Filing behaviour ----------------------------------------------------

const accountsOverdue: Rule = (d) => {
  if (!d.profile.accounts.overdue) return null;

  const due = d.profile.accounts.nextDue;
  const late = monthsSince(due);
  const howLate = late !== null ? `${late.toFixed(1)} months late` : "overdue";

  return {
    id: "accounts_overdue",
    label: "Annual accounts overdue",
    // Being months late is materially different from being days late.
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
    severity: "low",
    detail: `The annual confirmation statement was due ${
      d.profile.confirmationStatement.nextDue ?? "at an unknown date"
    } and has not been filed.`,
    benign:
      "This filing is a formality and costs very little to submit, so missing " +
      "it usually signals inattention rather than difficulty.",
    source: "Companies House filing deadlines",
  };
};

const staleAccounts: Rule = (d) => {
  const age = monthsSince(d.profile.accounts.lastMadeUpTo);
  // UK companies file up to 9 months after year end, so ~21 months is the
  // point at which the newest published figures are unusually old.
  if (age === null || age < 21) return null;

  return {
    id: "stale_accounts",
    label: "Published figures are unusually old",
    severity: "low",
    detail: `The most recent accounts cover a period ending ${
      d.profile.accounts.lastMadeUpTo
    }, roughly ${Math.round(age)} months ago.`,
    benign:
      "Normal filing lag can reach 21 months. This is a caution about how much " +
      "the financial picture can be trusted, not an accusation.",
    source: "Last accounts made-up date",
  };
};

// ---- Register events -----------------------------------------------------

const strikeOffAction: Rule = (d) => {
  const recent = d.filings.filter((f) => {
    const age = monthsSince(f.date);
    const text = `${f.type} ${f.description ?? ""}`.toLowerCase();
    return age !== null && age <= 18 && text.includes("strike-off");
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

const auditorResignation: Rule = (d) => {
  // Heuristic: Companies House gives no clean flag for this, so we match text
  // in filing descriptions. Imperfect, and labelled as such in the source line.
  const hits = d.filings.filter((f) => {
    const age = monthsSince(f.date);
    const text = (f.description ?? "").toLowerCase();
    return age !== null && age <= 24 && text.includes("auditor") && text.includes("resign");
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

const previousNames: Rule = (d) => {
  // CALIBRATION v2: only count name changes in the last five years. Tesco fired
  // this rule on rebrands from the 1980s, which say nothing about today.
  const recent = d.profile.previousNames.filter((n) => {
    const age = monthsSince(n.ceasedOn);
    return age !== null && age <= 60;
  });

  if (recent.length < 2) return null;

  return {
    id: "multiple_name_changes",
    label: "Repeated recent name changes",
    severity: "low",
    detail: `${recent.length} name changes in the last five years, most recently from ${recent[0]?.name}.`,
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

const directorChurn: Rule = (d) => {
  const departures = d.officers.filter((o) => {
    const age = monthsSince(o.resignedOn);
    return age !== null && age <= 12 && o.role.includes("director");
  });

  if (departures.length < 2) return null;

  // CALIBRATION v2: judge departures as a PROPORTION of the board.
  // Three departures from a ten-person plc board is routine rotation; three
  // from a four-person board is most of the leadership leaving. The absolute
  // number carries no information on its own.
  const board = boardSizeLastYear(d);
  if (board === 0) return null;

  const share = departures.length / board;
  if (share < 0.34) return null;

  return {
    id: "director_churn",
    label: "Large share of the board departed",
    severity: share >= 0.6 ? "high" : "medium",
    detail: `${departures.length} of roughly ${board} directors resigned in the last 12 months (${Math.round(
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
    severity: "high",
    detail: "Every director appointment has been resigned or terminated.",
    benign:
      "Sometimes a filing lag after a restructure. A UK company is legally " +
      "required to have at least one director, so this should not persist.",
    source: "Officer list",
  };
};

// ---- Ownership -----------------------------------------------------------

const noPSC: Rule = (d) => {
  if (d.profile.status !== "active") return null;

  // CALIBRATION v2: listed companies are EXEMPT from the PSC register. They
  // disclose ownership through stock-market rules instead. Penalising them for
  // an empty PSC register flagged every plc in Britain, including Greggs.
  if (isListedCompany(d)) return null;

  const activePSCs = d.pscs.filter((p) => !p.ceasedOn);
  if (activePSCs.length > 0) return null;

  return {
    id: "no_psc",
    label: "No person with significant control identified",
    severity: "low",
    detail: "No active PSC is recorded against the company.",
    benign:
      "Can be legitimate where ownership sits with an overseas parent. It does " +
      "reduce transparency about who is actually behind the company.",
    source: "PSC register",
  };
};

const controlChange: Rule = (d) => {
  const recentlyCeased = d.pscs.filter((p) => {
    const age = monthsSince(p.ceasedOn);
    return age !== null && age <= 12;
  });

  if (recentlyCeased.length === 0) return null;

  return {
    id: "control_change",
    label: "Recent change of control",
    severity: "medium",
    detail: `${recentlyCeased.length} controlling party/parties ceased in the last 12 months.`,
    benign:
      "Sales, buyouts and internal group transfers all show up this way. " +
      "Relevant because contracts and creditworthiness may have changed hands.",
    source: "PSC register cease dates",
  };
};

// ---- Secured lending -----------------------------------------------------

const newCharges: Rule = (d) => {
  const recent = d.charges.filter((c) => {
    const age = monthsSince(c.createdOn);
    return age !== null && age <= 12 && c.status === "outstanding";
  });

  if (recent.length === 0) return null;

  const holders = [...new Set(recent.flatMap((c) => c.personsEntitled))].slice(0, 3);

  return {
    id: "new_charges",
    label: "New secured borrowing in the last year",
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
  // CALIBRATION v2: threshold raised from 5 to 8. Established companies of any
  // size routinely carry a handful of charges.
  if (outstanding.length < 8) return null;

  return {
    id: "heavy_charge_load",
    label: "Large number of outstanding charges",
    severity: "low",
    detail: `${outstanding.length} charges remain outstanding against the company.`,
    benign:
      "Asset-heavy businesses such as property and equipment leasing routinely " +
      "carry many charges. Meaningful mainly relative to sector peers.",
    source: "Charges register",
  };
};

// ---- Director track record ----------------------------------------------

const directorFailureHistory: Rule = (d) => {
  // Ethics boundary: we only reach this data through directors of the company
  // the user searched. There is no path from a person's name.
  //
  // CALIBRATION v2: count only INSOLVENT outcomes, not dissolutions, and judge
  // them as a proportion of the director's total appointments. See the comment
  // on INSOLVENT_OUTCOMES above — this was the single biggest false-positive
  // source in v1.
  const flagged = d.directorHistories
    .map((dir) => {
      const total = dir.appointments.length;
      const insolvent = dir.appointments.filter((a) =>
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

// ---- Context (scores zero, but the reader should know) -------------------

const youngCompany: Rule = (d) => {
  const age = monthsSince(d.profile.incorporatedOn);
  if (age === null || age > 24) return null;

  return {
    id: "young_company",
    label: "Company is less than two years old",
    severity: "info",
    detail: `Incorporated ${d.profile.incorporatedOn}, roughly ${Math.round(age)} months ago.`,
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

/** Every rule the engine runs. Add a new signal by adding a function here. */
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
 * Overrides: facts so decisive that the arithmetic should not get a vote.
 *
 * Scoring systems that can average away a fatal fact are dangerous. A company
 * in liquidation with otherwise tidy filings must not come out amber.
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
 * Run every rule, total the points, and decide the band.
 *
 * This function is pure: same dossier in, same assessment out, every time.
 * That is what makes it testable and what makes the score defensible.
 */
export function assess(d: Dossier): Assessment {
  // .map runs each rule; .filter drops the nulls (rules that found nothing).
  const signals = RULES.map((rule) => rule(d)).filter((s): s is Signal => s !== null);

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

  // Sort so the most serious findings appear first in any UI.
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
    assessedAt: new Date().toISOString(),
  };
}