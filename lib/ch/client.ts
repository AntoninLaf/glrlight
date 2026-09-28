/**
 * The only file in the app that talks to Companies House.
 *
 * Responsibilities:
 *   1. Authentication (HTTP Basic, key as username, empty password)
 *   2. Error handling that distinguishes "no data" from "broken"
 *   3. Rate-limit awareness (600 requests / 5 min, shared across all endpoints)
 *   4. Normalising government JSON into our own types
 *
 * Everything downstream imports from here and never sees a raw API response.
 */

import type {
  Charge,
  CompanyProfile,
  DirectorHistory,
  Dossier,
  Filing,
  Officer,
  OfficerAppointment,
  PSC,
  SearchHit,
} from "./types";

const BASE = "https://api.company-information.service.gov.uk";

/** How many of a company's current directors we check for prior failures. */
const MAX_DIRECTORS_TO_TRACE = 5;

export class CompaniesHouseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string
  ) {
    super(message);
    this.name = "CompaniesHouseError";
  }
}

/**
 * Low-level request primitive.
 *
 * `allow404` is important: Companies House returns 404 for sub-resources that
 * legitimately have no data. A company with no secured lending 404s on
 * /charges. That is not an error — it is the answer "none". Treating it as a
 * failure would make every unencumbered company look broken.
 */
