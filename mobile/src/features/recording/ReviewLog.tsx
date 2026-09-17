import { ArrowLeft, Check, CircleHelp, Plus, Tag } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import type { ExtractedLogFields } from "@toph/contracts/transcription";
import AudioReview from "./AudioReview";
import { DateField, extractionBorder, extractionHint, Press, SelectField, TextField, TimeField, type ExtractionStatus } from "./fields";
import type { RecordingClip } from "./local-drafts";
import { activities, fields } from "./recording-profile";
import { suggestedTags, type WorkDetails } from "./recording-utils";
import { activityForm } from "./activity-forms";
import ActivityFields from "./ActivityFields";
import { ReviewLoading, ReviewProcessing, ReviewSkeleton } from "./ReviewSkeleton";
import { colors, fonts, shared, fontSize, lineHeight, radius, spacing } from "./styles";
import type { Transcript } from "./use-transcription";

type Props = {
  details: WorkDetails; clips: RecordingClip[]; transcript: Transcript;
  loading: boolean; stopping: boolean; saving: boolean; editing: boolean;
  fieldOptions?: string[];
  catalogScope?: string;
  extractedFields?: ExtractedLogFields | null;
  onChange: <K extends keyof WorkDetails>(key: K, value: WorkDetails[K]) => void;
  onRetry: () => void; onCancel: () => void;
  onAppend: () => void; onBack: () => void; onSave: () => void;
};

