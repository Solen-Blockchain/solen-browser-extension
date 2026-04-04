import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2";
import { blake3 } from "@noble/hashes/blake3";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

(ed25519.etc as Record<string, unknown>).sha512Async = async (...m: Uint8Array[]) =>
  sha512(ed25519.etc.concatBytes(...m));

// --- Base58 (Bitcoin alphabet) ---
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  for (const b of bytes) {
    if (b !== 0) break;
    zeros++;
  }
  let num = BigInt(0);
  for (const b of bytes) {
    num = num * BigInt(256) + BigInt(b);
  }
  const chars: string[] = [];
  while (num > BigInt(0)) {
    const remainder = Number(num % BigInt(58));
    num = num / BigInt(58);
    chars.unshift(BASE58_ALPHABET[remainder]);
  }
  for (let i = 0; i < zeros; i++) {
    chars.unshift("1");
  }
  return chars.join("");
}

export function base58Decode(str: string): Uint8Array {
  let zeros = 0;
  for (const c of str) {
    if (c !== "1") break;
    zeros++;
  }
  let num = BigInt(0);
  for (const c of str) {
    const idx = BASE58_ALPHABET.indexOf(c);
    if (idx === -1) throw new Error(`Invalid Base58 character: ${c}`);
    num = num * BigInt(58) + BigInt(idx);
  }
  const hex = num === BigInt(0) ? "" : num.toString(16).padStart(2, "0");
  const paddedHex = hex.length % 2 ? "0" + hex : hex;
  const byteLen = paddedHex.length / 2;
  const result = new Uint8Array(zeros + byteLen);
  for (let i = 0; i < byteLen; i++) {
    result[zeros + i] = parseInt(paddedHex.slice(i * 2, i * 2 + 2), 16);
  }
  return result;
}

/**
 * Detect whether a string is hex or Base58, and return the raw 32-byte array.
 */
export function addressToBytes(address: string): Uint8Array {
  const clean = address.startsWith("0x") ? address.slice(2) : address;
  if (/^[0-9a-fA-F]{64}$/.test(clean)) {
    return hexToBytes(clean);
  }
  return base58Decode(address);
}

export interface WalletAccount {
  name: string;
  accountId: string; // Base58
  publicKey: string;
  secretKey: string;
}

export async function generateKeypair() {
  const privKey = ed25519.utils.randomSecretKey();
  const pubKey = await ed25519.getPublicKeyAsync(privKey);
  return {
    publicKey: bytesToHex(pubKey),
    secretKey: bytesToHex(privKey) + bytesToHex(pubKey),
    accountId: base58Encode(pubKey),
  };
}

export async function keypairFromSecret(secretHex: string) {
  const privBytes = hexToBytes(secretHex.slice(0, 64));
  const pubKey = await ed25519.getPublicKeyAsync(privBytes);
  return {
    publicKey: bytesToHex(pubKey),
    secretKey: secretHex.slice(0, 64) + bytesToHex(pubKey),
    accountId: base58Encode(pubKey),
  };
}

export async function signMessage(secretHex: string, message: Uint8Array): Promise<string> {
  const privBytes = hexToBytes(secretHex.slice(0, 64));
  const sig = await ed25519.signAsync(message, privBytes);
  return bytesToHex(sig);
}

export function buildSigningMessage(
  senderBytes: number[],
  nonce: number,
  maxFee: number,
  rustActions: unknown[],
  chainId: number = 0,
): Uint8Array {
  const msg = new Uint8Array(8 + 32 + 8 + 16 + 32);
  const chainView = new DataView(new ArrayBuffer(8));
  chainView.setBigUint64(0, BigInt(chainId), true);
  msg.set(new Uint8Array(chainView.buffer), 0);
  msg.set(senderBytes, 8);
  const nonceView = new DataView(new ArrayBuffer(8));
  nonceView.setBigUint64(0, BigInt(nonce), true);
  msg.set(new Uint8Array(nonceView.buffer), 40);
  const feeView = new DataView(new ArrayBuffer(16));
  feeView.setBigUint64(0, BigInt(maxFee), true);
  msg.set(new Uint8Array(feeView.buffer), 48);
  const actionsJson = JSON.stringify(rustActions);
  const actionsHash = blake3(new TextEncoder().encode(actionsJson));
  msg.set(actionsHash.slice(0, 32), 64);
  return msg;
}

export function formatBalance(raw: string): string {
  const num = BigInt(raw || "0");
  const decimals = 8;
  const divisor = BigInt(10 ** decimals);
  const whole = num / divisor;
  const frac = num % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

export function parseAmount(amount: string): string {
  const decimals = 8;
  const parts = amount.split(".");
  const whole = BigInt(parts[0] || "0");
  const fracStr = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  const frac = BigInt(fracStr);
  return (whole * BigInt(10 ** decimals) + frac).toString();
}
