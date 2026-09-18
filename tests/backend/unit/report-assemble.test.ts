import { describe, expect, test } from "vitest";
import type { ReportDocument, ReportKind } from "@/contracts/reports";
import { assembleReport, mergeFacts, recordedFacts, type ReportFacts, type ReportLog } from "@/server/reports/assemble";

let next = 0;
function log(activity: string, field: string, date: string, facts: ReportFacts = {}, extra: Partial<ReportLog> = {}): ReportLog {
  next += 1;
  return { id: `log-${next}`, date, employee: "Isaac Wang", activity, field, start: "06:00", end: "10:30", hours: 4.5, notes: `${activity} on ${field}.`, facts, ...extra };
}
const said = (value: string | number) => ({ value });
function build(kind: ReportKind, logs: ReportLog[], earlierApplications: ReportLog[] = [], period = { from: "2026-04-01", to: "2026-04-30" }): ReportDocument {
  return assembleReport({
    kind, farm: { name: "Bays Ranch", timezone: "America/Los_Angeles" }, period, generatedAt: "2026-05-01T16:00:00.000Z",
    detection: { method: "recorded", model: null, logsRead: 0, factsDetected: 0 }, logs, earlierApplications,
  });
}
const values = (document: ReportDocument, section = 0) => document.sections[section].rows.map(row => row.cells.map(cell => cell.value));
const gap = (document: ReportDocument, label: string) => document.gaps.find(item => item.label === label);

describe("recorded facts", () => {
  test("files the log-form product by activity and composes weather", () => {
    expect(recordedFacts("Harvesting", { product: "Fuji apples", amount: 12, unit: "bins" })).toEqual({ commodity: said("Fuji apples"), amount: said(12), unit: said("bins") });
    expect(recordedFacts("Spraying", { product: "Copper", windSpeedMph: 4, windDirection: "NW", temperatureF: 68, custom_note: "x" }))
      .toEqual({ product: said("Copper"), weather: said("wind 4 mph NW, 68 °F") });
    expect(recordedFacts("Irrigation", { product: "Drip" })).toEqual({ irrigationMethod: said("Drip") });
    expect(recordedFacts("Weeding", { product: "Hoe" })).toEqual({});
  });

  test("keeps recorded values over detected ones", () => {
    const merged = mergeFacts({ product: said("Copper") }, [{ key: "product", value: "Sulfur", quote: "sulfur" }, { key: "targetPest", value: "mildew", quote: "for mildew" }]);
    expect(merged).toEqual({ product: said("Copper"), targetPest: { value: "mildew", quote: "for mildew" } });
  });
});

describe("pesticide use report", () => {
  test("fills DPR's elements from stated facts and dates the filing", () => {
    const complete = log("Spraying", "FIELD A", "2026-04-19", {
      commodity: said("Almonds"), product: said("Roundup PowerMAX"), epaRegNumber: said("524-549"), amount: said(2.5), unit: said("gal"),
      areaCovered: { value: 12, quote: "12 acres" }, areaUnit: { value: "acres", quote: "12 acres" }, applicationMethod: said("Tractor boom"),
    });
    const document = build("pesticide-use", [complete, log("Weeding", "FIELD F", "2026-04-24")]);
    expect(values(document)).toEqual([["Apr 19, 2026, 10:30 AM", "FIELD A", null, "Almonds", "12 acres", null, "Roundup PowerMAX", "524-549", "2.5 gal", "Ground (Tractor boom)", "Isaac Wang"]]);
    expect(document.sections[0].rows[0].cells[4]).toEqual({ value: "12 acres", quote: "12 acres" });
    expect(document.header.find(field => field.label === "Due to the county")?.cell.value).toBe("May 10, 2026");
    expect(document.gaps.map(item => item.label)).toEqual(["Operator ID number (OIN)", "County", "Site ID number", "Acres planted"]);
    expect(document.readiness).toEqual({ status: "incomplete", message: "1 application found. 4 values are missing.", missing: 4 });
    expect(document.version).toBe(2);
    expect(document.form.authority).toMatch(/DPR/);
    // Blanks say where the value would come from, right where it belongs.
    expect(document.header[1].cell).toEqual({ value: null, missing: { from: "records", source: "county permit", note: "Issued by the County Agricultural Commissioner. Toph doesn't store it." } });
    expect(document.sections[0].rows[0].cells[2].missing).toMatchObject({ from: "records", source: "county permit" });
  });

  test("lists each missing element with the logs it is missing from", () => {
    const bare = log("Pest Control", "FIELD K", "2026-04-29");
    const document = build("pesticide-use", [bare, log("Spraying", "FIELD A", "2026-04-19", { product: said("Copper"), applicationMethod: said("Drone") })]);
    expect(gap(document, "Product name")).toEqual({ label: "Product name", detail: "Not recorded on 1 of 2 applications.", logIds: [bare.id] });
    expect(document.sections[0].rows[0].cells[6]).toEqual({ value: null, missing: { from: "log", note: "The worker's log doesn't say which product was applied." } });
    expect(values(document)[1][9]).toBe("Air (Drone)");
  });

  test("reports no records, and spans several months without a single due date", () => {
    const document = build("pesticide-use", [], [], { from: "2026-03-15", to: "2026-04-30" });
    expect(document.readiness.status).toBe("no-records");
    expect(document.header.find(field => field.label === "Due to the county")?.cell.value).toBe("The 10th of the month after each month of use");
  });
});

