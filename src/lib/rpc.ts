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

export async function getTokenBalances(network: NetworkId, accountId: string): Promise<TokenInfo[]> {
  const apiUrl = network === "devnet"
    ? "http://127.0.0.1:29955"
    : network === "testnet"
      ? "https://testnet-api.solenchain.io"
      : "https://api.solenchain.io";

  try {
    const res = await fetch(`${apiUrl}/api/accounts/${accountId}/tokens`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
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
