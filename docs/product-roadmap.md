# Toph product assessment and roadmap

Assessment date: September 16, 2026. This is a recommendation based on the original brief, current repository, read-only localhost checks, and the primary sources linked below. It does not expand the approved implementation scope or authorize deployment. No application code was changed for this assessment.

## Objective and product direction

Toph helps workers record what happened in a field and helps managers turn that account into reliable operational records. The original brief specifically identifies fertilizer and chemical applications as the most common use case. Workers record hands-free audio; Toph transcribes and extracts the important information; managers review it on a desktop dashboard.

The strongest product direction is **voice-driven field records with traceable evidence**. A manager should be able to answer: what happened, where, when, who reported it, which products and quantities were involved, what remains uncertain, and who confirmed the result. Each answer should lead back to the same log and its supporting evidence.

There are three different definitions of completion:

| Scope | Completion means |
| --- | --- |
| Original interview challenge | Faithful default/expanded Figma dashboard, real persistent backend records matching the interface, working interactions, documented architecture reasoning, and eventually a hosted submission. Localhost remains the current target. |
| Complete product demonstration | A worker records or writes a log, survives loss of connectivity, submits it, receives useful extraction/review assistance, and sees the same persistent record reviewed by a manager and included in a report. |
| Product for real farms | The complete workflow plus authenticated farm membership, permissions, durable media, recovery, trustworthy treatment records, operational monitoring, and verified domain-specific rules. |

The mobile pipeline and advanced features are opportunities beyond the original dashboard challenge, not retroactive requirements of that challenge.

## Current implementation

The current [README](../README.md), [workspace documentation](frontend-workspace.md), and [mobile README](../mobile/README.md) supersede the older dashboard-only milestone descriptions.

| Area | Present in the repository | Remaining product gap |
| --- | --- | --- |
| Dashboard | Expansion, search, sorting, filters, audio, map enlargement, persistent tags, stable PostgreSQL UUIDs | Live submission, mutable log lifecycle, real metrics, larger datasets |
| Persistence | Next.js services, Drizzle/PostgreSQL, migrations, farm-consistent foreign keys, restricted runtime role, validation, revision conflicts | Production identity and narrower operations for growing workspace sections |
| Workspace | Map, reviews, reports, schedule, employees, performance, messages, settings, support | Connections between these workflows; some actions remain demo-only |
| Native mobile | Expo recording, playback, draft editing, device files, optional API transcription | Server submission, synchronization, extraction into structured fields, authenticated identity |
| Web recorder | Browser microphone capture, local IndexedDB drafts | Separate prototype; no server submission or transcription pipeline |
| Treatments | Mobile product/amount/unit inputs | No corresponding structured PostgreSQL treatment model or dashboard contract |
| Audits | Pending/Approved/Flagged status and a note | Reviewer identity, version history, evidence, correction loop, rules |
| Reports | CSV generation and saved report definitions | Fixed historical snapshots, treatment detail, complete server-side datasets |
| Map | Shared reference image, field selection, related logs | Real geometry, treatment footprints, temporal history |
| Messages | Persistent local conversation records | Authenticated worker delivery, log-linked questions and replies |
| Identity | Demo profile switching and a shared farm context | Authentication, farm membership, role authorization |

Read-only checks during this assessment returned HTTP 200 for `/api/health`, `/api/dashboard?period=all`, and `/api/workspace`. The dashboard reported eleven logs, four new logs, and one recording. Its metrics explicitly report `source: "figma_demo"`. The running browser rendered the dashboard and Isaac's expanded record.

The repository documents 108 passing backend tests at the workspace milestone; this assessment did not rerun them, exercise every control, test hardware audio, or perform a new pixel comparison. Those are separate acceptance activities.

## Recommended build order

### 1. Complete mobile-to-manager submission

This has the greatest immediate value because it connects the two existing applications.

Provide an authenticated submission operation, durable audio storage, and a lifecycle that both applications display. Separate transport/processing state from review state: an uploaded recording may still be processing, and a submitted record may still need clarification.

Use a client-generated submission ID with a farm-scoped uniqueness constraint. Retrying the same submission must return the same server log, including when a server commit succeeds but its response never reaches the phone. Validate identity and farm membership on the server; do not treat editable mobile profile names as identity.

Store audio in a private object store and its metadata in PostgreSQL. Upload directly with narrowly scoped upload credentials. Finalization verifies that the expected object exists and matches its recorded size/type/checksum before enqueueing processing. Failed processing must leave the original audio and the user's edits available.

