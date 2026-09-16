import { readFile } from "node:fs/promises";
import path from "node:path";

export async function GET(_request: Request, { params }: { params: Promise<{ view: string }> }) {
  if (process.env.NODE_ENV !== "development") return new Response(null, { status: 404 });
  const { view } = await params;
  if (view !== "default" && view !== "expanded") return new Response(null, { status: 404 });
  const source = await readFile(path.join(process.cwd(), "design", "reference", `${view}.svg`), "utf8");
  return new Response(source, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" } });
}
