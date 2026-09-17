import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, StyleSheet, View } from "react-native";
import { colors, radius } from "./styles";

export const ReviewLoading = createContext(false);

/** The real child determines size and layout; there is no second skeleton form to maintain. */
export function ReviewSkeleton({ children }: { children: ReactNode }) {
  const loading = useContext(ReviewLoading);
  const opacity = useRef(new Animated.Value(0.45)).current;
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReduceMotion(value); });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    if (!loading || reduceMotion) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.95, duration: 800, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.45, duration: 800, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [loading, reduceMotion, opacity]);
  return <View style={styles.container}>
    <View style={loading ? styles.hidden : undefined} pointerEvents={loading ? "none" : "auto"}
      accessibilityElementsHidden={loading} importantForAccessibility={loading ? "no-hide-descendants" : "auto"}>
      {children}
    </View>
    {loading && <Animated.View testID="review-skeleton" pointerEvents="none" style={[StyleSheet.absoluteFill, styles.fill, { opacity }]} />}
  </View>;
}
const styles = StyleSheet.create({
  container: { minWidth: 0 },
  hidden: { opacity: 0 },
  fill: { backgroundColor: colors.border, borderRadius: radius.control },
});