describe("pre-harvest intervals", () => {
  const harvest = () => log("Harvesting", "FIELD B", "2026-04-20", { commodity: said("Strawberries") });
  test("met, not met, and not verifiable", () => {
    const early = log("Spraying", "FIELD B", "2026-04-15", { product: said("Copper"), preHarvestDays: said(3) });
    expect(values(build("food-safety", [harvest()], [], undefined), 1)).toEqual([["Apr 20, 2026", "FIELD B", "Strawberries", "None recorded", "No pesticide application on FIELD B in the 90 days before"]]);
    expect(values(build("food-safety", [early, harvest()]), 1)[0][4]).toBe("Met for every prior application");
    const late = log("Spraying", "FIELD B", "2026-03-30", { product: said("Spinosad"), preHarvestDays: said(30) });
    expect(values(build("food-safety", [harvest()], [late]), 1)[0][4]).toBe("Not met: the Mar 30, 2026 application needs 30 days");
    const unstated = log("Pest Control", "FIELD B", "2026-04-10");
    const document = build("food-safety", [unstated, harvest()]);
    expect(values(document, 1)[0][4]).toBeNull();
    expect(gap(document, "Pre-harvest interval check")?.logIds).toHaveLength(1);
    expect(gap(document, "Water test results")?.logIds).toEqual([]);
    expect(document.sections[3]).toMatchObject({ title: "Water tests", rows: [], missing: { from: "records", source: "lab reports" } });
  });

  test("traceability lists each harvest's elements and the applications one step back", () => {
    const spray = log("Spraying", "FIELD B", "2026-03-01", { product: said("Copper"), preHarvestDays: said(1) });
    const picked = log("Harvesting", "FIELD B", "2026-04-20", { commodity: said("Strawberries"), variety: said("Albion"), amount: said(40), unit: said("flats"), destination: said("Coastal Cooling") });
    const document = build("harvest-traceability", [picked], [spray, log("Spraying", "FIELD C", "2026-03-01")]);
    expect(values(document, 0)).toEqual([["Strawberries, Albion", "40 flats", "Bays Ranch", "FIELD B", "Apr 20, 2026", "Coastal Cooling", `Toph harvest log ${picked.id}`, "Not required at harvest"]]);
    expect(values(document, 1)).toEqual([["Apr 20, 2026", "FIELD B", "Mar 1, 2026", "Spraying", "Copper", 50, "1 day"]]);
    expect(document.gaps.map(item => item.label)).toEqual(["Farm location (address)", "Phone number"]);
  });
});

