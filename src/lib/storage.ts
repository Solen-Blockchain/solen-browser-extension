/**
 * Extension storage wrapper. Uses chrome.storage.local with encryption.
 *
 * Persists a v2 Keystore (see ./keystore.ts) — encrypted blob when a password
 * is set, plaintext otherwise. Old bare-array shapes (from before HD support)
 * are migrated transparently on load.
 */

import { type Keystore, emptyKeystore, migrateLegacy } from "./keystore";
import { type NetworkId, DEFAULT_NETWORK } from "./networks";
import { encrypt, decrypt, hashPassword } from "./crypto";
import type { TokenInfo, IndexedTx } from "./rpc";

const KEYS = {
  KEYSTORE_ENCRYPTED: "solen_accounts_enc",
  KEYSTORE_PLAIN: "solen_accounts",
  PW_HASH: "solen_pw_hash",
  NETWORK: "solen_network",
  LOCK_TIMEOUT: "solen_lock_timeout",
  CONNECTED_SITES: "solen_connected_sites",
  ACTIVE_ACCOUNT: "solen_active_account",
  ACCOUNT_CACHE_PREFIX: "solen_account_cache_",
};

async function get<T>(key: string): Promise<T | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      resolve(result[key] ?? null);
    });
  });
}

async function set(key: string, value: unknown): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

async function remove(key: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(key, resolve);
  });
}

// ── Keystore ──────────────────────────────────────────────────

/**
 * Load the keystore. If `password` is provided and an encrypted blob exists,
 * decrypts it; otherwise reads the plaintext form. Bare-array (pre-HD) shapes
 * are migrated transparently. Returns an empty keystore if nothing is stored.
 */
export async function loadKeystore(password?: string): Promise<Keystore> {
  const encrypted = await get<string>(KEYS.KEYSTORE_ENCRYPTED);
  if (encrypted && password) {
    const json = await decrypt(encrypted, password);
    const parsed = JSON.parse(json);
    return migrateLegacy(parsed);
  }

  const plain = await get<string>(KEYS.KEYSTORE_PLAIN);
  if (!plain) return emptyKeystore();
  try {
    const parsed = JSON.parse(plain);
    return migrateLegacy(parsed);
  } catch {
    return emptyKeystore();
  }
}

/**
 * Save the keystore. If a password is set AND `password` is provided, writes
 * the encrypted blob; otherwise writes plaintext (callers should ensure they
 * don't pass mnemonic-bearing keystores into the plaintext path).
 */
export async function saveKeystore(ks: Keystore, password?: string): Promise<void> {
  const pwHash = await get<string>(KEYS.PW_HASH);
  if (pwHash && password) {
    const enc = await encrypt(JSON.stringify(ks), password);
    await set(KEYS.KEYSTORE_ENCRYPTED, enc);
    await remove(KEYS.KEYSTORE_PLAIN);
  } else {
    await set(KEYS.KEYSTORE_PLAIN, JSON.stringify(ks));
  }
}

// ── Password ──────────────────────────────────────────────────

export async function hasPassword(): Promise<boolean> {
  return !!(await get<string>(KEYS.PW_HASH));
}

export async function verifyPassword(password: string): Promise<boolean> {
  const stored = await get<string>(KEYS.PW_HASH);
  if (!stored) return true;
  const hash = await hashPassword(password);
  return hash === stored;
}

export async function setPassword(password: string, ks: Keystore): Promise<void> {
  const hash = await hashPassword(password);
  await set(KEYS.PW_HASH, hash);
  const enc = await encrypt(JSON.stringify(ks), password);
  await set(KEYS.KEYSTORE_ENCRYPTED, enc);
  await remove(KEYS.KEYSTORE_PLAIN);
}

/**
 * Remove the password and persist the keystore as plaintext. Caller must
 * ensure `ks` has no mnemonics — surfacing them as plaintext is a footgun
 * we refuse at the service-worker boundary.
 */
export async function removePassword(password: string, ks: Keystore): Promise<void> {
  if (!(await verifyPassword(password))) throw new Error("Wrong password");
  await remove(KEYS.PW_HASH);
  await remove(KEYS.KEYSTORE_ENCRYPTED);
  await set(KEYS.KEYSTORE_PLAIN, JSON.stringify(ks));
}

// ── Network ───────────────────────────────────────────────────

export async function getNetwork(): Promise<NetworkId> {
  return (await get<NetworkId>(KEYS.NETWORK)) || DEFAULT_NETWORK;
}

export async function setNetwork(network: NetworkId): Promise<void> {
  await set(KEYS.NETWORK, network);
}

// ── Active account ────────────────────────────────────────────

export async function getActiveAccountId(): Promise<string | null> {
  return get<string>(KEYS.ACTIVE_ACCOUNT);
}

export async function setActiveAccountId(id: string): Promise<void> {
  await set(KEYS.ACTIVE_ACCOUNT, id);
}

// ── Connected sites ───────────────────────────────────────────

export async function getConnectedSites(): Promise<string[]> {
  return (await get<string[]>(KEYS.CONNECTED_SITES)) || [];
}

export async function addConnectedSite(origin: string): Promise<void> {
  const sites = await getConnectedSites();
  if (!sites.includes(origin)) {
    sites.push(origin);
    await set(KEYS.CONNECTED_SITES, sites);
  }
}

export async function removeConnectedSite(origin: string): Promise<void> {
  const sites = await getConnectedSites();
  await set(KEYS.CONNECTED_SITES, sites.filter((s) => s !== origin));
}

// ── Account snapshot cache ────────────────────────────────────
//
// Last-known balance/tokens/transactions for a given (network, account),
// persisted to chrome.storage so the popup can paint immediately on cold
// service-worker starts instead of flashing a zero balance while RPC loads.

export interface AccountSnapshot {
  balance: string | null;
  tokens: TokenInfo[];
  transactions: IndexedTx[];
  updatedAt: number;
}

function snapshotKey(network: NetworkId, accountId: string): string {
  return `${KEYS.ACCOUNT_CACHE_PREFIX}${network}_${accountId}`;
}

export async function getAccountSnapshot(
  network: NetworkId,
  accountId: string,
): Promise<AccountSnapshot | null> {
  return get<AccountSnapshot>(snapshotKey(network, accountId));
}

export async function setAccountSnapshot(
  network: NetworkId,
  accountId: string,
  snap: AccountSnapshot,
): Promise<void> {
  await set(snapshotKey(network, accountId), snap);
}

// ── Lock timeout ──────────────────────────────────────────────

export async function getLockTimeout(): Promise<number> {
  return (await get<number>(KEYS.LOCK_TIMEOUT)) || 600_000;
}

export async function setLockTimeout(ms: number): Promise<void> {
  await set(KEYS.LOCK_TIMEOUT, ms);
}
