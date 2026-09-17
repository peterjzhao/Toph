import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { Calendar, Check, ChevronDown, Clock, X } from "lucide-react-native";
import { useContext, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type PressableProps, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { dateInputLabel, fieldLabel, fromDate, fromTime, timeInputLabel, toDate } from "./recording-utils";
import { colors, fonts, shared, radius, spacing } from "./styles";
import { ReviewLoading, ReviewProcessing, ReviewSkeleton } from "./ReviewSkeleton";

export type ExtractionStatus = "found" | "missing";
type ExtractionFeedback = { extractionStatus?: ExtractionStatus };
export function extractionBorder(status?: ExtractionStatus): Pick<ViewStyle, "borderColor"> | undefined {
  return status ? { borderColor: status === "found" ? colors.green : colors.warning } : undefined;
}
export function extractionHint(status?: ExtractionStatus) {
  return status === "found" ? "Found in recording" : status === "missing" ? "Not found in recording. Review or enter this detail." : undefined;
}

/** Pressable that dims like a disabled web button. */
export function Press({ disabled, style, children, ...rest }: PressableProps & { style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  return <Pressable disabled={disabled} style={[style, disabled ? shared.disabled : null]} {...rest}>{children}</Pressable>;
}

export function Labeled({ label, children, style, extractionStatus }: ExtractionFeedback & { label: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const initialLoading = useContext(ReviewLoading);
  const processing = useContext(ReviewProcessing);
  const loading = initialLoading || (processing && extractionStatus === "missing");
  return <View style={[styles.labeled, style]}><Text style={shared.label}>{label}</Text><ReviewSkeleton loading={loading}>{children}</ReviewSkeleton></View>;
}

export function TextField({ label, style, multiline, extractionStatus, summary = false, ...rest }: TextInputProps & ExtractionFeedback & { label: string; style?: StyleProp<ViewStyle>; summary?: boolean }) {
  return <Labeled label={label} style={style} extractionStatus={extractionStatus}>
    <TextInput
      {...rest}
      multiline={multiline}
      accessibilityLabel={label}
      accessibilityHint={extractionHint(extractionStatus)}
      placeholderTextColor={colors.soft}
      style={[shared.inputBox, shared.inputText, multiline ? styles.multiline : null, summary ? styles.summary : null, extractionBorder(extractionStatus)]}
    />
  </Labeled>;
}

/** Bottom panel used by the option picker and the iOS date/time spinners. */
function Panel({ visible, title, onClose, children, footer }: { visible: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
    <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.panel, { paddingBottom: Math.max(12, insets.bottom) }]}>
        <View style={styles.panelHandle} />
        <View style={styles.panelHeading}>
          <Text style={shared.heading}>{title}</Text>
          <Pressable style={styles.panelClose} onPress={onClose} accessibilityLabel={`Close ${title.toLowerCase()}`}><X size={21} color={colors.muted} /></Pressable>
        </View>
        {children}
        {footer}
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

export function SelectField({ label, value, values, onChange, disabled = false, style, extractionStatus, onAdd, onOpen }: ExtractionFeedback & {
  label: string; value: string; values: string[]; onChange: (value: string) => void; disabled?: boolean; style?: StyleProp<ViewStyle>;
  onAdd?: (value: string) => string; onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  function add() {
    try { const saved = onAdd!(name); onChange(saved); setOpen(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save choice."); }
  }
  return <Labeled label={label} style={style} extractionStatus={extractionStatus}>
    <Press style={[shared.inputBox, styles.selectBox, extractionBorder(extractionStatus)]} disabled={disabled} onPress={() => { onOpen?.(); setAdding(false); setName(""); setError(""); setOpen(true); }} accessibilityRole="button" accessibilityLabel={label} accessibilityValue={{ text: fieldLabel(value) }} accessibilityHint={extractionHint(extractionStatus)}>
      <Text style={[shared.inputText, styles.selectText, !value ? { color: colors.soft } : null]} numberOfLines={1}>{fieldLabel(value) || "Select…"}</Text>
      <ChevronDown size={15} color={colors.muted} />
    </Press>
    <Panel visible={open} title={label} onClose={() => setOpen(false)}>
      <ScrollView style={styles.optionList} bounces={false} keyboardShouldPersistTaps="handled">
        {values.map((item) => {
          const selected = item === value;
          return <Pressable key={item} style={styles.option} onPress={() => { onChange(item); setOpen(false); }} accessibilityRole="button" accessibilityState={{ selected }}>
            <Text style={[shared.inputText, selected ? styles.optionSelected : null]}>{fieldLabel(item)}</Text>
            {selected && <Check size={18} color={colors.green} />}
          </Pressable>;
        })}
        {onAdd && (adding ? <View style={styles.addItem}>
          <TextInput accessibilityLabel={`New ${label.toLowerCase()}`} value={name} onChangeText={setName} maxLength={120} autoFocus style={[shared.inputBox, shared.inputText]} returnKeyType="done" onSubmitEditing={add} />
          {error ? <Text accessibilityRole="alert" style={shared.muted}>{error}</Text> : null}
          <Press style={shared.primaryButton} onPress={add} disabled={!name.trim()} accessibilityRole="button"><Text style={shared.primaryText}>Save choice</Text></Press>
        </View> : <Pressable style={styles.option} onPress={() => setAdding(true)} accessibilityRole="button"><Text style={shared.inputText}>Add new…</Text></Pressable>)}
      </ScrollView>
    </Panel>
  </Labeled>;
}

function PickerField({ label, value, mode, onChange, style, extractionStatus }: ExtractionFeedback & { label: string; value: string; mode: "date" | "time"; onChange: (value: string) => void; style?: StyleProp<ViewStyle> }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Date>(() => toDate(value));
  const current = mode === "date" ? toDate(value) : toDate("", value);
  const text = mode === "date" ? dateInputLabel(value) : timeInputLabel(value);
  const commit = (date: Date) => onChange(mode === "date" ? fromDate(date) : fromTime(date));

  function press() {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: current, mode, is24Hour: false,
        onValueChange: (_event, date) => commit(date),
      });
      return;
    }
    setPending(current);
    setOpen(true);
  }

  return <Labeled label={label} style={style} extractionStatus={extractionStatus}>
    <Pressable style={[shared.inputBox, styles.selectBox, extractionBorder(extractionStatus)]} onPress={press} accessibilityRole="button" accessibilityLabel={label} accessibilityValue={{ text }} accessibilityHint={extractionHint(extractionStatus)}>
      <Text style={[shared.inputText, styles.selectText]}>{text}</Text>
      {mode === "date" ? <Calendar size={16} color={colors.ink} /> : <Clock size={16} color={colors.ink} />}
    </Pressable>
    {Platform.OS !== "android" && <Panel visible={open} title={label} onClose={() => setOpen(false)}
      footer={<Pressable style={[shared.primaryButton, styles.panelAction]} onPress={() => { commit(pending); setOpen(false); }} accessibilityRole="button"><Text style={shared.primaryText}>Done</Text></Pressable>}>
      <DateTimePicker value={pending} mode={mode} display="spinner" themeVariant="light" textColor={colors.ink} onValueChange={(_event, date) => setPending(date)} style={styles.spinner} />
    </Panel>}
  </Labeled>;
}

export function DateField(props: ExtractionFeedback & { label: string; value: string; onChange: (value: string) => void; style?: StyleProp<ViewStyle> }) {
  return <PickerField {...props} mode="date" />;
}

export function TimeField(props: ExtractionFeedback & { label: string; value: string; onChange: (value: string) => void; style?: StyleProp<ViewStyle> }) {
  return <PickerField {...props} mode="time" />;
}

const styles = StyleSheet.create({
  labeled: { gap: spacing.xs, minWidth: 0 },
  multiline: { minHeight: 96, textAlignVertical: "top" },
  summary: { minHeight: 144, lineHeight: 24, color: colors.muted },
  selectBox: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.xs, paddingRight: 11 },
  selectText: { flex: 1 },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.backdrop },
  panel: { maxHeight: "70%", borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, backgroundColor: colors.white, paddingTop: 10 },
  panelHandle: { alignSelf: "center", width: 38, height: 4, borderRadius: 3, backgroundColor: colors.handle, marginBottom: spacing.xs },
  panelHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, paddingLeft: spacing.xl, paddingRight: 18 },
  panelClose: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22 },
  panelAction: { marginHorizontal: spacing.xl, marginTop: spacing.sm },
  optionList: { flexGrow: 0 },
  addItem: { padding: spacing.lg, gap: spacing.sm },
  option: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, minHeight: 52, paddingVertical: 10, paddingHorizontal: spacing.xl, borderTopWidth: 1, borderTopColor: colors.line },
  optionSelected: { fontFamily: fonts.medium, color: colors.green },
  spinner: { alignSelf: "stretch" },
});