async function chFetch<T>(
  path: string,
  opts: { allow404?: boolean; retryOn429?: boolean } = {}
): Promise<T | null> {
  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key) throw new Error("COMPANIES_HOUSE_API_KEY is not set");

  // The trailing colon is the empty password. Omit it and you get a 401.
  const auth = Buffer.from(`${key}:`).toString("base64");

  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Basic ${auth}` },
    // Next.js caches fetches by default; we control caching deliberately in Step 6.
    cache: "no-store",
  });

  if (res.status === 404 && opts.allow404) return null;

  if (res.status === 429 && opts.retryOn429 !== false) {
    // The API tells us how long to wait. Respect it rather than guessing.
    const waitSeconds = Number(res.headers.get("retry-after") ?? 5);
    await new Promise((r) => setTimeout(r, Math.min(waitSeconds, 30) * 1000));
    return chFetch<T>(path, { ...opts, retryOn429: false });
  }

  if (!res.ok) {
    const hint =
      res.status === 401
        ? "Check the API key, and that auth is Basic rather than Bearer"
        : res.status === 429
        ? "Rate limited: 600 requests per 5 minutes across all endpoints"
        : "";
    throw new CompaniesHouseError(
      `Companies House returned ${res.status}${hint ? ` — ${hint}` : ""}`,
      res.status,
      path
    );
  }

  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

export async function searchCompanies(query: string, limit = 10): Promise<SearchHit[]> {
  const data = await chFetch<any>(
    `/search/companies?q=${encodeURIComponent(query)}&items_per_page=${limit}`
  );
  return (data?.items ?? []).map((item: any) => ({
    companyNumber: item.company_number,
    name: item.title,
    status: item.company_status,
    incorporatedOn: item.date_of_creation,
    addressSnippet: item.address_snippet,
  }));
}

/* ------------------------------------------------------------------ */
/* Individual resources                                                */
/* ------------------------------------------------------------------ */

export async function getProfile(companyNumber: string): Promise<CompanyProfile> {
  const d = await chFetch<any>(`/company/${companyNumber}`);
  if (!d) throw new CompaniesHouseError("Company not found", 404, companyNumber);

  return {
    companyNumber: d.company_number,
    name: d.company_name,
    status: d.company_status,
    statusDetail: d.company_status_detail,
    type: d.type,
    incorporatedOn: d.date_of_creation,
    dissolvedOn: d.date_of_cessation,
    sicCodes: d.sic_codes ?? [],
    registeredOfficeLocality: d.registered_office_address?.locality,

    accounts: {
      nextDue: d.accounts?.next_due,
      // The API exposes overdue in two places depending on age of the record.
      overdue: Boolean(d.accounts?.overdue ?? d.accounts?.next_accounts?.overdue),
      lastMadeUpTo: d.accounts?.last_accounts?.made_up_to,
      lastType: d.accounts?.last_accounts?.type,
      accountingReferenceDate: d.accounts?.accounting_reference_date,
    },

    confirmationStatement: {
      nextDue: d.confirmation_statement?.next_due,
      overdue: Boolean(d.confirmation_statement?.overdue),
      lastMadeUpTo: d.confirmation_statement?.last_made_up_to,
    },

    hasCharges: Boolean(d.has_charges),
    hasInsolvencyHistory: Boolean(d.has_insolvency_history),
    hasBeenLiquidated: Boolean(d.has_been_liquidated),
    registeredOfficeInDispute: Boolean(d.registered_office_is_in_dispute),
    undeliverableRegisteredOffice: Boolean(d.undeliverable_registered_office_address),

    previousNames: (d.previous_company_names ?? []).map((p: any) => ({
      name: p.name,
      ceasedOn: p.ceased_on,
    })),
  };
}

export async function getOfficers(companyNumber: string): Promise<Officer[]> {
  const d = await chFetch<any>(
    `/company/${companyNumber}/officers?items_per_page=100`,
    { allow404: true }
  );

  return (d?.items ?? []).map((o: any) => ({
    // The officer id is buried in a link URL: /officers/{id}/appointments
    officerId: o.links?.officer?.appointments?.split("/")[2],
    name: o.name,
    role: o.officer_role,
    appointedOn: o.appointed_on,
    resignedOn: o.resigned_on,
    occupation: o.occupation,
    active: !o.resigned_on,
  }));
}

export async function getFilingHistory(companyNumber: string): Promise<Filing[]> {
  const d = await chFetch<any>(
    `/company/${companyNumber}/filing-history?items_per_page=100`,
    { allow404: true }
  );

  return (d?.items ?? []).map((f: any) => ({
    date: f.date,
    category: f.category,
    type: f.type,
    description: f.description,
  }));
}

export async function getCharges(companyNumber: string): Promise<Charge[]> {
  const d = await chFetch<any>(`/company/${companyNumber}/charges`, {
    allow404: true, // no charges registered — a normal, meaningful answer
  });

  return (d?.items ?? []).map((c: any) => ({
    createdOn: c.created_on,
    deliveredOn: c.delivered_on,
    status: c.status,
    classification: c.classification?.description,
    personsEntitled: (c.persons_entitled ?? []).map((p: any) => p.name),
    satisfiedOn: c.satisfied_on,
  }));
}

export async function getPSCs(companyNumber: string): Promise<PSC[]> {
  const d = await chFetch<any>(
    `/company/${companyNumber}/persons-with-significant-control?items_per_page=100`,
    { allow404: true } // small companies frequently have none registered
  );

  return (d?.items ?? []).map((p: any) => ({
    name: p.name,
    kind: p.kind,
    naturesOfControl: p.natures_of_control ?? [],
    notifiedOn: p.notified_on,
    ceasedOn: p.ceased_on,
  }));
}

/**
 * A director's other appointments.
 *
 * Reached only via a director of a company the user explicitly looked up.
 * There is deliberately no path from a person's name into this function.
 */
export async function getOfficerAppointments(
  officerId: string
): Promise<OfficerAppointment[]> {
  const d = await chFetch<any>(
    `/officers/${officerId}/appointments?items_per_page=100`,
    { allow404: true }
  );

  return (d?.items ?? []).map((a: any) => ({
    companyNumber: a.appointed_to?.company_number,
    companyName: a.appointed_to?.company_name,
    companyStatus: a.appointed_to?.company_status,
    role: a.officer_role,
    appointedOn: a.appointed_on,
    resignedOn: a.resigned_on,
  }));
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

/**
 * Build the full dossier for one company.
 *
 * Fails soft: if a sub-resource errors we record it in partialFailures and
 * carry on. A dashboard that shows 90% of the picture and says which 10% is
 * missing is far more useful than an error page.
 *
 * Request cost: 5 calls, plus up to MAX_DIRECTORS_TO_TRACE more.
 */
export async function buildDossier(companyNumber: string): Promise<Dossier> {
  const partialFailures: string[] = [];

  // The profile is mandatory — no profile, no analysis.
  const profile = await getProfile(companyNumber);

  const settle = async <T>(label: string, p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch {
      partialFailures.push(label);
      return fallback;
    }
  };

  // Four independent calls, so run them together rather than in sequence.
  const [officers, filings, charges, pscs] = await Promise.all([
    settle("officers", getOfficers(companyNumber), [] as Officer[]),
    settle("filings", getFilingHistory(companyNumber), [] as Filing[]),
    settle("charges", getCharges(companyNumber), [] as Charge[]),
    settle("pscs", getPSCs(companyNumber), [] as PSC[]),
  ]);

  // Trace only current directors, longest-serving first, capped for budget.
  const toTrace = officers
    .filter((o) => o.active && o.role.includes("director") && o.officerId)
    .sort((a, b) => (a.appointedOn ?? "").localeCompare(b.appointedOn ?? ""))
    .slice(0, MAX_DIRECTORS_TO_TRACE);

  const directorHistories = await Promise.all(
    toTrace.map(async (o) => ({
      officerId: o.officerId!,
      name: o.name,
      appointments: await settle(
        `director:${o.name}`,
        getOfficerAppointments(o.officerId!),
        [] as OfficerAppointment[]
      ),
    }))
  );

  return {
    profile,
    officers,
    filings,
    charges,
    pscs,
    directorHistories,
    fetchedAt: new Date().toISOString(),
    partialFailures,
  };
}