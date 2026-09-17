# Documentation map

Start with the repository [README](../README.md) for the layout and local commands.

| Area | Current guide |
| --- | --- |
| Web pages and data flow | [Frontend workspace](frontend-workspace.md) |
| Vercel settings and deployment checks | [Deployment guide](deployment.md) |
| Native recording app | [Mobile README](../mobile/README.md) |
| Accounts and farm onboarding | [Farm accounts](backend/accounts.md) |
| Worker profiles and log sync | [Mobile API](backend/mobile.md) |
| Worker inboxes and admin messages | [Messaging](backend/messages.md) |
| On-device field segmentation | [Browser test and integration](backend/browser-segmentation.md) |
| Transcription and form filling | [Recording processing](backend/transcription.md) |
| Backend, web, and mobile responsibilities | [System map](system-map.md) |
| PostgreSQL and migrations | [Database setup](backend/setup.md) |
| Dashboard contract v2 | [API integration](backend/integration.md) |
| Other workspace pages | [Workspace API](backend/workspace.md) |
| Shared web and native styling values | [Design tokens](design-tokens.md), `shared/design/tokens.ts` |

Local historical prompts, agent handoffs, and reference captures
are not part of this release. Current code contracts and the guides above describe
the implementation.

The earlier browser recording mockup and its guide have been removed after the native Expo
port. The development-only `/design-check` dashboard comparison remains useful for Figma
review and reads only `src/fixtures/dashboard.ts`.
