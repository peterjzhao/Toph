import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { newPasswordProblem, PASSWORD_MAX_LENGTH, type AccountSession, type AuthResponse } from "@toph/contracts/accounts";
import type { MobileBootstrap } from "@toph/contracts/mobile";
import { apiOrigin, createMobileClient, MobileApiError } from "@/lib/api/mobile-client";
import { clearSessionToken, restoreSessionToken, saveSessionToken } from "@/lib/api/session-token";
import RecordingWorkspace from "@/features/recording/RecordingWorkspace";
import { Press, TextField } from "@/features/recording/fields";
import { colors, fonts, radius, shared, spacing } from "@/features/recording/styles";
import { sessionAccount } from "./session-account";

const api = createMobileClient();
type Mode = "login" | "join";

/** A recording workspace is mounted only after the server verifies its farm membership. */
export default function AccountGateway() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [code, setCode] = useState("");
  const [session, setSession] = useState<AccountSession | null>(null);
  const [bootstrap, setBootstrap] = useState<MobileBootstrap | null>(null);
  const [starting, setStarting] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const requestInProgress = useRef(false);
  const mounted = useRef(true);

  async function loadWorkspace(accountSession: AccountSession) {
    if (accountSession.account.role !== "worker") throw new Error("Farm admins sign in to the web dashboard. Use your worker account here.");
    const data = await api.accounts();
    sessionAccount(data, accountSession);
    if (mounted.current) setBootstrap(data);
  }

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        if (!await restoreSessionToken(apiOrigin())) return;
        const restored = await api.session();
        if (!mounted.current) return;
        setSession(restored);
        await loadWorkspace(restored);
      } catch (cause) {
        if (cause instanceof MobileApiError && cause.status === 401) {
          await clearSessionToken();
          if (mounted.current) setSession(null);
        }
        if (mounted.current) setError(cause instanceof Error ? cause.message : "Your account could not be loaded.");
      } finally { if (mounted.current) setStarting(false); }
    })();
    return () => { mounted.current = false; };
  }, []);

  async function act(action: () => Promise<void>) {
    if (requestInProgress.current) return;
    requestInProgress.current = true; setWorking(true); setError("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Please try again."); }
    finally { requestInProgress.current = false; setWorking(false); }
  }

  async function accept(result: AuthResponse["data"]) {
    if (result.account.role !== "worker") throw new Error("Farm admins sign in to the web dashboard. Use your worker account here.");
    await saveSessionToken(apiOrigin(), result.token ?? "");
    const { token: _token, ...accountSession } = result;
    setSession(accountSession);
    setName(""); setPassword(""); setConfirmation(""); setCode("");
    await loadWorkspace(accountSession);
  }

  async function submit() {
    if (!name.trim()) { setError("Enter your name."); return; }
    if (!password) { setError("Enter your password."); return; }
    const problem = mode === "join" ? newPasswordProblem(password, confirmation) : null;
    if (problem) { setError(problem); return; }
    if (mode === "join" && !code.trim()) { setError("Enter the join code from your farm admin."); return; }
    await act(async () => accept(mode === "join" ? await api.join(name, password, code) : await api.login(name, password)));
  }

  async function signOut() {
    // A local sign-out still works when the server is temporarily unreachable.
    try { await api.logout(); } catch { /* The device token is removed below. */ }
    await clearSessionToken();
    setBootstrap(null); setSession(null); setName(""); setPassword(""); setConfirmation(""); setCode(""); setError(""); setMode("login");
  }

  if (session && bootstrap) return <RecordingWorkspace key={`${session.farm.id}:${session.account.id}`} session={session} initialBootstrap={bootstrap} onSignOut={signOut} />;
  if (starting) return <LaunchScreen status="Connecting to your account" />;

  return <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
      <Text style={styles.brand}>toph</Text>
      <View style={styles.card}>
        {session ? <>
          <Text style={shared.heading}>Welcome, {session.account.name}</Text>
          <Text style={shared.muted}>{session.farm.name}</Text>
          <Text style={shared.text}>Connect to load your farm and recording workspace. Your device drafts are kept.</Text>
          <Press style={shared.primaryButton} disabled={working} onPress={() => void act(async () => {
            const refreshed = await api.session(); setSession(refreshed); await loadWorkspace(refreshed);
          })} accessibilityRole="button"><Text style={shared.primaryText}>{working ? "Connecting…" : "Try again"}</Text></Press>
          <Press style={shared.quietButton} disabled={working} onPress={() => void act(signOut)} accessibilityRole="button"><Text style={shared.quietText}>Sign out</Text></Press>
        </> : <>
          <View style={styles.intro}>
            <Text style={shared.heading}>{mode === "join" ? "Join your farm" : "Welcome back"}</Text>
          </View>
          <View style={styles.tabs} accessibilityRole="tablist">
            {(["login", "join"] as const).map(value => <Press key={value} style={[styles.tab, mode === value ? styles.activeTab : null]} disabled={working} onPress={() => { setMode(value); setPassword(""); setConfirmation(""); setError(""); }} accessibilityRole="tab" accessibilityState={{ selected: mode === value }}><Text style={[shared.text, mode === value ? styles.activeText : null]}>{value === "login" ? "Log in" : "Join a farm"}</Text></Press>)}
          </View>
          <TextField label="Your name" value={name} onChangeText={value => { setName(value); setError(""); }} maxLength={80} autoCapitalize="words" autoComplete="username" textContentType="username" autoCorrect={false} editable={!working} />
          <TextField label="Password" value={password} onChangeText={value => { setPassword(value); setError(""); }} maxLength={PASSWORD_MAX_LENGTH} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete={mode === "join" ? "new-password" : "current-password"} textContentType={mode === "join" ? "newPassword" : "password"} editable={!working} onSubmitEditing={() => { if (mode === "login") void submit(); }} />
          {mode === "join" && <TextField label="Confirm password" value={confirmation} onChangeText={value => { setConfirmation(value); setError(""); }} maxLength={PASSWORD_MAX_LENGTH} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" editable={!working} />}
          {mode === "join" && <TextField label="Farm join code" value={code} onChangeText={value => { setCode(value); setError(""); }} maxLength={40} autoCapitalize="characters" autoCorrect={false} editable={!working} onSubmitEditing={() => void submit()} />}
          <Press style={shared.primaryButton} disabled={working} onPress={() => void submit()} accessibilityRole="button"><Text style={shared.primaryText}>{working ? "Connecting…" : mode === "join" ? "Create account & join farm" : "Log in"}</Text></Press>

        </>}
        {error ? <View style={shared.notice} accessibilityRole="alert"><Text style={shared.noticeText}>{error}</Text></View> : null}
      </View>
    </ScrollView>
  </KeyboardAvoidingView>;
}

