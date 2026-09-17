import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const storageKey = "toph.account-session.v1";
type SavedToken = { origin: string; token: string };
let current: SavedToken | null = null;

/** Never attach a farm session to a different API origin or a third-party media URL. */
export function sessionHeaders(origin: string): Record<string, string> {
  return current?.origin === origin ? { Authorization: `Bearer ${current.token}` } : {};
}

export async function restoreSessionToken(origin: string): Promise<boolean> {
  current = null;
  // Expo web previews keep the token in memory only; native uses Keychain/Keystore.
  if (Platform.OS === "web") return false;
  const stored = await SecureStore.getItemAsync(storageKey);
  if (!stored) return false;
  try {
    const value = JSON.parse(stored) as Partial<SavedToken>;
    if (value.origin !== origin || typeof value.token !== "string" || !value.token) return false;
    current = { origin, token: value.token };
    return true;
  } catch { return false; }
}

export async function saveSessionToken(origin: string, token: string): Promise<void> {
  if (!token) throw new Error("The server did not provide a sign-in session. Please try again.");
  const next = { origin, token };
  if (Platform.OS !== "web") await SecureStore.setItemAsync(storageKey, JSON.stringify(next), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  current = next;
}

export async function clearSessionToken(): Promise<void> {
  if (Platform.OS !== "web") await SecureStore.deleteItemAsync(storageKey);
  current = null;
}
