/**
 * Message types for communication between extension components.
 *
 * Popup <-> Background: chrome.runtime.sendMessage
 * Content script <-> Background: chrome.runtime.sendMessage
 * Page <-> Content script: window.postMessage
 */

// ── Background service worker messages ────────────────────────

export type BackgroundRequest =
  | { type: "GET_STATE" }
  | { type: "UNLOCK"; password: string }
  | { type: "LOCK" }
  | { type: "CREATE_ACCOUNT"; name: string }
  | { type: "IMPORT_ACCOUNT"; name: string; secretKey: string }
  | { type: "REMOVE_ACCOUNT"; accountId: string }
  | { type: "EXPORT_KEY"; accountId: string }
  | { type: "SET_ACTIVE_ACCOUNT"; accountId: string }
  | { type: "SET_NETWORK"; network: string }
  | { type: "SET_PASSWORD"; password: string }
  | { type: "GET_BALANCE" }
  | { type: "SIGN_AND_SUBMIT"; operation: unknown }
  // HD wallet (BIP-39 + SLIP-0010)
  | { type: "CREATE_MNEMONIC_ACCOUNT"; name: string }
  | { type: "IMPORT_MNEMONIC_ACCOUNT"; name: string; mnemonic: string; label?: string }
  | { type: "ADD_FROM_MNEMONIC"; name: string; mnemonicId: string }
  | { type: "REVEAL_MNEMONIC"; password: string; mnemonicId: string }
  // dApp requests (from content script)
  | { type: "DAPP_CONNECT"; origin: string }
  | { type: "DAPP_GET_ACCOUNTS"; origin: string }
  | { type: "DAPP_SIGN_AND_SUBMIT"; origin: string; operation: unknown }
  | { type: "DAPP_SIGN_MESSAGE"; origin: string; message: string }
  | { type: "DAPP_GRANT_AGENT"; origin: string; request: GrantAgentRequest }
  | { type: "DAPP_REVOKE_AGENT"; origin: string; request: RevokeAgentRequest }
  | { type: "APPROVE_DAPP_REQUEST"; requestId: string }
  | { type: "REJECT_DAPP_REQUEST"; requestId: string };

/** Restrictions for a granted agent session key. Amounts are decimal strings of
 *  BASE units (1 SOLEN = 1e8). Mirrors @solen/agent-sdk's SessionGrant. */
export interface AgentSessionGrant {
  budgetTotal?: string;
  spendingLimit?: string;
  allowedTargets?: string[];
  allowedMethods?: string[];
  expiresAt?: number;
  /** Enforce the allowlist on contract sub-calls too (whole call tree). Default false. */
  restrictSubcalls?: boolean;
}

export interface GrantAgentRequest {
  /** The agent's ed25519 session public key (hex or base58). */
  agentPublicKey: string;
  grant: AgentSessionGrant;
}

export interface RevokeAgentRequest {
  agentPublicKey: string;
}

export interface TxSummary {
  block_height: number;
  index: number;
  sender: string;
  success: boolean;
  type: string;
  amount: string | null;
  to: string | null;
  token_symbol: string | null;
}

export interface TokenBalance {
  contract: string;
  symbol: string;
  name: string;
  balance: string;
  decimals: number;
}

export interface WalletState {
  isLocked: boolean;
  hasPassword: boolean;
  accounts: { name: string; accountId: string; publicKey: string; hd?: { mnemonicId: string; derivationIndex: number } }[];
  /** Stored mnemonic metadata (no plaintext words). */
  mnemonics: { id: string; label: string }[];
  activeAccountId: string | null;
  network: string;
  balance: string | null;
  tokens: TokenBalance[];
  transactions: TxSummary[];
  pendingDappRequest: DappRequest | null;
}

export interface DappRequest {
  id: string;
  origin: string;
  type: "connect" | "sign" | "signMessage" | "grant" | "revoke";
  data?: unknown;
}

// ── Content script <-> Page messages ──────────────────────────

export interface InpageRequest {
  type: "SOLEN_REQUEST";
  id: string;
  method: string;
  params?: unknown;
}

export interface InpageResponse {
  type: "SOLEN_RESPONSE";
  id: string;
  result?: unknown;
  error?: string;
}
