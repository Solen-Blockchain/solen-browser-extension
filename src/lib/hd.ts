// BIP-39 mnemonic + SLIP-0010 ed25519 HD derivation for Solen.
//
// All functions are pure — no I/O, no storage. The Keystore module wraps
// these for persistence; this module is what gets exercised by test vectors.

import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2";
import { hmac } from "@noble/hashes/hmac";
import { bytesToHex } from "@noble/hashes/utils";
import {
  generateMnemonic as bip39Generate,
  validateMnemonic as bip39Validate,
  mnemonicToSeed as bip39ToSeed,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

import { base58Encode } from "./wallet";

// @noble/ed25519 v3 dispatches async hashing through `hashes.sha512Async`.
// Browsers expose crypto.subtle natively so the lib's default polyfill works
// there. In Node (tests, server-side derivation) we wire up a pure-JS sha512
// from @noble/hashes so we don't need a WebCrypto polyfill.
(ed25519.hashes as Record<string, unknown>).sha512Async = async (msg: Uint8Array) =>
  sha512(msg);
(ed25519.hashes as Record<string, unknown>).sha512 = (msg: Uint8Array) => sha512(msg);

/**
 * Solen's SLIP-0044 coin type. Pending registration via PR
 * https://github.com/satoshilabs/slips/pull/2010 — chosen to encode the
 * mainnet launch date 2026-04-24. If maintainers redirect to a different
 * number, change this constant and re-derive any dev/test accounts.
 */
export const SOLEN_COIN_TYPE = 20260424;

const HARDENED_OFFSET = 0x80000000;
const ED25519_CURVE_KEY = new TextEncoder().encode("ed25519 seed");

// ── BIP-39 ──────────────────────────────────────────────────────

/** Generate a fresh 24-word BIP-39 mnemonic (256-bit entropy). */
export function generateMnemonic24(): string {
  return bip39Generate(wordlist, 256);
}

/** Returns true iff `mnemonic` is a valid BIP-39 phrase in the English wordlist. */
export function isValidMnemonic(mnemonic: string): boolean {
  return bip39Validate(mnemonic, wordlist);
}

/**
 * BIP-39 mnemonic → 64-byte seed via PBKDF2-HMAC-SHA512.
 * Throws if the mnemonic fails checksum validation.
 */
export async function mnemonicToSeed(mnemonic: string, passphrase: string = ""): Promise<Uint8Array> {
  if (!isValidMnemonic(mnemonic)) {
    throw new Error("invalid mnemonic (checksum failed)");
  }
  return bip39ToSeed(mnemonic, passphrase);
}

// ── SLIP-0010 ed25519 derivation ────────────────────────────────

/** Master key derivation per SLIP-0010 ed25519 (HMAC-SHA512 with curve seed). */
function deriveMaster(seed: Uint8Array): { key: Uint8Array; chainCode: Uint8Array } {
  const I = hmac(sha512, ED25519_CURVE_KEY, seed);
  return { key: I.slice(0, 32), chainCode: I.slice(32, 64) };
}

/**
 * Child key derivation (CKDpriv) for ed25519. Only hardened derivation is
 * defined for ed25519 in SLIP-0010; the index is always combined with the
 * hardened offset internally. Caller passes the human-readable index in
 * [0, 2^31).
 */
function ckdPriv(
  parentKey: Uint8Array,
  parentChainCode: Uint8Array,
  index: number,
): { key: Uint8Array; chainCode: Uint8Array } {
  if (!Number.isInteger(index) || index < 0 || index >= HARDENED_OFFSET) {
    throw new Error(`HD index must be an integer in [0, 2^31): got ${index}`);
  }
  const data = new Uint8Array(1 + 32 + 4);
  data[0] = 0x00;
  data.set(parentKey, 1);
  // ser32(i') as big-endian uint32 with the hardened bit set
  new DataView(data.buffer).setUint32(33, index + HARDENED_OFFSET, false);
  const I = hmac(sha512, parentChainCode, data);
  return { key: I.slice(0, 32), chainCode: I.slice(32, 64) };
}

/**
 * Derive a private key (and chain code) from a 64-byte BIP-39 seed at the
 * given path. Each path component must be a non-negative integer < 2^31;
 * hardening is applied to every level (SLIP-0010 ed25519 requires it).
 */
export function deriveEd25519FromSeed(
  seed: Uint8Array,
  path: number[],
): { privateKey: Uint8Array; chainCode: Uint8Array } {
  let { key, chainCode } = deriveMaster(seed);
  for (const index of path) {
    ({ key, chainCode } = ckdPriv(key, chainCode, index));
  }
  return { privateKey: key, chainCode };
}

// ── Solen account derivation ────────────────────────────────────

export interface DerivedAccount {
  /** 32-byte ed25519 secret seed (becomes the privateKey). */
  privateSeed: Uint8Array;
  /** 32-byte ed25519 public key. */
  publicKey: Uint8Array;
  /** Base58-encoded account ID (== Base58 of the public key). */
  accountId: string;
  /** Derivation index that was used (the third path component). */
  derivationIndex: number;
  /** Human-readable derivation path string. */
  derivationPath: string;
}

/** The Solen derivation path for a given account index. All hardened. */
export function solenPath(index: number): number[] {
  return [44, SOLEN_COIN_TYPE, index, 0];
}

/** Format a Solen path as a BIP-32-style string. */
export function formatSolenPath(index: number): string {
  return `m/44'/${SOLEN_COIN_TYPE}'/${index}'/0'`;
}

/**
 * Derive the Nth Solen account from a mnemonic (and optional BIP-39 passphrase).
 * Uses path m/44'/<SOLEN_COIN_TYPE>'/<index>'/0'.
 */
export async function accountFromMnemonic(
  mnemonic: string,
  index: number,
  passphrase: string = "",
): Promise<DerivedAccount> {
  const seed = await mnemonicToSeed(mnemonic, passphrase);
  const derived = deriveEd25519FromSeed(seed, solenPath(index));
  const publicKey = await ed25519.getPublicKeyAsync(derived.privateKey);
  return {
    privateSeed: derived.privateKey,
    publicKey,
    accountId: base58Encode(publicKey),
    derivationIndex: index,
    derivationPath: formatSolenPath(index),
  };
}

// ── Test helpers (also useful for cross-language vector generation) ──

/** Hex-encode a derived account for cross-language test vectors. */
export function derivedAccountToHex(d: DerivedAccount): {
  privateSeed: string;
  publicKey: string;
  accountId: string;
  derivationPath: string;
} {
  return {
    privateSeed: bytesToHex(d.privateSeed),
    publicKey: bytesToHex(d.publicKey),
    accountId: d.accountId,
    derivationPath: d.derivationPath,
  };
}
