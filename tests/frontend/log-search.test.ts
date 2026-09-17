import { describe, expect, it } from "vitest";
import { isFarmQuestion, logSearchText, matchesSearch } from "../../src/components/dashboard/log-search";
import type { EmployeeLog } from "../../src/components/dashboard/types";

const log: EmployeeLog = {
  id: "log-1", employee: { id: "e1", name: "Isaac Wang" }, activity: "Spraying", date: "2026-04-19",
  field: { id: "f1", name: "FIELD A", mapImageUrl: "" }, startAt: "2026-04-19T13:00:00Z", endAt: "2026-04-19T15:30:00Z",
  summary: "I'm leaving first, I'm going to go home.", recording: { url: "", durationSeconds: 0 }, tags: [], isNew: false,
};

describe("farm question detection", () => {
  it.each([
    "What did we spray on Field A?", "who worked in field b", "how many hours did Isaac log",
    "Show me all harvesting last week", "summarize april irrigation", "spraying in april?",
  ])("treats %j as a question", query => expect(isFarmQuestion(query)).toBe(true));

  it.each(["isaac", "Field A", "is", "show", "how many", "Isaac Wang spraying", "?", "Isaac spraying April"])(
    "keeps %j as a keyword search", query => expect(isFarmQuestion(query)).toBe(false),
  );
});

describe("keyword log search", () => {
  const text = logSearchText(log, ["Follow-up"], "America/Los_Angeles");
  it("matches summaries, farm-local times, dates and tags", () => {
    for (const query of ["home", "6:00", "8:30 am", "april 19", "follow-up", "field a"]) expect(matchesSearch(text, query)).toBe(true);
  });
  it("requires every word, in any order", () => {
    expect(matchesSearch(text, "spraying isaac")).toBe(true);
    expect(matchesSearch(text, "spraying maya")).toBe(false);
  });
  it("does not search anything missing from the row, summary or tags", () => {
    expect(matchesSearch(text, "transcript-only-word")).toBe(false);
  });
});
