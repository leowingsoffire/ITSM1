# VGC OCR Intelligence

**Multi-agent OCR and document intelligence on Azure AI Document Intelligence.**

VGC OCR Intelligence ingests operational documents of **any length and any layout** — 100+ page annual
reports, scanned supplier invoices, certificates of analysis, bills of lading, lease agreements and bank
statements — then runs them through an **eleven-agent orchestration mesh**, verifies every extracted value
against independent evidence, instantiates the **business workflow** that owns the document, and routes only
genuine exceptions to a human.

The bundled demonstration corpus models a Haw Par Corporation-style operational document set (Tiger Balm
healthcare, leisure, property and investments) so the platform can be exercised end-to-end with real,
generated PDFs and real business rules at zero Azure spend.

---

## Why this design is cost-effective

Azure AI Document Intelligence is priced **per page**, so the model you choose is the dominant cost driver.

| Model | List price / 1,000 pages | Used for |
| --- | --- | --- |
| `prebuilt-read` | **US$1.50** | Text-centric documents: annual reports, leases, licences, trademarks, B/Ls |
| `prebuilt-layout` | US$10.00 | Table-critical documents: invoices, POs, GRNs, CoAs, bank statements, claims |
| `prebuilt-invoice` (domain) | US$10.00 | Not used — replaced by Read + local rules |
| `custom-neural` | US$50.00 | Not used |

**Levers applied**

1. **Adaptive model routing** — `selectModelForType()` sends each document to the cheapest model that can
   satisfy its extraction contract. A 160-page annual report costs **US$0.24** on Read instead of
   **US$1.60** on a prebuilt domain model.
2. **One-page triage** — long documents are triaged on a single Read page before full analysis, so
   classification never pays for Layout twice.
3. **Zero-marginal-cost intelligence** — classification, five-layer extraction and all 26 business rules
   run in-process on the App Service instance. No per-call AI charges.
4. **Right-sized compute** — Linux App Service **P1v3 x 2** (~US$221.92/month) for zone-redundant
   production; drop to B1 (~US$12.41/month) for dev/test.
5. **Storage lifecycle** — originals tier to cool at 30 days and archive at 180 days.
6. **Managed identity everywhere** — no keys, so no Key Vault secret-rotation overhead.
7. **Log Analytics with sampled request logging**, keeping ingestion inside the agreed 25 GB/month.

### Signed-off reference profile — **S$1,690 / month**

The **Cost & Value** screen opens on the profile below, which is the agreed Haw Par run-rate. Every
assumption is adjustable, and the budget meter reports live variance against S$1,690.

| Assumption | Value |
| --- | --- |
| Documents per month | 18,000 (216,000 pages) |
| Average pages per document | 12 |
| Pages needing Layout | 32% (adaptive routing on) |
| App Service | P1v3 x 2 instances (zone redundant) |
| Blob storage | 435 GB hot + transactions |
| Log Analytics ingest | 25 GB/month |
| Private endpoints | 3 |

| Line item | Monthly (USD) |
| --- | ---: |
| Azure AI Document Intelligence | 938.52 |
| Azure App Service (Linux) | 221.92 |
| Azure Monitor / Log Analytics | 59.80 |
| Private networking | 21.90 |
| Azure Service Bus | 9.81 |
| Azure Blob Storage | 9.19 |
| Azure Key Vault | 0.03 |
| **Total** | **US$1,261.17** |

At SGD 1.34 per USD that is **S$1,689.97 -> S$1,690/month** (S$20,280/year, S$0.094 per document,
S$0.0078 per page). The manual keying baseline for the same volume is **S$70,560/month**, so the
platform returns roughly **41x** its Azure spend.

---

## Multi-agent orchestration

Every document is processed by a **mesh of eleven specialist agents**, not a linear script. The mesh is a
real dependency graph: `executionWaves()` topologically sorts the agents into waves, and everything inside a
wave runs concurrently. Each agent returns a summary, a confidence, structured findings and an `apply(state)`
function — the only path by which it may mutate the shared run state, so data flow stays explicit and
auditable.

