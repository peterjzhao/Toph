# Shared design tokens

Edit **`shared/design/tokens.ts`** to change the shared appearance of the website, iOS app,
and Android app. It holds named colors, spacing, corner radii, font sizes, line heights,
font weights, and platform font names. Both applications import it as `@toph/design`.
It has no dependencies and does not need a package install or generation command.

```text
shared/design/tokens.ts
  ├─ website: src/lib/design-tokens.ts → CSS variables on <html> → CSS Modules
  └─ native:  mobile/src/features/recording/styles.ts → React Native styles
```

## Example: change the shared green

The source currently contains:

```ts
colors: {
  brand: "#146c44",
  // ...
}
```

Change `brand` here and the next web/native build uses the new value wherever the brand
token is referenced. Hover and tinted colors are separate tokens (`brandHover`, `brandTint`),
so a palette change should update those intentionally as well.

On the website, existing CSS Modules use:

```css
.primaryButton {
  background: var(--toph-color-brand);
  border-radius: var(--toph-radius-control);
  padding: 10px var(--toph-spacing-md);
}
```

The adapter in `src/lib/design-tokens.ts` converts `spacing.md: 16` into
`--toph-spacing-md: 16px`. `src/app/layout.tsx` places the variables on the root HTML element
as server-rendered styles. All pages inherit them, including before JavaScript hydration.
Nothing is copied into a second generated stylesheet that could become stale.

On native, the recording style module uses the same values:

```ts
export const colors = { green: tokens.colors.brand /* other aliases */ };
export const { spacing, radius, fontSize, lineHeight } = tokens;

// Used by the recording screens:
{ color: colors.green, paddingHorizontal: spacing.md, borderRadius: radius.control }
```

React Native receives numeric dimensions directly in its own layout units, without `px`.
The existing native color names (`green`, `ink`, `white`, etc.) are aliases to the shared
tokens so recording components can keep their current imports.

## What is shared and what stays local

- Shared values now drive the common dashboard/workspace palette, type sizes/weights,
  spacing, and radii, plus the native recording screens, fields, account sheet, audio
  player, and review views. All migrated values retain their previous appearance.
- Layout decisions stay in each app: sidebar widths, microphone button size, safe-area
  calculations, breakpoints, and individual layout measurements. Specialized chart/status
  colors and uncommon measurements that are not in the shared scale also stay local.
- Both apps still load Geist using their own font loader. Font registration names live in
  the token source; changing the actual typeface also requires supplying the font files
  and updating the platform loader. Changing font size tokens requires no new font assets.
- Tokens are bundled with each app. Published mobile apps need a new app build or configured
  update to receive changes; this is not a live remote theme service.

## Adding a token

Add a value to an existing token group, then reference it in the relevant styles. The web
adapter automatically converts camel case to kebab case and adds `px` to dimension groups:
`colors.textMuted` becomes `--toph-color-text-muted`, while `fontSize.body` becomes
`--toph-font-size-body`. Colors and font weights receive no length suffix.

For new native styles, use the existing recording style exports or import `tokens` directly
from `@toph/design`. Avoid copying its literal values back into components. The root and
mobile `tsconfig.json` files resolve that alias to the same source. The native Metro config
watches `shared/` so token edits participate in Fast Refresh.

If Metro was already running when this setup was added, restart it once to load the new
alias/watch configuration. Future token value changes do not need a manual copy/generation
step. Existing development servers were left running during implementation.

Verification: both TypeScript projects and the web production build pass. A one-off check
resolved every migrated CSS variable and confirmed all five web stylesheets retain their
original values. The current mobile test suite passed all 63 tests. Expo production exports
also bundled successfully for both iOS and Android with environment-file loading disabled;
the shared runtime import resolves correctly in Metro. No app was installed or deployed.

References: [Expo path aliases](https://docs.expo.dev/guides/typescript/#path-aliases-optional),
[Expo SDK 57 Metro configuration](https://docs.expo.dev/versions/v57.0.0/config/metro/).