export default function ReviewLog({ details, clips, transcript, loading, stopping, saving, editing, fieldOptions = fields, catalogScope, extractedFields,
  onChange, onRetry, onCancel, onAppend, onBack, onSave }: Props) {
  const [moreDetails, setMoreDetails] = useState(!clips.length && !loading);
  const form = activityForm(details.activity);
  function status(key: keyof ExtractedLogFields): ExtractionStatus | undefined {
    if (!extractedFields) return undefined;
    if (["product", "amount", "unit"].includes(key) && details.activity !== extractedFields.activity) return "missing";
    if (key === "unit" && extractedFields.unit && !form.units?.includes(extractedFields.unit)) return "missing";
    const value = extractedFields[key];
    return value === null || (Array.isArray(value) ? value.length === 0 : typeof value === "string" && !value.trim()) ? "missing" : "found";
  }
  // Completed speech and the current form remain readable during append/retry.
  return <ReviewProcessing.Provider value={loading}><ReviewLoading.Provider value={loading && !transcript.text}>
    <View style={styles.reviewCard} accessibilityState={{ busy: loading }}>
      {(clips.length > 0 || loading) && <View style={styles.recordingSection}>
        {clips.map((clip, index) => <ReviewSkeleton key={clip.audio.uri} loading={loading && !clip.transcript}>
          <AudioReview audio={clip.audio} seconds={clip.durationSeconds}
            title={clips.length > 1 ? `Recording ${index + 1}` : undefined} />
        </ReviewSkeleton>)}
        {loading && <View style={styles.reviewActions}>
        <Text style={shared.muted} accessibilityLiveRegion="polite">{stopping ? "Finishing…" : "Transcribing…"}</Text>
            <Press style={shared.quietButton} onPress={onCancel} disabled={stopping} accessibilityRole="button"><Text style={shared.quietText}>Cancel</Text></Press>
        </View>}
        <Press style={[shared.primaryButton, styles.appendButton]} onPress={onAppend} disabled={stopping || saving} accessibilityRole="button"><Plus size={16} color={colors.white} /><Text style={shared.primaryText}>Append recording</Text></Press>
        {(clips.length > 0 || loading) && <ReviewSkeleton>
          <View style={styles.transcriptBlock}>
            <Text style={shared.label}>Transcript</Text>
            <Text selectable style={shared.text}>{transcript.text || "—"}</Text>
          </View>
      </ReviewSkeleton>}
      </View>}
      {!loading && clips.length > 0 && transcript.status !== "done" && <View style={styles.transcriptError}>
        {transcript.message ? <View style={[shared.notice, styles.transcriptNotice]} accessibilityRole={transcript.status === "error" ? "alert" : undefined}>
          <CircleHelp size={18} color={colors.muted} /><Text style={shared.noticeText}>{transcript.message}</Text>
        </View> : null}
        <Pressable style={[shared.quietButton, styles.transcriptAction]} onPress={onRetry} accessibilityRole="button"><Text style={shared.quietText}>{transcript.status === "idle" ? "Transcribe recording" : "Try transcribing again"}</Text></Pressable>
      </View>}
      <View style={styles.formGrid}>
        <View style={styles.formRow}>
          <SelectField style={styles.half} label="Field" extractionStatus={status("fieldId")} value={details.field} values={fieldOptions} onChange={(value) => onChange("field", value)} />
          <SelectField style={styles.half} label="Activity" extractionStatus={status("activity")} value={details.activity} values={activities} onChange={(value) => onChange("activity", value)} />
        </View>
        <DateField label="Date" extractionStatus={status("workDate")} value={details.workDate} onChange={(value) => onChange("workDate", value)} />
        <View style={styles.formRow}>
          <TimeField style={styles.half} label="Start time" extractionStatus={status("startTime")} value={details.startTime} onChange={(value) => onChange("startTime", value)} />
          <TimeField style={styles.half} label="End time" extractionStatus={status("endTime")} value={details.endTime} onChange={(value) => onChange("endTime", value)} />
        </View>
      </View>
      <ActivityFields details={details} catalogScope={catalogScope} onChange={onChange} status={status} />
      {!form.notesLabel && <TextField label="Summary" summary extractionStatus={status("notes")} multiline maxLength={5000} value={details.notes} onChangeText={(value) => onChange("notes", value)} />}
      <Pressable style={[shared.quietButton, styles.transcriptAction]} onPress={() => setMoreDetails(value => !value)} accessibilityRole="button" accessibilityState={{ expanded: moreDetails }}><Text style={shared.quietText}>{moreDetails ? "Fewer details" : "More details"}</Text></Pressable>
      {moreDetails && <>
      <View style={styles.tags}>
        <View style={styles.tagsHeading}><Tag size={15} color={colors.muted} /><Text style={shared.muted}>Tags</Text></View>
        <ReviewSkeleton loading={loading && (!transcript.text || status("tags") === "missing")}><View testID="review-tags" style={[styles.tagList, extractedFields ? styles.tagFeedback : null, extractionBorder(status("tags"))]}>
          {suggestedTags.map((tag) => {
            const selected = details.tags.includes(tag);
            return <Pressable key={tag} style={[styles.tag, selected ? styles.tagSelected : null]} onPress={() => onChange("tags", selected ? details.tags.filter((item) => item !== tag) : [...details.tags, tag])} accessibilityRole="togglebutton" accessibilityState={{ checked: selected }} accessibilityHint={extractionHint(status("tags"))}>
              {selected ? <Check size={13} color={colors.green} /> : <Plus size={13} color={colors.muted} />}
              <Text style={[styles.tagText, selected ? styles.tagTextSelected : null]}>{tag}</Text>
            </Pressable>;
          })}
        </View></ReviewSkeleton>
      </View>
      </>}
      {!loading && <>
        <View style={styles.reviewActions}>
          <Press style={shared.quietButton} onPress={onBack} disabled={saving} accessibilityRole="button"><ArrowLeft size={16} color={colors.muted} /><Text style={shared.quietText}>Back</Text></Press>
          <Press style={shared.primaryButton} onPress={onSave} disabled={saving} accessibilityRole="button"><Text style={shared.primaryText}>{saving ? "Saving…" : "Save log"}</Text></Press>
        </View>
      </>}
    </View>
  </ReviewLoading.Provider></ReviewProcessing.Provider>;
}
const styles = StyleSheet.create({
  half: { flex: 1 },
  appendButton: { width: "100%", alignSelf: "stretch" },
  reviewCard: { gap: spacing.xl },
  recordingSection: { gap: spacing.md },
  transcriptStatus: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: 18 },
  transcriptError: { gap: 0 },
  transcriptNotice: { marginBottom: 0 },
  transcriptAction: { alignSelf: "flex-start", paddingLeft: 0 },
  transcriptBlock: { gap: spacing.xs, borderWidth: 1, borderColor: colors.line, borderRadius: radius.popover, padding: spacing.sm },
  formGrid: { gap: spacing.lg },
  formRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-end" },
  tags: { gap: spacing.sm },
  tagsHeading: { flexDirection: "row", alignItems: "center", gap: 7 },
  tagList: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  tagFeedback: { borderWidth: 1, borderRadius: radius.control, padding: spacing.xs },
  tag: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 40, paddingVertical: spacing.xs, paddingHorizontal: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 22, backgroundColor: colors.white },
  tagSelected: { backgroundColor: colors.greenTint, borderColor: colors.greenTint },
  tagText: { fontFamily: fonts.regular, fontSize: fontSize.body, lineHeight: lineHeight.body, color: colors.muted },
  tagTextSelected: { color: colors.green },
  reviewActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, paddingTop: spacing.xxs },
});
