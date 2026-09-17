# Field map regions

The generated A–K graphics are in `public/assets/field-maps/`. `regions.json` is the portable segmentation file; `src/lib/field-map.ts` imports the same file for the UI. No database records or schema were changed.

Assignment revision 2 swaps B/I, C/H, D/G, and F/J at the user's request. Images and polygons move together; each field retains its record ID and activity history. Original generation prompts retain their original letters in `generation.json`, alongside `generatedAsField`.

Each entry includes the field letter, stable seeded PostgreSQL `fieldId`, image URL, original image dimensions, and polygon vertices. Coordinates are normalized `[x, y]` pairs in the range 0–1. The origin is the top-left corner; x increases rightward and y downward. Convert to pixels with `x * imageWidth` and `y * imageHeight`. SVG polygons close automatically; consumers needing a closed ring should append the first vertex.

The boundaries were extracted from the blue outlines in each generated PNG, simplified to approximately two source pixels, and normalized using that PNG's dimensions. A is 1668 × 943; the other images are 1670 × 942. These are illustrative image regions, not GPS coordinates or surveyed parcel boundaries. AI-generated maps have minor texture and boundary variations; overlay alignment is approximate away from the selected field's own image.

| Field | Image location |
| --- | --- |
| A | Center golden rectangle, immediately right of the lake |
| B | Golden rectangle above C (originally I) |
| C | Small dark rectangle immediately right of A (originally H) |
| D | Wide dark rectangle directly below A (originally G) |
| E | Narrow golden block at bottom center |
| F | Dark rectangle above B (originally J) |
| G | Lower green block just east of I, including both subplots (originally D) |
| H | Partial circular field at the far lower-left edge (originally C) |
| I | Lower-left curved green field; original approved sample (originally B) |
| J | Dark irregular block immediately right of E (originally F) |
| K | Large curved field in the upper right |

`FieldMap` places transparent SVG links over the uncropped image, with hover/focus outlines and native keyboard activation. Both the image and SVG zoom inside the same scrolling container. Clicking a region in a dashboard log or its expanded map navigates to `/map?field=<record ID>`. The Map page selects that field, shows its generated image and existing activity records, and keeps the URL in sync for reloads and Back/Forward. Regions are only linked when their IDs exist in the provided field list. Unknown/custom imagery retains its original image and whole-map link rather than receiving incorrect polygons.

These assets are resolved in the frontend for the seeded IDs when the stored image is the original shared `/assets/field-map.svg`. The API still returns its persisted URL; replacing a stored image with a custom URL takes precedence. Future backend integration can persist each generated asset URL and import the same polygon data as needed without deriving record identity from a field name.

Verification: `npm run test:frontend` covers all eleven interior sample points, image existence, normalized bounds, background exclusions, and custom imagery handling. Browser verification covers field selection and navigation, dashboard links, keyboard activation, and zoom alignment.
