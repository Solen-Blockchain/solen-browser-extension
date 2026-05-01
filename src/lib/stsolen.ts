/**
 * stSOLEN-specific helpers for the popup. We read the contract's
 * `exchange_rate()` view to compute the SOLEN-equivalent backing of a user's
 * stSOLEN balance.
 *
 * Cached for 30 s in `chrome.storage.local` so the popup doesn't refetch on
 * every render — popups remount every time the user clicks the icon.
 */

import { networks, type NetworkId } from "./networks";

interface RateCacheEntry {
  pool: string; // BigInt as string (chrome.storage doesn't take BigInt)
  supply: string;
  ts: number; // ms epoch
}

const CACHE_TTL_MS = 30_000;
const CACHE_KEY_PREFIX = "stsolen-rate:";

export interface ExchangeRate {
  pool: bigint;
  supply: bigint;
}

/** True when this network has a deployed stSOLEN contract. */
export function isStsolenSupported(network: NetworkId): boolean {
  return !!networks[network].stsolenAddress;
}

/** True when `contract` is the stSOLEN address for `network`. */
export function isStsolenContract(contract: string, network: NetworkId): boolean {
  const addr = networks[network].stsolenAddress;
  if (!addr) return false;
  const norm = contract.replace(/^0x/, "").toLowerCase();
  return norm === addr.toLowerCase();
}

/** Decode a u128 little-endian from a hex prefix (32 hex chars). */
function decodeU128LE(hex: string): bigint {
  if (hex.length < 32) return 0n;
  let v = 0n;
  for (let i = 30; i >= 0; i -= 2) {
    v = (v << 8n) | BigInt(parseInt(hex.substring(i, i + 2), 16));
  }
  return v;
}

async function fetchRate(network: NetworkId): Promise<ExchangeRate | null> {
  const cfg = networks[network];
  if (!cfg.stsolenAddress) return null;
  try {
    const resp = await fetch(cfg.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "solen_callView",
        params: [cfg.stsolenAddress, "exchange_rate", ""],
      }),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      result?: { return_data?: string; success?: boolean };
    };
    const hex = json.result?.return_data ?? "";
    if (hex.length < 64) return null;
    return {
      pool: decodeU128LE(hex.substring(0, 32)),
      supply: decodeU128LE(hex.substring(32, 64)),
    };
  } catch {
    return null;
  }
}

/**
 * Returns the current exchange rate, caching for 30 s. `null` when unsupported
 * or the read fails — callers should fall back to "1:1" display in that case.
 */
export async function readCachedExchangeRate(
  network: NetworkId,
): Promise<ExchangeRate | null> {
  const key = CACHE_KEY_PREFIX + network;
  const stored = await chrome.storage.local.get(key);
  const entry = stored[key] as RateCacheEntry | undefined;
  const now = Date.now();
  if (entry && now - entry.ts < CACHE_TTL_MS) {
    try {
      return { pool: BigInt(entry.pool), supply: BigInt(entry.supply) };
    } catch {
      /* fall through to refetch */
    }
  }
  const fresh = await fetchRate(network);
  if (fresh) {
    await chrome.storage.local.set({
      [key]: {
        pool: fresh.pool.toString(),
        supply: fresh.supply.toString(),
        ts: now,
      } satisfies RateCacheEntry,
    });
  }
  return fresh;
}

/** SOLEN-equivalent backing of an stSOLEN balance (in base units). */
export function backingValue(
  stsolenBalance: bigint,
  rate: ExchangeRate,
): bigint {
  if (rate.supply === 0n) return 0n;
  return (stsolenBalance * rate.pool) / rate.supply;
}

/** Format a u128 base-unit value with 8 decimals into a human string. */
export function formatBaseUnits(amount: bigint): string {
  const SOLEN_DECIMALS = 8n;
  const divisor = 10n ** SOLEN_DECIMALS;
  const whole = amount / divisor;
  const frac = amount % divisor;
  if (frac === 0n) return whole.toString();
  const padded = frac.toString().padStart(Number(SOLEN_DECIMALS), "0");
  const trimmed = padded.replace(/0+$/, "");
  return trimmed.length === 0 ? whole.toString() : `${whole}.${trimmed}`;
}

/** Open the stake.solenchain.io dapp in a new tab, optionally pre-filling the connected account. */
export function openStakeDapp(account?: string): void {
  const url = account
    ? `https://stake.solenchain.io/?account=${encodeURIComponent(account)}`
    : "https://stake.solenchain.io/";
  if (typeof chrome !== "undefined" && chrome.tabs?.create) {
    chrome.tabs.create({ url });
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
