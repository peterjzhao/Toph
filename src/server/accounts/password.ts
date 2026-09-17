/**
 * Password hashing for accounts. Clients send the password over HTTPS; only this module turns it
 * into the stored `scrypt$<salt>$<hash>` value, so web and mobile share one implementation.
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type postgres from "postgres";

const KEY_BYTES = 64;
const derive = (password: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) =>
  scrypt(password.normalize("NFKC"), salt, KEY_BYTES, (error, key) => error ? reject(error) : resolve(key)));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${(await derive(password, salt)).toString("hex")}`;
}

/** Always derives a key, so a missing account or hash costs the same time as a wrong password. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const [scheme, salt, hash] = (stored ?? "").split("$");
  const valid = scheme === "scrypt" && /^[0-9a-f]{32}$/.test(salt ?? "") && /^[0-9a-f]{128}$/.test(hash ?? "");
  const key = await derive(password, valid ? Buffer.from(salt, "hex") : Buffer.alloc(16));
  return valid && timingSafeEqual(key, Buffer.from(hash, "hex"));
}

/** Accounts that predate passwords, and the seeded sample farm, sign in with their lowercased first name. */
export const initialPassword = (name: string) => name.normalize("NFKC").trim().split(/\s+/u)[0].toLowerCase();

/** Gives every account without a password its initial one. Idempotent; run by db:migrate. */
export async function backfillPasswords(sql: postgres.Sql | postgres.TransactionSql): Promise<number> {
  const rows = await sql<{ id: string; name: string }[]>`select id, name from toph.accounts where password_hash is null`;
  for (const row of rows) await sql`update toph.accounts set password_hash = ${await hashPassword(initialPassword(row.name))} where id = ${row.id} and password_hash is null`;
  return rows.length;
}
