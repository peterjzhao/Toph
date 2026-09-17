# Toph design review

Reviewed September 16, 2026. This file records observations for later frontend implementation; it does not add requirements beyond the user's requested dashboard and architecture discussion.

The user asks for architecture first, then frontend implementation. The attached challenge brief calls for a close reproduction of the dashboard, row expansion, persistent backend data reflecting the page's data shape, hosting, research, and an explanation of decisions. The product background describes mobile audio capture and transcription; it does not establish that the submission must implement the entire mobile application or a transcription service.

The [linked Figma canvas](https://www.figma.com/design/nvpGmK1je0QsesXtZcBdjg/F26-Dev-Challenge-Figma?node-id=1-1483) was accessible in the browser. Its text layers confirmed the supplied brief. Entering Prototype view presented a Figma sign-up dialog, so prototype wiring and transitions were not verified. The user's movie is the available evidence of runtime scrolling.

**Export inventory**

The twelve pasted files are byte-for-byte repetitions of four unique exports. Each unique export appeared three times. The supposed individual-component copies contain complete 1676 × 955 dashboard exports as well. Original unique files are retained in `design/reference`; the manifest records original paths and SHA-256 hashes.

| Reference | Source attachment ID |
| --- | --- |
| `default.css` | `57251877-6777-4543-8699-5f2bca84d7ad` |
| `default.svg` | `9a5a7f3b-c170-4e5a-bd83-bed0d83ddc6e` |
| `expanded.css` | `6212d804-ac22-4501-806f-b659949f1c91` |
| `expanded.svg` | `63167945-6a32-40e6-a905-28a955075ead` |

The full SVGs contain text outlines and exact icon geometry. They are useful visual baselines and asset sources; the interface itself should use semantic elements and live text so it can display database records and support interaction.

Three embedded raster images were extracted without modification: a 200 × 200 JPEG avatar, a 256 × 256 PNG checker texture, and a 1403 × 896 PNG satellite image. The avatar is identical in both exported views. Keep the SVG's crop and any separate vector overlays when reproducing the map. Extracting the raster alone does not reproduce the entire composed map.

**Measured reference geometry**

| Element | Exported measurement |
| --- | --- |
| Dashboard frame | 1676 × 955 px |
| Outer layout | 10 px padding and 10 px gap |
| Navigation panel | 280 × 935 px; 16 px radius |
| Main panel | 1366 × 935 px; 30 px horizontal padding |
| Main content width | 1306 px |
| Heading area | 87 px high; 20 px vertical padding |
| Search | 370 × 34 px |
| Metric-card row | 115 px high; 10 px gaps |
| Default log card | 1306 × 364 px; 20 px radius |
| Expanded log card | 1306 × 713 px |
| Default log body | 232 px high |
| Expanded log body | 581 px high |
| Standard log row | 58 px high |
| Expanded left content | 592 px wide |
| Expanded map column | Approximately 594 px wide |

Geist is the only font family in the supplied CSS. Weights used are 400, 500, and 600. Examples: dashboard heading 20/26 px at weight 600; row text 14/18 px; expanded controls and summary 16/21 px. The first row background is `#F8F8F8`, primary pale borders use `#F2F2F2`, and search borders use `#E6E6E6`.

The CSS export contains repeated frame names, Figma-specific layout conventions, and `leading-trim` / `text-edge` declarations. It is design evidence rather than a directly usable stylesheet. Reconstruct each semantic component with measured dimensions and verify the resulting text baselines in the chosen browser.

**Observed interaction and scrolling**

The brief explicitly establishes row-click expansion into inline details and the supplied frame shows the View button changing to Close. The expanded area contains a waveform, Play Recording, Add Tag, summary text, map, and Expand Map.

The supplied movie is about 8.9 seconds, 1700 × 946 pixels, with no audio stream. It is cropped and should not replace the SVG as the dimensional baseline. Extracted frames show the sidebar remaining stationary while the right-side content moves vertically. At around two seconds, the right-side heading, metric cards, toolbar, and upper part of the expanded recording have scrolled out of view; subsequent log rows have moved upward.

Both CSS exports mark an inner log frame with `overflow-y: scroll`. That declaration alone does not reproduce all motion visible in the movie. Use the recording as the behavioral reference when deciding the right-hand scroll container and clipping boundaries; do not assume sticky metrics or a sticky table header. Verify the scroll behavior with a browser recording during implementation.

Only row expansion and the recorded scrolling are verified interaction requirements. Details such as whether multiple rows can be open, filter-menu appearance, map-modal appearance, and the tagging flow have not been specified. Proposed defaults are one expanded row, accessible unstyled dialogs/popovers with custom styling, real tag persistence, and map enlargement using the original image. These should preserve the supplied resting states.

**Sample content**

The default export contains Isaac Wang / Spraying / April 19, 2026 / FIELD A; Maya Patel / Harvesting / April 20 / FIELD B; Liam Johnson / Planting / April 21 / FIELD C; and Sophia Lee / Irrigation / April 22 / FIELD D.

The expanded export adds Ethan Kim, Olivia Martinez, Noah Brown, Emma Davis, James Wilson, Isabella Garcia, and Benjamin Moore, giving eleven rows in total. The Active Workers card showing 12 does not imply twelve displayed log rows. See the architecture proposal for how the different record counts and undefined statistics are handled.

The supplied summary text contains an April 8 timestamp while the row's activity date is April 19. Preserve the reference content for visual comparison; the brief does not establish whether these represent different event times or placeholder text. Avoid silently rewriting the summary to make it more plausible.

**Visual acceptance plan**

Compare the implementation to both complete SVG exports at 1676 × 955. Use the original font and asset geometry, fixed sample data, and the same browser environment for each run. Inspect image overlays and differences for spacing, text baselines, line breaks, icons, borders, radii, and image crops. Then compare scrolling to the user's movie and exercise row expansion, controls, and persistence. Responsive layouts below the desktop design size require additional design judgment because no mobile reference was supplied.

The frontend has since been implemented and visually reviewed. See `docs/frontend-preview.md` for the current behavior, comparison tools, verification, and remaining backend integration boundary.