/** Redraws the native launch screen so the wordmark stays in place, with a status line beneath it. */
function LaunchScreen({ status }: { status: string }) {
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    let active = true;
    let pulse: Animated.CompositeAnimation | undefined;
    void AccessibilityInfo.isReduceMotionEnabled().then(reduceMotion => {
      if (!active || reduceMotion) return;
      pulse = Animated.loop(Animated.sequence([
        Animated.timing(opacity, { toValue: 0.45, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]));
      pulse.start();
    });
    return () => { active = false; pulse?.stop(); };
  }, [opacity]);
  // Equal halves keep the wordmark at the screen centre, where the native splash draws it.
  return <View style={styles.launch}>
    <View style={styles.launchHalf} />
    <Image source={require("@/assets/images/splash-toph.png")} style={styles.wordmark} resizeMode="contain" fadeDuration={0} accessible accessibilityLabel="Toph" />
    <View style={styles.launchHalf}>
      <Animated.Text style={[shared.muted, styles.status, { opacity }]}>{status}</Animated.Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  launch: { flex: 1, alignItems: "center", backgroundColor: colors.white },
  launchHalf: { flex: 1, alignSelf: "stretch", alignItems: "center", paddingHorizontal: spacing.xl },
  // The expo-splash-screen plugin in app.json draws this 677×338 asset 150 points wide.
  wordmark: { width: 150, aspectRatio: 677 / 338 },
  status: { marginTop: spacing.sm, textAlign: "center" },
  page: { flex: 1, backgroundColor: colors.white },
  content: { flexGrow: 1, paddingHorizontal: spacing.xl, gap: 48 },
  brand: { fontFamily: fonts.semibold, fontSize: 36, lineHeight: 44, letterSpacing: -1.5, color: colors.ink },
  card: { width: "100%", maxWidth: 460, alignSelf: "center", gap: spacing.lg },
  intro: { gap: spacing.sm },
  tabs: { flexDirection: "row", backgroundColor: colors.panel, borderRadius: radius.control, padding: 4 },
  tab: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.control },
  activeTab: { backgroundColor: colors.white },
  activeText: { fontFamily: fonts.medium, color: colors.green },
});
