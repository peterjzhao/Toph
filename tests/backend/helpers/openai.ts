/** A completed Responses API reply whose output text is `value` as JSON. */
export const completedResponse = (value: unknown) =>
  Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });

/** A completed Responses API reply in which the model refused. */
export const refusalResponse = () =>
  Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] });
