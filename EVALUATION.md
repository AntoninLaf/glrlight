# Evaluation

**Short version: I have not established GLRlight's predictive validity. I tried
to test it, the attempt failed for a specific and instructive reason, and this
document records what happened rather than quietly dropping it.**

I therefore position the tool as a comprehension and triage aid — it tells you
what is on a company's public register and what it might mean — not as a
predictor of insolvency.

---

## What I set out to measure

The question that matters for a screening tool is not "does it flag Carillion
today?" A company already in liquidation is trivially detectable; an override
catches it before any rule runs.

The real question is: **would the signals have fired twelve months before
collapse, while the company was still trading?**

## Method

### Point-in-time reconstruction

The Companies House API returns the register as it stands *today*. Today it says
`status: liquidation`, which my override converts straight to red. Testing
against that would produce near-perfect accuracy and prove nothing — the engine
would simply be reading a field that says "this company failed."

That failure mode has a name: **look-ahead bias**, where information from after
the decision point leaks into the decision. It is the most common way a backtest
lies, in finance and machine learning alike.

So I wrote `lib/risk/rewind.ts`, which reconstructs the register as it plausibly
stood on a given date:

| Field | Why it leaks | How I treat it |
|---|---|---|
| `status` | Says "liquidation" — the answer | Forced to `active` |
| `hasInsolvencyHistory` | True only because of the event being predicted | Forced to `false` |
| Officers | Shows who resigned *since* | Post-cutoff resignations reversed |
| Charges | Shows what has been satisfied since | Restored to outstanding |
| PSCs | Shows who ceased since | Restored as active |
| Filings | Includes everything after | Truncated |
| `accounts.overdue` | A live flag with no historical equivalent | Inferred from gaps between accounts filings |

One leak I could not close: each past directorship carries the *other* company's
status as it is today, so a subsidiary that failed in 2022 appears failed even
when the cutoff is 2016. Closing it would need a dated status history the API
does not expose.

### Design

Sample companies now in liquidation, administration or receivership. Take the
insolvency onset date from the earliest insolvency-related filing. Rewind to
twelve months before that and score. Compare against surviving companies matched
on sector and incorporation window, scored at the same calendar date.

I report detection rate, false-alarm rate, and the precision implied at the true
UK base rate of roughly 0.5% annual insolvency.

---

## What happened

Four runs. Each produced an inverted result — filing-behaviour signals fired more
often in survivors than in companies that failed. I found and corrected three
separate method defects along the way. The inversion survived all of them.

### Defect 1 — my engine had no sense of "when"

Every time-window rule compared dates against `Date.now()`. Asking "did two
directors resign in the last twelve months?" at a 2008 cutoff checked the last
twelve months of *2026*. Nothing ever qualified, so `director_churn`,
`new_charges`, `control_change`, `strike_off_action` and `auditor_resignation`
silently never fired during the entire first run.

**Half my engine was disabled and nothing in the code looked wrong.** Rules now
take an explicit `asOf` date (`lib/risk/engine.ts`). The backtest found a defect,
not a miscalibration.

### Defect 2 — an anachronism

`no_psc` fired in 90% of failures and 78% of survivors. The PSC register did not
exist before 6 April 2016, and most of my cutoffs fell before it. I was flagging
every company in Britain for not complying with a law that had not been written.

### Defect 3 — an age confound I created myself

My fix for one asymmetry created a worse one. I required controls to be
established at the cutoff, but applied no such requirement to the cases. Several
signals need at least two prior filings to fire, so young companies are
*structurally incapable* of tripping them. My older controls lit up, my younger
cases scored zero, and the test appeared to show that late filing predicts
survival.

I was measuring age, not failure — a textbook confounding variable. Both groups
now carry the same minimum-age floor.

### The defect that ended it — sampling

A final diagnostic (`scripts/baseline.ts`) measured how often each signal fires
in ordinary active companies, with no case matching and no failure involved. The
sample came back as thirty consecutive Scottish limited partnerships: private
equity carry vehicles and fund structures, which file almost nothing. All green.

**Companies House advanced search returns results in a fixed order.** My "random"
sampling picked a random *offset* into that ordered list and took the next 200 —
which is random chunk selection, not random sampling. Each run drew a different
but internally homogeneous block: one was almost entirely Northern Irish
construction firms, another consultancies, this one limited partnerships.

**Every result in this investigation reflects sample composition rather than
company behaviour.** The inversion was probably never about insolvency at all.

---

## What I would need to do this properly

1. **A real sampling frame.** The API offers no random-sampling primitive. The
   bulk data product — the full register as a downloadable file — would allow
   proper stratified sampling by size, sector, age and region.
2. **Company-type filtering.** Limited partnerships, charities and dormant shells
   have filing obligations so different they should not be pooled with trading
   companies.
3. **Insolvency dates from a primary source.** I infer onset from filing text;
   the Gazette and the Insolvency Service publish actual dates.
4. **Sample sizes in the hundreds.** Thirty companies cannot separate a modest
   effect from noise even with clean sampling.
5. **Empirical weights.** My severities are set by domain reasoning. With a
   proper sample they could be fitted rather than argued.

---

## What this means for the product

**GLRlight does not claim to predict insolvency, and the interface does not imply
it.** A green verdict means nothing adverse was found on the public register —
not that a company is financially sound. Both the interface and the model's
instructions say so explicitly.

What it verifiably does: read a company's entire public filing record in about a
second, surface every notable finding with its date and source, present the
innocent explanation alongside each one, and write the whole thing up in plain
English with specific questions worth asking.

That is a comprehension and triage tool. It is useful because doing this by hand
takes half an hour, so most people never do it at all.

---

## Reproducing this

```bash
node --env-file=.env.local --import tsx scripts/backtest.ts --size 30
node --env-file=.env.local --import tsx scripts/baseline.ts --size 30
```

I have left both scripts in the repository, including their flaws. `rewind.ts` is
sound and reusable; the sampling is not. Anyone wanting to finish this properly
should start at the bulk data product.