import { ArrowLeft, Check, CircleHelp, Plus, Tag } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import AudioReview from "./AudioReview";
import { DateField, Press, SelectField, TextField, TimeField } from "./fields";
import type { RecordingClip } from "./local-drafts";
import { activities, fields } from "./recording-profile";
import { isTreatment, suggestedTags, unitOptions, type WorkDetails } from "./recording-utils";
import { ReviewLoading, ReviewSkeleton } from "./ReviewSkeleton";
import { colors, fonts, shared, fontSize, lineHeight, radius, spacing } from "./styles";
import type { Transcript } from "./use-transcription";

type Props = {
  details: WorkDetails; clips: RecordingClip[]; isDemo: boolean; transcript: Transcript;
  loading: boolean; stopping: boolean; saving: boolean; editing: boolean;
  fieldOptions?: string[];
  onChange: <K extends keyof WorkDetails>(key: K, value: WorkDetails[K]) => void;
  onRetry: () => void; onCancel: () => void;
  onAppend: () => void; onBack: () => void; onSave: () => void;
};

export default function ReviewLog({ details, clips, isDemo, transcript, loading, stopping, saving, editing, fieldOptions = fields,
  onChange, onRetry, onCancel, onAppend, onBack, onSave }: Props) {
  return <ReviewLoading.Provider value={loading}>
    <View style={styles.reviewCard} accessibilityState={{ busy: loading }}>
      {(clips.length > 0 || loading) && <View style={styles.recordingSection}>
        {clips.map((clip, index) => <ReviewSkeleton key={clip.audio.uri}>
          <AudioReview audio={clip.audio} seconds={clip.durationSeconds} isDemo={isDemo}
            title={clips.length > 1 ? `Recording ${index + 1}` : undefined} />
        </ReviewSkeleton>)}
        {loading && <View style={styles.loadingActions}>
          <Text style={shared.muted} accessibilityLiveRegion="polite">{stopping ? "Finishing recording…" : "Transcribing recording…"}</Text>
          <View style={styles.reviewActions}>
            <Press style={shared.quietButton} onPress={onCancel} disabled={stopping} accessibilityRole="button"><Text style={shared.quietText}>Cancel</Text></Press>
            <Press style={shared.primaryButton} onPress={onAppend} disabled={stopping} accessibilityRole="button"><Plus size={16} color={colors.white} /><Text style={shared.primaryText}>Append recording</Text></Press>
          </View>
        </View>}
        {!loading && clips.length > 0 && <Press style={shared.quietButton} onPress={onAppend} disabled={saving} accessibilityRole="button"><Plus size={16} color={colors.muted} /><Text style={shared.quietText}>Append recording</Text></Press>}
        {(clips.length > 0 || loading) && <ReviewSkeleton>
          <View style={styles.transcriptBlock}>
            <Text style={shared.label}>Transcript</Text>
            <Text selectable style={shared.text}>{transcript.text || (loading ? "Your transcript will appear here." : "No transcript yet.")}</Text>
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
          <SelectField style={styles.half} label="Field" value={details.field} values={fieldOptions} onChange={(value) => onChange("field", value)} />
          <SelectField style={styles.half} label="Activity" value={details.activity} values={activities} onChange={(value) => onChange("activity", value)} />
        </View>
        <DateField label="Date" value={details.workDate} onChange={(value) => onChange("workDate", value)} />
        <View style={styles.formRow}>
          <TimeField style={styles.half} label="Start time" value={details.startTime} onChange={(value) => onChange("startTime", value)} />
          <TimeField style={styles.half} label="End time" value={details.endTime} onChange={(value) => onChange("endTime", value)} />
        </View>
      </View>
      <TextField label="Notes" multiline maxLength={5000} value={details.notes} onChangeText={(value) => onChange("notes", value)} />
      {isTreatment(details.activity) && <View style={styles.treatment}>
        <ReviewSkeleton><View style={styles.legendRow}><Text style={styles.legend}>Treatment</Text><Text style={styles.legendHint}>Optional</Text><View style={styles.legendLine} /></View></ReviewSkeleton>
        <TextField label="Product" maxLength={120} value={details.product} onChangeText={(value) => onChange("product", value)} />
        <View style={styles.amountInputs}>
          <TextField style={styles.amountField} label="Amount" keyboardType="decimal-pad" value={details.amount} onChangeText={(value) => onChange("amount", value)} />
          <SelectField style={styles.unitField} label="Unit" value={details.unit} values={unitOptions} onChange={(value) => onChange("unit", value)} />
        </View>
      </View>}
      <View style={styles.tags}>
        <View style={styles.tagsHeading}><Tag size={15} color={colors.muted} /><Text style={shared.muted}>Tags</Text></View>
        <ReviewSkeleton><View style={styles.tagList}>
          {suggestedTags.map((tag) => {
            const selected = details.tags.includes(tag);
            return <Pressable key={tag} style={[styles.tag, selected ? styles.tagSelected : null]} onPress={() => onChange("tags", selected ? details.tags.filter((item) => item !== tag) : [...details.tags, tag])} accessibilityRole="togglebutton" accessibilityState={{ checked: selected }}>
              {selected ? <Check size={13} color={colors.green} /> : <Plus size={13} color={colors.muted} />}
              <Text style={[styles.tagText, selected ? styles.tagTextSelected : null]}>{tag}</Text>
            </Pressable>;
          })}
        </View></ReviewSkeleton>
      </View>
      {!loading && <>
        <View style={styles.reviewActions}>
          <Press style={shared.quietButton} onPress={onBack} disabled={saving} accessibilityRole="button"><ArrowLeft size={16} color={colors.muted} /><Text style={shared.quietText}>Back</Text></Press>
          <Press style={shared.primaryButton} onPress={onSave} disabled={saving} accessibilityRole="button"><Text style={shared.primaryText}>{saving ? "Saving…" : "Save log"}</Text></Press>
        </View>
      </>}
    </View>
  </ReviewLoading.Provider>;
}
const styles = StyleSheet.create({
  half: { flex: 1 },
  loadingActions: { gap: spacing.sm },
  reviewCard: { gap: spacing.xl },
  recordingSection: { gap: spacing.md },
  transcriptStatus: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: 18 },
  transcriptError: { gap: 0 },
  transcriptNotice: { marginBottom: 0 },
  transcriptAction: { alignSelf: "flex-start", paddingLeft: 0 },
  transcriptBlock: { gap: spacing.xs, borderWidth: 1, borderColor: colors.line, borderRadius: radius.popover, padding: spacing.sm },
  formGrid: { gap: spacing.lg },
  formRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-end" },
  treatment: { paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line, gap: spacing.md },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  legend: { fontFamily: fonts.regular, fontSize: fontSize.control, lineHeight: lineHeight.control, color: colors.ink },
  legendHint: { fontFamily: fonts.regular, fontSize: fontSize.caption, lineHeight: lineHeight.caption, color: colors.soft, marginRight: 5 },
  legendLine: { flex: 1, height: 1, backgroundColor: colors.line },
  amountInputs: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-end" },
  amountField: { flex: 1 },
  unitField: { width: 100 },
  tags: { gap: spacing.sm },
  tagsHeading: { flexDirection: "row", alignItems: "center", gap: 7 },
  tagList: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  tag: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 40, paddingVertical: spacing.xs, paddingHorizontal: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 22, backgroundColor: colors.white },
  tagSelected: { backgroundColor: colors.greenTint, borderColor: colors.greenTint },
  tagText: { fontFamily: fonts.regular, fontSize: fontSize.body, lineHeight: lineHeight.body, color: colors.muted },
  tagTextSelected: { color: colors.green },
  reviewActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, paddingTop: spacing.xxs },
});
