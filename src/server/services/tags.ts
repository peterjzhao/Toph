import "server-only";
/**
 * Tag mutations. Each call runs in one transaction that first locks the farm-scoped log row
 * (SELECT ... FOR UPDATE), so concurrent additions and removals for the same log are
 * serialized: the ten-tag limit cannot be bypassed and duplicate requests converge on one
 * catalog entry and one association.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { TagDto } from "@/contracts/dashboard";
import type { FarmContext } from "@/server/farm-context";
import type { Database } from "@/server/db/client";
import { tags, workLogTags, workLogs } from "@/server/db/schema";
import { notFound, tagLimitReached } from "@/server/errors";
import { parseUuid } from "@/server/validation/ids";
import { MAX_TAGS_PER_LOG, normalizeTagLabel } from "@/server/validation/tag-label";

export type LogTagsResult = { logId: string; tags: TagDto[] };

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function lockLog(tx: Transaction, farmId: string, logId: string): Promise<void> {
  const [log] = await tx
    .select({ id: workLogs.id })
    .from(workLogs)
    .where(and(eq(workLogs.farmId, farmId), eq(workLogs.id, logId)))
    .for("update");
  if (!log) throw notFound("Log not found.");
}

async function loadLogTags(tx: Transaction, logId: string): Promise<TagDto[]> {
  const rows = await tx
    .select({ id: tags.id, label: tags.label })
    .from(workLogTags)
    .innerJoin(tags, and(eq(tags.id, workLogTags.tagId), eq(tags.farmId, workLogTags.farmId)))
    .where(eq(workLogTags.workLogId, logId))
    .orderBy(asc(tags.normalizedLabel), asc(tags.id));
  return rows.map((r) => ({ id: r.id, label: r.label }));
}

async function touchLog(tx: Transaction, logId: string): Promise<void> {
  await tx.update(workLogs).set({ updatedAt: sql`now()` }).where(eq(workLogs.id, logId));
}

/**
 * Assigns a tag (created on first use, matched case-insensitively afterwards) to a log in the
 * context's farm. Re-assigning an existing tag is an idempotent success, even at the limit.
 */
export async function addLogTag(ctx: FarmContext, logId: string, label: unknown): Promise<LogTagsResult> {
  const id = parseUuid(logId, "logId");
  const normalized = normalizeTagLabel(label);

  return ctx.db.transaction(async (tx) => {
    await lockLog(tx, ctx.farmId, id);

    // Resolve the catalog entry. ON CONFLICT DO NOTHING needs no UPDATE privilege on tags and
    // waits for a concurrent insert of the same label to commit before the fallback SELECT.
    const inserted = await tx
      .insert(tags)
      .values({ id: randomUUID(), farmId: ctx.farmId, label: normalized.label, normalizedLabel: normalized.normalizedLabel })
      .onConflictDoNothing({ target: [tags.farmId, tags.normalizedLabel] })
      .returning({ id: tags.id });
    let tagId = inserted[0]?.id;
    if (!tagId) {
      const [existing] = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.farmId, ctx.farmId), eq(tags.normalizedLabel, normalized.normalizedLabel)));
      if (!existing) throw new Error("Tag resolution failed after conflict.");
      tagId = existing.id;
    }

    const current = await tx.select({ tagId: workLogTags.tagId }).from(workLogTags).where(eq(workLogTags.workLogId, id));
    if (current.some((row) => row.tagId === tagId)) {
      return { logId: id, tags: await loadLogTags(tx, id) };
    }
    // Throwing rolls the transaction back, including a catalog entry created above.
    if (current.length >= MAX_TAGS_PER_LOG) throw tagLimitReached(MAX_TAGS_PER_LOG);

    await tx.insert(workLogTags).values({ farmId: ctx.farmId, workLogId: id, tagId });
    await touchLog(tx, id);
    return { logId: id, tags: await loadLogTags(tx, id) };
  });
}

/**
 * Removes a tag association from a log in the context's farm. The reusable tag record is kept.
 * Removing a tag that is not assigned (or does not exist) is an idempotent success.
 */
export async function removeLogTag(ctx: FarmContext, logId: string, tagId: string): Promise<LogTagsResult> {
  const id = parseUuid(logId, "logId");
  const tag = parseUuid(tagId, "tagId");

  return ctx.db.transaction(async (tx) => {
    await lockLog(tx, ctx.farmId, id);
    const deleted = await tx
      .delete(workLogTags)
      .where(and(eq(workLogTags.farmId, ctx.farmId), eq(workLogTags.workLogId, id), eq(workLogTags.tagId, tag)))
      .returning({ tagId: workLogTags.tagId });
    if (deleted.length > 0) await touchLog(tx, id);
    return { logId: id, tags: await loadLogTags(tx, id) };
  });
}
