/**
 * lib/risk/rewind.ts
 *
 * A time machine for dossiers.
 *
 * WHY THIS FILE IS THE WHOLE BACKTEST
 *
 * To ask "would GLRlight have flagged this company a year before it collapsed?"
 * we need the register as it stood a year before it collapsed. What the API
 * returns is the register as it stands TODAY — and today it says
 * status: "liquidation", which our override turns straight into red.
 *
 * Testing against that would produce near-perfect accuracy and prove nothing.
 * The engine would simply be reading a field that says "this company failed".
 *
 * That mistake has a name: LOOK-AHEAD BIAS. Information from after the decision
 * point leaking into the decision. It is the most common way a backtest lies,
 * in finance and in machine learning alike, and it is why most published
 * trading strategies fall apart in production.
 *
 * So this file strips the future out. Every field below is either rewound or
 * explicitly documented as unrewindable.
 */

import type { Charge, Dossier, Filing, Officer, PSC } from "../ch/types";

/** Was this date on or before the cutoff? Missing dates count as "not yet". */
function onOrBefore(isoDate: string | undefined, cutoff: Date): boolean {
  if (!isoDate) return false;
  const d = new Date(isoDate);
  return !Number.isNaN(d.getTime()) && d <= cutoff;
}

/** Was this date strictly after the cutoff — i.e. is it news from the future? */
function after(isoDate: string | undefined, cutoff: Date): boolean {
  if (!isoDate) return false;
  const d = new Date(isoDate);
  return !Number.isNaN(d.getTime()) && d > cutoff;
}

function monthsBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** What we could not rewind, so the report can be honest about it. */
export interface RewindCaveats {
  /** Director appointment outcomes reflect TODAY's status, not the cutoff's. */
  directorOutcomesAreCurrent: boolean;
  /** Accounts lateness was inferred from filing gaps, not from a real flag. */
  accountsOverdueInferred: boolean;
}

export interface RewoundDossier {
  dossier: Dossier;
  caveats: RewindCaveats;
}

/**
 * Reconstruct a dossier as it plausibly stood on `cutoff`.
 */
