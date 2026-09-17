/** Device form configuration. Extra crop/operation details stay in the local draft. */
import { workActivityDetails, type WorkActivityDetails } from "@toph/contracts/recording";

export type ActivityForm = WorkActivityDetails;

export const activityForm = (activity: string): ActivityForm => workActivityDetails[activity] ?? {};

export function activityDetailSummary(details: { activity: string; product: string; amount: string; unit: string }) {
  const form = activityForm(details.activity);
  return [form.itemLabel && details.product ? `${form.itemLabel}: ${details.product}` : "",
    form.quantityLabel && details.amount ? `${form.quantityLabel}: ${details.amount} ${details.unit}` : ""].filter(Boolean).join(" · ");
}
