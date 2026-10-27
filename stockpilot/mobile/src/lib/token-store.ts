import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Keychain/Keystore on the phone; localStorage for the web preview, where SecureStore isn't available.
export const tokenStore = {
  get: (key: string): Promise<string | null> =>
    Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.getItem(key) ?? null) : SecureStore.getItemAsync(key),
  set: (key: string, value: string): Promise<void> =>
    Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.setItem(key, value)) : SecureStore.setItemAsync(key, value),
  remove: (key: string): Promise<void> =>
    Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.removeItem(key)) : SecureStore.deleteItemAsync(key),
};