Create a transactional local queue in SQLite, preserving drafts and audio files across relaunch. Expo SDK 57 provides persistent SQLite storage. Supabase Storage supports resumable uploads through TUS, making it a plausible fit for interrupted field uploads; the exact native client integration still needs device verification. Sources: [Expo SQLite](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/), [Supabase resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads).

Acceptance: record offline, save, force-close, reopen, reconnect, interrupt an upload, resume, repeat submission, and observe exactly one durable dashboard log with playable audio. A second browser must see it. Show actionable retry states and retain unsent audio. Distinguish a verified local save from server acceptance.

### 2. Extract structured information with evidence and focused questions

The current native transcription populates Notes; it does not extract a work record. Add a server-side pipeline that proposes fields such as activity, field, work period, products, quantities, units, and treated area.

Keep these as separate records or versions: original audio, transcript, machine extraction, worker-confirmed values, and manager-approved values. Store model/schema/prompt versions and evidence spans. An extraction should be able to return missing or ambiguous values instead of inventing them. Human edits must survive retries and later machine results.

For each proposed value, show the supporting transcript passage. Where an aligned transcript is available, selecting that value should play the relevant audio segment. Timestamp alignment is an explicit pipeline requirement; do not assume the current transcription response supplies it.

Example: the worker says, “I used twelve liters on the north block.” The system can suggest a quantity, but should ask which product was used and what “north block” means if the farm catalog is ambiguous. If a number might be a total or a rate, request clarification. One recording may describe several field operations; preserve one source recording with multiple linked work entries when required.

Add English/Spanish capture and clarification as an initial multilingual target, while keeping the original-language evidence. Preserve the distinction between transcription and translation. Farm-specific aliases should map to canonical fields/products only after confirmation when ambiguous.

Acceptance: a labeled evaluation set containing noisy speech, mixed languages, product aliases, self-corrections, missing units, and multiple operations. Measure field-level correctness, unsupported-value rate, clarification behavior, latency, and human correction effort. A model's self-reported confidence is not a measured probability.

### 3. Make treatment applications a first-class data model

This is the central domain feature. Model an application separately from its product line items so one application can contain several products. Link each application to its work log, crop/season, field or treated area, and operator.

Capture product identity, optional registration reference, batch/lot, amount, unit, application method, treated area, and any relevant rate or carrier volume. Store original quantities alongside normalized quantities and the conversion basis. Distinguish product amount, mixture volume, concentration, and rate. Do not convert mass to volume without an explicit density or formulation basis.

Support photos of labels, receipts, and equipment settings as evidence; OCR should propose catalog matches for confirmation. QR codes on fields or inventory can provide an additional way to resolve identity when voice names are ambiguous.

This matches real recordkeeping needs: USDA's U.S. restricted-use pesticide guidance includes product identity, quantity, application location, crop/site, treated area, and applicator information. That guidance has a specific jurisdiction and applicability; it is not a universal checklist for every farm or fertilizer application. [USDA recordkeeping guidance](https://www.ams.usda.gov/rules-regulations/pesticide-records/understanding).

Acceptance: enter a multi-product application, correct a quantity, and see consistent values in the log, field history, review queue, and report. Missing required information should stay visibly unresolved.

### 4. Add a correction loop and a durable audit history

Extend the current review screen with named reviewers, append-only revision events, old/new values, timestamps, reasons, and linked evidence. Approval should apply to a particular record version. A material correction creates a new version requiring review; it does not silently retain approval from an older version.

A manager can ask a question attached to a specific log field. The worker sees that question, answers by text or voice, and the answer creates a proposed correction with evidence. This gives Messages a concrete role in the main workflow.

Generate an audit packet containing selected record versions, original evidence references, reviewer decisions, and the ruleset version used for completeness checks. Persist a report snapshot or immutable export artifact so downloading an old report reproduces the same content. A digest can help detect changes, but it does not by itself prove that the underlying account is truthful.

For future compliance features, use deterministic checks based on verified label/jurisdiction/crop data, with sources and effective dates. Missing or conflicting inputs produce “needs review,” not a declaration that a field or activity is safe. Start with completeness and consistency checks before safety-sensitive scheduling rules.

Acceptance: edit an approved application, inspect both versions, reapprove, and retrieve the original export unchanged. Record who approved which version.

### 5. Give each field a navigable history

Replace the image-only map in the operational experience with imported or drawn field boundaries. Use a time slider to browse treatments, irrigation, scouting notes, photos, and unresolved questions by field and season. Preserve the supplied image and exact fixture state for Figma comparison.

