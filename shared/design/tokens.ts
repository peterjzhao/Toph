/**
 * Toph's shared visual values. Edit this file to update web, iOS, and Android.
 * Pure data only: no React, browser, native, server, or environment imports.
 * Dimensions are numbers: the web adapter adds px; React Native uses them directly.
 */
export const tokens = {
  colors: {
    brand: "#146c44",
    brandHover: "#105b39",
    brandTint: "rgba(20,108,68,0.1)",
    text: "#000",
    textMuted: "#4d4d4d",
    textSubtle: "#808080",
    textDisabled: "#b3b3b3",
    surface: "#fff",
    surfaceMuted: "#f8f8f8",
    border: "#e6e6e6",
    divider: "#f2f2f2",
    handle: "#ccc",
    backdrop: "rgba(0,0,0,0.28)",
    focus: "#087c57",
    selection: "#dceddf",
  },
  spacing: { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32 },
  radius: { small: 4, control: 8, popover: 12, card: 14, panel: 16, section: 20, sheet: 24 },
  fontSize: { tiny: 10, caption: 12, compact: 13, body: 14, control: 16, heading: 20, title: 24, metric: 48 },
  lineHeight: { caption: 16, body: 18, control: 21, heading: 26 },
  fontWeight: { regular: 400, medium: 500, semibold: 600 },
  // Font registration differs by platform; both load the existing Geist font files.
  fontFamily: {
    web: "var(--font-geist-sans), Arial, sans-serif",
    native: { regular: "Geist-Regular", medium: "Geist-Medium", semibold: "Geist-SemiBold" },
  },
} as const;
