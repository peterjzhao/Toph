# Toph

Toph is a Next.js management dashboard backed by Drizzle and PostgreSQL. The website serves
one shared farm with persistent sample data. See [Vercel deployment](docs/deployment.md) for
the existing project's settings and deployment checks.

The [Expo recording app](mobile/README.md) uses the same server and existing farm demo
accounts. It supports account switching, profile/photo editing, and syncing recordings or
written logs. See [mobile connection setup](docs/backend/mobile-demo.md). Hosted transcription
is still disabled; recordings and written notes can be saved without it.

## Repository layout

```text
src/
  app/                    Next.js pages, layouts, and API routes
  components/dashboard/   Live dashboard UI, styles, and display types
  components/workspace/   Sidebar pages and shared workspace UI
  contracts/              Shared serializable dashboard, workspace, and mobile API types
  fixtures/               Development-only Figma comparison data
  lib/                    Small web utilities
  server/                 Database access, services, validation, and HTTP helpers
public/assets/            Web runtime assets
shared/design/            Design tokens required by the website, also reusable by native apps
mobile/                   Separate Expo app, native assets, and mobile tests
certs/                    Public CA bundled with server API functions
design/reference/         Original design material, retained for visual review
drizzle/                  Versioned SQL migrations and metadata
scripts/db/               Database setup utilities
tests/backend/            Backend unit and PostgreSQL integration tests
docs/                     Website, API, database, design, and deployment guides
```

The root package is the Next.js app. The `mobile/` package has independent dependencies
and is not needed to build the website. Dashboard components are live UI; `/design-check` uses isolated fixtures
for development-only Figma comparisons.

Shared colors, typography, spacing, and radii live in `shared/design/tokens.ts`. The website
converts them to CSS variables, and native screens import them through their recording style
module. Layouts remain platform-specific. See [design tokens](docs/design-tokens.md) for where
to edit values and how both apps receive the changes.

## Run locally

Follow [database setup](docs/backend/setup.md) to configure `.env.local` and PostgreSQL.
Install the root dependencies with `npm ci` when needed, then run:

```sh
npm run db:up
npm run db:migrate
npm run db:seed
npm run db:check
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000), matching the configured write origin.
Reuse an existing development server. Normal seeding preserves existing edits and tags.

## Checks and documentation

```sh
npm run typecheck
npm run test:unit         # no database connection
npm run test:frontend     # date-filter boundaries, no database connection
npm run build
npm run test:backend      # requires the separate guarded PostgreSQL test database
npm run check:mobile-server # read-only check of the Vercel connection after pushing
```

See the [documentation map](docs/README.md), [frontend workspace](docs/frontend-workspace.md),
[dashboard API](docs/backend/integration.md), and [deployment guide](docs/deployment.md).

Profiles currently share farm access; switching or signing out is not production authentication.
Messages and support requests remain in this database and are not delivered externally.
Reference maps and synthesized recordings are sample media. Live dashboard metrics are now
computed from stored records; response accuracy stays unset until there is a measured source.
The development fixture alone retains the original Figma card values.
