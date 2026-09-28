# GLRlight

**Early-warning screening on UK companies, built from the public register.**

Type a company name. In about a second you get a green, amber or red verdict, the
evidence behind it with dates and sources, and the arithmetic showing how the
score was reached. Ask for a briefing and a language model writes it up as
something you could send a colleague.

🔗 **[Live demo](#)** · Data from Companies House under the Open Government Licence

---

## Why this exists

Around five million companies sit on the UK register. Businesses take on
suppliers, clients and partners from among them daily, and most of those
decisions are made with no counterparty check at all — the tools that exist are
priced for procurement departments, not for the agency owner who is about to do
£40,000 of work on 60-day terms.

The incumbents (Creditsafe, Dun & Bradstreet, Experian Business) share three
structural gaps:

**They lag.** Credit scores lean on filed accounts. A UK small company can file
up to nine months after its year end, so the "current" financial picture is
routinely 12–21 months old. By the time accounts show distress, trade creditors
already know.

**They return a number, not a narrative.** A score of 42 tells a finance manager
nothing actionable. What they need is *which* facts moved it, *when*, and *what
to ask about*.

**They are priced out of the market most exposed to the risk.** Annual
subscriptions put them beyond the SMEs and freelancers for whom one client
collapse is existential.

Meanwhile the register publishes, free and in near real time, a stream of
behavioural events that precede distress: late filings, auditor resignations,
year-end changes, director departures, new floating charges, strike-off notices.
These are leading indicators, and they are largely unexploited outside
specialist credit teams.

GLRlight is the free first pass — the check that tells you whether paying for
real diligence is warranted.

---

## What it looks at

| Category | Signals |
|---|---|
| Filing behaviour | Accounts overdue, confirmation statement overdue, published figures unusually old |
| Register events | Strike-off action, auditor resignation, repeated recent name changes, registered office problems |
| Governance | Large share of the board departed, no active directors |
| Ownership | No PSC identified, recent change of control |
| Secured lending | New charges in the last year, heavy outstanding charge load |
| Director record | Prior insolvencies, weighted against total appointments |

None of these proves anything alone. Late accounts are usually a distracted
bookkeeper. The signal is in the **clustering and sequence** — which is exactly
what a credit score flattens.

---

## How it works

```
Companies House API  →  normalised dossier      lib/ch/
                                ↓
                     deterministic rules engine  lib/risk/
                                ↓
              scored signals + green/amber/red verdict
                                ↓                    ↓
                     interface (instant)      Gemini briefing (on request)
                        app/page.tsx               lib/ai/
```

Next.js on Vercel · Companies House public data API · Gemini for prose only.

---

## Decisions worth defending

### The model does not compute the score

Rules do. Gemini only writes the explanation, and only from signals that have
already fired. This is the central architectural choice.

A language model predicts plausible text. That makes it excellent at explanation
and unreliable at judgement. Asked to score risk, it produces a confident number
with nothing behind it: not reproducible between runs, not auditable when a
company asks why it was flagged, and not improvable — you can only reword the
prompt and hope. With rules, you point at line 140 and say: accounts four months
overdue, five points.

The model is given the verdict as a **fact to explain**, never as a question to
answer.

### Calibration is empirical, and version one was wrong

The first working version rated **Greggs and Tesco as amber** — two of the
healthiest companies in Britain. Four assumptions were wrong, and each was a
domain error rather than a coding bug:

1. **Dissolution was counted as failure.** It usually is not. Large groups strike
   off dormant subsidiaries as routine solvent housekeeping, so any experienced
   plc director accumulates dozens. Only insolvency — liquidation,
   administration, receivership — is a genuine failure signal.
2. **Listed companies were penalised for having no PSC register.** They are
   exempt; they disclose ownership through stock-market rules instead. This
   flagged every plc in the country.
3. **Director departures were counted absolutely.** Three departures from a
   ten-person plc board is routine rotation; three from a board of four is the
   leadership walking out. Only the proportion carries information.
4. **Name changes had no recency window**, so Tesco scored for rebrands from the
   1980s.

For a screening tool, **false positives are more damaging than misses.**
Insolvency is rare, so most companies checked are fine. Flag the healthy ones and
users learn within a week that amber means nothing — at which point the tool is
worse than useless, because it also buries the real warnings.

The fixes are marked `CALIBRATION v2` in `lib/risk/engine.ts`.

### Every finding carries its innocent explanation

A tool that only ever says "concerning" trains people to stop reading it.
Presenting the benign reading alongside each flag is what makes the alarming
reading credible when it matters. The interface shows both; the model is
instructed to carry the balance into its prose.

### Green does not mean healthy

A green verdict means nothing adverse was found on the public register. It does
**not** mean the company is financially sound — accounts can be filed perfectly
on time by a business that is failing. Both the interface and the model's
instructions state this explicitly, because the reassuring misreading is the one
that would get a user hurt.

### Generation degrades instead of failing

Free and low-tier model availability is genuinely unreliable: models appear in
the catalogue but return 404 at the generation endpoint, and popular ones return
503 under load. Rather than pinning one model, generation walks a fallback chain
with exponential backoff, and reports which model served each request. Some
models reject the `systemInstruction` field, so the client detects that and
inlines the instructions instead.

---

## Data ethics

Register data is public and openly licensed, but public does not mean
unconstrained. Three rules govern this build:

- **The company is the subject.** People appear only as properties of companies.
  There is no search by person and there never will be — that would make this a
  people-search product, which carries categorically different obligations.
- **No residential or service addresses are displayed**, even where the register
  exposes them.
- **Director history is reported as corporate outcomes**, never as personal
  characterisation. Insolvency practitioners and turnaround specialists are
  appointed to failing companies by design; the interface says so.

GLRlight is not a credit reference agency, does not provide regulated advice, and
its output should not be the sole basis for any credit, lending or commercial
decision.

---

## Does it work?

Detecting a company already in liquidation is trivial — an override catches it
before any rule runs. **The test that matters is whether the signals fire twelve
months before collapse, while the company is still trading.**

That backtest is the next piece of work:

> Sample UK companies that entered insolvency in a given period. Reconstruct the
> register as it stood twelve months prior and score it. Compare against a
> control group matched on sector, size band and age.

Metrics to report: precision and recall at each band, lift over base rate, and
median warning lead time. Accuracy alone is meaningless here — insolvency is rare
enough that predicting "green" every time scores well and detects nothing.

| Metric | Result |
|---|---|
| Sample size | *pending* |
| Precision at red | *pending* |
| Recall at red | *pending* |
| Lift over base rate | *pending* |
| Median lead time | *pending* |

Results will be published here whatever they show, including the cases where the
register was silent right up to collapse.

---

## Limitations

- **Register data only.** No bank data, no trade payment history, no management
  accounts. A company can be in serious difficulty with a spotless register.
- **Small-company filings are thin.** Micro-entity accounts contain very little.
- **One signal is a text heuristic.** Companies House gives no clean flag for
  auditor resignation, so it is detected by matching filing descriptions. Labelled
  as such in the output.
- **Correlation, not causation.** These signals are associated with distress, not
  diagnostic of it.
- **UK only.** Cross-border groups are invisible beyond their UK entities.

---

## Cost and limits

Companies House API access is free, with a documented ceiling of 600 requests per
five-minute window across all endpoints. One assessment costs about ten requests,
so roughly 60 lookups per window across all users — which is why results are
cached.

Briefing generation costs roughly **$0.003 per company**, cached for 24 hours, so
repeat lookups are free. The architecture is what makes a cheap fast model
sufficient: because judgement happens in the rules engine, the model only has to
write.

---

## Running it yourself

```bash
git clone https://github.com/AntoninLaf/glrlight.git
cd glrlight
npm install
cp .env.example .env.local   # then add your two keys
npm run dev
```

Keys are free: [Companies House](https://developer.company-information.service.gov.uk)
and [Google AI Studio](https://aistudio.google.com/apikey).

Command-line tools for inspecting each layer separately:

```bash
node --env-file=.env.local --import tsx scripts/dossier.ts "greggs"   # raw register data
node --env-file=.env.local --import tsx scripts/assess.ts  "greggs"   # signals and score
node --env-file=.env.local --import tsx scripts/memo.ts    "greggs"   # the written briefing
node --env-file=.env.local --import tsx scripts/memo.ts    "greggs" --prompt   # inspect the prompt
```

---

## Next

**Watchlists with change alerts.** The register is a stream, and monitoring is
where the commercial value sits — "tell me when one of my 40 suppliers files
late" is a subscription; a one-off lookup is not.

**A second jurisdiction**, most likely France via the free national registers,
since the signal logic transfers.

**Empirically calibrated weights.** They are currently set by domain reasoning.
The backtest above is what would replace judgement with evidence.

---

*Company information from Companies House, used under the Open Government Licence
v3.0. Not affiliated with or endorsed by Companies House.*
