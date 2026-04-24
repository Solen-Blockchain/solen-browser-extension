/**
 * Registry of known SRC-20 token logos, keyed by lowercase hex contract
 * address (no `0x` prefix). Values may be:
 *   - a bundled extension path (resolved via `chrome.runtime.getURL`)
 *   - an absolute `https://…` URL
 *   - an `ipfs://Qm…` URI (rewritten to the public gateway at display time)
 *
 * Add entries here as tokens become well-known. The native SOLEN is handled
 * separately — see `TokenIcon`.
 */
export const KNOWN_TOKENS: Record<string, string> = {
  // Solen Ape Coin (SOLENAPE) — launchpad token #1, graduated 2026-04-24.
  "dc9259e08616e564edf482a1dd11972e6d0e8636cfd1e04f0fb9075b7063d6b6":
    "ipfs://QmXioqtS3F8S6zd6JMoQBx9uKYYCcaMhL96dP1u1iPsSbf",
};

const GATEWAY = "https://gateway.pinata.cloud/ipfs/";

export function knownLogo(contract: string): string | null {
  const normalized = contract.replace(/^0x/, "").toLowerCase();
  return KNOWN_TOKENS[normalized] ?? null;
}

/**
 * Normalize a registry value to something an `<img src>` can load.
 * Bundled paths get `chrome.runtime.getURL`, `ipfs://` gets rewritten.
 */
export function resolveLogoUrl(value: string): string {
  if (value.startsWith("ipfs://")) return GATEWAY + value.slice(7);
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  // Fall through to an extension-bundled asset.
  return chrome.runtime.getURL(value);
}
