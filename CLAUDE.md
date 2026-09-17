# Toph project context

Read `AGENTS.md`, `docs/project-context.md`, and `docs/README.md` first. Preserve the generated
Next.js instructions and read the installed framework docs before changing framework code.

The dashboard API uses contract v2 in `src/contracts/dashboard.ts`; workspace DTOs are in
`src/contracts/workspace.ts`. `docs/backend-spec.md` and `docs/fable-backend-prompt.md` are
historical implementation handoffs, not instructions to replace the current schema with v1.

Use PostgreSQL and Drizzle inside the existing Next.js application. Database access stays
server-only. Preserve concurrent edits and running servers; do not deploy. Follow active task
ownership in `AGENTS.md` and retain exact reference data and sample-media disclosures.

The native app lives in `mobile/` and has its own `AGENTS.md`. Its prepared API client and
reserved submission endpoint are intentionally disconnected; see `docs/backend/mobile.md`.
Do not enable sync, authentication, storage, or database writes without a new user instruction.
