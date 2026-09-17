/** Shared form vocabulary; safe to import in web, native, and server code. */
export const workActivities = ["Spraying", "Fertilizing", "Planting", "Irrigation", "Harvesting", "Scouting", "Pruning", "Soil work", "Equipment maintenance", "Weeding", "Monitoring", "Soil Testing", "Seeding", "Pest Control"] as const;
export const treatmentActivities = ["Spraying", "Fertilizing", "Pest Control"] as const;
export const treatmentUnits = ["L", "mL", "kg", "g", "gal", "lb"] as const;
export const workTags = ["Needs review", "Equipment", "Follow-up"] as const;
