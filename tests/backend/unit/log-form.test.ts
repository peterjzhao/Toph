import { expect, test } from "vitest";
import { allLogFields, checkLogDetails, defaultLogFormSettings, logFormCatalog, resolveLogForm, treatmentSummary, type ActivityFormDef } from "@/contracts/log-form";
import { workActivityDetails, workUnits } from "@/contracts/recording";
import { parseWorkspaceState } from "@/server/workspace/validation";

const catalog: Record<string, ActivityFormDef> = logFormCatalog;

test("a key has one type everywhere and every unit reference resolves within its activity", () => {
  const types = new Map<string, string>();
  for (const [activity, def] of Object.entries(catalog)) {
    const fields = [...def.defaults, ...def.suggested];
    expect(new Set(fields.map(field => field.key)).size, activity).toBe(fields.length);
    for (const field of fields) {
      expect(types.get(field.key) ?? field.type, `${activity}.${field.key}`).toBe(field.type);
      types.set(field.key, field.type);
      expect(field.key.startsWith("custom_")).toBe(false);
      if (field.type === "select") expect(field.options?.length).toBeGreaterThan(0);
      if (field.unitKey) expect(fields.find(item => item.key === field.unitKey)?.type).toBe("select");
    }
  }
});

test("the default form is what the app collected before the catalog existed", () => {
  const form = resolveLogForm();
  expect(form.Spraying.fields.map(field => field.key)).toEqual(["product", "amount", "unit"]);
  expect(form.Scouting).toEqual({ notesLabel: "Observations", fields: [] });
  expect(workActivityDetails.Planting).toEqual({ itemLabel: "Crop / variety", quantityLabel: "Plants planted", units: ["plants", "trays", "rows"] });
  expect(workActivityDetails.Irrigation).toEqual({ itemLabel: "Irrigation method", notesLabel: "Observations" });
  expect([...workUnits].sort()).toEqual(["L", "mL", "kg", "g", "gal", "lb", "plants", "trays", "rows", "seeds", "bins", "crates", "bunches"].sort());
});

test("a farm switches suggestions on, defaults off, and adds its own fields", () => {
  const form = resolveLogForm({ enabled: { Spraying: ["applicationMethod", "areaCovered"] }, hidden: { Spraying: ["unit"] },
    custom: [{ key: "custom_block", label: "Block", type: "text", activities: ["Spraying"] }] });
  // A number and its unit move together in both directions.
  expect(form.Spraying.fields.map(field => field.key)).toEqual(["product", "applicationMethod", "areaCovered", "areaUnit", "custom_block"]);
  expect(form["Pest Control"].fields.map(field => field.key)).toEqual(["product", "amount", "unit"]);
  expect(allLogFields(form).find(field => field.key === "applicationMethod")?.options).toContain("Plane");
});

test("details are checked against the activity's fields", () => {
  const form = resolveLogForm({ ...defaultLogFormSettings, enabled: { Spraying: ["applicationMethod"] } });
  expect(checkLogDetails(form, "Spraying", { product: " Neem oil ", amount: 2, unit: "L", applicationMethod: "Truck", targetPest: null })).toEqual({ details: { product: "Neem oil", amount: 2, unit: "L", applicationMethod: "Truck" }, problems: [] });
  expect(checkLogDetails(form, "Spraying", { amount: 2 }).problems).toEqual([{ key: "unit", message: "Choose a unit for amount applied." }]);
  expect(checkLogDetails(form, "Spraying", { applicationMethod: "Rocket", amount: "2", targetPest: "Aphids" }).problems.map(problem => problem.key)).toEqual(["applicationMethod", "amount", "targetPest"]);
  // A draft made under an earlier form keeps its values instead of failing to sync.
  expect(checkLogDetails(form, "Spraying", { targetPest: "Aphids" }, true)).toEqual({ details: { targetPest: "Aphids" }, problems: [] });
  expect(treatmentSummary({ product: "Neem oil", amount: 2, unit: "L" })).toBe("Treatment: Neem oil 2 L");
  expect(treatmentSummary({ applicationMethod: "Truck" })).toBe("");
});

test("workspace validation accepts only catalog keys and well-formed custom fields", () => {
  const base = { employees: [], schedule: [], reviews: [], reports: [], messages: [], tickets: [],
    settings: { farmName: "Farm", contactName: "Admin", email: "", timezone: "America/Los_Angeles", notifications: { recordings: true, weekly: true, reminders: true } } };
  const custom = { key: "custom_tank", label: "Tank", type: "select", options: ["North", "South"], activities: ["Spraying"] };
  expect(parseWorkspaceState(base).logForm).toBeUndefined();
  expect(parseWorkspaceState({ ...base, logForm: { enabled: { Spraying: ["applicationMethod"] }, hidden: { Planting: ["amount"] }, custom: [custom] } }).logForm?.custom).toHaveLength(1);
  for (const logForm of [
    { enabled: { Spraying: ["product"] }, hidden: {}, custom: [] },
    { enabled: { Planting: ["applicationMethod"] }, hidden: {}, custom: [] },
    { enabled: { Dancing: ["crewSize"] }, hidden: {}, custom: [] },
    { enabled: {}, hidden: {}, custom: [{ ...custom, key: "product" }] },
    { enabled: {}, hidden: {}, custom: [{ ...custom, options: undefined }] },
    { enabled: {}, hidden: {}, custom: [{ ...custom, activities: ["Dancing"] }] },
    { enabled: {}, hidden: {}, custom: [custom, custom] },
  ]) expect(() => parseWorkspaceState({ ...base, logForm })).toThrow();
});