| Agent | Role | Mission |
| --- | --- | --- |
| Intake | ingest | Validates the artefact, checksums it and establishes provenance |
| Analyst | analyse | Drives Azure Document Intelligence (or the demo engine) and normalises pages |
| Taxonomist | classify | Explainable weighted-evidence classification with runner-up scores |
| Field extractor | extract | Five-layer extraction: exact K/V, fuzzy K/V, printed label line, regex, table binding |
| Tabulator | extract | Foots tables and reconciles line items against declared totals |
| Rule auditor | validate | Executes the business-rule catalogue and explains each breach |
| Accuracy assurer | assure | Independent multi-check verification of every field |
| Reconciler | assure | Cross-document and cross-field corroboration |
| Compliance officer | assure | Retention class, PII residue and policy checks |
| Consensus builder | decide | Measures agreement between agents and surfaces disputes |
| Router | decide | Chooses straight-through, review or exception — never weakens the review rule |

The **Agent Mesh** screen renders the live topology wave by wave, and every run is retained with per-agent
evidence at `GET /api/agents/runs` and `GET /api/documents/:id/agent-run`.

---

## Workflow engine

Classification does not end at a label — it instantiates the **business process that owns the document**.
Thirteen workflow definitions cover invoice-to-pay, purchase-order matching, goods receipt, QC release,
shipment clearance, lease administration, regulatory registration, trademark renewal, expense claims,
marketing-claim substantiation, bank reconciliation, statutory reporting and manual triage.

* Automated steps are **pre-completed with evidence** by the agents that did the work.
* A clean document is **straight-through processed**: the human step is skipped with its justification minuted.
* Priority is **derived**, never guessed — exposure, assurance risk, rule breaches and process urgency each
  contribute to a 0–100 score with printed reasons.
* SLA state (`on-track` / `at-risk` / `breached`) is computed from the definition's SLA clock.
* Transitions (`approve`, `reject`, `hold`, `resume`, `reassign`, `escalate`, `comment`, `cancel`) are
  validated **server-side** and appended to an immutable audit history. An `actor` is mandatory: the server
  never invents attribution.

---

## Accuracy assurance

Accuracy is **measured with independent evidence, not by restating the model's own confidence**. Every field
is subjected to seven checks, and each check declares **what it proves** — whether the platform read the
document correctly (*extraction fidelity*), or whether the document is internally consistent
(*document integrity*):

| Check | What it proves | Attribution |
| --- | --- | --- |
| Grounding | The value actually appears in the recognised page text | Extraction fidelity |
| Typing | The value parses as its declared type | Extraction fidelity |
| Corroboration | A second, genuinely independent source in the document agrees | Extraction fidelity |
| Reference | The value matches reference data (jurisdiction-aware company registration, container ISO 6346, currency) | Extraction fidelity |
| Confidence | The extractor's own confidence clears the review threshold | Extraction fidelity |
| Arithmetic | The value satisfies the document's own arithmetic (totals, tax, footing) | Document integrity |
| Rules | No business rule flags the field | Document integrity |

**Why the split matters.** A supplier invoice whose printed total contradicts its own line items is a defect
in the *document*, not in the transcription — the platform read it perfectly. Scoring both failures the same
way understates extraction accuracy, tells a reviewer to re-key a value that is already correct, and corrupts
the calibration curve. So the two dimensions are scored separately: fields carry a `verdict`
(`verified`, `probable`, `unverified`, `conflict`, `missing`) for extraction fidelity **and** an `integrity`
state (`clean`, `disputed`, `not-applicable`) for the document itself.

Separating them **never weakens the gate**. A disputed document still raises `riskLevel` to `high`, still
blocks straight-through processing, still raises review priority and is still reported as an error by the
orchestrator — it is simply labelled honestly, so the reviewer fixes the invoice instead of the transcription.