export function rewind(current: Dossier, cutoff: Date): RewoundDossier {
  /* ---------------- Filings: simply truncate ---------------- */
  // Easy and exact: every filing carries its own date.
  const filings: Filing[] = current.filings.filter((f) => onOrBefore(f.date, cutoff));

  /* ---------------- Officers ---------------- */
  // Someone who resigned AFTER the cutoff was still serving at the cutoff.
  // Someone appointed after the cutoff did not exist to us yet.
  const officers: Officer[] = current.officers
    .filter((o) => onOrBefore(o.appointedOn, cutoff))
    .map((o) => {
      const leftLater = after(o.resignedOn, cutoff);
      return {
        ...o,
        resignedOn: leftLater ? undefined : o.resignedOn,
        active: leftLater ? true : !o.resignedOn,
      };
    });

  /* ---------------- Charges ---------------- */
  // A charge satisfied after the cutoff was still outstanding at the cutoff.
  const charges: Charge[] = current.charges
    .filter((c) => onOrBefore(c.createdOn, cutoff))
    .map((c) => {
      const satisfiedLater = after(c.satisfiedOn, cutoff);
      return {
        ...c,
        satisfiedOn: satisfiedLater ? undefined : c.satisfiedOn,
        status: satisfiedLater ? "outstanding" : c.status,
      };
    });

  /* ---------------- Persons with significant control ---------------- */
  const pscs: PSC[] = current.pscs
    .filter((p) => onOrBefore(p.notifiedOn, cutoff))
    .map((p) => ({
      ...p,
      ceasedOn: after(p.ceasedOn, cutoff) ? undefined : p.ceasedOn,
    }));

  /* ---------------- Accounts position ---------------- */
  // accounts.overdue is a LIVE flag with no historical equivalent, so it has to
  // be inferred. A UK company files annually and may take up to nine months
  // after year end, so a gap beyond ~18 months since the last accounts filing
  // means something was late at the cutoff.
  //
  // This is an approximation and is reported as a caveat rather than hidden.
  const accountsFilings = filings
    .filter((f) => f.category === "accounts")
    .sort((a, b) => b.date.localeCompare(a.date));

  const lastAccountsFiling = accountsFilings[0]?.date;

  // Two filings are the minimum needed to know a company's filing rhythm. With
  // one, an 18-month gap is indistinguishable between "late" and "this is their
  // first cycle" — a UK company's first accounts are not due until 21 months
  // after incorporation. Inferring lateness from a single filing flagged every
  // young company in the control group and inverted the whole result.
  const canJudgeLateness = accountsFilings.length >= 2;

  const monthsSinceAccounts = lastAccountsFiling
    ? monthsBetween(new Date(lastAccountsFiling), cutoff)
    : null;

  const accountsOverdue =
    canJudgeLateness && monthsSinceAccounts !== null && monthsSinceAccounts > 18;

  // Approximate the next due date so the engine can say HOW late: one year
  // after the last filing is roughly when the next one was expected.
  const approxNextDue = lastAccountsFiling
    ? isoDate(new Date(new Date(lastAccountsFiling).getTime() + 365 * 24 * 60 * 60 * 1000))
    : undefined;

  /* ---------------- Confirmation statement ---------------- */
  const confirmationFilings = filings
    .filter((f) => f.category === "confirmation-statement" || f.category === "annual-return")
    .sort((a, b) => b.date.localeCompare(a.date));

  const lastConfirmation = confirmationFilings[0]?.date;
  const monthsSinceConfirmation = lastConfirmation
    ? monthsBetween(new Date(lastConfirmation), cutoff)
    : null;

  // The confirmation statement is annual with a 14-day filing window, so 14
  // months of silence means it was genuinely late.
    // Same reasoning as accounts: one filing tells you nothing about rhythm.
  const confirmationOverdue =
    confirmationFilings.length >= 2 &&
    monthsSinceConfirmation !== null &&
    monthsSinceConfirmation > 14;

  /* ---------------- Director histories ---------------- */
  // THE LEAK WE CANNOT CLOSE.
  //
  // Each appointment carries the OTHER company's status as it is today. A
  // subsidiary that entered liquidation in 2022 shows as liquidation even when
  // we are standing in 2016. We can drop appointments that began after the
  // cutoff, but we cannot un-fail a company that had not failed yet.
  //
  // Effect: the director-failure signal is inflated in the past. Reported as a
  // caveat. Closing it properly would need a dated status history the API does
  // not expose — a real limitation, not a shortcut.
  const directorHistories = current.directorHistories.map((dir) => ({
    ...dir,
    appointments: dir.appointments.filter((a) => onOrBefore(a.appointedOn, cutoff)),
  }));

  /* ---------------- Profile ---------------- */
  // The three fields that would give the game away outright.
  const profile: Dossier["profile"] = {
    ...current.profile,
    status: "active",           // it was trading at the cutoff, by construction
    statusDetail: undefined,    // would say "in liquidation"
    dissolvedOn: undefined,
    hasInsolvencyHistory: false, // true only because of the event we predict
    hasBeenLiquidated: false,
    previousNames: current.profile.previousNames.filter((n) =>
      onOrBefore(n.ceasedOn, cutoff)
    ),
    accounts: {
      ...current.profile.accounts,
      overdue: accountsOverdue,
      nextDue: approxNextDue,
      // Treated as "date of last accounts filing" rather than the true
      // made-up-to date, which the filing list does not reliably expose.
      lastMadeUpTo: lastAccountsFiling,
    },
    confirmationStatement: {
      ...current.profile.confirmationStatement,
      overdue: confirmationOverdue,
      nextDue: lastConfirmation,
      lastMadeUpTo: lastConfirmation,
    },
    // These flags are point-in-time and cheap to recompute from what we kept.
    hasCharges: charges.length > 0,
    registeredOfficeInDispute: false,       // no dated history available
    undeliverableRegisteredOffice: false,   // no dated history available
  };

  return {
    dossier: {
      profile,
      officers,
      filings,
      charges,
      pscs,
      directorHistories,
      fetchedAt: cutoff.toISOString(),
      partialFailures: current.partialFailures,
    },
    caveats: {
      directorOutcomesAreCurrent: directorHistories.some((d) => d.appointments.length > 0),
      accountsOverdueInferred: true,
    },
  };
}

/**
 * When did this company's insolvency actually begin?
 *
 * We use the earliest insolvency-related filing rather than the dissolution
 * date, because dissolution can follow years later — and we want the moment
 * things visibly went wrong, not the moment the paperwork finished.
 *
 * Returns null when nothing insolvency-related appears, in which case the
 * company should be dropped from the sample rather than guessed at.
 */
export function insolvencyOnset(d: Dossier): Date | null {
  const markers = d.filings.filter((f) => {
    const text = `${f.category} ${f.type} ${f.description ?? ""}`.toLowerCase();
    return (
      text.includes("insolvency") ||
      text.includes("liquidation") ||
      text.includes("administration") ||
      text.includes("receiver") ||
      text.includes("winding-up") ||
      text.includes("winding up")
    );
  });

  if (markers.length === 0) return null;

  // Filings arrive newest-first, so the earliest marker is the last one.
  const earliest = markers.map((f) => f.date).sort()[0];
  const date = new Date(earliest);
  return Number.isNaN(date.getTime()) ? null : date;
}