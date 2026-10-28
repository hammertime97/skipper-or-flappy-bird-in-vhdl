/**
 * Google Play subscriptions through RevenueCat.
 *
 * Setup (once): create the subscription in Play Console, add it to a RevenueCat
 * offering with an entitlement called "pro", and put the RevenueCat Android public
 * SDK key in EXPO_PUBLIC_REVENUECAT_ANDROID_KEY.
 *
 * With a server, the backend learns about purchases from RevenueCat's webhook and stays the
 * source of truth for the plan. Without one (on-phone mode), the app asks RevenueCat directly
 * whether this Google account has Pro: see hasProOnThisDevice().
 */
import { Platform } from 'react-native';
import Purchases, { type PurchasesPackage } from 'react-native-purchases';

const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '';
export const PRO_ENTITLEMENT = 'pro';

let configured = false;

export function purchasesAvailable(): boolean {
  return Platform.OS === 'android' && ANDROID_KEY.length > 0;
}

function ensureConfigured(appUserID?: string) {
  if (configured || !purchasesAvailable()) return;
  Purchases.configure({ apiKey: ANDROID_KEY, appUserID });
  configured = true;
}

/** Tie purchases to our user id, so RevenueCat's webhook can find the account. */
export async function identifyPurchaser(userId: number) {
  if (!purchasesAvailable()) return;
  try {
    if (!configured) ensureConfigured(String(userId));
    else await Purchases.logIn(String(userId));
  } catch (e) {
    console.warn('RevenueCat identify failed', e);
  }
}

export async function resetPurchaser() {
  if (!configured) return;
  try {
    await Purchases.logOut();
  } catch {
    // logOut throws for anonymous users; nothing to do.
  }
}

/**
 * On-phone mode: does this phone's Google account have an active Pro subscription?
 * Null when subscriptions aren't set up in this build, or RevenueCat can't be reached
 * (then the app keeps the plan it last knew).
 */
export async function hasProOnThisDevice(): Promise<boolean | null> {
  if (!purchasesAvailable()) return null;
  try {
    ensureConfigured();
    const info = await Purchases.getCustomerInfo();
    return PRO_ENTITLEMENT in info.entitlements.active;
  } catch {
    return null;
  }
}

export async function getPackages(): Promise<PurchasesPackage[]> {
  if (!purchasesAvailable()) return [];
  ensureConfigured();
  const offerings = await Purchases.getOfferings();
  return offerings.current?.availablePackages ?? [];
}

/** Returns true when the user now has Pro. False if they cancelled the Play sheet. */
export async function buy(pkg: PurchasesPackage): Promise<boolean> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return PRO_ENTITLEMENT in customerInfo.entitlements.active;
  } catch (e) {
    if ((e as { userCancelled?: boolean }).userCancelled) return false;
    throw e;
  }
}

export async function restore(): Promise<boolean> {
  if (!purchasesAvailable()) return false;
  ensureConfigured();
  const info = await Purchases.restorePurchases();
  return PRO_ENTITLEMENT in info.entitlements.active;
}
