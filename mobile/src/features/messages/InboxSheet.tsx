import * as Crypto from "expo-crypto";
import { ArrowLeft, MessageSquare, RefreshCw, Send } from "lucide-react-native";
import { useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Message } from "@toph/contracts/workspace";
import { colors, fonts, fontSize, lineHeight, radius, shared, spacing } from "../recording/styles";
import type { useInbox } from "./use-inbox";

type Props = { visible: boolean; onClose: () => void; employeeId: string; farmName: string; online: boolean; inbox: ReturnType<typeof useInbox> };
export default function InboxSheet({ visible, onClose, employeeId, farmName, online, inbox }: Props) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState("");
  const draftVersion = useRef(0);
  const attempt = useRef<{ id: string; body: string } | null>(null);
  const sending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [sendError, setSendError] = useState("");
  async function send() {
    const body = draft.trim();
    if (!body || sending.current) return;
    if (attempt.current?.body !== body) attempt.current = { id: Crypto.randomUUID(), body };
    const version = draftVersion.current;
    sending.current = true; setSaving(true); setSendError("");
    try {
      await inbox.send({ ...attempt.current, employeeId });
      attempt.current = null;
      if (draftVersion.current === version) setDraft("");
    } catch (cause) { setSendError(cause instanceof Error ? cause.message : "Could not send. Your draft is still here."); }
    finally { sending.current = false; setSaving(false); }
  }
  const messages = [...inbox.messages].reverse().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
    <View style={[styles.sheet, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close inbox" onPress={onClose} style={shared.roundButton}><ArrowLeft size={20} color={colors.ink} /></Pressable>
        <View style={styles.title}><Text style={shared.heading} accessibilityRole="header">Inbox</Text><Text style={shared.muted} numberOfLines={1}>{farmName} · Farm admin</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh messages" onPress={() => void inbox.refresh()} style={shared.roundButton}><RefreshCw size={18} color={colors.ink} /></Pressable>
      </View>
      <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {(!online || inbox.error) && <Text style={styles.notice} accessibilityRole="alert">{!online ? "Offline. Your messages will refresh when you reconnect." : inbox.error}</Text>}
        {!!inbox.readError && <Pressable accessibilityRole="button" onPress={() => void inbox.markRead()}><Text style={styles.notice}>{inbox.readError}</Text></Pressable>}
        {inbox.loading && online && !messages.length ? <View style={styles.empty}><ActivityIndicator color={colors.ink} /><Text style={shared.muted}>Loading your inbox…</Text></View> : messages.length ?
          <FlatList<Message> inverted data={messages} keyExtractor={message => message.id} style={styles.body} contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled" renderItem={({ item: message }) => {
            const outgoing = message.from === "employee";
            return <View style={[styles.bubble, outgoing ? styles.outgoing : styles.incoming]}><Text style={[shared.text, outgoing && styles.outgoingText]}>{message.body}</Text><Text style={[styles.meta, outgoing && styles.outgoingMeta]}>{new Date(message.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{outgoing ? ` · ${message.read ? "Read" : "Sent"}` : ""}</Text></View>;
          }} /> : <View style={styles.empty}><MessageSquare size={32} color={colors.soft} /><Text style={shared.heading}>Your farm inbox</Text><Text style={[shared.muted, styles.centered]}>Ask your farm admin a question or share an update.</Text></View>}
        <View style={styles.composer}>
          {!!sendError && <Text style={styles.error} accessibilityRole="alert">{sendError}</Text>}
          <View style={styles.composeRow}><TextInput accessibilityLabel="Message to farm admin" placeholder="Message admin…" placeholderTextColor={colors.soft} multiline maxLength={4000} value={draft} style={[shared.inputBox, shared.inputText, styles.input]} onChangeText={value => { draftVersion.current++; setDraft(value); setSendError(""); }} /><Pressable accessibilityRole="button" accessibilityLabel={saving ? "Sending message" : "Send message"} disabled={!draft.trim() || saving || !online} onPress={() => void send()} style={[styles.send, (!draft.trim() || saving || !online) && shared.disabled]}>{saving ? <ActivityIndicator color={colors.white} /> : <Send size={20} color={colors.white} />}</Pressable></View>
        </View>
      </KeyboardAvoidingView>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.white },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { flex: 1, gap: spacing.xxs },
  body: { flex: 1 },
  messages: { padding: spacing.lg, gap: spacing.sm },
  bubble: { maxWidth: "88%", borderRadius: radius.control, padding: spacing.md, gap: spacing.xs },
  incoming: { alignSelf: "flex-start", backgroundColor: colors.panel },
  outgoing: { alignSelf: "flex-end", backgroundColor: colors.ink },
  outgoingText: { color: colors.white },
  outgoingMeta: { color: colors.white, opacity: 0.75 },
  meta: { fontFamily: fonts.regular, fontSize: fontSize.caption, lineHeight: lineHeight.caption, color: colors.muted },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  centered: { textAlign: "center" },
  composer: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.lg, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line },
  composeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  input: { flex: 1, maxHeight: 140 },
  send: { width: 46, height: 46, borderRadius: radius.control, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" },
  notice: { ...shared.muted, padding: spacing.md, backgroundColor: colors.panel },
  error: { ...shared.muted, color: colors.warning },
});