test("labor hours groups each worker's day and lists payroll items Toph does not hold", () => {
  const document = build("labor-hours", [
    log("Spraying", "FIELD A", "2026-04-19", {}, { start: "06:00", end: "08:00", hours: 2 }),
    log("Weeding", "FIELD F", "2026-04-19", {}, { start: "13:00", end: "15:30", hours: 2.5 }),
    log("Pruning", "FIELD G", "2026-04-20", {}, { employee: "Noah Brown", start: "07:00", end: "11:30", hours: 4.5 }),
  ]);
  expect(values(document, 0)).toEqual([
    ["Apr 19, 2026", "Isaac Wang", "6:00 AM", "3:30 PM", 4.5, "Spraying (FIELD A); Weeding (FIELD F)"],
    ["Apr 20, 2026", "Noah Brown", "7:00 AM", "11:30 AM", 4.5, "Pruning (FIELD G)"],
  ]);
  expect(document.sections[1].columns).toEqual(["Worker", "Days worked", "Hours worked", "Hours offered", "Rate of pay", "Earnings", "Deductions"]);
  expect(values(document, 1)).toEqual([["Isaac Wang", 1, 4.5, null, null, null, null], ["Noah Brown", 1, 4.5, null, null, null, null]]);
  expect(document.sections[1].rows[0].cells[4].missing).toMatchObject({ from: "records", source: "payroll" });
  expect(document.gaps.map(item => item.label)).toEqual(["Hours offered", "Rate of pay", "Earnings", "Deductions", "Employer address", "Employer FEIN"]);
  expect(document.readiness).toMatchObject({ message: "2 worker-days found. 10 values are missing.", missing: 10 });
});

test("acreage marks a field irrigated only from an irrigation log on that field", () => {
  const document = build("acreage", [
    log("Planting", "FIELD C", "2026-04-21", { commodity: said("Tomatoes"), areaCovered: said(8), areaUnit: said("acres") }),
    log("Seeding", "FIELD J", "2026-04-28", { areaCovered: said(40), areaUnit: said("rows") }),
    log("Irrigation", "FIELD C", "2026-04-22"),
  ]);
  expect(values(document).map(cells => [cells[0], cells[3], cells[5], cells[6], cells[7]])).toEqual([
    ["FIELD C", "Tomatoes", "8 acres", "Irrigated", "Apr 21, 2026"],
    ["FIELD J", null, null, null, "Apr 28, 2026"],
  ]);
  expect(document.header.find(field => field.label === "Crop year")?.cell.value).toBe(2026);
});

test("nitrogen is calculated only from a stated amount, grade and acreage", () => {
  const stated = log("Fertilizing", "FIELD E", "2026-04-23", { product: said("Urea"), amount: said(500), unit: said("lb"), nitrogenPercent: said(46), areaCovered: said(10), areaUnit: said("acres") });
  const document = build("nitrogen", [stated, log("Irrigation", "FIELD E", "2026-04-24", { irrigationMethod: said("drip"), areaCovered: said(10), areaUnit: said("acres") })]);
  expect(values(document)).toEqual([["FIELD E", null, null, "10 acres", "drip", "1 application: Urea", 23, null]]);
  const unstated = build("nitrogen", [log("Fertilizing", "FIELD E", "2026-04-23", { product: said("UAN-32"), amount: said(20), unit: said("gal") })]);
  expect(values(unstated)[0][6]).toBeNull();
  expect(gap(unstated, "Total nitrogen applied")?.detail).toBe("Not recorded on 1 of 1 field.");
});

test("organic records keep every log in the activity log and flag input approval", () => {
  const long = "x".repeat(200);
  const document = build("organic", [log("Spraying", "FIELD A", "2026-04-19", { weather: { value: "wind picked up", quote: "wind picked up" } }, { notes: long }), log("Monitoring", "FIELD H", "2026-04-26")]);
  expect(values(document, 0)[0][6]).toBe("wind picked up");
  expect(values(document, 3)).toHaveLength(2);
  expect(String(values(document, 3)[0][5])).toHaveLength(158);
  expect(gap(document, "Organic approval of each input")?.logIds).toHaveLength(1);
});
