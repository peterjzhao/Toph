/** Shared form vocabulary; safe to import in web, native, and server code. Derived from the log-form catalog. */
import { logFormCatalog, resolveLogForm, allLogFields, treatmentUnits, workActivities } from "./log-form";

export { treatmentUnits, workActivities };
export const treatmentActivities = ["Spraying", "Fertilizing", "Pest Control"] as const;
export const workTags = ["Needs review", "Equipment", "Follow-up"] as const;

/** Activity-specific meaning of the default item/quantity fields (`product`, `amount`, `unit`). */
export type WorkActivityDetails = {
  itemLabel?: string;
  quantityLabel?: string;
  units?: readonly string[];
  notesLabel?: string;
};

export const workActivityDetails: Record<string, WorkActivityDetails> = Object.fromEntries(Object.entries(logFormCatalog).map(([activity, def]) => {
  const field = (key: string) => def.defaults.find(item => item.key === key);
  const details: WorkActivityDetails = {};
  if (field("product")) details.itemLabel = field("product")!.label;
  if (field("amount")) { details.quantityLabel = field("amount")!.label; details.units = field("unit")?.options; }
  if ("notesLabel" in def) details.notesLabel = def.notesLabel;
  return [activity, details];
}));

/** Every unit the default quantity field accepts, across activities. */
export const workUnits = allLogFields(resolveLogForm()).find(field => field.key === "unit")!.options as [string, ...string[]];
