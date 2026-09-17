import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { activityForm } from "./activity-forms";
import { readActivityItems, saveActivityItem } from "./activity-catalog";
import { SelectField, TextField, type ExtractionStatus } from "./fields";
import type { WorkDetails } from "./recording-utils";
import { shared, spacing } from "./styles";

type Props = {
  details: WorkDetails;
  catalogScope?: string;
  onChange: <K extends keyof WorkDetails>(key: K, value: WorkDetails[K]) => void;
  status: (key: "product" | "amount" | "unit" | "notes") => ExtractionStatus | undefined;
};

export default function ActivityFields({ details, catalogScope, onChange, status }: Props) {
  const form = activityForm(details.activity);
  const [items, setItems] = useState<string[]>([]);
  const [error, setError] = useState("");
  function refresh() {
    try { setItems(readActivityItems(details.activity, catalogScope)); setError(""); }
    catch (cause) { setItems([]); setError(cause instanceof Error ? cause.message : "Could not load choices."); }
  }
  useEffect(refresh, [details.activity, catalogScope]);
  const options = [...new Set([...items, ...(details.product ? [details.product] : [])])];
  return <View style={styles.fields}>
    {form.itemLabel && <SelectField key={details.activity} label={form.itemLabel} value={details.product} values={options}
      extractionStatus={status("product")} onChange={value => onChange("product", value)} onOpen={refresh}
      onAdd={value => { const saved = saveActivityItem(details.activity, value, catalogScope); refresh(); return saved; }} />}
    {error ? <Text style={shared.muted} accessibilityRole="alert">{error}</Text> : null}
    {form.quantityLabel && <View style={styles.row}>
      <TextField style={styles.quantity} label={form.quantityLabel} extractionStatus={status("amount")} keyboardType="decimal-pad" value={details.amount} onChangeText={value => onChange("amount", value)} />
      <SelectField style={styles.unit} label="Unit" extractionStatus={status("unit")} value={details.unit} values={[...(form.units ?? [])]} onChange={value => onChange("unit", value)} />
    </View>}
    {form.notesLabel && <TextField label={form.notesLabel} extractionStatus={status("notes")} multiline maxLength={5000} value={details.notes} onChangeText={value => onChange("notes", value)} />}
  </View>;
}

const styles = StyleSheet.create({
  fields: { gap: spacing.md },
  row: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-end" },
  quantity: { flex: 1 },
  unit: { width: 110 },
});