**Independent means independent.** Corroboration only accepts a second source with a different `sourceKey`
(a different key/value pair, table cell, document field or a repeated printed occurrence). A source that
produced nothing is excluded entirely: an empty read can neither corroborate nor contradict.

Before verification, a conservative **auto-repair** pass fixes reversible OCR damage (digit confusion inside
numeric bodies, stray label punctuation, identifier spacing) and records the exact rule that changed the value.

The **Accuracy** screen publishes a corpus benchmark, per-check pass rates **with their attribution**, an
accuracy *and* integrity KPI, and **two reliability curves** — the calibrated confidence the platform
publishes (the one that is contractually meaningful) and the raw model confidence it started from — each with
a Brier score and expected calibration error, so the platform's claimed confidence can be audited against its
observed accuracy. Every document also exposes an **Assurance** tab listing per-field evidence: each check,
its status, its attribution and the detail behind it.

---

## Azure Document Intelligence — deep integration

* **Eight-model catalogue** with tiers, outputs, list prices and the routing decision for every document type.
* **Seven add-on features** (`ocr.highResolution`, `ocr.formula`, `barcodes`, `ocr.font`, `languages`,
  `keyValuePairs`, `queryFields`) requested only when the selected model actually supports them.
* **Query fields** are derived from the document type's field contract.
* **Long-running operation polling** with throttle-aware backoff, and **explicit fallback** — if Azure is
  unavailable the document records a `fallbackReason` rather than silently pretending the call succeeded.
* **Managed identity or resource key**, with a token cache; no credential is ever serialised into an API
  response.
* The **Azure DI** console shows authentication mode, API version, the model catalogue, per-type routing with
  the alternatives considered, and a live **re-probe** of the configured resource.

---

| Area | What it does |
| --- | --- |
| **Ingestion** | Multi-file upload, magic-byte + MIME + extension validation, SHA-256 checksum, batch tracking, 100 MB / 2,000-page ceilings |
| **Analysis** | Azure AI Document Intelligence REST (`2024-11-30`) long-running operations with backoff; offline demo engine for zero-cost local runs |
| **Classification** | Explainable weighted-evidence classifier over 11 document types, with evidence and runner-up scores |
| **Extraction** | Five layers — exact key/value, fuzzy key/value, printed label line, regex patterns, table binding — with per-field confidence, page anchor and bounding box |
| **Validation** | 26 business rules: GST @ 9%, three-way matching, QC specification limits, expiry/renewal dates, ISO 6346 containers, policy caps, balance-sheet ties |
| **Orchestration** | 11-agent dependency mesh executed in concurrent waves, with per-agent evidence and retained run history |
| **Assurance** | 7 attributed checks per field (extraction fidelity vs document integrity), verdicts, integrity states, calibrated confidence, auto-repair, corpus benchmark and dual reliability curves |
| **Workflows** | 13 business-process definitions, derived priority, SLA clocks, straight-through processing, server-validated transitions and an immutable audit trail |
| **Review** | Priority-scored exception queue, side-by-side OCR viewer with field anchors, inline correction, approve/reject, immutable audit trail |
| **Search** | Full-text search across every recognised page with highlighted snippets and page numbers |
| **Analytics** | Straight-through-processing rate, extraction quality, throughput, exception drivers, realised cost and hours avoided |
| **Export** | Per-document workbook, corpus workbook (6 sheets), field CSV and requirements traceability matrix — all `.xlsx` written with zero third-party dependencies |

---

## Running it locally

```powershell
npm install
npm start
```

Then open <http://localhost:8080>. The demo passphrase is `vgc`.

The platform starts in **demo mode** (`ANALYZER_MODE=demo`): it generates real, multi-page PDFs and
processes them through the identical pipeline, so the entire product can be demonstrated **without any
Azure spend**. Go to **Ingest Documents → Run selected samples** to populate the workspace, or drag your
own PDFs onto the drop zone.

