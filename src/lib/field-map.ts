import regions from "../../public/assets/field-maps/regions.json";

// Illustration coordinates for the seeded farm, never surveyed/GPS boundaries.
export const fieldMapRegions = regions.fields;

export function fieldMapRegion(fieldId: string) {
  return fieldMapRegions.find(region => region.fieldId === fieldId);
}

export function fieldMapImage(fieldId: string, originalUrl?: string | null) {
  const region = fieldMapRegion(fieldId);
  // Preserve custom imagery; these polygons only describe this particular map.
  if (region && (!originalUrl || originalUrl === "/assets/field-map.svg" || originalUrl === region.imageUrl)) return region.imageUrl;
  return originalUrl ?? "";
}

export function fieldMapHref(fieldId: string) {
  return `/map?field=${encodeURIComponent(fieldId)}`;
}
