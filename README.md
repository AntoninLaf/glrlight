# GLRlight

**Read any UK company's public register in one second, and understand what is on
it.**

Type a company name. You get a green, amber or red triage verdict, every notable
finding with its date and source, the innocent explanation alongside each one,
and — on request — a plain-English briefing ending with the questions worth
putting to that company before you sign.

🔗 **[Live demo](https://glrlight-mbpvzrp19-antonin8.vercel.app/)** · Data from Companies House under the Open Government Licence

> **What this is not.** GLRlight does not predict insolvency, and I do not claim
> it does. I built a backtest to find out whether it could; the attempt failed
> for reasons I document in full in [EVALUATION.md](./EVALUATION.md). A green
> verdict means nothing adverse was found on the public register — not that a
> company is financially sound.

---

## Why I built it

Around five million companies sit on the UK register. Businesses take on
suppliers, clients and partners from among them daily, and most of those
decisions involve no counterparty check at all — the tools that exist are priced
for procurement departments, not for the agency owner about to do £40,000 of work
on 60-day terms.

Everything you would want to know is already public and free: when accounts were
last filed, whether the confirmation statement is overdue, who has come and gone
from the board, what security lenders hold, whether the Registrar has moved to
strike the company off. It is all there, spread across six endpoints and written
in the language of company law.

Reading it by hand takes half an hour, so nobody does. GLRlight does it in a
second and explains what it found.

---

## What it looks at

| Category | Signals |
|---|---|
| Filing behaviour | Accounts overdue, confirmation statement overdue, published figures unusually old |
| Register events | Strike-off action, auditor resignation, repeated recent name changes, registered office problems |
| Governance | Large share of the board departed, no active directors |
| Ownership | No PSC identified, recent change of control |
| Secured lending | New charges within the year, heavy outstanding charge load |
| Director record | Prior insolvencies, weighted against total appointments |

Sixteen rules, each a small independent function. None proves anything alone —
late accounts are usually a distracted bookkeeper. What the interface shows is
the clustering and the sequence, which is exactly what a single credit score
flattens.

---

## How it works

```
Companies House API  →  normalised dossier         lib/ch/
                                ↓
                    deterministic rules engine     lib/risk/
                                ↓
            scored signals + green/amber/red verdict
                          ↓                    ↓
              interface (instant)      Gemini briefing (on request)
                 app/page.tsx                lib/ai/
```

Next.js on Vercel · Companies House public data API · Gemini for prose only.

---

## Decisions I would defend

### The model does not compute the score

Rules do. Gemini only writes the explanation, and only from signals that have
already fired.

A language model predicts plausible text. That makes it excellent at explanation
and unreliable at judgement. Asked to score risk it produces a confident number
with nothing behind it: not reproducible between runs, not auditable when a
company asks why it was flagged, and not improvable — you can only reword the
prompt and hope. With rules I can point at a line number and say: accounts four
months overdue, five points.

The model receives the verdict as a **fact to explain**, never as a question to
answer. The interface shows the arithmetic in the margin so a reader can follow
it.

### I calibrated empirically, and my first version was wrong

My first working version rated **Greggs and Tesco as amber** — two of the
healthiest companies in Britain. Four of my assumptions were wrong, and each was
a domain error rather than a coding bug:

1. **I counted dissolution as failure.** It usually is not. Large groups strike
   off dormant subsidiaries as routine solvent housekeeping, so any experienced
   plc director accumulates dozens. Only insolvency — liquidation, administration,
   receivership — signals genuine failure.
2. **I penalised listed companies for having no PSC register.** They are exempt,
   disclosing ownership through stock-market rules instead. I was flagging every
   plc in the country.
3. **I counted director departures absolutely.** Three from a ten-person plc
   board is routine rotation; three from a board of four is the leadership
   walking out. Only the proportion carries information.
4. **My name-change rule had no recency window**, so Tesco scored for 1980s
   rebrands.

For a screening tool, **false positives are more damaging than misses.** Flag the
healthy ones and users learn within a week that amber means nothing — at which
point the tool is worse than useless, because it also buries the real warnings.

I found two further defects later via the backtest, including an as-of date bug
that had silently disabled every time-window rule. See
[EVALUATION.md](./EVALUATION.md). Fixes are marked `CALIBRATION` in
`lib/risk/engine.ts`.

### Every finding carries its innocent explanation

A tool that only ever says "concerning" trains people to stop reading it.
Presenting the benign reading alongside each flag is what makes the alarming
reading credible when it matters. The interface shows both, and I instruct the
model to carry that balance into its prose.

### Generation degrades instead of failing

Model availability is unreliable: models appear in the catalogue but return 404
at the generation endpoint, and popular ones return 503 under load. Rather than
pinning one, generation walks a fallback chain with exponential backoff and
reports which model served each request. Some models reject the
`systemInstruction` field, so the client detects that and inlines the
instructions instead.

---

## Data ethics

Register data is public and openly licensed, but public does not mean
unconstrained. Three rules govern this build:

- **The company is the subject.** People appear only as properties of companies.
  There is no search by person and there never will be — that would make this a
  people-search product, carrying categorically different obligations.
- **No residential or service addresses are displayed**, even where the register
  exposes them.
- **Director history is reported as corporate outcomes**, never as personal
  characterisation. Insolvency practitioners and turnaround specialists are
  appointed to failing companies by design, and the interface says so.

GLRlight is not a credit reference agency, does not provide regulated advice, and
its output should not be the sole basis for any commercial decision.

---

## Evaluation

I have not established predictive validity. The attempt, the three method defects
I found in my own work, and the sampling problem that ended it are documented in
**[EVALUATION.md](./EVALUATION.md)**, with the scripts left in the repository.

The short version: building a point-in-time reconstruction of the register was
straightforward. Building a *representative sample* from an API with no
random-sampling primitive was not, and it defeated three successive attempts.
Every apparent result turned out to reflect sample composition rather than
company behaviour.

That is the honest state of it. Anyone wanting to finish the job should start
from the bulk data product rather than the search API.

---

## Limitations

- **Register data only.** No bank data, no trade payment history, no management
  accounts. A company can be in serious difficulty with a spotless register.
- **Small-company filings are thin.** Micro-entity accounts contain very little.
- **One signal is a text heuristic.** Companies House gives no clean flag for
  auditor resignation, so I detect it by matching filing descriptions. The output
  labels it as such.
- **Weights are set by judgement**, not fitted to data.
- **UK only.** Cross-border groups are invisible beyond their UK entities.

---

## Cost and limits

Companies House access is free, with a ceiling of 600 requests per five-minute
window across all endpoints. One assessment costs about ten requests.

Briefing generation costs roughly **$0.003 per company**, cached for 24 hours.
The architecture is what makes a cheap fast model sufficient: because judgement
happens in the rules engine, the model only has to write.

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
node --env-file=.env.local --import tsx scripts/dossier.ts "greggs"           # raw register data
node --env-file=.env.local --import tsx scripts/assess.ts  "greggs"           # signals and score
node --env-file=.env.local --import tsx scripts/memo.ts    "greggs"           # the written briefing
node --env-file=.env.local --import tsx scripts/memo.ts    "greggs" --prompt  # inspect the prompt
node --env-file=.env.local --import tsx scripts/backtest.ts --size 30         # the evaluation attempt
node --env-file=.env.local --import tsx scripts/baseline.ts --size 30         # population firing rates
```

---

## Next

**Watchlists with change alerts.** The register is a stream, and monitoring is
where the commercial value sits — "tell me when one of my 40 suppliers files
late" is a subscription; a one-off lookup is not.

**A second jurisdiction**, most likely France via the free national registers,
since the reading logic transfers.

**A real evaluation**, built on bulk data with proper stratified sampling.

---

*Company information from Companies House, used under the Open Government Licence
v3.0. Not affiliated with or endorsed by Companies House.*