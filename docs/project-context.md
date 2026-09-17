# Project context and goals

Updated September 16, 2026, after the user approved the architecture and requested concurrent backend work.

Current-state note: the original handoff below is retained as history. The web workspace is
now connected to PostgreSQL, the dashboard contract is v2, and the native app lives in
`mobile/src/features/recording/`. The superseded web `/record` prototype was removed. Mobile
submission is prepared but intentionally disabled. Use [docs/README.md](README.md) for the
current guides and [backend/mobile.md](backend/mobile.md) for the new boundary. Keep local
drafts, migrations, design references, and active development processes intact.

## Product and submission

Toph helps farmers review work performed on their fields. Workers' activity logs are shown in a dashboard. Clicking a row expands its recording, summary, map, and tags.

This first version is an **interview submission using persistent sample farm data**. The user explicitly chose that scope. The interface is being implemented concurrently by the frontend agent, and the user has asked for a backend specification and prompt for Claude Fable.

The challenge asks for:

1. A faithful implementation of the default dashboard and expanded-entry design.
2. A backend storing data that persists beyond the browser session.
3. Backend data whose shape reflects the data displayed on the page.
4. A hosted submission eventually; the user's current instruction is localhost only.
5. Research and a clear explanation of why the architecture was chosen.

The user particularly emphasized the data-shape requirement. Every displayed log must correspond to a stored record. Its employee, activity, date, field, start/end times, summary, recording reference, map reference, and tags must be represented by the backend. A collapsed row and its expansion share the same log ID. The server returns a data contract matching those concepts.

## Agreed architecture

- Next.js App Router with React and TypeScript; one application and repository.
- Custom CSS Modules and original design assets for visual fidelity.
- PostgreSQL, with Supabase as the intended managed database provider.
- Drizzle for typed queries, schema definitions, and versioned SQL migrations.
- Next.js Route Handlers over server-only service functions for the initial backend integration boundary.
- Vercel is the intended application host for a later phase. Do not deploy now.

Use the existing package manager and framework versions. At handoff, `package.json` specifies Next.js 16.3.5 and React 19.3.0. Check the actual file when beginning work. The installed Next.js documentation under `node_modules/next/dist/docs/` is authoritative for the installed version; read the relevant guides before writing Next.js code.

The earlier architecture document was written before approval and still uses proposal-stage wording. This document records the subsequently approved stack and concurrent-work scope. `docs/backend-spec.md` refines the earlier illustrative data contract into the backend integration contract. User instructions remain authoritative.

## Current boundaries

The frontend is being built and previewed locally. A Next.js development server was started at `http://127.0.0.1:3000`; verify whether it is still running instead of restarting it. No working PostgreSQL connection or backend implementation was verified when this handoff was written.

Backend work should produce working migrations, seed data, service functions, HTTP endpoints, tests, and setup documentation. The frontend can keep using its own fixture during this work. Wiring the finished backend into visual components is a subsequent, small integration change owned by the frontend agent.

Do not add a separate Express application, change the framework, switch database products, or replace this repository with a starter. There is no need to build the mobile recording app, AI transcription, a live mapping provider, production sign-in, or the other sidebar destinations for this milestone.

## Concurrent ownership

| Owner | Files and work |
| --- | --- |
| Frontend agent | `src/components/**`, `src/app/page.tsx`, `src/app/layout.tsx`, styles, UI fixtures in `src/lib/**`, `public/**`, and visual testing |
| Backend / Fable | `src/server/**`, `src/contracts/**`, `src/app/api/**`, `drizzle/**`, `drizzle.config.ts`, `scripts/db/**`, `tests/backend/**`, `compose.db.yaml`, `.env.example`, and `docs/backend/**` |
| Shared, minimal edits only | `package.json` and `package-lock.json`: add backend dependencies/scripts without changing existing frontend versions or scripts |
| Read-only reference for both | `design/reference/**`, this handoff, and the original design brief |

Before creating a file, inspect whether it already exists; another agent may have created it since this document was written. Preserve concurrent changes. Do not reset, clean, reformat, or overwrite unrelated work. Re-read shared files immediately before editing. Run only one package-manager operation at a time; if another installation is active, wait for it to finish. Do not stop existing processes or remove build output.

Keep integration changes in a short handoff document, `docs/backend/integration.md`, with exact import paths, endpoint examples, and any adapter needed for the frontend's current fixture shape. Do not edit visual files to force the integration while the frontend is being generated.

## Design sources and data caveats

- Figma: https://www.figma.com/design/nvpGmK1je0QsesXtZcBdjg/F26-Dev-Challenge-Figma?node-id=1-1483
- Canonical frame: 1676 × 955. Font: Geist.
- Default export: `design/reference/default.css` and `default.svg`.
- Expanded export: `design/reference/expanded.css` and `expanded.svg`.
- Scroll behavior: `design/reference/scroll.mov`.
- Extracted assets currently available: `/assets/avatar.jpg`, `/assets/field-map.svg`, `/assets/waveform.svg`.
- `/assets/sample-recording.mp3` is a synthesized demo clip created during frontend preparation, not an original farm recording. The screen recording has no audio stream.

The default export shows four logs; the expanded export includes eleven. Use a stable eleven-log dataset. The compact four-row view is presentation, not a database limit or a reason to create records when a row opens. Four seeded logs are marked new as an explicit demo convention.

The reference card values are 5 recordings, 1 new recording, 12 active workers, and response accuracy 90. Their underlying definitions are not supplied. Persist them as a dated, explicitly attributed Figma demo snapshot. Do not present them as measured AI accuracy or invent a calculation to manufacture the desired values.

Use April 2026 for the initial demo period. Do not replace sample dates with today's dates. Only Isaac's expanded summary was supplied; preserve it exactly. Additional details must be identified as demo fixtures in project documentation.

The visual and persistence requirements both matter. A screenshot used as the entire interface, localStorage alone, or hardcoded values served as if queried from a database would not complete the full-stack submission.
