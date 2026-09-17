import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { tokens } from "@toph/design";

// Hold the native wordmark while fonts load; there is no second JS splash.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    [tokens.fontFamily.native.regular]: require("@/assets/fonts/Geist-Regular.ttf"),
    [tokens.fontFamily.native.medium]: require("@/assets/fonts/Geist-Medium.ttf"),
    [tokens.fontFamily.native.semibold]: require("@/assets/fonts/Geist-SemiBold.ttf"),
  });

  if (!fontsLoaded && !fontError) return null;

  return (
    <View
      style={{ flex: 1, backgroundColor: tokens.colors.surface }}
      onLayout={() => SplashScreen.hide()}
    >
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: tokens.colors.surface } }} />
    </View>
  );
}
