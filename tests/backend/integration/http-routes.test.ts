import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type postgres from "postgres";
import type { DashboardResponse, LogResponse, LogTagsResponse, TagsResponse } from "@/contracts/dashboard";
import * as dashboardRoute from "@/app/api/dashboard/route";
import * as healthRoute from "@/app/api/health/route";
import * as logRoute from "@/app/api/logs/[logId]/route";
import * as logTagsRoute from "@/app/api/logs/[logId]/tags/route";
import * as logTagRoute from "@/app/api/logs/[logId]/tags/[tagId]/route";
import * as tagsRoute from "@/app/api/tags/route";
import { ISAAC_LOG_ID, recordId } from "@/server/db/initial-data";
import { openTestSql } from "../helpers/test-db";
import { OTHER_FARM, prepareTestDatabase, resetTags } from "../helpers/prepare-db";
import { TEST_APP_ORIGIN, applyEnv, useRouteTestEnv } from "../helpers/route-env";

const BASE = "http://127.0.0.1:3000";
const MAYA_LOG_ID = recordId("workLog", 2);

function params<T extends Record<string, string>>(value: T): { params: Promise<T> } {
  return { params: Promise.resolve(value) };
}

function get(path: string): NextRequest {
  return new NextRequest(`${BASE}${path}`);
}

function post(path: string, body: BodyInit | null, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`${BASE}${path}`, { method: "POST", body, headers });
}

function del(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`${BASE}${path}`, { method: "DELETE", headers });
}

const WRITE_HEADERS = { origin: TEST_APP_ORIGIN, "content-type": "application/json" };

async function json<T>(response: Response): Promise<T> {
  expect(response.headers.get("content-type")).toMatch(/application\/json/);
  return (await response.json()) as T;
}

type ErrorBody = { error: { code: string; message: string; fields?: Record<string, string> } };

