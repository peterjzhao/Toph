/** Serializable account and farm-onboarding contract, shared by web and mobile. */
export type AccountRole = "admin" | "worker";
export type AccountDto = { id: string; name: string; role: AccountRole; employeeId: string | null };
export type AccountFarmDto = { id: string; name: string; timezone: string; isDemo: boolean; setupComplete: boolean };
export type AccountSession = { account: AccountDto; farm: AccountFarmDto; joinCode?: string };
export type AuthResponse = { data: AccountSession & { token?: string } };
export type AuthClient = "web" | "mobile";
export type SignupRequest = { name: string; farmName: string; timezone?: string; client?: AuthClient };
export type JoinFarmRequest = { name: string; code: string; client?: AuthClient };
export type LoginRequest = { name: string; client?: AuthClient };
export type FieldPoint = { x: number; y: number };
export type FarmFieldDto = { id: string; label: string; boundary: FieldPoint[] };
export type FarmImageDto = { url: string; width: number; height: number };
export type FarmSetup = { image: FarmImageDto | null; fields: FarmFieldDto[]; setupComplete: boolean };
export type FarmSetupResponse = { data: FarmSetup };
export type SaveFarmSetupRequest = {
  image?: { dataUrl: string; width: number; height: number };
  fields: Array<{ id?: string; label: string; boundary: FieldPoint[] }>;
};
export type FarmMemberDto = { id: string; name: string; employeeId: string | null; role: AccountRole; active: boolean };
export type FarmMembersResponse = { data: FarmMemberDto[] };
