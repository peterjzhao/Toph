import { FileText } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, fontSize, lineHeight, radius, spacing } from "../styles";
import { isLive, phaseDisplay, phaseHint, type HandsFreeState } from "./machine";

type Props = HandsFreeState & {
  /** Fills the whole window during a session; sits inside the capture screen while idle. */
  fullScreen: boolean;
  /** Stops the session, or saves the log once `ready`. */
  onPress: () => void;
  onReview: () => void;
};

/** One giant tap target whose colour and label give the state at arm's length. */
export default function HandsFreeScreen({ phase, transport, message, ready, fullScreen, onPress, onReview }: Props) {
  const insets = useSafeAreaInsets();
  const display = phaseDisplay[phase];
  const hint = phaseHint({ phase, ready });
  const live = isLive(phase);
  const action = phase === "idle" ? "Start hands-free log" : live ? (ready ? "Save hands-free log" : "Stop hands-free log") : "Close";
  return <View style={[fullScreen ? styles.overlay : styles.panel, { backgroundColor: display.background }]} accessibilityViewIsModal={fullScreen}>
    <Pressable style={[styles.target, fullScreen ? { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + 96 } : null]} onPress={onPress}
      accessibilityRole="button" accessibilityLabel={`${display.label}. ${action}`} accessibilityHint={hint} accessibilityState={{ busy: phase === "connecting" || phase === "thinking" }}>
      <Text style={[styles.label, { color: display.foreground }]} accessibilityLiveRegion="assertive" adjustsFontSizeToFit numberOfLines={1}>{display.label}</Text>
      {message ? <Text style={[styles.message, { color: display.foreground }]} numberOfLines={6}>{message}</Text> : null}
      <Text style={[styles.hint, { color: display.foreground }]}>{hint}{live && transport === "turns" ? " · Turn by turn" : ""}</Text>
    </Pressable>
    {/* A sibling of the tap target, not a child, so it stays a separate control for touch and screen readers. */}
    {live && <Pressable style={[styles.review, { bottom: insets.bottom + spacing.xl }]} onPress={onReview} accessibilityRole="button" accessibilityLabel="Review on screen" accessibilityHint="Stops listening and opens the log form with what has been filled in">
      <FileText size={17} color={colors.ink} /><Text style={styles.reviewText}>Review on screen</Text>
    </Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 20 },
  panel: { flex: 1, minHeight: 295, borderRadius: radius.section, overflow: "hidden" },
  target: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, padding: spacing.xl },
  label: { fontFamily: fonts.semibold, fontSize: 56, lineHeight: 64, letterSpacing: -1.5, textAlign: "center" },
  message: { fontFamily: fonts.regular, fontSize: fontSize.heading, lineHeight: lineHeight.heading, textAlign: "center" },
  hint: { fontFamily: fonts.regular, fontSize: fontSize.control, lineHeight: lineHeight.control, textAlign: "center", opacity: 0.85 },
  review: { position: "absolute", alignSelf: "center", flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: 48, paddingHorizontal: spacing.lg, borderRadius: radius.sheet, backgroundColor: colors.white },
  reviewText: { fontFamily: fonts.medium, fontSize: fontSize.control, lineHeight: lineHeight.control, color: colors.ink },
});
