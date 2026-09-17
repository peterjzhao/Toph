# Local dashboard preview

Implemented September 16, 2026. Open **http://127.0.0.1:3000** while `npm run dev` is running. The development server binds to the local machine only. Nothing was deployed.

## Implementation

The dashboard uses Next.js App Router, React, TypeScript, CSS Modules, and locally served Geist. The page is assembled from live text, semantic controls, and table records. Its default state and expanded Isaac Wang entry were compared with the supplied SVGs at their original **1676 × 955** size using a browser difference overlay.

The reference geometry is retained: 280 px sidebar, 10 px outer padding and gap, 30 px content inset, 115 px metric cards, 58 px table rows, and the original map crop and overlays. The avatar, map composition, waveform geometry, and sidebar/metric icons come from the supplied exports. Small font rasterization differences remain between live browser text and the outlined SVG reference; this is not a claim of zero differing pixels.

The sidebar stays in place while the right pane scrolls. The compact table shows four rows at a time with the remaining records available by scrolling inside it. Expanding a row reveals its details and lets the right pane scroll as shown in the supplied movie. The dataset stays at eleven stable records in both views.

Working controls include:

- Row click and View/Close expansion, one entry at a time.
- Search, four sort choices, activity/field/month filters, and an empty state.
- Individual selection, select all, and mixed selection without opening a row.
- Audio play/pause with a moving playhead.
- Add Tag with empty/duplicate validation and keyboard-accessible dialogs.
- Map enlargement, zoom controls, and Escape dismissal.
- Keyboard sorting and visible focus styles.

Dashboard, Activity Logs, and Map navigation work within this preview. Other navigation destinations explain that they are outside this dashboard milestone.

## Data boundary

`src/app/page.tsx` currently passes the fixture in `src/lib/dashboard-data.ts` to `src/components/dashboard.tsx`. This frontend is not yet wired to the concurrently implemented backend. Tags remain in React state and reset on reload; this does **not** satisfy the full-stack persistence requirement by itself. Follow `docs/backend-spec.md` and the backend integration handoff when replacing the fixture with contract v1 data.

The metrics reproduce the Figma sample values. April 2026 remains the demo period. Isaac's summary preserves the supplied text; other summaries are explicitly sample content. All rows currently use the original map composition as a visual fixture.

`public/assets/sample-recording.mp3` is a synthesized, clearly announced demonstration clip, not an original worker recording. The supplied screen recording has no audio stream. The waveform preserves the design geometry and is not computed from this sample clip.

## Visual review tools

Development-only routes provide comparisons without changing the normal dashboard:

- `/design-check?view=default`
- `/design-check?view=expanded`
- Add `&overlay=off` to see the implementation without the difference layer.

Use a 1676 × 955 viewport for those comparisons. The original reference SVG is layered over the UI using difference blending, so aligned pixels appear black. Both the comparison page and reference-serving route are disabled outside development. Original references remain in `design/reference/`.

## Verification

Browser checks passed for default/expanded layouts, search and empty state, newest-first and keyboard sorting, activity filtering, checkbox selection, play/pause, tag addition and duplicate validation, dialog focus and Escape, map zoom, and independent sidebar/content scrolling. Layouts were also inspected at 1280 × 800 and 390 × 844; the narrow view contained table overflow without widening the page. The final default page loaded all images and reported no browser errors or warnings.

A TypeScript check scoped to the dashboard, fixture, app layout/page, and development comparison routes passed. After concurrent backend type fixes landed, the full `npm run build` also passed compilation, TypeScript, and page generation. Backend-owned files were left intact. Database persistence and API integration were not tested as part of this frontend preview.
