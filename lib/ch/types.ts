/**
 * Normalised shapes for everything we pull from Companies House.
 *
 * These are OUR types, not the API's. The API returns far more than this and
 * uses snake_case; we keep only what feeds a signal and convert at the boundary.
 * When the API changes shape, only lib/ch/client.ts needs editing — the risk
 * engine downstream never sees raw government JSON.
 */

export type TriageBand = "green" | "amber" | "red";

/** A company's headline record. */
export interface CompanyProfile {
  companyNumber: string;
  name: string;
  /** e.g. "active", "liquidation", "administration", "dissolved" */
  status: string;
  /** e.g. "active-proposal-to-strike-off" — present only when something is happening */
  statusDetail?: string;
  type: string;
  incorporatedOn?: string;
  dissolvedOn?: string;
  sicCodes: string[];
  registeredOfficeLocality?: string;

  accounts: {
    /** Filing deadline for the next set of accounts */
    nextDue?: string;
    overdue: boolean;
    /** Date the last accounts were made up to */
    lastMadeUpTo?: string;
    /** "micro-entity" | "small" | "full" | "dormant" | "group" | ... */
    lastType?: string;
    /** Day/month the financial year ends. Changes to this are a signal. */
    accountingReferenceDate?: { day: string; month: string };
  };

  confirmationStatement: {
    nextDue?: string;
    overdue: boolean;
    lastMadeUpTo?: string;
  };

  hasCharges: boolean;
  hasInsolvencyHistory: boolean;
  hasBeenLiquidated: boolean;
  registeredOfficeInDispute: boolean;
  undeliverableRegisteredOffice: boolean;

  previousNames: { name: string; ceasedOn?: string }[];
}

/** One appointment at the company. */
export interface Officer {
  /** Companies House officer id — used to look up their other appointments */
  officerId?: string;
  name: string;
  /** "director" | "secretary" | "llp-member" | ... */
  role: string;
  appointedOn?: string;
  resignedOn?: string;
  occupation?: string;
  /** True if this appointment is current */
  active: boolean;
}

/** Another company the same person is or was a director of. */
export interface OfficerAppointment {
  companyNumber: string;
  companyName: string;
  companyStatus: string;
  role: string;
  appointedOn?: string;
  resignedOn?: string;
}

/** Aggregated history for one director, used for the serial-failure signal. */
export interface DirectorHistory {
  officerId: string;
  name: string;
  appointments: OfficerAppointment[];
}

/** A filed document. */
export interface Filing {
  date: string;
  /** "accounts" | "officers" | "gazette" | "mortgage" | "resolution" | ... */
  category: string;
  /** Machine-readable code, e.g. "gazette-notice-compulsory-strike-off" */
  type: string;
  description: string;
}

/** Secured lending registered against the company. */
export interface Charge {
  createdOn?: string;
  deliveredOn?: string;
  /** "outstanding" | "fully-satisfied" | "part-satisfied" | "satisfied" */
  status: string;
  /** Free-text classification, e.g. "A registered charge" */
  classification?: string;
  /** Who holds the security — a bank name here is meaningful context */
  personsEntitled: string[];
  satisfiedOn?: string;
}

/** A person or entity with significant control. */
export interface PSC {
  name: string;
  kind: string;
  naturesOfControl: string[];
  notifiedOn?: string;
  ceasedOn?: string;
}

/**
 * Everything the risk engine needs about one company, in one object.
 * Sub-resources are arrays rather than null so downstream code never
 * has to null-check before iterating.
 */
export interface Dossier {
  profile: CompanyProfile;
  officers: Officer[];
  filings: Filing[];
  charges: Charge[];
  pscs: PSC[];
  directorHistories: DirectorHistory[];
  /** Which sub-resources failed to load, so the UI can be honest about gaps */
  fetchedAt: string;
  partialFailures: string[];
}

/** A hit from the company search endpoint. */
export interface SearchHit {
  companyNumber: string;
  name: string;
  status: string;
  incorporatedOn?: string;
  addressSnippet?: string;
}