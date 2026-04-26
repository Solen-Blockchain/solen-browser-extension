// Keystore types and pure helpers.
//
// Two coexisting account kinds:
//   - "key": legacy random-seed account. Holds its own secretKey directly.
//   - "hd":  derived from a stored mnemonic at a given index. Re-derives on
//            demand; no persisted secretKey.
//
// The keystore is versioned. Bare-array keystores from before this change
// are detected and migrated transparently on first load.
//
// Persistence lives in storage.ts — this module is pure (the service worker
// has no `localStorage`, only `chrome.storage.local`, which is async).

export interface LegacyKeyAccount {
  kind: "key";
  name: string;
  accountId: string;
  publicKey: string;
  secretKey: string;
}

export interface HdAccount {
  kind: "hd";
  name: string;
  accountId: string;
  publicKey: string;
  /** ID of the StoredMnemonic this account derives from. */
  mnemonicId: string;
  /** Derivation index used at path m/44'/<coin>'/<index>'/0'. */
  derivationIndex: number;
}

export type StoredKey = LegacyKeyAccount | HdAccount;

export interface StoredMnemonic {
  id: string;
  /** User-facing label (e.g. "Default", "Hardware import"). */
  label: string;
  /** The mnemonic words. This is plaintext within the keystore — the
   *  keystore itself is AES-GCM encrypted by the wallet password before
   *  being persisted. HD accounts require a password, so this should
   *  never end up plaintext on disk. */
  mnemonic: string;
}

export interface Keystore {
  version: 2;
  mnemonics: StoredMnemonic[];
  accounts: StoredKey[];
}

export function emptyKeystore(): Keystore {
  return { version: 2, mnemonics: [], accounts: [] };
}

/**
 * Migrate any legacy storage shape into a v2 Keystore. Pure function — no
 * I/O, no side effects. Returns a fresh object so callers can compare for
 * structural change.
 */
export function migrateLegacy(raw: unknown): Keystore {
  // Bare array of legacy WalletAccount objects (pre-v2).
  if (Array.isArray(raw)) {
    const accounts: StoredKey[] = [];
    for (const item of raw) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as any).accountId === "string" &&
        typeof (item as any).publicKey === "string" &&
        typeof (item as any).secretKey === "string"
      ) {
        accounts.push({
          kind: "key",
          name: typeof (item as any).name === "string" ? (item as any).name : "",
          accountId: (item as any).accountId,
          publicKey: (item as any).publicKey,
          secretKey: (item as any).secretKey,
        });
      }
    }
    return { version: 2, mnemonics: [], accounts };
  }
  // Already v2 — pass through.
  if (raw && typeof raw === "object" && (raw as any).version === 2) {
    return raw as Keystore;
  }
  // Unknown shape — start fresh rather than risk silently losing data.
  return emptyKeystore();
}

// ── Conversion helpers (Keystore ↔ in-memory WalletAccount) ────

import { accountFromMnemonic } from "./hd";
import { bytesToHex } from "@noble/hashes/utils";
import type { WalletAccount } from "./wallet";

/**
 * Build the in-memory WalletAccount[] from the keystore. For "hd" accounts,
 * the secretKey is re-derived from the mnemonic at the recorded index.
 * Throws if an "hd" account references a mnemonicId that no longer exists.
 */
export async function hydrateAccounts(ks: Keystore): Promise<WalletAccount[]> {
  const out: WalletAccount[] = [];
  for (const a of ks.accounts) {
    if (a.kind === "key") {
      out.push({
        name: a.name,
        accountId: a.accountId,
        publicKey: a.publicKey,
        secretKey: a.secretKey,
      });
    } else {
      const mnem = ks.mnemonics.find((m) => m.id === a.mnemonicId);
      if (!mnem) {
        throw new Error(`HD account "${a.name}" references missing mnemonic ${a.mnemonicId}`);
      }
      const derived = await accountFromMnemonic(mnem.mnemonic, a.derivationIndex);
      out.push({
        name: a.name,
        accountId: a.accountId,
        publicKey: a.publicKey,
        secretKey: bytesToHex(derived.privateSeed) + bytesToHex(derived.publicKey),
        hd: { mnemonicId: a.mnemonicId, derivationIndex: a.derivationIndex },
      });
    }
  }
  return out;
}

/**
 * Convert an in-memory WalletAccount back into a StoredKey for persistence.
 * For HD accounts, the secretKey is dropped — only metadata is persisted.
 */
export function dehydrateAccount(a: WalletAccount): StoredKey {
  if (a.hd) {
    return {
      kind: "hd",
      name: a.name,
      accountId: a.accountId,
      publicKey: a.publicKey,
      mnemonicId: a.hd.mnemonicId,
      derivationIndex: a.hd.derivationIndex,
    };
  }
  return {
    kind: "key",
    name: a.name,
    accountId: a.accountId,
    publicKey: a.publicKey,
    secretKey: a.secretKey,
  };
}

/** Replace the stored accounts list with the dehydrated form of `accounts`. */
export function withAccounts(ks: Keystore, accounts: WalletAccount[]): Keystore {
  return { ...ks, accounts: accounts.map(dehydrateAccount) };
}

/** Find the highest derivation index already used for a mnemonic, or -1 if none. */
export function highestIndexFor(ks: Keystore, mnemonicId: string): number {
  let max = -1;
  for (const a of ks.accounts) {
    if (a.kind === "hd" && a.mnemonicId === mnemonicId && a.derivationIndex > max) {
      max = a.derivationIndex;
    }
  }
  return max;
}
