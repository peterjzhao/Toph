/** Serializable account and farm-onboarding contract, shared by web and mobile. */
export type AccountRole = "admin" | "worker";
export type AccountDto = { id: string; name: string; role: AccountRole; employeeId: string | null };
export type AccountFarmDto = { id: string; name: string; timezone: string; setupComplete: boolean };
export type AccountSession = { account: AccountDto; farm: AccountFarmDto; joinCode?: string };
export type AuthResponse = { data: AccountSession & { token?: string } };
export type AuthClient = "web" | "mobile";
/** New passwords must be this long; login accepts any length so first-name initial passwords work. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;
/** Shared by the web and mobile create-account forms; the server re-validates the length. */
export function newPasswordProblem(password: string, confirmation: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use a password with at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Use a password with at most ${PASSWORD_MAX_LENGTH} characters.`;
  return password === confirmation ? null : "The two passwords don’t match.";
}
export type SignupRequest = { name: string; password: string; farmName: string; timezone?: string; client?: AuthClient };
export type JoinFarmRequest = { name: string; password: string; code: string; client?: AuthClient };
export type LoginRequest = { name: string; password: string; client?: AuthClient };
export type FieldPoint = { x: number; y: number };
export type FarmFieldDto = { id: string; label: string; boundary: FieldPoint[] };
export type FarmImageDto = { url: string; width: number; height: number };
export type FarmSetup = { image: FarmImageDto | null; fields: FarmFieldDto[]; setupComplete: boolean };
export type FarmSetupResponse = { data: FarmSetup };
export type SaveFarmSetupRequest = {
  /** Web Mercator "minX,minY,maxX,maxY" when the view came from the map picker; absent for uploads. */
  image?: { dataUrl: string; width: number; height: number; bbox?: string };
  fields: Array<{ id?: string; label: string; boundary: FieldPoint[] }>;
};
export type FarmMemberDto = { id: string; name: string; employeeId: string | null; role: AccountRole; active: boolean };
export type FarmMembersResponse = { data: FarmMemberDto[] };
