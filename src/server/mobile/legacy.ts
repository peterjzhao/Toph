import "server-only";
/** The first installed app recognizes mode: demo. Only the wire label changes. */
export async function legacyBootstrap(response: Response) {
  if (!response.ok) return response;
  const body = await response.json();
  return Response.json({ ...body, data: { ...body.data, mode: "demo" } }, { headers: response.headers });
}
