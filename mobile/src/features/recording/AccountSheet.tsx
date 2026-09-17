import { ArrowRight, AudioLines, Camera, LogOut, RefreshCw, X } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { MobileAccount, MobileAccountEdit } from "@toph/contracts/mobile";
import { useEffect, useRef, useState } from "react";
import { Animated, BackHandler, Easing, KeyboardAvoidingView, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Press, SelectField, TextField } from "./fields";
import { activities } from "./recording-profile";
import ProfileAvatar from "./ProfileAvatar";
import { colors, fonts, shared, fontSize, lineHeight, radius, spacing } from "./styles";

type Props = {
  profile: MobileAccount;
  fields: string[];
  farmName: string;
  connectionError: string;
  connected: boolean;
  onRefresh: () => Promise<void>;
  onSignOut: () => Promise<void>;
  logCount: number;
  onClose: () => void;
  onSave: (profile: MobileAccountEdit) => Promise<void>;
  onViewLogs: () => void;
};

const duration = 200;

export default function AccountSheet({ profile, fields, farmName, connected, connectionError, onRefresh, onSignOut, logCount, onClose, onSave, onViewLogs }: Props) {
  const [edited, setEdited] = useState(profile);
  const [error, setError] = useState("");
  const [closing, setClosing] = useState(false);
  const [working, setWorking] = useState(false);
  const workingRef = useRef(false);
  // Refreshing the same account after a revision conflict must not discard unsaved edits.
  useEffect(() => { setEdited(profile); setError(""); }, [profile.id]);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const sheetHeight = Math.round(windowHeight * 0.9);
  const translate = useRef(new Animated.Value(sheetHeight)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translate, { toValue: 0, duration, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 1, duration, useNativeDriver: true }),
    ]).start();
  }, [backdrop, translate]);

  function dismiss() {
    if (closingRef.current || workingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    Animated.parallel([
      Animated.timing(translate, { toValue: sheetHeight, duration, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 0, duration, useNativeDriver: true }),
    ]).start(() => onClose());
  }

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { dismiss(); return true; });
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !closingRef.current && !workingRef.current,
    onMoveShouldSetPanResponder: (_event, gesture) => !closingRef.current && !workingRef.current && Math.abs(gesture.dy) > 2,
    onPanResponderMove: (_event, gesture) => translate.setValue(Math.max(0, gesture.dy)),
    onPanResponderRelease: (_event, gesture) => {
      const distance = Math.max(0, gesture.dy);
      const velocity = gesture.vy;
      if (distance > 100 || (distance > 35 && velocity > 0.65)) dismiss();
      else Animated.timing(translate, { toValue: 0, duration, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
    },
    onPanResponderTerminate: () => Animated.timing(translate, { toValue: 0, duration, easing: Easing.out(Easing.ease), useNativeDriver: true }).start(),
  })).current;

  async function act(action: () => Promise<void>) {
    if (workingRef.current) return;
    workingRef.current = true; setWorking(true); setError("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Please try again."); }
    finally { workingRef.current = false; setWorking(false); }
  }

  async function choosePhoto() {
    await act(async () => {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 1 });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      const context = ImageManipulator.manipulate(asset.uri);
      try {
        const side = Math.min(asset.width, asset.height);
        context.crop({ originX: Math.floor((asset.width - side) / 2), originY: Math.floor((asset.height - side) / 2), width: side, height: side }).resize({ width: 256, height: 256 });
        const image = await context.renderAsync();
        try {
          const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
          if (!result.base64 || result.base64.length > 170_000) throw new Error("Choose a smaller photo.");
          setEdited(current => ({ ...current, avatarUrl: `data:image/jpeg;base64,${result.base64}` }));
        } finally { image.release(); }
      } finally { context.release(); }
    });
  }

  async function submit() {
    if (!edited.name.trim()) { setError("Enter your name."); return; }
    await act(async () => {
      const { id: _id, ...changes } = edited;
      await onSave({ ...changes, name: edited.name.trim(), email: edited.email.trim() });
      workingRef.current = false;
      dismiss();
    });
  }

  return <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
    <Animated.View style={[styles.backdrop, { opacity: backdrop }]}><Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityLabel="Close account" /></Animated.View>
    <Animated.View style={[styles.sheet, { height: sheetHeight, transform: [{ translateY: translate }] }]} accessibilityViewIsModal accessibilityLabel="Account">
      <KeyboardAvoidingView style={styles.sheetInner} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.grip} {...pan.panHandlers}>
          <View style={styles.handle} />
          <View style={styles.heading}>
            <Text style={shared.heading} accessibilityRole="header">Account</Text>
            <Pressable style={styles.close} onPress={dismiss} accessibilityRole="button" accessibilityLabel="Close account"><X size={21} color={colors.muted} /></Pressable>
          </View>
        </View>
        <ScrollView style={styles.form} contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
          <View style={styles.identity}>
            <Press onPress={() => void choosePhoto()} disabled={working} accessibilityRole="button" accessibilityLabel="Change profile photo"><ProfileAvatar name={edited.name} uri={edited.avatarUrl} size={72} /></Press>
            <Text style={styles.name}>{edited.name}</Text>
            <Text style={shared.muted}>{farmName}</Text>
            <Press style={shared.quietButton} onPress={() => void choosePhoto()} disabled={working} accessibilityRole="button"><Camera size={16} color={colors.muted} /><Text style={shared.quietText}>Change photo</Text></Press>
            {edited.avatarUrl && <Press onPress={() => setEdited({ ...edited, avatarUrl: null })} disabled={working} accessibilityRole="button"><Text style={shared.quietText}>Remove photo</Text></Press>}
          </View>
          <View style={styles.fields}>
            <TextField label="Name" value={edited.name} editable={!working} maxLength={80} autoComplete="name" textContentType="name" onChangeText={(name) => { setEdited({ ...edited, name }); setError(""); }} />
            <TextField label="Role" value={edited.role} editable={false} />
            <TextField label="Email" value={edited.email} editable={!working} keyboardType="email-address" autoCapitalize="none" autoComplete="email" maxLength={254} onChangeText={email => setEdited({ ...edited, email })} />
            <TextField label="Phone" value={edited.phone} editable={!working} keyboardType="phone-pad" autoComplete="tel" maxLength={60} onChangeText={phone => setEdited({ ...edited, phone })} />
            <SelectField label="Default field" value={edited.defaultField} values={fields} disabled={working || !fields.length} onChange={(defaultField) => setEdited({ ...edited, defaultField })} />
            <SelectField label="Default activity" value={edited.defaultActivity} values={[...new Set([...activities, edited.defaultActivity])]} disabled={working} onChange={(defaultActivity) => setEdited({ ...edited, defaultActivity })} />
          </View>
          <Pressable style={styles.logs} onPress={onViewLogs} disabled={working} accessibilityRole="button" accessibilityLabel={`My logs, ${logCount}`}>
            <AudioLines size={19} color={colors.ink} />
            <Text style={[shared.text, styles.logsLabel]}>My logs</Text>
            <Text style={shared.muted}>{logCount}</Text>
            <ArrowRight size={17} color={colors.ink} />
          </Pressable>
          <Text style={shared.muted}>Your profile and logs belong to {farmName}. Device drafts stay with your account when you sign out.</Text>
          {!connected && <Press style={shared.quietButton} onPress={() => void act(onRefresh)} disabled={working} accessibilityRole="button"><RefreshCw size={16} color={colors.muted} /><Text style={shared.quietText}>Reconnect to Toph</Text></Press>}
          <Press style={styles.logs} onPress={() => void act(onSignOut)} disabled={working} accessibilityRole="button"><LogOut size={19} color={colors.ink} /><Text style={[shared.text, styles.logsLabel]}>Sign out</Text><ArrowRight size={17} color={colors.ink} /></Press>
          {connectionError && !error ? <View style={shared.notice} accessibilityRole="alert"><Text style={shared.noticeText}>{connectionError}</Text></View> : null}
          {error ? <View style={shared.notice} accessibilityRole="alert"><Text style={shared.noticeText}>{error}</Text></View> : null}
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: Math.max(12, insets.bottom) }]}>
          <Press style={shared.primaryButton} onPress={() => void submit()} disabled={closing || working || !connected} accessibilityRole="button"><Text style={shared.primaryText}>{working ? "Saving…" : "Save changes"}</Text></Press>
        </View>
      </KeyboardAvoidingView>
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.backdrop },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, backgroundColor: colors.white, overflow: "hidden", shadowColor: colors.ink, shadowOpacity: 0.07, shadowRadius: 14, shadowOffset: { width: 0, height: -6 }, elevation: 12 },
  sheetInner: { flex: 1 },
  grip: { paddingTop: 10, paddingLeft: spacing.xl, paddingRight: 18 },
  handle: { alignSelf: "center", width: 38, height: 4, borderRadius: 3, backgroundColor: colors.handle, marginBottom: spacing.xs },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22 },
  form: { flex: 1 },
  formContent: { paddingTop: 14, paddingHorizontal: spacing.xl, paddingBottom: spacing.sm, gap: 22 },
  identity: { alignItems: "center", gap: 7 },
  avatar: { width: 72, height: 72, borderRadius: 36, marginBottom: spacing.xxs },
  name: { fontFamily: fonts.semibold, fontSize: fontSize.heading, lineHeight: lineHeight.heading, color: colors.ink, textAlign: "center" },
  fields: { gap: 18 },
  logs: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, paddingVertical: 10, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line },
  logsLabel: { flex: 1 },
  footer: { paddingTop: spacing.sm, paddingHorizontal: spacing.xl, borderTopWidth: 1, borderTopColor: colors.line },
});
