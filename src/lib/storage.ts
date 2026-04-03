/**
 * Extension storage wrapper. Uses chrome.storage.local with encryption for keys.
 */

import { type WalletAccount } from "./wallet";
import { type NetworkId, DEFAULT_NETWORK } from "./networks";
import { encrypt, decrypt, hashPassword } from "./crypto";

const KEYS = {
  ACCOUNTS_ENCRYPTED: "solen_accounts_enc",
  ACCOUNTS_PLAIN: "solen_accounts",
  PW_HASH: "solen_pw_hash",
  NETWORK: "solen_network",
  LOCK_TIMEOUT: "solen_lock_timeout",
  CONNECTED_SITES: "solen_connected_sites",
  ACTIVE_ACCOUNT: "solen_active_account",
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

// ── Accounts ──────────────────────────────────────────────────

export async function loadAccounts(password?: string): Promise<WalletAccount[]> {
  // Try encrypted first.
  const encrypted = await get<string>(KEYS.ACCOUNTS_ENCRYPTED);
  if (encrypted && password) {
    const json = await decrypt(encrypted, password);
    return JSON.parse(json);
  }

  // Fall back to plaintext.
  const plain = await get<string>(KEYS.ACCOUNTS_PLAIN);
  return plain ? JSON.parse(plain) : [];
}

export async function saveAccounts(accounts: WalletAccount[], password?: string): Promise<void> {
  const pwHash = await get<string>(KEYS.PW_HASH);
  if (pwHash && password) {
    const enc = await encrypt(JSON.stringify(accounts), password);
    await set(KEYS.ACCOUNTS_ENCRYPTED, enc);
    await remove(KEYS.ACCOUNTS_PLAIN);
  } else {
    await set(KEYS.ACCOUNTS_PLAIN, JSON.stringify(accounts));
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

export async function setPassword(password: string, accounts: WalletAccount[]): Promise<void> {
  const hash = await hashPassword(password);
  await set(KEYS.PW_HASH, hash);
  const enc = await encrypt(JSON.stringify(accounts), password);
  await set(KEYS.ACCOUNTS_ENCRYPTED, enc);
  await remove(KEYS.ACCOUNTS_PLAIN);
}

export async function removePassword(password: string, accounts: WalletAccount[]): Promise<void> {
  if (!(await verifyPassword(password))) throw new Error("Wrong password");
  await remove(KEYS.PW_HASH);
  await remove(KEYS.ACCOUNTS_ENCRYPTED);
  await set(KEYS.ACCOUNTS_PLAIN, JSON.stringify(accounts));
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

// ── Lock timeout ──────────────────────────────────────────────

export async function getLockTimeout(): Promise<number> {
  return (await get<number>(KEYS.LOCK_TIMEOUT)) || 600_000; // 10 min default
}

export async function setLockTimeout(ms: number): Promise<void> {
  await set(KEYS.LOCK_TIMEOUT, ms);
}
