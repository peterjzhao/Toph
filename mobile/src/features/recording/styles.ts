/** Native styles use the shared design values; screen geometry stays native. */
import { StyleSheet } from "react-native";
import { tokens } from "@toph/design";

export const colors = {
  ink: tokens.colors.text,
  muted: tokens.colors.textMuted,
  soft: tokens.colors.textSubtle,
  green: tokens.colors.brand,
  greenTint: tokens.colors.brandTint,
  line: tokens.colors.divider,
  border: tokens.colors.border,
  bar: tokens.colors.textDisabled,
  panel: tokens.colors.surfaceMuted,
  handle: tokens.colors.handle,
  backdrop: tokens.colors.backdrop,
  white: tokens.colors.surface,
};

export const fonts = tokens.fontFamily.native;
export const { spacing, radius, fontSize, lineHeight } = tokens;

export const shared = StyleSheet.create({
  text: { fontFamily: fonts.regular, fontSize: fontSize.body, lineHeight: lineHeight.body, color: colors.ink },
  muted: { fontFamily: fonts.regular, fontSize: fontSize.body, lineHeight: lineHeight.body, color: colors.muted },
  heading: { fontFamily: fonts.semibold, fontSize: fontSize.heading, lineHeight: lineHeight.heading, color: colors.ink },
  label: { fontFamily: fonts.regular, fontSize: fontSize.body, lineHeight: lineHeight.body, color: colors.muted },
  inputBox: { minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, paddingVertical: 11, paddingHorizontal: spacing.sm, backgroundColor: colors.white },
  inputText: { fontFamily: fonts.regular, fontSize: fontSize.control, lineHeight: lineHeight.control, color: colors.ink },
  roundButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
  primaryButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, minHeight: 46, paddingVertical: spacing.sm, paddingHorizontal: 18, borderRadius: radius.control, backgroundColor: colors.ink },
  primaryText: { fontFamily: fonts.regular, fontSize: fontSize.control, lineHeight: lineHeight.control, color: colors.white },
  quietButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, minHeight: 44, padding: spacing.xs },
  quietText: { fontFamily: fonts.regular, fontSize: fontSize.body, lineHeight: lineHeight.body, color: colors.muted },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, backgroundColor: colors.panel, padding: spacing.sm, marginBottom: spacing.lg },
  noticeText: { flex: 1, fontFamily: fonts.regular, fontSize: fontSize.body, lineHeight: lineHeight.body, color: colors.muted },
  disabled: { opacity: 0.5 },
});
