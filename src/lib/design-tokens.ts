import type { CSSProperties } from "react";
import { tokens } from "@toph/design";

/** CSS variables are rendered on <html>, so they also exist before hydration. */
const variables: Record<`--toph-${string}`, string> = {};
const kebab = (value: string) => value.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);

for (const [name, value] of Object.entries(tokens.colors)) {
  variables[`--toph-color-${kebab(name)}`] = value;
}
for (const group of ["spacing", "radius", "fontSize", "lineHeight"] as const) {
  for (const [name, value] of Object.entries(tokens[group])) {
    variables[`--toph-${kebab(group)}-${kebab(name)}`] = `${value}px`;
  }
}
for (const [name, value] of Object.entries(tokens.fontWeight)) {
  variables[`--toph-font-weight-${name}`] = String(value);
}
variables["--toph-font-family"] = tokens.fontFamily.web;

export const webDesignTokens: CSSProperties = variables;
