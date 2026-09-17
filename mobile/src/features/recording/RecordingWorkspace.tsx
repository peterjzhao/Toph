import * as Crypto from "expo-crypto";
import { useNetworkState } from "expo-network";
import {
  ArrowLeft, ArrowRight, AudioLines, CheckCheck, CircleHelp, CloudUpload, FileText, Mic, Pause, Play, Plus, RefreshCw, Square, WifiOff,
} from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { MobileAccount, MobileAccountEdit, MobileBootstrap, MobileRemoteLog } from "@toph/contracts/mobile-demo";
import { assetUrl, createDemoClient, DemoApiError } from "@/lib/api/demo-client";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AccountSheet from "./AccountSheet";
import ReviewLog from "./ReviewLog";
import AudioReview from "./AudioReview";
import ProfileAvatar from "./ProfileAvatar";
import { readAccounts, saveAccounts } from "./mobile-accounts";
import { Press } from "./fields";
import { draftClips, listDrafts, saveDraft, type RecordingDraft } from "./local-drafts";
import { defaultProfile, fields, readProfile } from "./recording-profile";
import {
  clock, dateLabel, emptyDetails, fieldLabel, isTreatment, localDate, sampleDetails, validateDetails, type WorkDetails,
} from "./recording-utils";
import { colors, fonts, shared, fontSize, lineHeight, spacing } from "./styles";
import { useTranscription } from "./use-transcription";
import { useRecorder } from "./use-recorder";

type Screen = "capture" | "review" | "saved" | "library" | "remote";
const pageTitles: Record<Screen, string> = { capture: "Record", review: "Review log", saved: "Draft saved", library: "Logs", remote: "Saved log" };
const initialAccount: MobileAccount = { ...defaultProfile, id: "10000000-0000-4000-8000-000000000001", role: "Farm worker", email: "", phone: "", avatarUrl: null };
const api = createDemoClient();

