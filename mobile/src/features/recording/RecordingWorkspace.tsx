import * as Crypto from "expo-crypto";
import { useNetworkState } from "expo-network";
import {
  ArrowLeft, ArrowRight, AudioLines, CheckCheck, CircleHelp, CloudUpload, FileText, MessageSquare, Mic, Pause, Play, Plus, RefreshCw, Square, WifiOff,
} from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import type { MobileAccount, MobileAccountEdit, MobileBootstrap, MobileRemoteLog } from "@toph/contracts/mobile";
import type { AccountSession } from "@toph/contracts/accounts";
import { assetHeaders, assetUrl, createMobileClient, MobileApiError } from "@/lib/api/mobile-client";
import { sessionAccount } from "@/features/accounts/session-account";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AccountSheet from "./AccountSheet";
import ReviewLog from "./ReviewLog";
import AudioReview from "./AudioReview";
import ProfileAvatar from "./ProfileAvatar";
import { Press } from "./fields";
import { draftClips, listDrafts, saveDraft, type RecordingDraft } from "./local-drafts";
import {
  clock, dateLabel, emptyDetails, fieldLabel, localDate, validateDetails, type WorkDetails,
} from "./recording-utils";
import { colors, fonts, shared, fontSize, lineHeight, spacing } from "./styles";
import { useTranscription } from "./use-transcription";
import { useRecorder } from "./use-recorder";
import { applyExtractedDetails } from "./extracted-details";
import { activityDetailSummary, activityForm } from "./activity-forms";
import { saveActivityItem } from "./activity-catalog";
import type { ExtractedLogFields } from "@toph/contracts/transcription";
import HandsFreeScreen from "./hands-free/HandsFreeScreen";
import { readHandsFreePreference, saveHandsFreePreference } from "./hands-free/preference";
import type { SaveOutcome } from "./hands-free/turn-loop";
import { useHandsFree } from "./hands-free/use-hands-free";
import InboxSheet from "../messages/InboxSheet";
import { useInbox } from "../messages/use-inbox";

type Screen = "capture" | "review" | "saved" | "library" | "remote";
const pageTitles: Record<Exclude<Screen, "review">, string> = { capture: "Record", saved: "Draft saved", library: "Logs", remote: "Saved log" };
const api = createMobileClient();
type Props = { session: AccountSession; initialBootstrap: MobileBootstrap; onSignOut: () => Promise<void> };

