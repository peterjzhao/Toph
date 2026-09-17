import {
  audioFileName, clock, dateInputLabel, dateLabel, emptyDetails, fieldLabel, fromDate, fromTime,
  isTreatment, localDate, timeInputLabel, toDate, validateDetails,
} from "../recording-utils";

describe("formatting", () => {
  test("clock pads minutes and seconds and floors fractions", () => {
    expect(clock(0)).toBe("00:00");
    expect(clock(13.384671)).toBe("00:13");
    expect(clock(61)).toBe("01:01");
    expect(clock(3599.9)).toBe("59:59");
  });

  test("dateLabel formats ISO dates like the web app and falls back for empty dates", () => {
    expect(dateLabel("2026-04-19")).toBe("Apr 19, 2026");
    expect(dateLabel("2026-12-01")).toBe("Dec 1, 2026");
    expect(dateLabel("")).toBe("New work log");
  });

  test("localDate uses the device's local calendar date", () => {
    expect(localDate(new Date(2026, 8, 16, 23, 30))).toBe("2026-09-16");
    expect(localDate(new Date(2026, 0, 5, 0, 1))).toBe("2026-01-05");
  });

  test("fieldLabel converts FIELD codes to display labels", () => {
    expect(fieldLabel("FIELD A")).toBe("Field A");
    expect(fieldLabel("Spraying")).toBe("Spraying");
  });

  test("input labels mirror the browser's date and time inputs", () => {
    expect(dateInputLabel("2026-09-16")).toBe("09/16/2026");
    expect(dateInputLabel("")).toBe("mm/dd/yyyy");
    expect(timeInputLabel("06:00")).toBe("06:00 AM");
    expect(timeInputLabel("13:05")).toBe("01:05 PM");
    expect(timeInputLabel("00:30")).toBe("12:30 AM");
    expect(timeInputLabel("12:00")).toBe("12:00 PM");
    expect(timeInputLabel("")).toBe("--:-- --");
  });

  test("date conversions round-trip through picker Date values", () => {
    const date = toDate("2026-04-19", "06:00");
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(3);
    expect(date.getDate()).toBe(19);
    expect(date.getHours()).toBe(6);
    expect(fromDate(date)).toBe("2026-04-19");
    expect(fromTime(new Date(2026, 3, 19, 10, 40))).toBe("10:40");
    expect(toDate("", "").getFullYear()).toBeGreaterThan(2000);
  });

  test("audioFileName uses the work date or draft", () => {
    expect(audioFileName("2026-04-19", "m4a")).toBe("toph-2026-04-19.m4a");
    expect(audioFileName("", "m4a")).toBe("toph-draft.m4a");
  });

  test("isTreatment matches the three treatment activities", () => {
    expect(isTreatment("Spraying")).toBe(true);
    expect(isTreatment("Fertilizing")).toBe(true);
    expect(isTreatment("Pest Control")).toBe(true);
    expect(isTreatment("Harvesting")).toBe(false);
  });
});

describe("validateDetails", () => {
  const valid = { ...emptyDetails, workDate: "2026-04-19", startTime: "06:00", endTime: "10:40", notes: "Sprayed field A.", product: "Water", amount: "2" };

  test("accepts a complete log", () => {
    expect(validateDetails(valid, false)).toBe("");
    expect(validateDetails({ ...valid, notes: "" }, true)).toBe("");
  });

  test("requires the date and both times before other checks", () => {
    expect(validateDetails({ ...valid, workDate: "" }, true)).toBe("Fill in the date, start time, and end time.");
    expect(validateDetails({ ...valid, startTime: "" }, true)).toBe("Fill in the date, start time, and end time.");
    expect(validateDetails({ ...valid, endTime: "" }, true)).toBe("Fill in the date, start time, and end time.");
  });

  test("rejects an end time that is not after the start time", () => {
    expect(validateDetails({ ...valid, endTime: "06:00" }, true)).toBe("End time must be later than start time for this work date.");
    expect(validateDetails({ ...valid, endTime: "05:59" }, true)).toBe("End time must be later than start time for this work date.");
  });

  test("requires a note or a recording", () => {
    expect(validateDetails({ ...valid, notes: "   " }, false)).toBe("Add a short note or a recording before saving.");
  });

  test("requires a positive numeric amount for spraying", () => {
    expect(validateDetails({ ...valid, amount: "0" }, false)).toBe("Enter amount applied greater than zero.");
    expect(validateDetails({ ...valid, amount: "abc" }, false)).toBe("Enter amount applied greater than zero.");
    expect(validateDetails({ ...valid, amount: "-2" }, false)).toBe("Enter amount applied greater than zero.");
    expect(validateDetails({ ...valid, amount: "2.5" }, false)).toBe("");
    expect(validateDetails({ ...valid, amount: "" }, false)).toBe("Enter amount applied greater than zero.");
  });

  test.each([
    ["Spraying", "Product", "L"], ["Fertilizing", "Fertilizer", "kg"],
    ["Planting", "Crop / variety", "plants"], ["Seeding", "Seed / variety", "g"],
    ["Harvesting", "Crop / variety", "crates"],
  ])("%s requires its item, quantity and compatible unit", (activity, label, unit) => {
    const details = { ...valid, activity, unit };
    expect(validateDetails(details, true)).toBe("");
    expect(validateDetails({ ...details, product: "" }, true)).toBe(`Choose ${label.toLowerCase()}.`);
    expect(validateDetails({ ...details, amount: "" }, true)).not.toBe("");
    expect(validateDetails({ ...details, unit: "wrong" }, true)).toBe("Choose a valid unit.");
  });

  test("monitoring has no product or amount requirement", () => {
    expect(validateDetails({ ...valid, activity: "Monitoring", product: "", amount: "", unit: "" }, true)).toBe("");
  });
});