```powershell
npm test     # 146 unit + API integration tests (node:test), run serially in a throwaway DATA_DIR
npm run e2e  # browser checks: full journeys, validation, a11y and desktop/tablet/mobile layouts
```

`npm test` provisions an isolated data directory (see `scripts/run-tests.mjs`) because the API suites clear
the document store and rewrite `settings.json` — running them against a real workspace would destroy it.
Running a single file directly (`node --test tests/api.test.js`) fails fast with an explanation; set
`DATA_DIR` to a throwaway directory if you need to.

`npm run e2e` drives a real Chromium through Playwright against a server on `http://127.0.0.1:8080`, so
start the app first. It exercises the onboarding wizard, the login gate, the account/workspace menu, all
twelve routes, the ingest journey, the agent mesh, the accuracy console, the Azure console, workflow
filtering/search/sorting, a real workflow transition with reload persistence, form validation, accessibility
(labelling, heading structure, focus order), error and not-found states, console/network hygiene, and layout
overflow at 1440 px, 834 px and 390 px. Screenshots are written to `artifacts/e2e/` (git-ignored), and the
settings suites that mutate data provision their own workspace so the demo workspace is never altered.

### Switching to live Azure analysis

Copy `.env.example` to `.env` and set:

```ini
ANALYZER_MODE=azure
AZURE_DOCINT_ENDPOINT=https://<your-resource>.cognitiveservices.azure.com
# either a resource key…
AZURE_DOCINT_KEY=<key>
# …or, preferred, managed identity / az login
AZURE_DOCINT_USE_MANAGED_IDENTITY=true
```

If Azure is unavailable at runtime the platform **degrades explicitly** to the demo engine and records a
`fallbackReason` on the document — it never silently pretends a cloud call succeeded.

---

## Architecture

```
Browser SPA (vanilla JS, strict CSP)
      │  REST + Server-Sent Events
Azure App Service (Linux P1v3 x 2, Node.js 20, system-assigned identity)
      ├─ Ingestion            magic-byte validation, checksum, batching
      ├─ Worker pool          bounded concurrency, 6 stages, live events
      │     └─ Orchestrator   11 agents · dependency waves · per-agent evidence
      │            ├─ Analyst  ──► Azure AI Document Intelligence
      │            │                (prebuilt-read | prebuilt-layout | add-ons | query fields)
      │            ├─ Taxonomist / Field extractor / Tabulator
      │            ├─ Rule auditor            26 business rules
      │            ├─ Accuracy assurer        7 attributed checks per field
      │            ├─ Reconciler / Compliance officer
      │            └─ Consensus builder ──► Router  (straight-through | review | exception)
      ├─ Workflow engine      13 definitions · derived priority · SLA · audit trail
      └─ Analytics/Export     dashboards, XLSX, CSV
      │
Azure Blob Storage · Azure Key Vault · Log Analytics + Application Insights
```

Pipeline stages per document: `ingest → analyse → classify → extract → validate → score`. The agent mesh
re-emits these six stages over SSE, so the live progress contract is unchanged.

---

## Deploying to Azure

```powershell
az group create --name rg-hawpar-docai --location southeastasia

az deployment group create `
  --resource-group rg-hawpar-docai `
  --template-file infra/main.bicep `
  --parameters infra/main.parameters.json
```

The Bicep template provisions:

- App Service Plan (Linux **P1v3**, `appServicePlanCapacity` = 2) and Web App with a **system-assigned managed identity**
- **Azure AI Document Intelligence** (S0) with `disableLocalAuth: true`
- Storage account (HTTPS-only, no public blobs, shared-key disabled) with a lifecycle policy
- Key Vault (RBAC, soft-delete, purge protection)
- Log Analytics workspace + Application Insights and an HTTP 5xx alert rule
- Role assignments: `Cognitive Services User`, `Storage Blob Data Contributor`, `Key Vault Secrets User`,
  `Monitoring Metrics Publisher`

Deploy the application. Package only the runtime sources — bundling `node_modules` or the local `data/`
directory produces a slow, oversized deployment and defeats the Oryx build:

```powershell
$stage = "$env:TEMP\vgc-deploy"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item src, scripts, worker, package.json, package-lock.json, README.md -Destination $stage -Recurse
Compress-Archive -Path "$stage\*" -DestinationPath "$env:TEMP\vgc-deploy.zip" -Force

