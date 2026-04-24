import { useState } from "react";
import { knownLogo, resolveLogoUrl } from "../lib/token-registry";

interface TokenLike {
  contract: string;
  symbol: string;
}

/**
 * Round token avatar. Renders an image if we know the token (native SOLEN or
 * registry entry); otherwise falls back to two-letter initials with the same
 * accent color scheme the wallet used before.
 *
 * The image load has its own error fallback — broken logo URLs (e.g. IPFS
 * gateway down) don't leave a blank circle.
 */
export function TokenIcon({
  contract,
  symbol,
  sizeClass = "w-8 h-8",
  textClass = "text-[10px]",
}: {
  contract: string;
  symbol: string;
  sizeClass?: string;
  textClass?: string;
}) {
  const [broken, setBroken] = useState(false);

  const isSolen = contract === "native";
  const logoPath = isSolen ? "icons/icon48.png" : knownLogo(contract);

  if (logoPath && !broken) {
    const src = isSolen ? chrome.runtime.getURL(logoPath) : resolveLogoUrl(logoPath);
    return (
      <img
        src={src}
        alt={symbol}
        className={`${sizeClass} rounded-full object-cover bg-gray-800`}
        onError={() => setBroken(true)}
      />
    );
  }

  // Initials fallback.
  const tint = isSolen
    ? "bg-emerald-500/15 text-emerald-400"
    : "bg-indigo-500/15 text-indigo-400";
  return (
    <div className={`${sizeClass} ${tint} ${textClass} rounded-full flex items-center justify-center font-bold`}>
      {(symbol || "??").slice(0, 2)}
    </div>
  );
}
