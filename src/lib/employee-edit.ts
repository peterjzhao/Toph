import type { Employee } from "../contracts/workspace";

/** Keep live changes to untouched fields while applying the person's open form draft. */
export function mergeEmployeeEdit(latest: Employee, original: Employee, draft: Employee): Employee {
  return {
    ...latest,
    name: draft.name === original.name ? latest.name : draft.name,
    role: draft.role === original.role ? latest.role : draft.role,
    email: draft.email === original.email ? latest.email : draft.email,
    phone: draft.phone === original.phone ? latest.phone : draft.phone,
    status: draft.status === original.status ? latest.status : draft.status,
  };
}