PostGIS fits the existing PostgreSQL architecture and supports indexed geographic queries. Use actual imported boundaries or clearly identified demo geometry; the reference satellite image does not establish coordinates. [Supabase PostGIS documentation](https://supabase.com/docs/guides/database/extensions/postgis).

A particularly useful view is “what did we know about this field on this date?” It distinguishes when work occurred, when a delayed offline log arrived, and when someone corrected or approved it. Recording location can suggest a field with explicit confirmation; a single GPS point cannot prove an entire area was treated.

Acceptance: select a field/date, see only relevant events, open the original log, and inspect its source evidence and revision state.

## Distinctive extensions after the core workflow

| Idea | Concrete experience | Technical depth and dependency |
| --- | --- | --- |
| Planned-versus-reported reconciliation | An inbox shows assignments with no submitted log, mismatched fields/products, or conflicting times. Every flag explains itself. | Link assignments to submitted operations; deterministic rules plus candidate matching. An absent log means “not recorded,” not proof work was omitted. |
| Inventory reconciliation | Confirmed application quantities reduce the matching stock lot; corrections adjust usage; the manager investigates physical-count discrepancies. | Append-only stock movements, exact units, approval-version idempotency, compensating entries. Never double-charge stock because processing retried. |
| Evidence-linked farm questions | “Which fields have incomplete treatment records this week?” returns records and explains missing values. | Authorized structured queries for quantities/dates; text retrieval for narrative context; citations to exact log versions. Writes require an explicit reviewed action. |
| Shift handover briefing | A short text or audio briefing covers completed work, unresolved questions, and the next assignment, with links back to logs. | Grounded summaries, delivery preferences, per-user scope, source freshness. No generic ungrounded farm advice. |
| Treatment cost and material balance | Compare recorded input use and cost by field/season, and surface discrepancies with inventory. | Cost-at-use snapshots, compatible units, area normalization. Avoid presenting recorded hours as worker productivity or correlation as treatment effectiveness. |
| Weather context | A log preserves observed weather and separately attributed nearby provider data; a planner displays source-aware constraints. | Temporal/geographic joins, units, observation age and uncertainty. Provider estimates must not masquerade as on-site measurements. |
| Quality and processing inspector | A reviewer can inspect capture, upload attempts, extraction versions, corrections, and measured quality for a demonstration log. | Tracing, job attempts, labeled evaluation cases, per-field error analysis. Useful for the interview and later debugging. |

Voice entry and treatment inventory are already present in other farm products: FarmQA describes voice-to-text/hands-free scouting, and Farmbrite documents product amounts, inventory deductions, and application details. My differentiation recommendation is therefore the connected experience of reliable offline capture, inspectable extraction, focused clarification, and versioned evidence—not a claim that any single feature is unique in the market. Sources: [FarmQA voice capture](https://farmqa.com/blog/2022/05/02/agronomist-insights-from-anywhere/), [Farmbrite treatment recording](https://help.farmbrite.com/help/adding-a-crop-treatment).

## Architecture evolution

Keep Next.js, React, TypeScript, Expo, PostgreSQL, and Drizzle. The current stack supports this direction. Add capabilities incrementally:

1. Share browser/mobile-safe submission and treatment contracts, with runtime validation at server boundaries. Preserve dashboard contract v1 and stable log IDs; introduce additive fields or an explicit versioned contract as needed.
2. Introduce authenticated farm membership and canonical employee/field catalogs. Resolve the workspace roster overlay before allowing new roster members to author normalized work logs.
3. Add media/upload metadata, submission identities, applications and product lines, processing jobs, extraction versions, and revision events as their features arrive.
4. Enqueue processing in the same transaction that accepts a completed submission. A separate worker process can initially claim PostgreSQL jobs using leases, bounded retries, and recorded attempts. Use an outbox for reliable downstream notifications. This can run locally without a new distributed-services platform.
5. Keep the mobile queue and server business lifecycle separate. Represent retryable upload failures, processing failures, unresolved extraction, and review decisions independently.
6. Move growing workspace arrays to normalized tables with record-level mutations and versions when their real workflows are introduced. Retain optimistic concurrency; do not silently replay stale whole-section replacements.
7. Refresh web views through bounded polling first or an authorized realtime channel when justified. Treat notifications as prompts to fetch canonical state and recover missed events with a refresh.
8. Query reports/metrics on the server over the full filtered dataset. Add appropriate indexes and pagination; measure before introducing caches or a separate search service.

The mobile transcription module currently reads an `EXPO_PUBLIC_*` provider key and calls the provider directly. Move that call behind the authenticated backend before distributing the app. Native API authentication must be designed explicitly; weakening the current browser Origin check is not a substitute for authenticating a phone.

Private PostgreSQL schemas and a restricted database role are useful foundations, but farm membership and operation-level authorization still need enforcement. Supabase does not automatically authorize arbitrary Drizzle queries merely because it hosts the database.

## Specific integration issues to address

- **Pagination:** `WorkspaceProvider` loads `/api/dashboard?period=all` once and discards pagination metadata. The API defaults to 50 rows. Current reports, maps, and performance can therefore operate on an incomplete set once more than 50 logs exist. Exercise a dataset larger than that limit before calling the connected workflow complete.
- **Employee identity:** new roster employees live in the workspace JSONB aggregate, while `work_logs` references normalized employees. A create-log API needs a canonical employee path rather than assuming those stores are interchangeable.
- **Fields:** mobile fields are fixed display strings; dashboard fields have UUIDs. Load and cache canonical IDs and aliases from the farm catalog.
- **Time:** mobile review and assignments currently use same-day times. Agree on farm timezone, overnight work, capture time, work time, submission time, and device clock correction semantics.
- **Transcript:** the database has an optional transcript column, but dashboard contract v1 exposes a summary rather than transcript evidence. Add an explicit evidence contract when the review feature is built.
- **Review history:** the current workspace review replaces the prior status/note for a log. It has no persistent chain of decisions or reviewer identity.
- **Reports:** saved definitions currently export whatever matching logs are loaded at download time. Distinguish reusable report templates from frozen audit exports.
- **Demo dates and metrics:** April 2026 filtering and the 5/1/12/90 cards are intentional reference fixtures. Provide explicit operational date ranges and defined live metrics when accepting new submissions while preserving exact design comparisons.
- **Selection:** row selection exists, but should lead to useful batch actions such as tag, assign review, or export, with a clear partial-failure result.

## Delivery phases and acceptance gates

| Phase | Deliverable | Acceptance gate |
| --- | --- | --- |
| A: Preserve submission quality | Figma regression baseline, reproducible setup, loading/error/empty states, keyboard/mobile checks, architecture rationale | Default and expanded views compared to references at 1676 × 955; persisted tags and stable IDs verified; local setup reproduced |
| B: Connect the workflow | Identity/catalogs, private audio storage, transactional draft queue, create-log API, upload recovery, manual structured review | Offline recording survives restart; repeated upload/submit creates one log; second browser retrieves it; datasets above 50 records remain complete |
| C: Add trustworthy assistance | Extraction proposals, evidence spans, uncertainty questions, worker correction, manager review | Labeled scenarios expose unsupported fields; human edits survive reprocessing; approvals bind to record versions |
| D: Make records operational | Treatment ledger, field timeline, frozen reports, assignment reconciliation | One confirmed application flows consistently through field history, review, and reproducible export |
| E: Add selected advanced features | Inventory/cost, grounded questions, multilingual clarification, weather context | Each feature has source-backed results, measurable benefit, and failure-path coverage |

Hosting remains a later, separately authorized milestone. Local development can verify storage and job behavior with local services. Before eventual hosting, verify the actual Supabase connection/storage/auth configuration and target application runtime rather than assuming local success proves hosted behavior.

## Suggested interview demonstration

Use a separate, clearly identified scenario dataset so the exact Figma fixtures stay intact.

1. A worker records a realistic field note without connectivity. The application confirms a local save.
2. Relaunch the phone app and recover the recording; reconnect and watch it submit.
3. Show extracted fields and a deliberately missing quantity/unit clarification. Answer it.
4. Open the same log in the desktop dashboard. Select a field value and hear its source audio.
5. Correct one value as manager, inspect the revision, and approve that version.
6. Open the field timeline and generate a fixed report containing that record and review evidence.
7. Demonstrate an interrupted/repeated submission producing no duplicate log; show a failed job retry preserving the human correction.

The technical explanation can then follow the visible behavior: stable IDs and idempotency, local transactions, database constraints, durable jobs, explicit uncertainty, versioned reviews, and reproducible exports.

## Product measures

Measure capture-to-confirmed-record time, local-save and eventual-sync success, duplicate submissions prevented, required-field completeness, review turnaround, and correction rate per extracted field. Pair rates with denominators and time windows. Evaluate extraction on labeled examples independently of production approval rates. Keep the reference “Response Accuracy 90” snapshot attributed to the design; it is not evidence of measured AI quality.

Before broad field rollout, validate with workers and managers which languages, crops, product catalogs, connectivity conditions, and report formats matter most. The source brief establishes the problem direction; this assessment does not claim customer interviews or market validation were performed.
