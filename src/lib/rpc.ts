import { type NetworkId, networks } from "./networks";

let requestId = 0;

export async function rpcCall<T>(
  network: NetworkId,
  method: string,
  params: unknown[] | Record<string, unknown> = [],
): Promise<T> {
  const url = networks[network].rpcUrl;
  const id = ++requestId;
  const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!res.ok) throw new Error(`RPC request failed: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.result as T;
}

export function getBalance(network: NetworkId, accountId: string) {
  return rpcCall<string>(network, "solen_getBalance", [accountId]);
}

export function getAccount(network: NetworkId, accountId: string) {
  return rpcCall<{ id: string; balance: string; nonce: number; code_hash: string }>(
    network, "solen_getAccount", [accountId],
  );
}

export function submitOperation(network: NetworkId, operation: unknown) {
  return rpcCall<{ accepted: boolean; op_hash?: string; error?: string }>(
    network, "solen_submitOperation", [operation],
  );
}

export interface IndexedTx {
  block_height: number;
  index: number;
  sender: string;
  nonce: number;
  success: boolean;
  gas_used: number;
  error: string | null;
  events: { block_height: number; tx_index: number; emitter: string; topic: string; data: string }[];
}

export interface TokenInfo {
  contract: string;
  symbol: string;
  name: string;
  balance: string;
  decimals: number;
}

function base58ToHex(b58: string): string {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt(0);
  for (const c of b58) {
    const idx = ALPHABET.indexOf(c);
    if (idx < 0) return "";
    n = n * 58n + BigInt(idx);
  }
  return n.toString(16).padStart(64, "0");
}

export async function getTokenBalances(network: NetworkId, accountId: string): Promise<TokenInfo[]> {
  const apiUrl = network === "devnet"
    ? "http://127.0.0.1:29955"
    : network === "testnet"
      ? "https://testnet-api.solenchain.io"
      : "https://api.solenchain.io";

  // Convert account ID to hex for callView args.
  const accountHex = base58ToHex(accountId);
  if (!accountHex) return [];

  try {
    const res = await fetch(`${apiUrl}/api/accounts/${accountId}/tokens`);
    if (!res.ok) return [];
    const data = await res.json();

    if (!Array.isArray(data)) return [];

    const tokens: TokenInfo[] = [];
    for (const item of data) {
      const contract = typeof item === "string" ? item : item.contract;
      if (!contract) continue;

      try {
        const [nameRes, symbolRes, decimalsRes, balRes] = await Promise.all([
          callView(network, contract, "name"),
          callView(network, contract, "symbol"),
          callView(network, contract, "decimals"),
          callView(network, contract, "balance_of", accountHex),
        ]);

        const name = nameRes || "Unknown Token";
        const symbol = symbolRes || "???";
        const decimals = decimalsRes ? parseInt(decimalsRes, 10) || 8 : 8;
        const balance = balRes || "0";

        // Skip tokens with zero balance.
        if (balance === "0" || balance === "") continue;

        tokens.push({ contract, symbol, name, balance, decimals });
      } catch {
        // Skip tokens we can't query.
      }
    }
    return tokens;
  } catch {
    return [];
  }
}

async function callView(network: NetworkId, contract: string, method: string, arg?: string): Promise<string> {
  try {
    const result = await rpcCall<{ return_data?: string; data?: string; success?: boolean }>(
      network, "solen_callView", [contract, method, arg || ""]
    );
    const hex = result.return_data || result.data || "";
    if (!hex) return "";

    if (method === "balance_of") {
      if (hex.length >= 32) {
        const bytes: number[] = [];
        for (let i = 0; i < 32; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
        let val = BigInt(0);
        for (let i = bytes.length - 1; i >= 0; i--) val = (val << BigInt(8)) | BigInt(bytes[i]);
        return val.toString();
      }
      return "0";
    }
    if (method === "decimals") {
      if (hex.length >= 2) return parseInt(hex.slice(0, 2), 16).toString();
      return "8";
    }
    // Text fields (name, symbol): decode hex to UTF-8.
    const textBytes: number[] = [];
    for (let i = 0; i < hex.length; i += 2) textBytes.push(parseInt(hex.slice(i, i + 2), 16));
    return new TextDecoder().decode(new Uint8Array(textBytes));
  } catch {
    return "";
  }
}

export async function getAccountTxs(network: NetworkId, accountId: string, limit = 10): Promise<IndexedTx[]> {
  const apiUrl = network === "devnet"
    ? "http://127.0.0.1:29955"
    : network === "testnet"
      ? "https://testnet-api.solenchain.io"
      : "https://api.solenchain.io";

  const res = await fetch(`${apiUrl}/api/accounts/${accountId}/txs?limit=${limit}`);
  if (!res.ok) return [];
  return res.json();
}