az webapp deploy --resource-group rg-hawpar-docai --name <webAppName> `
  --src-path "$env:TEMP\vgc-deploy.zip" --type zip
```

`SCM_DO_BUILD_DURING_DEPLOYMENT` is already set by the template, so App Service installs production
dependencies during deployment. A large upload can outlast the CLI's polling window and report a 504 while the
server-side build is still running — check `az webapp log deployment show` before retrying.

Verify with `https://<webAppName>.azurewebsites.net/api/health`. `engine` reports `azure` once the
`Cognitive Services User` role assignment has propagated; until then the platform degrades to the offline
engine and records the reason on each document rather than failing the request.

The whole browser suite can be pointed at the deployed site, which is the strongest end-to-end proof:

```powershell
$env:E2E_BASE_URL = "https://<webAppName>.azurewebsites.net"
npm run e2e
```

### Edge preview (Cloudflare Workers)

The same Express application also runs on Workers for a zero-infrastructure demo. The edge runtime has no
durable storage, so the demo corpus is baked in as a snapshot of genuine engine output — including each
document's workflow instance, agent run and accuracy assessment — and the orchestration history is replayed
from it on cold start.

```powershell
npm run build:seed   # re-runs the real pipeline and captures src/seed/snapshot.json
npm run cf:dev       # local Workers runtime
npm run cf:deploy
```

Rebuild the snapshot whenever the pipeline, agents, workflows or accuracy engine change, otherwise the edge
preview will serve records that predate them.

---

## Security & governance

- HTTPS-only, HSTS, strict `Content-Security-Policy` (`script-src 'self'`, `style-src 'self'` — no
  `unsafe-inline` anywhere), `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`,
  `Permissions-Policy`, `Cross-Origin-Opener-Policy`, and no `X-Powered-By` stack disclosure.
  The client keeps that policy honest by applying every dynamic style through CSSOM
  (`style.setProperty`), which CSP exempts, rather than a `style` attribute, which it blocks —
  see `el()`/`svgEl()` in `src/public/js/util.js`. `npm run e2e` fails on any CSP report, so a
  dropped declaration surfaces as a test failure instead of a silently mis-rendered bar.
- Defence-in-depth upload validation (extension, declared MIME type, magic bytes) and path-traversal-safe
  file names
- Per-client rate limits, counted once per request over a rolling 60 s window: API 600/min
  (`RATE_LIMIT_API_PER_MINUTE`) and upload 60/min (`RATE_LIMIT_UPLOAD_PER_MINUTE`)
- Optional `API_KEY` gate with timing-safe comparison
- Structured JSON logging with correlation IDs and automatic redaction of secret-like keys
- PDPA: bank account numbers and identifiers masked before persistence; retention cap and hard delete
- CSV exports are guarded against formula injection; all DOM is built via `textContent`, never `innerHTML`
- **Zero npm vulnerabilities** (`npm audit`) — no Azure SDKs, no spreadsheet libraries; the OOXML writer is
  implemented in `src/lib/xlsx.js` with only `node:zlib`

---

## Project layout

```
infra/            Bicep template and parameters
src/
  config/         Validated, frozen configuration
  domain/         Document taxonomy, fields, rules, reference data,
                  Azure model catalogue, agent roster, workflow definitions
  lib/            Logger, typed errors, deterministic RNG, formatting, XLSX writer
  services/
    analyzers/    Azure Document Intelligence client + offline demo engine
    agents/       Multi-agent orchestrator (11 agents, wave execution)
    *.service.js  Ingestion, pipeline, classification, extraction, validation,
                  accuracy, workflow, azure, store, analytics, cost, export, samples
  middleware/     Correlation IDs, security headers, CORS, auth, rate limiting
  routes/         Document lifecycle, platform and intelligence APIs
  public/         Single-page application (HTML, CSS, ES modules)
    assets/azure/ Official Microsoft Azure service icons (see ATTRIBUTION.md)
scripts/          Seed builder, smoke test, Playwright end-to-end suite
tests/            node --test unit and API integration suites
```

