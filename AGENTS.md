<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Toph project instructions

Read `docs/project-context.md` before making project changes. The user approved Next.js + React + TypeScript, PostgreSQL hosted by Supabase, and Drizzle for an interview submission with persistent sample data. The current development target is localhost; do not deploy as part of frontend or concurrent backend implementation.

The dashboard must closely reproduce the supplied Figma. The backend must represent the same data concepts and expose one stable record ID for each collapsed/expanded employee log. Original references are in `design/reference/`; see `docs/design-review.md` for measurements and scrolling observations.

### Concurrent work ownership

- Frontend work owns components, styles, `src/app/page.tsx`, `src/app/layout.tsx`, UI fixtures under `src/lib/**`, and `public/**`.
- Backend/Fable work owns `src/server/**`, `src/contracts/**`, `src/app/api/**`, `drizzle/**`, `drizzle.config.ts`, `scripts/db/**`, `tests/backend/**`, `compose.db.yaml`, `.env.example`, and `docs/backend/**`.
- Read `docs/backend/integration.md` and `src/contracts/dashboard.ts` for the current contract v2. `docs/backend-spec.md` records the original v1 handoff and acceptance rationale. Keep shared DTOs in `src/contracts/dashboard.ts`; do not import database modules into the browser.
- Preserve concurrent edits. Re-read shared files before changing them. Add only necessary backend dependencies/scripts to `package.json` and `package-lock.json`; preserve existing frontend versions and scripts, and avoid simultaneous package-manager operations.
- Do not stop another agent's development server, remove its build output, replace the project starter, or rewrite files outside the active task's ownership. Backend-to-frontend wiring should be documented in `docs/backend/integration.md` for the frontend owner.

Use actual PostgreSQL for persistence verification. Sample fixture fallback, browser storage, and JSON files do not satisfy the backend requirement. Keep sample-only metrics and synthesized media clearly identified in code/docs, preserve the exact Figma fixture text/dates, and never claim an unperformed verification.

The ready-to-paste backend task is in `docs/fable-backend-prompt.md`. Preserve the generated Next.js rules above.

### Current layout and mobile boundary

- Live dashboard components are under `src/components/dashboard/`; development comparison data is under `src/fixtures/`.
- Shared serializable DTOs belong in `src/contracts/`; React context types stay with their provider.
- The native recording app is in `mobile/src/features/recording/`; read `mobile/AGENTS.md` before changing it. The earlier web `/record` prototype was removed.
- `mobile/src/lib/api/mobile-client.ts` uses the canonical `/api/mobile/v1` API. The user authorized shared farm accounts, persisted log sync, and transcription with structured fields. Read `docs/backend/mobile.md` and `docs/backend/transcription.md`. The user requested removal of the old demo routes and settings; do not add compatibility aliases.
- Run root `npm run test:unit` for checks without PostgreSQL setup. `test:backend` still uses the separate guarded test database.
- Shared visual values belong in `shared/design/tokens.ts` (`@toph/design` in both apps). Web CSS variables are provided by `src/lib/design-tokens.ts`; native aliases and styles are in `mobile/src/features/recording/styles.ts`. Keep platform layouts local and preserve Figma values; see `docs/design-tokens.md`.
