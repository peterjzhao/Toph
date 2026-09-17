/** Shared form vocabulary; safe to import in web, native, and server code. */
export const workActivities = ["Spraying", "Fertilizing", "Planting", "Irrigation", "Harvesting", "Scouting", "Pruning", "Soil work", "Equipment maintenance", "Weeding", "Monitoring", "Soil Testing", "Seeding", "Pest Control"] as const;
export const treatmentActivities = ["Spraying", "Fertilizing", "Pest Control"] as const;
export const treatmentUnits = ["L", "mL", "kg", "g", "gal", "lb"] as const;
export const workTags = ["Needs review", "Equipment", "Follow-up"] as const;

/** Activity-specific meaning of the extraction product/amount/unit fields. */
export type WorkActivityDetails = {
  itemLabel?: string;
  quantityLabel?: string;
  units?: readonly string[];
  notesLabel?: string;
};

export const workActivityDetails: Record<string, WorkActivityDetails> = {
  Spraying: { itemLabel: "Product", quantityLabel: "Amount applied", units: treatmentUnits },
  Fertilizing: { itemLabel: "Fertilizer", quantityLabel: "Amount applied", units: ["kg", "g", "lb", "L", "mL", "gal"] },
  "Pest Control": { itemLabel: "Product", quantityLabel: "Amount applied", units: treatmentUnits },
  Planting: { itemLabel: "Crop / variety", quantityLabel: "Plants planted", units: ["plants", "trays", "rows"] },
  Seeding: { itemLabel: "Seed / variety", quantityLabel: "Seed sown", units: ["kg", "g", "lb", "seeds", "trays"] },
  Harvesting: { itemLabel: "Crop / variety", quantityLabel: "Yield", units: ["kg", "lb", "bins", "crates", "bunches"] },
  Irrigation: { itemLabel: "Irrigation method", notesLabel: "Observations" },
  Pruning: { itemLabel: "Crop / variety", notesLabel: "Work performed" },
  "Soil work": { itemLabel: "Operation", notesLabel: "Work performed" },
  Weeding: { itemLabel: "Weeding method", notesLabel: "Work performed" },
  "Equipment maintenance": { itemLabel: "Equipment", notesLabel: "Work performed" },
  Scouting: { notesLabel: "Observations" },
  Monitoring: { notesLabel: "Observations" },
  "Soil Testing": { itemLabel: "Test type", notesLabel: "Results / observations" },
};


export const workUnits = [...treatmentUnits, "plants", "trays", "rows", "seeds", "bins", "crates", "bunches"] as const;