export default function RecordingWorkspace() {
  const recorder = useRecorder();
  const insets = useSafeAreaInsets();
  const network = useNetworkState();
  const [screen, setScreen] = useState<Screen>("capture");
  const [details, setDetails] = useState<WorkDetails>(emptyDetails);
  const [drafts, setDrafts] = useState<RecordingDraft[]>([]);
  const [editing, setEditing] = useState<RecordingDraft | null>(null);
  const [saved, setSaved] = useState<RecordingDraft | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingDrafts, setLoadingDrafts] = useState(true);
  const [profile, setProfile] = useState<MobileAccount>(initialAccount);
  const [bootstrap, setBootstrap] = useState<MobileBootstrap | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [remoteLogs, setRemoteLogs] = useState<MobileRemoteLog[]>([]);
  const [remoteLog, setRemoteLog] = useState<MobileRemoteLog | null>(null);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const selectedId = useRef(initialAccount.id);
  const connectionGeneration = useRef(0);
  const draftId = useRef<string | null>(null);
  const saveInProgress = useRef(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const transcription = useTranscription();
  const { clips, transcript, append, load } = transcription;
  const freshRecording = useRef(false);
  const closeAccount = useCallback(() => setAccountOpen(false), []);
  const scrollArea = useRef<ScrollView>(null);
  const online = network.isConnected !== false && network.isInternetReachable !== false;
  const active = recorder.status === "recording" || recorder.status === "paused";
  const busy = active || recorder.status === "requesting" || recorder.status === "stopping";
  const treatment = isTreatment(details.activity);

  useEffect(() => {
    try {
      const cache = readAccounts();
      const storedProfile = cache?.bootstrap.accounts.find(item => item.id === cache.activeId) ?? { ...initialAccount, ...readProfile() };
      setProfile(storedProfile);
      selectedId.current = storedProfile.id;
      if (cache) setBootstrap(cache.bootstrap);
      setDetails({ ...emptyDetails, workDate: localDate(), field: storedProfile.defaultField, activity: storedProfile.defaultActivity });
    } catch {
      setDetails({ ...emptyDetails, workDate: localDate() });
      setError("Account settings could not be loaded.");
    }
    listDrafts().then(setDrafts).catch((cause: Error) => setError(cause.message)).finally(() => setLoadingDrafts(false));
    void refreshAccounts().catch(() => undefined);
    return () => { connectionGeneration.current++; };
  }, []);

  async function refreshAccounts() {
    const generation = ++connectionGeneration.current;
    try {
      const data = await api.accounts();
      if (generation !== connectionGeneration.current) return;
      setBootstrap(data);
      const account = data.accounts.find(item => item.id === selectedId.current);
      if (!account) throw new Error("Your selected account is unavailable. Choose another farm account.");
      saveAccounts(data, account.id);
      setBootstrap(data); setProfile(account); setConnected(true); setConnectionError("");
    } catch (cause) {
      if (generation !== connectionGeneration.current) return;
      setConnected(false);
      const message = cause instanceof Error ? cause.message : "Cannot connect to Toph.";
      setConnectionError(message);
      throw cause;
    }
  }

  async function refreshLogs() {
    const accountId = selectedId.current;
    setLoadingRemote(true);
    try {
      const logs = await api.logs(accountId);
      if (selectedId.current === accountId) { setRemoteLogs(logs); setConnectionError(""); }
    } catch (cause) { if (selectedId.current === accountId) setConnectionError(cause instanceof Error ? cause.message : "Cannot load saved logs."); }
    finally { if (selectedId.current === accountId) setLoadingRemote(false); }
  }

  useEffect(() => {
    scrollArea.current?.scrollTo({ y: 0, animated: false });
  }, [screen]);

  useEffect(() => {
    if (error || recorder.error) scrollArea.current?.scrollTo({ y: 0, animated: true });
  }, [error, recorder.error]);

  // Stop completes asynchronously; upload only after the recorder has finalized its file.
  useEffect(() => {
    if (!freshRecording.current || recorder.status !== "ready" || !recorder.audio) return;
    freshRecording.current = false;
    void append({ audio: recorder.audio, durationSeconds: recorder.seconds, transcript: "" });
  }, [recorder.status, recorder.audio, recorder.seconds, append]);

  function clearTranscript() {
    freshRecording.current = false;
    load([]);
  }

  function appendRecording() {
    transcription.cancel();
    freshRecording.current = false;
    setError("");
    setScreen("capture");
    void recorder.start();
  }

  function change<K extends keyof WorkDetails>(key: K, value: WorkDetails[K]) {
    setDetails((current) => ({ ...current, [key]: value }));
    setError("");
  }

  function newRecording() {
    recorder.reset();
    clearTranscript();
    setEditing(null);
    setSaved(null);
    draftId.current = null;
    setDetails({ ...emptyDetails, workDate: localDate(), field: profile.defaultField, activity: profile.defaultActivity });
    setError("");
    setScreen("capture");
  }

  async function updateProfile(changes: MobileAccountEdit) {
    if (!bootstrap) throw new Error("Connect to Toph before saving account changes.");
    let data: MobileBootstrap;
    try { data = await api.updateAccount(profile.id, changes, bootstrap.revision); }
    catch (cause) {
      if (cause instanceof DemoApiError && cause.status === 409) await refreshAccounts().catch(() => undefined);
      throw cause;
    }
    saveAccounts(data, profile.id);
    const next = data.accounts.find(item => item.id === profile.id)!;
    setBootstrap(data); setProfile(next); setConnected(true); setConnectionError("");
    if (screen === "capture" && recorder.status === "idle") {
      setDetails((current) => ({ ...current, field: next.defaultField, activity: next.defaultActivity }));
    }
  }

  async function switchAccount(next: MobileAccount) {
    if (next.id === profile.id) return;
    if (busy || saving || saveInProgress.current) throw new Error("Finish saving or recording before switching accounts.");
    // Save even incomplete work locally before changing its owner/context.
    if ((screen === "capture" || screen === "review") && !editing?.sync && (clips.length || details.notes.trim() || details.product || details.startTime || details.endTime)) {
      transcription.cancel();
      const stored = await saveDraft(currentDraft());
      rememberDraft(stored);
    }
    if (!bootstrap) throw new Error("Connect to Toph to load accounts.");
    saveAccounts(bootstrap, next.id);
    connectionGeneration.current++;
    selectedId.current = next.id;
    setProfile(next); setRemoteLogs([]); setRemoteLog(null); setLoadingRemote(false);
    recorder.reset(); clearTranscript(); setEditing(null); setSaved(null); draftId.current = null;
    setDetails({ ...emptyDetails, workDate: localDate(), field: next.defaultField, activity: next.defaultActivity });
    setScreen("capture"); setError("");
    void refreshAccounts().catch(() => undefined);
  }

  function finishRecording() {
    if (recorder.isDemo) setDetails({ ...sampleDetails });
    freshRecording.current = !recorder.isDemo;
    void recorder.finish();
    setScreen("review");
  }

  function writeNote() {
    if (!clips.length) {
      recorder.load(null, 0, false);
      clearTranscript();
    }
    setScreen("review");
  }

  function openDraft(draft: RecordingDraft) {
    if (draft.employee.id !== profile.id) return;
    if (draft.sync) {
      const remote = remoteLogs.find(item => item.id === draft.sync?.logId);
      if (remote) { setRemoteLog(remote); setScreen("remote"); return; }
      setSaved(draft); setScreen("saved"); return;
    }
    setDetails({ field: draft.field, activity: draft.activity, workDate: draft.workDate,
      startTime: draft.startTime, endTime: draft.endTime, notes: draft.notes,
      product: draft.product, amount: draft.amount, unit: draft.unit, tags: draft.tags });
    setEditing(draft);
    draftId.current = draft.id;
    setError("");
    recorder.load(draft.audio, draft.durationSeconds, draft.isDemo);
    freshRecording.current = false;
    load(draftClips(draft));
    setScreen("review");
  }

  function openLibrary() {
    setScreen("library");
    setError("");
    void refreshLogs();
  }

  function rememberDraft(stored: RecordingDraft) {
    setDrafts(current => [stored, ...current.filter(item => item.id !== stored.id)]);
    setEditing(stored); setSaved(stored);
  }

  function currentDraft(): RecordingDraft {
    const now = new Date().toISOString();
    if (!draftId.current) draftId.current = editing?.id ?? Crypto.randomUUID();
    return { ...details, notes: details.notes.trim(), product: treatment ? details.product.trim() : "", amount: treatment ? details.amount : "",
      id: draftId.current, createdAt: editing?.createdAt ?? now, updatedAt: now,
      employee: editing?.employee ?? { id: profile.id, name: profile.name }, farmId: editing?.farmId ?? bootstrap?.farm.id ?? "00000000-0000-4000-8000-000000000001",
      transcript: transcript.text, clips, audio: clips[0]?.audio ?? null, durationSeconds: clips.reduce((total, clip) => total + clip.durationSeconds, 0), isDemo: Boolean(editing?.isDemo || recorder.isDemo) };
  }

  async function syncDraft(stored: RecordingDraft) {
    if (stored.sync) return;
    if (!online) throw new Error("Saved on this device. Connect to the internet and tap Sync log to send it to Toph.");
    const data = bootstrap ?? await api.accounts();
    const receipt = await api.submit(stored, data);
    const synced = await saveDraft({ ...stored, sync: { logId: receipt.logId, savedAt: receipt.savedAt } });
    rememberDraft(synced);
    setConnected(true); setConnectionError("");
  }

  async function retrySync() {
    if (!saved || saveInProgress.current) return;
    saveInProgress.current = true; setSaving(true); setError("");
    try { await syncDraft(saved); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Sync failed. Your draft is safe on this device."); }
    finally { saveInProgress.current = false; setSaving(false); }
  }

  async function submit() {
    if (saveInProgress.current || saving || busy || transcript.status === "working") return;
    const problem = validateDetails(details, clips.length > 0);
    if (problem) { setError(problem); return; }
    setSaving(true);
    saveInProgress.current = true;
    setError("");
    const draft = currentDraft();
    try {
      const stored = await saveDraft(draft);
      rememberDraft(stored);
      setScreen("saved");
      if (!stored.isDemo) await syncDraft(stored);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The draft could not be saved. Please try again."); }
    finally { setSaving(false); saveInProgress.current = false; }
  }

  const statusText = recorder.status === "requesting" ? "Connecting…" : recorder.status === "recording" ? (recorder.isDemo ? "Sample recording" : "Recording") : recorder.status === "paused" ? "Paused" : "";
  const noticeMessage = error || recorder.error;
  const accountDrafts = drafts.filter(draft => draft.employee.id === profile.id && draft.farmId === (bootstrap?.farm.id ?? "00000000-0000-4000-8000-000000000001"));
  const visibleRemoteLogs = remoteLogs.filter(log => !accountDrafts.some(draft => draft.sync?.logId === log.id));

  return <View style={styles.app}>
    <View style={styles.appContent} pointerEvents={accountOpen ? "none" : "auto"} accessibilityElementsHidden={accountOpen} importantForAccessibility={accountOpen ? "no-hide-descendants" : "auto"}>
      <View style={[styles.header, { paddingTop: 18 + insets.top, height: 80 + insets.top }]}>
        <Press onPress={newRecording} disabled={busy || saving} accessibilityRole="button" accessibilityLabel="Toph, new recording"><Text style={styles.brand}>toph</Text></Press>
        <Press style={styles.avatarButton} onPress={() => setAccountOpen(true)} disabled={busy || saving} accessibilityRole="button" accessibilityLabel="Open account">
          <ProfileAvatar name={profile.name} uri={profile.avatarUrl} size={38} />
        </Press>
      </View>

      <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView ref={scrollArea} style={styles.main} contentContainerStyle={[styles.mainContent, screen === "capture" ? styles.captureContent : null]} keyboardShouldPersistTaps="handled">
          {screen !== "capture" && <View style={styles.pageHeading}>
            <Text style={shared.heading} accessibilityRole="header">{screen === "saved" && saved?.sync ? "Log saved" : pageTitles[screen]}</Text>
            {screen === "library" && <Pressable style={shared.roundButton} onPress={newRecording} accessibilityRole="button" accessibilityLabel="New recording"><Plus size={20} color={colors.ink} /></Pressable>}
          </View>}
          {!online && <View style={shared.notice} accessibilityLiveRegion="polite"><WifiOff size={17} color={colors.muted} /><Text style={shared.noticeText}>Offline</Text></View>}
          {noticeMessage ? <View style={shared.notice} accessibilityRole="alert"><CircleHelp size={18} color={colors.muted} /><Text style={shared.noticeText}>{noticeMessage}</Text></View> : null}

          {screen === "capture" && <View style={styles.recordCard} accessibilityLabel="Record a log">
            {/* <View style={styles.contextFields}>
              <SelectField style={styles.half} label="Field" value={details.field} values={fields} onChange={(value) => change("field", value)} disabled={busy} />
              <SelectField style={styles.half} label="Activity" value={details.activity} values={activities} onChange={(value) => change("activity", value)} disabled={busy} />
            </View> */}
            <View style={styles.recorder}>
              <View style={styles.recorderStatus} accessibilityLiveRegion="polite">
                <Text style={shared.quietText}>{statusText}</Text>
              </View>
              <Text style={styles.timer} accessibilityLabel={`${Math.floor(recorder.seconds)} seconds recorded`}>{clock(recorder.seconds)}</Text>
              <View style={styles.waveform} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {recorder.levels.map((level, index) => <View key={index} style={[styles.bar, active ? styles.barActive : null, { height: Math.round(active ? level : 3 + Math.abs(Math.sin(index * 0.64)) * 8) }]} />)}
              </View>
              <View style={styles.recordControls}>
                <View style={styles.sideControl}>
                  {active && <Pressable style={shared.roundButton} onPress={recorder.status === "paused" ? recorder.resume : recorder.pause} accessibilityRole="button" accessibilityLabel={recorder.status === "paused" ? "Resume recording" : "Pause recording"}>
                    {recorder.status === "paused" ? <Play size={20} color={colors.ink} /> : <Pause size={20} color={colors.ink} />}
                  </Pressable>}
                </View>
                <View style={styles.recordRing}>
                  <Press style={styles.recordButton} disabled={recorder.status === "requesting"} onPress={active ? finishRecording : appendRecording} accessibilityRole="button" accessibilityLabel={active ? "Finish recording" : "Start recording"}>
                    {recorder.status === "paused" ? <Text style={shared.primaryText}>Finish</Text> : active ? <Square size={26} color={colors.white} fill={colors.white} strokeWidth={0} /> : <Mic size={32} color={colors.white} strokeWidth={1.7} />}
                  </Press>
                </View>
                <View style={styles.sideControl}>
                  {(active || recorder.status === "requesting") && <Press style={shared.quietButton} onPress={newRecording} accessibilityRole="button" accessibilityLabel="Cancel recording"><Text style={shared.quietText}>Cancel</Text></Press>}
                </View>
              </View>
            </View>
            {clips.length > 0 && !busy && <Press style={shared.quietButton} onPress={() => setScreen("review")} accessibilityRole="button"><Text style={shared.quietText}>Return to review</Text></Press>}
            <Press style={[shared.quietButton, styles.noteButton]} onPress={writeNote} disabled={busy} accessibilityRole="button"><FileText size={17} color={colors.muted} /><Text style={shared.quietText}>Write a note</Text></Press>
          </View>}

          {screen === "review" && <ReviewLog details={details} clips={clips} isDemo={recorder.isDemo} transcript={transcript}
            fieldOptions={bootstrap?.fields.map(field => field.name)}
            loading={recorder.status === "stopping" || transcript.status === "working"} stopping={recorder.status === "stopping"}
            saving={saving} editing={Boolean(editing)} onChange={change} onError={setError}
            onRetry={() => void transcription.run()} onCancel={transcription.cancel} onAppend={appendRecording}
            onBack={newRecording} onSave={() => void submit()} />}

          {screen === "saved" && saved && <View style={styles.successCard} accessibilityLabel="Saved draft">
            <View style={styles.successIcon}><CheckCheck size={36} color={colors.green} strokeWidth={1.6} /></View>
            <View style={styles.savedSummary}>
              <Text style={styles.savedTitle}>{saved.activity} · {fieldLabel(saved.field)}</Text>
              <Text style={[shared.muted, styles.centered]}>{dateLabel(saved.workDate)} · {saved.audio ? clock(saved.durationSeconds) : "Note"}</Text>
            </View>
            <Text style={[shared.muted, styles.centered]}>{saved.sync ? "Saved to Toph and available on the dashboard." : saving ? "Syncing to Toph…" : "Draft kept on this device."}</Text>
            {!saved.sync && !saved.isDemo && <Press style={shared.primaryButton} onPress={() => void retrySync()} disabled={saving} accessibilityRole="button"><CloudUpload size={18} color={colors.white} /><Text style={shared.primaryText}>{saving ? "Syncing…" : "Sync log"}</Text></Press>}
            <Press style={shared.primaryButton} onPress={newRecording} disabled={saving} accessibilityRole="button"><Plus size={18} color={colors.white} /><Text style={shared.primaryText}>New recording</Text></Press>
            <Pressable style={shared.quietButton} onPress={openLibrary} accessibilityRole="button"><Text style={shared.quietText}>View logs</Text><ArrowRight size={16} color={colors.muted} /></Pressable>
          </View>}

          {screen === "library" && <View accessibilityLabel="Saved logs">
            <Text style={shared.muted}>{profile.name}</Text>
            <Press style={shared.quietButton} onPress={() => void refreshLogs()} disabled={loadingRemote} accessibilityRole="button"><RefreshCw size={16} color={colors.muted} /><Text style={shared.quietText}>{loadingRemote ? "Loading saved logs…" : "Refresh logs"}</Text></Press>
            {connectionError ? <Text style={shared.muted}>{connectionError}</Text> : null}
            {loadingDrafts ? <Text style={shared.text} accessibilityLiveRegion="polite">Loading…</Text> : accountDrafts.length || visibleRemoteLogs.length ? <View>{accountDrafts.map((draft) => <Pressable style={styles.draftRow} key={draft.id} onPress={() => openDraft(draft)} accessibilityRole="button">
              <View style={styles.draftIcon}>{draft.audio ? <AudioLines size={21} color={colors.muted} /> : <FileText size={21} color={colors.muted} />}</View>
              <View style={styles.draftText}>
                <Text style={styles.draftTitle}>{draft.activity} · {fieldLabel(draft.field)}</Text>
                <Text style={styles.draftMeta}>{dateLabel(draft.workDate)} · {draft.isDemo ? "Sample" : draft.sync ? "Synced" : "On this device"} · {draft.audio ? clock(draft.durationSeconds) : "Note"}</Text>
              </View>
              <ArrowRight size={16} color={colors.ink} />
            </Pressable>)}{visibleRemoteLogs.map(log => <Pressable style={styles.draftRow} key={log.id} onPress={() => { setRemoteLog(log); setScreen("remote"); }} accessibilityRole="button">
              <View style={styles.draftIcon}><CheckCheck size={21} color={colors.green} /></View><View style={styles.draftText}><Text style={styles.draftTitle}>{log.activity} · {fieldLabel(log.field.name)}</Text><Text style={styles.draftMeta}>{dateLabel(log.date)} · On Toph</Text></View><ArrowRight size={16} color={colors.ink} />
            </Pressable>)}</View> : <View style={styles.emptyState}>
              <AudioLines size={32} color={colors.soft} />
              <Text style={shared.heading}>No logs yet</Text>
              <Pressable style={shared.primaryButton} onPress={newRecording} accessibilityRole="button"><Mic size={17} color={colors.white} /><Text style={shared.primaryText}>Record</Text></Pressable>
            </View>}
          </View>}
          {screen === "remote" && remoteLog && <View style={{ gap: spacing.lg }}>
            <Text style={shared.heading}>{remoteLog.activity} · {fieldLabel(remoteLog.field.name)}</Text>
            <Text style={shared.muted}>{dateLabel(remoteLog.date)} · {remoteLog.employee.name}</Text>
            <Text style={shared.text}>{remoteLog.notes}</Text>
            {remoteLog.treatment && <><Text style={shared.label}>Treatment</Text><Text style={shared.text}>{[remoteLog.treatment.product, remoteLog.treatment.amount, remoteLog.treatment.unit].filter(value => value !== null).join(" ")}</Text></>}
            {remoteLog.transcript && <><Text style={shared.label}>Transcript</Text><Text style={shared.text}>{remoteLog.transcript}</Text></>}
            {(remoteLog.clips.length ? remoteLog.clips : remoteLog.recording ? [{ url: remoteLog.recording.url, durationSeconds: remoteLog.recording.durationSeconds ?? 0, mimeType: "audio/mpeg" }] : []).map((clip, index) => <AudioReview key={clip.url} title={`Recording ${index + 1}`} audio={{ uri: assetUrl(clip.url)!, mimeType: clip.mimeType, extension: clip.mimeType === "audio/mpeg" ? "mp3" : "m4a" }} seconds={clip.durationSeconds} isDemo={false} fileName={`toph-${remoteLog.id}-${index}.m4a`} onError={setError} />)}
            <Press style={shared.quietButton} onPress={openLibrary} accessibilityRole="button"><ArrowLeft size={16} color={colors.muted} /><Text style={shared.quietText}>Back to logs</Text></Press>
          </View>}
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[styles.navigation, { paddingBottom: Math.max(5, insets.bottom) }]} accessibilityRole="tablist">
        <Press style={styles.navButton} onPress={() => setScreen(clips.length > 0 || recorder.status === "ready" ? "review" : "capture")} disabled={busy || saving} accessibilityRole="tab" accessibilityState={{ selected: screen !== "library" }}>
          <Mic size={22} color={screen !== "library" ? colors.ink : colors.soft} strokeWidth={1.6} />
          <Text style={[styles.navLabel, screen !== "library" ? styles.navActive : null]}>Record</Text>
        </Press>
        <Press style={styles.navButton} onPress={openLibrary} disabled={busy || saving} accessibilityRole="tab" accessibilityState={{ selected: screen === "library" }}>
          <AudioLines size={22} color={screen === "library" ? colors.ink : colors.soft} strokeWidth={1.6} />
          <Text style={[styles.navLabel, screen === "library" ? styles.navActive : null]}>Logs</Text>
        </Press>
      </View>
    </View>
    {accountOpen && <AccountSheet profile={profile} accounts={bootstrap?.accounts ?? []} fields={bootstrap?.fields.map(field => field.name) ?? fields} farmName={bootstrap?.farm.name ?? "Bays Ranch"} connected={connected} connectionError={connectionError} onRefresh={refreshAccounts} onSwitch={switchAccount} logCount={accountDrafts.length + visibleRemoteLogs.length} onClose={closeAccount} onSave={updateProfile} onViewLogs={() => { setAccountOpen(false); openLibrary(); }} />}
  </View>;
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.white },
  appContent: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.xl, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  brand: { fontFamily: fonts.semibold, fontSize: 30, lineHeight: 36, letterSpacing: -1.5, color: colors.ink },
  avatarButton: { width: 44, height: 44, padding: 3, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatar: { width: 38, height: 38, borderRadius: 19 },
  body: { flex: 1 },
  main: { flex: 1 },
  mainContent: { paddingTop: spacing.xl, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  captureContent: { flexGrow: 1 },
  pageHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 28, marginBottom: spacing.xl },
  recordCard: { flex: 1, minHeight: 385 },
  contextFields: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-end" },
  half: { flex: 1 },
  recorder: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 295, paddingTop: 22, paddingBottom: 134 },
  recorderStatus: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 18 },
  timer: { fontFamily: fonts.regular, fontSize: fontSize.metric, lineHeight: 58, letterSpacing: -1.5, color: colors.ink, fontVariant: ["tabular-nums"], marginTop: 6, marginBottom: 10 },
  waveform: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3, alignSelf: "stretch", height: 54, marginBottom: 30, overflow: "hidden" },
  bar: { width: 2, borderRadius: 2, backgroundColor: colors.bar },
  barActive: { backgroundColor: colors.green },
  recordControls: { flexDirection: "row", alignItems: "center", gap: 26 },
  sideControl: { width: 64, alignItems: "center" },
  recordRing: { width: 94, height: 94, borderRadius: 47, backgroundColor: colors.line, alignItems: "center", justifyContent: "center" },
  recordButton: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" },
  noteButton: { alignSelf: "center" },
  successCard: { alignItems: "center", paddingTop: 58, paddingBottom: spacing.xl, gap: spacing.lg },
  successIcon: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.greenTint, alignItems: "center", justifyContent: "center" },
  savedSummary: { alignItems: "center", gap: spacing.xs, marginTop: spacing.xxs, marginBottom: spacing.md },
  savedTitle: { fontFamily: fonts.medium, fontSize: fontSize.control, lineHeight: lineHeight.control, color: colors.ink, textAlign: "center" },
  centered: { textAlign: "center" },
  draftRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: colors.line },
  draftIcon: { width: 40, height: 44, borderWidth: 1, borderColor: colors.line, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  draftText: { flex: 1, gap: 6 },
  draftTitle: { fontFamily: fonts.medium, fontSize: fontSize.body, lineHeight: lineHeight.body, color: colors.ink },
  draftMeta: { fontFamily: fonts.regular, fontSize: fontSize.caption, lineHeight: lineHeight.caption, color: colors.muted },
  emptyState: { alignItems: "center", gap: spacing.xl, paddingTop: 90, paddingBottom: spacing.xl },
  navigation: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 9, paddingHorizontal: spacing.xl, backgroundColor: colors.white },
  navButton: { flex: 1, alignItems: "center", justifyContent: "center", gap: 5, minHeight: 54 },
  navLabel: { fontFamily: fonts.regular, fontSize: fontSize.caption, lineHeight: lineHeight.caption, color: colors.soft },
  navActive: { fontFamily: fonts.medium, color: colors.ink },
});