describe("HTTP route handlers", () => {
  let sql: postgres.Sql;
  let restoreEnv: () => void;

  beforeAll(async () => {
    sql = openTestSql();
    await prepareTestDatabase(sql);
    await resetTags(sql);
    restoreEnv = useRouteTestEnv();
  });

  afterEach(() => {
    useRouteTestEnv();
  });

  afterAll(async () => {
    restoreEnv();
    await sql.end();
  });

  describe("GET /api/dashboard", () => {
    it("returns the data and meta envelope with no-store caching", async () => {
      const response = await dashboardRoute.GET(get("/api/dashboard"));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await json<DashboardResponse>(response);
      expect(body.data.logs).toHaveLength(11);
      expect(body.data.newLogCount).toBe(4);
      expect(body.meta.contractVersion).toBe("2");
      expect(body.meta.filters.period).toBe("all");
      expect(body.meta.pagination).toEqual({ total: 11, limit: 50, offset: 0, hasMore: false });
    });

    it("applies query parameters", async () => {
      const response = await dashboardRoute.GET(get("/api/dashboard?q=isaac&sort=date-desc&limit=5&activity=Spraying"));
      const body = await json<DashboardResponse>(response);
      expect(body.data.logs.map((l) => l.employee.name)).toEqual(["Isaac Wang"]);
      expect(body.meta.filters).toMatchObject({ q: "isaac", activities: ["Spraying"], sort: "date-desc" });
      expect(body.meta.pagination.limit).toBe(5);
    });

    it("rejects invalid or unknown parameters with a 400 error envelope", async () => {
      const response = await dashboardRoute.GET(get("/api/dashboard?farmId=00000000-0000-4000-8000-000000000002&limit=0"));
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await json<ErrorBody>(response);
      expect(body).not.toHaveProperty("data");
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.fields).toEqual({ farmId: "unknown parameter", limit: "must be between 1 and 100" });
    });
  });

  describe("GET /api/logs/:logId", () => {
    it("returns the same record the dashboard lists", async () => {
      const dashboard = await json<DashboardResponse>(await dashboardRoute.GET(get("/api/dashboard")));
      const response = await logRoute.GET(get(`/api/logs/${ISAAC_LOG_ID}`), params({ logId: ISAAC_LOG_ID }));
      expect(response.status).toBe(200);
      const body = await json<LogResponse>(response);
      expect(body.data).toEqual(dashboard.data.logs[0]);
    });

    it("returns 400 for a malformed ID and 404 for unknown or out-of-scope IDs", async () => {
      const bad = await logRoute.GET(get("/api/logs/nope"), params({ logId: "nope" }));
      expect(bad.status).toBe(400);
      const other = await logRoute.GET(get(`/api/logs/${OTHER_FARM.logId}`), params({ logId: OTHER_FARM.logId }));
      expect(other.status).toBe(404);
      expect((await json<ErrorBody>(other)).error.code).toBe("NOT_FOUND");
    });
  });

  describe("tag routes", () => {
    it("adds and removes tags with committed results visible to the next read", async () => {
      const added = await logTagsRoute.POST(
        post(`/api/logs/${ISAAC_LOG_ID}/tags`, JSON.stringify({ label: "Needs review" }), WRITE_HEADERS),
        params({ logId: ISAAC_LOG_ID }),
      );
      expect(added.status).toBe(200);
      expect(added.headers.get("cache-control")).toBe("no-store");
      const addedBody = await json<LogTagsResponse>(added);
      expect(addedBody.data.logId).toBe(ISAAC_LOG_ID);
      expect(addedBody.data.tags.map((t) => t.label)).toEqual(["Needs review"]);
      const tagId = addedBody.data.tags[0].id;

      const detail = await json<LogResponse>(await logRoute.GET(get(`/api/logs/${ISAAC_LOG_ID}`), params({ logId: ISAAC_LOG_ID })));
      expect(detail.data.tags).toEqual(addedBody.data.tags);

      const catalog = await json<TagsResponse>(await tagsRoute.GET());
      expect(catalog.data).toEqual([{ id: tagId, label: "Needs review" }]);

      const removed = await logTagRoute.DELETE(
        del(`/api/logs/${ISAAC_LOG_ID}/tags/${tagId}`, { origin: TEST_APP_ORIGIN }),
        params({ logId: ISAAC_LOG_ID, tagId }),
      );
      expect(removed.status).toBe(200);
      expect((await json<LogTagsResponse>(removed)).data).toEqual({ logId: ISAAC_LOG_ID, tags: [] });
      const again = await logTagRoute.DELETE(
        del(`/api/logs/${ISAAC_LOG_ID}/tags/${tagId}`, { origin: TEST_APP_ORIGIN }),
        params({ logId: ISAAC_LOG_ID, tagId }),
      );
      expect(again.status).toBe(200);
    });

    it("requires the configured Origin on writes", async () => {
      const missing = await logTagsRoute.POST(
        post(`/api/logs/${ISAAC_LOG_ID}/tags`, JSON.stringify({ label: "X" }), { "content-type": "application/json" }),
        params({ logId: ISAAC_LOG_ID }),
      );
      expect(missing.status).toBe(403);
      expect((await json<ErrorBody>(missing)).error.code).toBe("FORBIDDEN");

      const wrong = await logTagsRoute.POST(
        post(`/api/logs/${ISAAC_LOG_ID}/tags`, JSON.stringify({ label: "X" }), {
          ...WRITE_HEADERS,
          origin: "https://evil.example",
        }),
        params({ logId: ISAAC_LOG_ID }),
      );
      expect(wrong.status).toBe(403);

      const wrongDelete = await logTagRoute.DELETE(
        del(`/api/logs/${ISAAC_LOG_ID}/tags/50000000-0000-4000-8000-000000000123`, { origin: "http://localhost:3000" }),
        params({ logId: ISAAC_LOG_ID, tagId: "50000000-0000-4000-8000-000000000123" }),
      );
      expect(wrongDelete.status).toBe(403);
      expect((await json<LogResponse>(await logRoute.GET(get(`/api/logs/${ISAAC_LOG_ID}`), params({ logId: ISAAC_LOG_ID })))).data.tags).toEqual([]);
    });

    it("accepts an equivalent Origin spelling with a default port", async () => {
      const response = await logTagsRoute.POST(
        post(`/api/logs/${MAYA_LOG_ID}/tags`, JSON.stringify({ label: "Port check" }), {
          ...WRITE_HEADERS,
          origin: "HTTP://127.0.0.1:3000",
        }),
        params({ logId: MAYA_LOG_ID }),
      );
      expect(response.status).toBe(200);
      await resetTags(sql);
    });

    it("rejects non-JSON, oversized, malformed, and over-specified bodies", async () => {
      const path = `/api/logs/${ISAAC_LOG_ID}/tags`;
      const p = params({ logId: ISAAC_LOG_ID });

      const form = await logTagsRoute.POST(post(path, "label=x", { origin: TEST_APP_ORIGIN, "content-type": "application/x-www-form-urlencoded" }), p);
      expect(form.status).toBe(415);

      const noType = await logTagsRoute.POST(post(path, JSON.stringify({ label: "x" }), { origin: TEST_APP_ORIGIN }), p);
      expect(noType.status).toBe(415);

      const declaredTooLarge = await logTagsRoute.POST(
        post(path, JSON.stringify({ label: "x" }), { ...WRITE_HEADERS, "content-length": "5000" }),
        p,
      );
      expect(declaredTooLarge.status).toBe(413);

      const big = JSON.stringify({ label: "x", padding: "y".repeat(5000) });
      const tooLarge = await logTagsRoute.POST(post(path, big, WRITE_HEADERS), p);
      expect(tooLarge.status).toBe(413);

      // A streamed body with no Content-Length must also be bounded.
      const chunk = new TextEncoder().encode(big);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(chunk);
          controller.close();
        },
      });
      const streamedRequest = new Request(`${BASE}${path}`, {
        method: "POST",
        body: stream,
        headers: WRITE_HEADERS,
        duplex: "half",
      } as RequestInit);
      const streamed = await logTagsRoute.POST(new NextRequest(streamedRequest), p);
      expect(streamed.status).toBe(413);
      expect(streamed.headers.get("content-length")).not.toBe("5000");

      const malformed = await logTagsRoute.POST(post(path, "{not json", WRITE_HEADERS), p);
      expect(malformed.status).toBe(400);
      expect((await json<ErrorBody>(malformed)).error.code).toBe("VALIDATION_ERROR");

      const extra = await logTagsRoute.POST(post(path, JSON.stringify({ label: "x", color: "red" }), WRITE_HEADERS), p);
      expect(extra.status).toBe(400);
      expect((await json<ErrorBody>(extra)).error.fields).toHaveProperty("color");

      const notObject = await logTagsRoute.POST(post(path, JSON.stringify(["x"]), WRITE_HEADERS), p);
      expect(notObject.status).toBe(400);

      const wrongType = await logTagsRoute.POST(post(path, JSON.stringify({ label: 5 }), WRITE_HEADERS), p);
      expect(wrongType.status).toBe(400);

      const empty = await logTagsRoute.POST(post(path, null, WRITE_HEADERS), p);
      expect(empty.status).toBe(400);

      const blank = await logTagsRoute.POST(post(path, JSON.stringify({ label: "   " }), WRITE_HEADERS), p);
      expect(blank.status).toBe(400);
      expect((await json<ErrorBody>(blank)).error.fields).toHaveProperty("label");
    });

    it("returns 404 for out-of-scope logs and 409 at the tag limit", async () => {
      const other = await logTagsRoute.POST(
        post(`/api/logs/${OTHER_FARM.logId}/tags`, JSON.stringify({ label: "Intruder" }), WRITE_HEADERS),
        params({ logId: OTHER_FARM.logId }),
      );
      expect(other.status).toBe(404);

      for (let i = 1; i <= 10; i += 1) {
        const response = await logTagsRoute.POST(
          post(`/api/logs/${MAYA_LOG_ID}/tags`, JSON.stringify({ label: `Limit ${i}` }), WRITE_HEADERS),
          params({ logId: MAYA_LOG_ID }),
        );
        expect(response.status).toBe(200);
      }
      const eleventh = await logTagsRoute.POST(
        post(`/api/logs/${MAYA_LOG_ID}/tags`, JSON.stringify({ label: "Limit 11" }), WRITE_HEADERS),
        params({ logId: MAYA_LOG_ID }),
      );
      expect(eleventh.status).toBe(409);
      expect((await json<ErrorBody>(eleventh)).error.code).toBe("TAG_LIMIT_REACHED");
      await resetTags(sql);
    });
  });

  describe("configuration and availability", () => {
    it("answers 503 NOT_CONFIGURED when the farm is not configured or does not exist", async () => {
      applyEnv({ TOPH_FARM_ID: undefined });
      const missing = await dashboardRoute.GET(get("/api/dashboard"));
      expect(missing.status).toBe(503);
      expect((await json<ErrorBody>(missing)).error.code).toBe("NOT_CONFIGURED");

      applyEnv({ TOPH_FARM_ID: "00000000-0000-4000-8000-000000000042" });
      const unknown = await dashboardRoute.GET(get("/api/dashboard"));
      expect(unknown.status).toBe(503);
      expect((await json<ErrorBody>(unknown)).error.code).toBe("NOT_CONFIGURED");
    });

    it("returns a sanitized 503 without a database URL and never fake data", async () => {
      applyEnv({ DATABASE_URL: undefined });
      const dashboard = await dashboardRoute.GET(get("/api/dashboard"));
      expect(dashboard.status).toBe(503);
      const body = await json<ErrorBody>(dashboard);
      expect(body.error.code).toBe("DATABASE_UNAVAILABLE");
      expect(body).not.toHaveProperty("data");
      expect(JSON.stringify(body)).not.toMatch(/postgres|password|stack|at /);

      const health = await healthRoute.GET();
      expect(health.status).toBe(503);
      expect((await json<ErrorBody>(health)).error.code).toBe("DATABASE_UNAVAILABLE");
    });

    it("returns a sanitized 503 when the database is unreachable", async () => {
      applyEnv({ DATABASE_URL: "postgresql://toph_app:secret-value@127.0.0.1:1/toph" });
      const response = await dashboardRoute.GET(get("/api/dashboard"));
      expect(response.status).toBe(503);
      const text = await response.text();
      expect(text).not.toMatch(/secret-value|ECONNREFUSED|127\.0\.0\.1:1/);
      expect(JSON.parse(text).error.code).toBe("DATABASE_UNAVAILABLE");

      const health = await healthRoute.GET();
      expect(health.status).toBe(503);
    });

    it("reports health only after a real database check", async () => {
      const response = await healthRoute.GET();
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await json(response)).toEqual({ data: { status: "ok", database: "connected" } });
    });
  });
});