### Third-party assets

The SVGs in `src/public/assets/azure/` are the official
[Azure architecture icons](https://learn.microsoft.com/azure/architecture/icons/)
published by Microsoft, obtained via the community mirror at
[loryanstrant/MicrosoftCloudLogos](https://github.com/loryanstrant/MicrosoftCloudLogos).
They are used **unmodified** to identify Azure services in the Solution Blueprint
architecture diagram and the Cost & Value breakdown, in line with the
[Microsoft Trademark and Brand Guidelines](https://www.microsoft.com/legal/intellectualproperty/trademarks).
All logos remain the property of Microsoft Corporation; their presence does not
imply Microsoft endorsement. Full detail in
[`src/public/assets/azure/ATTRIBUTION.md`](src/public/assets/azure/ATTRIBUTION.md).

---

## API surface

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness probe used by App Service |
| `GET` | `/api/config` | Capability discovery for the SPA |
| `POST` | `/api/documents` | Multi-file upload |
| `GET` | `/api/documents` | Filtered, paginated listing |
| `GET` | `/api/documents/:id` | Full record without page payloads |
| `GET` | `/api/documents/:id/pages/:n` | OCR overlay data for the viewer |
| `PATCH` | `/api/documents/:id/fields/:key` | Human correction + re-validation |
| `POST` | `/api/documents/:id/decision` | Approve or reject |
| `GET` | `/api/documents/:id/export.xlsx` | Per-document workbook |
| `GET` | `/api/analytics/dashboard` | Operational KPIs |
| `GET` | `/api/analytics/review-queue` | Prioritised exceptions |
| `GET` | `/api/search?q=` | Full-text search |
| `POST` | `/api/cost/estimate` | Monthly TCO projection |
| `POST` | `/api/samples/run` | Generate and process the sample pack |
| `GET` | `/api/events` | Server-sent pipeline events |
| `GET` | `/api/export/documents.xlsx` | Corpus workbook |
| `GET` | `/api/export/requirements.xlsx` | Requirements traceability matrix |
| `GET` | `/api/agents` | Agent roster with execution waves and topology |
| `GET` | `/api/agents/topology` | Static mesh description for the console |
| `GET` | `/api/agents/runs` | Retained orchestration run history |
| `GET` | `/api/agents/:agentId` | One agent plus the evidence it produced |
| `GET` | `/api/documents/:id/agent-run` | Full per-agent run for a document |
| `GET` | `/api/workflows` | Filtered, searchable, sortable workflow board |
| `GET` | `/api/workflows/overview` | Queues, SLA posture and automation rate |
| `GET` | `/api/workflows/definitions` | The 13 workflow definitions |
| `GET` | `/api/workflows/:documentId` | Full workflow instance with audit history |
| `POST` | `/api/workflows/:documentId/actions` | Server-validated workflow transition |
| `GET` | `/api/accuracy/benchmark` | Corpus accuracy + integrity, attributed per-check pass rates, per-type breakdown, both calibration curves |
| `GET` | `/api/accuracy/calibration` | Reliability curve, Brier score, calibration error |
| `GET` | `/api/documents/:id/accuracy` | Per-field verdicts, integrity states and the evidence behind them |
| `GET` | `/api/azure/profile` | Integration profile (never includes a credential) |
| `GET` | `/api/azure/models` | Model catalogue and per-type routing decisions |
| `GET` | `/api/azure/status` | Live probe of the configured resource (`?refresh=true` to force) |
