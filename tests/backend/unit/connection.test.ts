import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveSslOption } from "@/server/db/connection";
import { mapDatabaseError, redactConnectionStrings } from "@/server/db/errors";
import { normalizeOrigin } from "@/server/http/origin";

describe("resolveSslOption", () => {
  it("uses no TLS for loopback hosts unless requested", () => {
    expect(resolveSslOption("postgresql://u:p@127.0.0.1:54329/toph")).toBe(false);
    expect(resolveSslOption("postgresql://u:p@localhost/toph")).toBe(false);
    expect(resolveSslOption("postgresql://u:p@localhost/toph?sslmode=require")).toEqual({ rejectUnauthorized: true });
  });

  it("always verifies certificates for remote hosts, even with sslmode=require", () => {
    expect(resolveSslOption("postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require")).toEqual({
      rejectUnauthorized: true,
    });
    expect(resolveSslOption("postgresql://u:p@db.example.supabase.co:5432/postgres")).toEqual({ rejectUnauthorized: true });
  });

  it("rejects remote TLS opt-outs but permits explicit plaintext on loopback", () => {
    expect(() => resolveSslOption("postgresql://u:p@db.internal:5432/postgres?sslmode=disable"))
      .toThrow("TLS cannot be disabled for a remote database.");
    expect(resolveSslOption("postgresql://u:p@localhost/toph?sslmode=disable")).toBe(false);
  });

  it("loads a CA bundle from the configured path", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "toph-ca-"));
    const caPath = path.join(dir, "ca.pem");
    try {
      writeFileSync(caPath, "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n");
      expect(resolveSslOption("postgresql://u:p@db.example.supabase.co/postgres", caPath)).toEqual({
        rejectUnauthorized: true,
        ca: "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n",
      });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("loads the shipped public CA by the same relative path used on Vercel", () => {
    const caPath = "certs/supabase-prod-ca-2021.crt";
    const ca = readFileSync(caPath, "utf8");
    expect(new X509Certificate(ca).ca).toBe(true);
    const ssl = resolveSslOption("postgresql://u:p@db.example.supabase.co/postgres?sslmode=require", caPath);
    // No custom checkServerIdentity: Node's default hostname verification remains active.
    expect(ssl).toEqual({ rejectUnauthorized: true, ca });
  });

  it("fails closed when the configured CA is missing", () => {
    expect(() => resolveSslOption("postgresql://u:p@db.example.supabase.co/postgres", "certs/missing.crt"))
      .toThrow();
  });
});

describe("mapDatabaseError", () => {
  it("maps connection and authentication failures, including wrapped causes, to a sanitized 503", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), { code: "ECONNREFUSED" });
    expect(mapDatabaseError(refused)?.status).toBe(503);
    const wrapped = new Error("Failed query: select 1", { cause: refused });
    expect(mapDatabaseError(wrapped)?.status).toBe(503);
    expect(mapDatabaseError(wrapped)?.message).not.toMatch(/127\.0\.0\.1/);
    const badPassword = Object.assign(new Error("password authentication failed"), { code: "28P01" });
    expect(mapDatabaseError(badPassword)?.code).toBe("DATABASE_UNAVAILABLE");
    const missingTable = Object.assign(new Error('relation "toph.farms" does not exist'), { code: "42P01" });
    expect(mapDatabaseError(missingTable)?.message).toMatch(/not been migrated/);
  });

  it("leaves unrelated errors to the generic handler", () => {
    expect(mapDatabaseError(new Error("boom"))).toBeNull();
    expect(mapDatabaseError(Object.assign(new Error("dup"), { code: "23505" }))).toBeNull();
  });
});

describe("redactConnectionStrings", () => {
  it("removes credentials from anything shaped like a connection string", () => {
    expect(redactConnectionStrings("could not connect to postgresql://toph_app:s3cret@db.example.com:5432/toph now")).toBe(
      "could not connect to postgresql://[redacted] now",
    );
    expect(redactConnectionStrings("postgres://a:b@c/d")).toBe("postgresql://[redacted]");
  });
});

describe("normalizeOrigin", () => {
  it("canonicalizes scheme and host and drops default ports", () => {
    expect(normalizeOrigin("HTTP://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(normalizeOrigin("https://Toph.Example.com:443")).toBe("https://toph.example.com");
    expect(normalizeOrigin("null")).toBeNull();
    expect(normalizeOrigin("file:///tmp/x")).toBeNull();
    expect(normalizeOrigin("")).toBeNull();
  });
});