export default function RecordingWorkspace({ session, initialBootstrap, onSignOut }: Props) {
  const initialAccount = sessionAccount(initialBootstrap, session);
  const catalogScope = `${session.farm.id}:${session.account.id}`;
  const recorder = useRecorder();
  const insets = useSafeAreaInsets();
  const network = useNetworkState();
  const [screen, setScreen] = useState<Screen>("capture");
  // True once the form on screen has been saved as a log; Record then starts over instead of reopening it.
  const workSaved = useRef(false);
  const [details, setDetails] = useState<WorkDetails>(() => ({ ...emptyDetails, workDate: localDate(), field: initialAccount.defaultField, activity: initialAccount.defaultActivity, unit: activityForm(initialAccount.defaultActivity).units?.[0] ?? "" }));
  const [drafts, setDrafts] = useState<RecordingDraft[]>([]);
  const [editing, setEditing] = useState<RecordingDraft | null>(null);
  const [saved, setSaved] = useState<RecordingDraft | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingDrafts, setLoadingDrafts] = useState(true);
  const [profile, setProfile] = useState<MobileAccount>(initialAccount);
  const [bootstrap, setBootstrap] = useState<MobileBootstrap>(initialBootstrap);
  const [connected, setConnected] = useState(true);
  const [connectionError, setConnectionError] = useState("");
  const [remoteLogs, setRemoteLogs] = useState<MobileRemoteLog[]>([]);
  const [remoteLog, setRemoteLog] = useState<MobileRemoteLog | null>(null);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const selectedId = useRef(initialAccount.id);
  const connectionGeneration = useRef(0);
  const draftId = useRef<string | null>(null);
  const saveInProgress = useRef(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const editedFields = useRef(new Set<keyof WorkDetails>());
  const previousSuggestions = useRef<ExtractedLogFields | null>(null);
  function applyFields(fields: ExtractedLogFields) {
    const previous = previousSuggestions.current;
    previousSuggestions.current = fields;
    setDetails(current => applyExtractedDetails(current, fields, bootstrap?.fields ?? [], editedFields.current, previous));
    if (fields.activity && fields.product && activityForm(fields.activity).itemLabel) {
      try { saveActivityItem(fields.activity, fields.product, catalogScope); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "This choice could not be saved on your device."); }
    }
  }
  const voiceContext = { accountId: profile.id, referenceDate: details.workDate || localDate() };
  const transcription = useTranscription({ context: voiceContext, onFields: applyFields });
  const { clips, transcript, append, load } = transcription;
  const [handsFreeOn, setHandsFreeOn] = useState(readHandsFreePreference);
  // A spoken "save" waits here until the form has rendered the last extracted details, then runs Save log.
  const [voiceSave, setVoiceSave] = useState<{ done: (outcome: SaveOutcome) => void } | null>(null);
  const handsFree = useHandsFree({
    context: voiceContext, recorder, appendClip: transcription.appendClip, loadTranscript: load, applyFields,
    save: () => new Promise<SaveOutcome>(done => setVoiceSave({ done })),
    onReset: newRecording,
    onReview: message => { setScreen("review"); if (message) setError(message); },
  });
  const freshRecording = useRef(false);
  const closeAccount = useCallback(() => setAccountOpen(false), []);
  const scrollArea = useRef<ScrollView>(null);
  const online = network.isConnected !== false && network.isInternetReachable !== false;
  const inbox = useInbox(profile.id, inboxOpen, online);
  const active = recorder.status === "recording" || recorder.status === "paused";
  const busy = active || recorder.status === "requesting" || recorder.status === "stopping";

  useEffect(() => {
    listDrafts().then(setDrafts).catch((cause: Error) => setError(cause.message)).finally(() => setLoadingDrafts(false));
    return () => { connectionGeneration.current++; };
  }, []);

  async function refreshAccounts() {
    const generation = ++connectionGeneration.current;
    try {
      const data = await api.accounts();
      if (generation !== connectionGeneration.current) return;
      const account = sessionAccount(data, session);
      setBootstrap(data); setProfile(account); setConnected(true); setConnectionError("");
      if (screen === "capture" && recorder.status === "idle") setDetails(current => ({ ...current, field: data.fields.some(field => field.name === current.field) ? current.field : account.defaultField }));
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
    editedFields.current.clear();
    previousSuggestions.current = null;
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
    editedFields.current.add(key);
    if (key === "activity" && value !== details.activity) {
      for (const field of ["product", "amount", "unit"] as const) editedFields.current.delete(field);
      setDetails(current => ({ ...current, activity: value as string, product: "", amount: "", unit: activityForm(value as string).units?.[0] ?? "" }));
    } else setDetails((current) => ({ ...current, [key]: value }));
    setError("");
  }

  function newRecording() {
    workSaved.current = false;
    recorder.reset();
    clearTranscript();
    setEditing(null);
    setSaved(null);
    draftId.current = null;
    setDetails({ ...emptyDetails, workDate: localDate(), field: profile.defaultField, activity: profile.defaultActivity, unit: activityForm(profile.defaultActivity).units?.[0] ?? "" });
    setError("");
    setScreen("capture");
  }

  async function updateProfile(changes: MobileAccountEdit) {
    if (!bootstrap) throw new Error("Connect to Toph before saving account changes.");
    let data: MobileBootstrap;
    try { data = await api.updateAccount(profile.id, changes, bootstrap.revision); }
    catch (cause) {
      if (cause instanceof MobileApiError && cause.status === 409) await refreshAccounts().catch(() => undefined);
      throw cause;
    }
    const next = sessionAccount(data, session);
    setBootstrap(data); setProfile(next); setConnected(true); setConnectionError("");
    if (screen === "capture" && recorder.status === "idle") {
      setDetails((current) => ({ ...current, field: next.defaultField, activity: next.defaultActivity, unit: activityForm(next.defaultActivity).units?.[0] ?? "" }));
    }
  }

  async function signOut() {
    if (busy || saving || saveInProgress.current) throw new Error("Finish saving or recording before signing out.");
    // Keep even incomplete work under this farm and author before ending the session.
    if ((screen === "capture" || screen === "review") && !editing?.sync && (clips.length || details.notes.trim() || details.product || details.startTime || details.endTime)) {
      transcription.cancel();
      const stored = await saveDraft(currentDraft());
      rememberDraft(stored);
    }
    connectionGeneration.current++;
    transcription.cancel();
    await onSignOut();
  }

  function finishRecording() {
    freshRecording.current = true;
    void recorder.finish();
    setScreen("review");
  }

  function writeNote() {
    if (!clips.length) {
      recorder.load(null, 0);
      clearTranscript();
    }
    setScreen("review");
  }

  function openDraft(draft: RecordingDraft) {
    if (draft.employee.id !== profile.id || draft.farmId !== session.farm.id) return;
    if (draft.sync) {
      const remote = remoteLogs.find(item => item.id === draft.sync?.logId);
      if (remote) { setRemoteLog(remote); setScreen("remote"); return; }
      setSaved(draft); setScreen("saved"); return;
    }
    editedFields.current = new Set((Object.keys(emptyDetails) as (keyof WorkDetails)[]).filter(key => Array.isArray(draft[key]) ? draft[key].length > 0 : Boolean(draft[key])));
    previousSuggestions.current = null;
    setDetails({ field: draft.field, activity: draft.activity, workDate: draft.workDate,
      startTime: draft.startTime, endTime: draft.endTime, notes: draft.notes,
      product: draft.product, amount: draft.amount, unit: draft.unit, tags: draft.tags });
    setEditing(draft);
    draftId.current = draft.id;
    setError("");
    recorder.load(draft.audio, draft.durationSeconds);
    workSaved.current = false;
    freshRecording.current = false;
    load(draftClips(draft));
    setScreen("review");
  }

  function openRecord() {
    if (workSaved.current) { newRecording(); return; }
    setScreen(clips.length > 0 || recorder.status === "ready" ? "review" : "capture");
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
    const form = activityForm(details.activity);
    return { ...details, notes: details.notes.trim(), product: form.itemLabel ? details.product.trim() : "", amount: form.quantityLabel ? details.amount : "",
      id: draftId.current, createdAt: editing?.createdAt ?? now, updatedAt: now,
      employee: editing?.employee ?? { id: profile.id, name: profile.name }, farmId: editing?.farmId ?? session.farm.id,
      transcript: transcript.text, clips, audio: clips[0]?.audio ?? null, durationSeconds: clips.reduce((total, clip) => total + clip.durationSeconds, 0) };
  }

  async function syncDraft(stored: RecordingDraft) {
    if (stored.sync) return;
    if (!online) throw new Error("Saved on this device. Connect to the internet and tap Sync log to send it to Toph.");
    if (stored.employee.id !== profile.id || stored.farmId !== session.farm.id) throw new Error("Sign in to this draft’s original farm account to sync it.");
    const data = bootstrap;
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

  /** Save log. The outcome is what hands-free mode tells the worker; the form itself shows the same message. */
  async function submit(): Promise<SaveOutcome> {
    if (saveInProgress.current || saving || busy || transcript.status === "working") return { stored: false, synced: false, error: "The log is still being prepared." };
    const problem = bootstrap.fields.length ? validateDetails(details, clips.length > 0) : (!clips.length && !details.notes.trim() ? "Add a note or recording to keep a device draft." : "");
    if (problem) { setError(problem); return { stored: false, synced: false, error: problem }; }
    setSaving(true);
    saveInProgress.current = true;
    setError("");
    const draft = currentDraft();
    let kept = false;
    try {
      if (draft.product) saveActivityItem(draft.activity, draft.product, catalogScope);
      const stored = await saveDraft(draft);
      rememberDraft(stored);
      workSaved.current = true;
      kept = true;
      setScreen("saved");
      if (bootstrap.fields.length) await syncDraft(stored);
      return { stored: true, synced: bootstrap.fields.length > 0, error: "" };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The draft could not be saved. Please try again.";
      setError(message);
      return { stored: kept, synced: false, error: message };
    } finally { setSaving(false); saveInProgress.current = false; }
  }

  useEffect(() => {
    if (!voiceSave) return;
    setVoiceSave(null);
    void submit().then(voiceSave.done);
  });

  function toggleHandsFree(next: boolean) {
    setHandsFreeOn(next);
    saveHandsFreePreference(next);
  }

  const statusText = recorder.status === "requesting" ? "Starting microphone…" : recorder.status === "recording" ? "Recording" : recorder.status === "paused" ? "Paused" : "";
  const noticeMessage = error || recorder.error;
  const accountDrafts = drafts.filter(draft => draft.employee.id === profile.id && draft.farmId === session.farm.id);
  const visibleRemoteLogs = remoteLogs.filter(log => !accountDrafts.some(draft => draft.sync?.logId === log.id));
  const localRemoteDraft = remoteLog ? accountDrafts.find(draft => draft.sync?.logId === remoteLog.id) : undefined;
  const handsFreeOpen = handsFree.phase !== "idle";
  // Hands-free starts an empty log, so it is offered only while there is nothing to lose.
  const handsFreeReady = handsFreeOn && !handsFreeOpen && !busy && clips.length === 0 && !editing;
  const covered = accountOpen || handsFreeOpen;

  return <View style={styles.app}>
    <View style={styles.appContent} pointerEvents={covered ? "none" : "auto"} accessibilityElementsHidden={covered} importantForAccessibility={covered ? "no-hide-descendants" : "auto"}>
      <View style={[styles.header, { paddingTop: 18 + insets.top, height: 80 + insets.top }]}>
        <Press onPress={newRecording} disabled={busy || saving} accessibilityRole="button" accessibilityLabel="Toph, new recording"><Text style={styles.brand}>toph</Text></Press>
        <Text style={styles.farmName} numberOfLines={1}>{session.farm.name}</Text>
        <Press style={styles.avatarButton} onPress={() => setAccountOpen(true)} disabled={busy || saving} accessibilityRole="button" accessibilityLabel="Open account">
          <ProfileAvatar name={profile.name} uri={profile.avatarUrl} size={38} />
        </Press>
      </View>

      <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView ref={scrollArea} style={styles.main} contentContainerStyle={[styles.mainContent, screen === "capture" ? styles.captureContent : null]} keyboardShouldPersistTaps="handled">
          {screen !== "capture" && screen !== "review" && <View style={styles.pageHeading}>
            <Text style={shared.heading} accessibilityRole="header">{screen === "saved" && saved?.sync ? "Log saved" : pageTitles[screen]}</Text>
            {screen === "library" && <View style={styles.headingActions}>
              <Press style={shared.roundButton} onPress={() => void refreshLogs()} disabled={loadingRemote} accessibilityRole="button" accessibilityLabel={loadingRemote ? "Loading saved logs" : "Refresh logs"}>{loadingRemote ? <ActivityIndicator color={colors.ink} /> : <RefreshCw size={18} color={colors.ink} />}</Press>
              <Pressable style={shared.roundButton} onPress={newRecording} accessibilityRole="button" accessibilityLabel="New recording"><Plus size={20} color={colors.ink} /></Pressable>
            </View>}
          </View>}
          {!online && <View style={shared.notice} accessibilityLiveRegion="polite"><WifiOff size={17} color={colors.muted} /><Text style={shared.noticeText}>Offline</Text></View>}
          {noticeMessage ? <View style={shared.notice} accessibilityRole="alert"><CircleHelp size={18} color={colors.muted} /><Text style={shared.noticeText}>{noticeMessage}</Text></View> : null}
          {!bootstrap.fields.length && <View style={shared.notice}><Text style={shared.noticeText}>Your farm admin is setting up the fields. You can keep recordings as device drafts until fields are ready.</Text><Press onPress={() => void refreshAccounts().catch(() => undefined)} accessibilityRole="button" accessibilityLabel="Refresh fields"><RefreshCw size={18} color={colors.muted} /></Press></View>}

          {screen === "capture" && <View style={styles.recordCard} accessibilityLabel="Record a log">
            {/* <View style={styles.contextFields}>
              <SelectField style={styles.half} label="Field" value={details.field} values={fields} onChange={(value) => change("field", value)} disabled={busy} />
              <SelectField style={styles.half} label="Activity" value={details.activity} values={activities} onChange={(value) => change("activity", value)} disabled={busy} />
            </View> */}
            <View style={styles.handsFreeRow}>
              <Text style={shared.text}>Hands-free</Text>
              <Switch value={handsFreeOn} onValueChange={toggleHandsFree} disabled={busy} trackColor={{ true: colors.green, false: colors.border }} accessibilityLabel="Hands-free" accessibilityHint="Record and save a log by voice, without touching the screen" />
            </View>
            {handsFreeReady ? <HandsFreeScreen {...handsFree} fullScreen={false} onPress={() => void handsFree.start()} onReview={() => handsFree.stop(true)} /> : <View style={styles.recorder}>
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
            </View>}
            {clips.length > 0 && !busy && <Press style={shared.quietButton} onPress={() => setScreen("review")} accessibilityRole="button"><Text style={shared.quietText}>Return to review</Text></Press>}
            <Press style={[shared.quietButton, styles.noteButton]} onPress={writeNote} disabled={busy} accessibilityRole="button"><FileText size={17} color={colors.muted} /><Text style={shared.quietText}>Write a note</Text></Press>
          </View>}

          {screen === "review" && <ReviewLog details={details} clips={clips} transcript={transcript}
            catalogScope={catalogScope}
            extractedFields={transcription.extractedFields}
            fieldOptions={bootstrap?.fields.map(field => field.name)}
            loading={recorder.status === "stopping" || transcript.status === "working"} stopping={recorder.status === "stopping"}
            saving={saving} editing={Boolean(editing)} onChange={change}
            onRetry={() => void transcription.run()} onCancel={transcription.cancel} onAppend={appendRecording}
            onBack={newRecording} onSave={() => void submit()} />}

          {screen === "saved" && saved && <View style={styles.successCard} accessibilityLabel="Saved draft">
            <View style={styles.successIcon}><CheckCheck size={36} color={colors.green} strokeWidth={1.6} /></View>
            <View style={styles.savedSummary}>
              <Text style={styles.savedTitle}>{saved.activity} · {fieldLabel(saved.field)}</Text>
              <Text style={[shared.muted, styles.centered]}>{dateLabel(saved.workDate)} · {saved.audio ? clock(saved.durationSeconds) : "Note"}</Text>
              {activityDetailSummary(saved) ? <Text style={[shared.text, styles.centered]}>{activityDetailSummary(saved)}</Text> : null}
            </View>
            {!saved.sync && <Text style={[shared.muted, styles.centered]}>{saving ? "Syncing…" : "Saved on device"}</Text>}
            {!saved.sync && bootstrap.fields.length > 0 && <Press style={shared.primaryButton} onPress={() => void retrySync()} disabled={saving} accessibilityRole="button"><CloudUpload size={18} color={colors.white} /><Text style={shared.primaryText}>{saving ? "Syncing…" : "Sync log"}</Text></Press>}
            <Press style={shared.primaryButton} onPress={newRecording} disabled={saving} accessibilityRole="button"><Plus size={18} color={colors.white} /><Text style={shared.primaryText}>New recording</Text></Press>
            <Pressable style={shared.quietButton} onPress={openLibrary} accessibilityRole="button"><Text style={shared.quietText}>View logs</Text><ArrowRight size={16} color={colors.muted} /></Pressable>
          </View>}

          {screen === "library" && <View accessibilityLabel="Saved logs">
            {connectionError ? <Text style={shared.muted}>{connectionError}</Text> : null}
            {loadingDrafts ? <Text style={shared.text} accessibilityLiveRegion="polite">Loading…</Text> : accountDrafts.length || visibleRemoteLogs.length ? <View>{accountDrafts.map((draft) => <Pressable style={styles.draftRow} key={draft.id} onPress={() => openDraft(draft)} accessibilityRole="button">
              <View style={styles.draftIcon}>{draft.audio ? <AudioLines size={21} color={colors.muted} /> : <FileText size={21} color={colors.muted} />}</View>
              <View style={styles.draftText}>
                <Text style={styles.draftTitle}>{draft.activity} · {fieldLabel(draft.field)}</Text>
                <Text style={styles.draftMeta}>{dateLabel(draft.workDate)} · {draft.sync ? "Synced" : "On this device"} · {draft.audio ? clock(draft.durationSeconds) : "Note"}</Text>
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
            <Text style={shared.muted}>{dateLabel(remoteLog.date)}</Text>
            <Text style={shared.text}>{remoteLog.notes}</Text>
            {remoteLog.treatment && <><Text style={shared.label}>Treatment</Text><Text style={shared.text}>{[remoteLog.treatment.product, remoteLog.treatment.amount, remoteLog.treatment.unit].filter(value => value !== null).join(" ")}</Text></>}
            {!remoteLog.treatment && localRemoteDraft && activityDetailSummary(localRemoteDraft) ? <Text style={shared.text}>{activityDetailSummary(localRemoteDraft)}</Text> : null}
            {remoteLog.transcript && <><Text style={shared.label}>Transcript</Text><Text style={shared.text}>{remoteLog.transcript}</Text></>}
            {(remoteLog.clips.length ? remoteLog.clips : remoteLog.recording ? [{ url: remoteLog.recording.url, durationSeconds: remoteLog.recording.durationSeconds ?? 0, mimeType: "audio/mpeg" }] : []).map((clip, index) => <AudioReview key={clip.url} title={`Recording ${index + 1}`} headers={assetHeaders(assetUrl(clip.url)!)} audio={{ uri: assetUrl(clip.url)!, mimeType: clip.mimeType, extension: clip.mimeType === "audio/mpeg" ? "mp3" : "m4a" }} seconds={clip.durationSeconds} />)}
            <Press style={shared.quietButton} onPress={openLibrary} accessibilityRole="button"><ArrowLeft size={16} color={colors.muted} /><Text style={shared.quietText}>Back to logs</Text></Press>
          </View>}
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[styles.navigation, { paddingBottom: Math.max(5, insets.bottom) }]} accessibilityRole="tablist">
        <Press style={styles.navButton} onPress={openRecord} disabled={busy || saving} accessibilityRole="tab" accessibilityState={{ selected: screen !== "library" }}>
          <Mic size={22} color={screen !== "library" ? colors.ink : colors.soft} strokeWidth={1.6} />
          <Text style={[styles.navLabel, screen !== "library" ? styles.navActive : null]}>Record</Text>
        </Press>
        <Press style={styles.navButton} onPress={openLibrary} disabled={busy || saving} accessibilityRole="tab" accessibilityState={{ selected: screen === "library" }}>
          <AudioLines size={22} color={screen === "library" ? colors.ink : colors.soft} strokeWidth={1.6} />
          <Text style={[styles.navLabel, screen === "library" ? styles.navActive : null]}>Logs</Text>
        </Press>
        <Press style={styles.navButton} onPress={() => setInboxOpen(true)} disabled={busy || saving} accessibilityRole="tab" accessibilityLabel={`Inbox${inbox.unreadCount ? `, ${inbox.unreadCount} unread` : ""}`} accessibilityState={{ selected: inboxOpen }}>
          <View><MessageSquare size={22} color={colors.soft} strokeWidth={1.6} />{inbox.unreadCount > 0 && <View style={styles.inboxBadge}><Text style={styles.inboxBadgeText}>{inbox.unreadCount > 99 ? "99+" : inbox.unreadCount}</Text></View>}</View>
          <Text style={styles.navLabel}>Inbox</Text>
        </Press>
      </View>
    </View>
    {accountOpen && <AccountSheet profile={profile} fields={bootstrap.fields.map(field => field.name)} farmName={session.farm.name} connected={connected} connectionError={connectionError} onRefresh={refreshAccounts} onSignOut={signOut} logCount={accountDrafts.length + visibleRemoteLogs.length} onClose={closeAccount} onSave={updateProfile} onViewLogs={() => { setAccountOpen(false); openLibrary(); }} />}
    {handsFreeOpen && <HandsFreeScreen {...handsFree} fullScreen onPress={() => handsFree.stop()} onReview={() => handsFree.stop(true)} />}
    <InboxSheet visible={inboxOpen} onClose={() => setInboxOpen(false)} employeeId={profile.id} farmName={session.farm.name} online={online} inbox={inbox} />
  </View>;
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.white },
  appContent: { flex: 1 },
  headingActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.xl, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  brand: { fontFamily: fonts.semibold, fontSize: 30, lineHeight: 36, letterSpacing: -1.5, color: colors.ink },
  farmName: { flex: 1, paddingHorizontal: spacing.md, fontFamily: fonts.regular, fontSize: fontSize.caption, lineHeight: lineHeight.caption, color: colors.muted, textAlign: "right" },
  avatarButton: { width: 44, height: 44, padding: 3, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatar: { width: 38, height: 38, borderRadius: 19 },
  body: { flex: 1 },
  main: { flex: 1 },
  mainContent: { paddingTop: spacing.xl, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  captureContent: { flexGrow: 1 },
  pageHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 28, marginBottom: spacing.xl },
  recordCard: { flex: 1, minHeight: 385 },
  handsFreeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, marginBottom: spacing.sm },
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
  inboxBadge: { position: "absolute", top: -7, right: -13, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.green, alignItems: "center", justifyContent: "center" },
  inboxBadgeText: { fontFamily: fonts.medium, fontSize: 10, color: colors.white },
});
