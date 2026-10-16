/**
 * Web stand-in for expo-secure-store, whose web module is empty (every call
 * throws), so the browser dev build could never keep a session. There is no
 * keychain in a browser; localStorage is the closest equivalent. Native
 * builds never load this file.
 */
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 0;

type Options = { keychainAccessible?: number };

export async function getItemAsync(key: string): Promise<string | null> {
  return globalThis.localStorage?.getItem(key) ?? null;
}

export async function setItemAsync(key: string, value: string, _options?: Options): Promise<void> {
  globalThis.localStorage?.setItem(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  globalThis.localStorage?.removeItem(key);
}
