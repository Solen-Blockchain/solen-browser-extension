/**
 * Background service worker — manages wallet state and handles requests
 * from the popup and content scripts.
 */

import { type WalletAccount, generateKeypair, keypairFromSecret, signMessage, buildSigningMessage, formatBalance, addressToBytes } from "../lib/wallet";
import { type NetworkId, networks } from "../lib/networks";
import * as storage from "../lib/storage";
import {
  type Keystore,
  emptyKeystore,
  hydrateAccounts,
  dehydrateAccount,
  highestIndexFor,
} from "../lib/keystore";
import { generateMnemonic24, isValidMnemonic, accountFromMnemonic } from "../lib/hd";
import { getBalance, getAccount, submitOperation, getAccountTxs, getTokenBalances, type IndexedTx, type TokenInfo } from "../lib/rpc";
import type { BackgroundRequest, WalletState, DappRequest } from "../lib/messages";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils";

function uuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = bytesToHex(bytes);
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

// In-memory state (cleared on lock).
// `keystore` is the persisted source of truth; `accounts` is the hydrated
// view (HD account secret keys are re-derived on unlock and held in memory).
let keystore: Keystore = emptyKeystore();
let accounts: WalletAccount[] = [];
let activeAccountId: string | null = null;
let network: NetworkId = "testnet";
let isLocked = true;
let sessionPassword: string | null = null;
let balance: string | null = null;
let tokens: TokenInfo[] = [];
let transactions: IndexedTx[] = [];
let pendingDappRequest: DappRequest | null = null;
let dappRequestResolvers: Map<string, (result: unknown) => void> = new Map();
let lockTimer: ReturnType<typeof setTimeout> | null = null;

// ── Initialization ────────────────────────────────────────────

let initReady: Promise<void>;

async function init() {
  network = await storage.getNetwork();
  const hasPw = await storage.hasPassword();
  isLocked = hasPw;

  if (!hasPw) {
    keystore = await storage.loadKeystore();
    accounts = await hydrateAccounts(keystore);
    activeAccountId = (await storage.getActiveAccountId()) || accounts[0]?.accountId || null;
    if (activeAccountId) {
      await hydrateSnapshot();
      refreshBalance();
    }
  }
}

/**
 * Load the last-known balance/tokens/transactions for the active account
 * from disk into in-memory state. Called on cold start, unlock, and when
 * the user switches account or network — so the popup paints cached values
 * instantly instead of zeros while the next RPC fetch is in flight.
 */
async function hydrateSnapshot(): Promise<void> {
  if (!activeAccountId) {
    balance = null;
    tokens = [];
    transactions = [];
    return;
  }
  const snap = await storage.getAccountSnapshot(network, activeAccountId);
  if (snap) {
    balance = snap.balance;
    tokens = snap.tokens;
    transactions = snap.transactions;
  } else {
    balance = null;
    tokens = [];
    transactions = [];
  }
}

initReady = init();

// ── Lock timer ────────────────────────────────────────────────

async function resetLockTimer() {
  if (lockTimer) clearTimeout(lockTimer);
  const timeout = await storage.getLockTimeout();
  if (timeout === 0) return; // never lock
  lockTimer = setTimeout(() => lock(), timeout);
}

function setBadge(text: string) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: text ? "#10b981" : "#000000" });
}

let approvalWindowId: number | null = null;

async function openApprovalWindow() {
  // Close existing approval window if any.
  if (approvalWindowId !== null) {
    try { await chrome.windows.remove(approvalWindowId); } catch {}
    approvalWindowId = null;
  }

  const popup = await chrome.windows.create({
    url: chrome.runtime.getURL("src/popup/index.html"),
    type: "popup",
    width: 380,
    height: 620,
    focused: true,
  });
  approvalWindowId = popup.id ?? null;

  // Clean up when the window is closed (user dismissed without acting).
  if (approvalWindowId !== null) {
    chrome.windows.onRemoved.addListener(function onClose(windowId) {
      if (windowId === approvalWindowId) {
        approvalWindowId = null;
        chrome.windows.onRemoved.removeListener(onClose);
        // If there's still a pending request, reject it.
        if (pendingDappRequest) {
          const resolver = dappRequestResolvers.get(pendingDappRequest.id);
          dappRequestResolvers.delete(pendingDappRequest.id);
          pendingDappRequest = null;
          setBadge("");
          if (resolver) resolver({ error: "User dismissed" });
        }
      }
    });
  }
}

function closeApprovalWindow() {
  if (approvalWindowId !== null) {
    chrome.windows.remove(approvalWindowId).catch(() => {});
    approvalWindowId = null;
  }
}

function lock() {
  isLocked = true;
  sessionPassword = null;
  keystore = emptyKeystore();
  accounts = [];
  balance = null;
  if (lockTimer) { clearTimeout(lockTimer); lockTimer = null; }
}

async function unlock(password: string): Promise<boolean> {
  const valid = await storage.verifyPassword(password);
  if (!valid) return false;
  keystore = await storage.loadKeystore(password);
  accounts = await hydrateAccounts(keystore);
  activeAccountId = (await storage.getActiveAccountId()) || accounts[0]?.accountId || null;
  sessionPassword = password;
  isLocked = false;
  resetLockTimer();
  if (activeAccountId) {
    await hydrateSnapshot();
    refreshBalance();
  }
  return true;
}

/** Persist a keystore mutation: update in-memory state, save to storage. */
async function applyKeystore(next: Keystore): Promise<void> {
  keystore = next;
  accounts = await hydrateAccounts(keystore);
  await storage.saveKeystore(keystore, sessionPassword || undefined);
}

// ── Balance ───────────────────────────────────────────────────

async function refreshBalance() {
  if (!activeAccountId) { balance = null; tokens = []; transactions = []; return; }
  // Capture the (network, account) the fetch is for. If the user switches
  // mid-flight, we still want to write the result to the right cache slot
  // and avoid clobbering the in-memory state for the new selection.
  const accountAtStart = activeAccountId;
  const networkAtStart = network;
  try {
    const [bal, toks, txs] = await Promise.all([
      getBalance(networkAtStart, accountAtStart),
      getTokenBalances(networkAtStart, accountAtStart),
      getAccountTxs(networkAtStart, accountAtStart, 10),
    ]);
    if (accountAtStart === activeAccountId && networkAtStart === network) {
      balance = bal;
      tokens = toks;
      transactions = txs;
    }
    await storage.setAccountSnapshot(networkAtStart, accountAtStart, {
      balance: bal,
      tokens: toks,
      transactions: txs,
      updatedAt: Date.now(),
    });
  } catch {
    if (accountAtStart === activeAccountId && networkAtStart === network) {
      balance = null;
    }
  }
}

// Refresh balance every 10s when unlocked.
setInterval(() => {
  if (!isLocked && activeAccountId) refreshBalance();
}, 10_000);

// ── State snapshot ────────────────────────────────────────────

function parseLeU128(hex: string): string {
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  let val = BigInt(0);
  for (let i = bytes.length - 1; i >= 0; i--) val = (val << BigInt(8)) | BigInt(bytes[i]);
  return val.toString();
}

function summarizeTxs() {
  return transactions.map((tx) => {
    // Detect tx type from events.
    // Native transfers: emitter = sender. Token transfers: emitter = contract address.
    const nativeTransferEvt = tx.events.find((e) => e.topic === "transfer" && e.emitter === tx.sender);
    const tokenTransferEvt = tx.events.find((e) => e.topic === "transfer" && e.emitter !== tx.sender);
    const stakeEvt = tx.events.find((e) => e.topic === "delegate" || e.topic === "undelegate");
    const intentEvt = tx.events.find((e) => e.topic === "intent_fulfilled");
    const rewardEvt = tx.events.find((e) => e.topic === "epoch_reward" || e.topic === "delegator_reward");

    let type = "Transaction";
    let amount: string | null = null;
    let to: string | null = null;
    let token_symbol: string | null = null;

    // Bridge events
    const bridgeDepEvt = tx.events.find((e) => e.topic === "bridge_deposit" && e.data.length >= 136);
    const bridgeRelEvt = tx.events.find((e) => e.topic === "bridge_release" && e.data.length >= 96);

    if (bridgeDepEvt) {
      type = "Bridge → Base";
      amount = parseLeU128(bridgeDepEvt.data.slice(104, 136));
      token_symbol = "SOLEN";
    } else if (bridgeRelEvt) {
      type = "Bridge → Solen";
      amount = parseLeU128(bridgeRelEvt.data.slice(64, 96));
      token_symbol = "SOLEN";
    } else if (intentEvt) {
      type = "Intent";
    }

    if (!bridgeDepEvt && !bridgeRelEvt && nativeTransferEvt && nativeTransferEvt.data.length >= 96) {
      type = intentEvt ? "Intent" : "Transfer";
      to = nativeTransferEvt.data.slice(0, 64);
      amount = parseLeU128(nativeTransferEvt.data.slice(64, 96));
      token_symbol = "SOLEN";
    } else if (tokenTransferEvt && tokenTransferEvt.data.length >= 96) {
      type = "Token Transfer";
      to = tokenTransferEvt.data.slice(0, 64);
      amount = parseLeU128(tokenTransferEvt.data.slice(64, 96));
      // Try to get symbol from cached tokens.
      const cachedToken = tokens.find(t => t.contract === tokenTransferEvt.emitter);
      token_symbol = cachedToken?.symbol || "Token";
    } else if (stakeEvt && stakeEvt.data.length >= 96) {
      type = stakeEvt.topic === "delegate" ? "Stake" : "Unstake";
      amount = parseLeU128(stakeEvt.data.slice(64, 96));
      token_symbol = "SOLEN";
    } else if (rewardEvt) {
      type = "Reward";
      token_symbol = "SOLEN";
    }

    return {
      block_height: tx.block_height,
      index: tx.index,
      sender: tx.sender,
      success: tx.success,
      type,
      amount,
      to,
      token_symbol,
    };
  });
}

function getState(): WalletState {
  return {
    isLocked,
    hasPassword: sessionPassword !== null || accounts.length === 0,
    accounts: accounts.map((a) => ({
      name: a.name,
      accountId: a.accountId,
      publicKey: a.publicKey,
      ...(a.hd ? { hd: a.hd } : {}),
    })),
    mnemonics: keystore.mnemonics.map((m) => ({ id: m.id, label: m.label })),
    activeAccountId,
    network,
    balance,
    tokens: tokens.map(t => ({ contract: t.contract, symbol: t.symbol, name: t.name, balance: t.balance, decimals: t.decimals })),
    transactions: summarizeTxs(),
    pendingDappRequest,
  };
}

// ── Transaction building ──────────────────────────────────────

import { parseAmount } from "../lib/wallet";

function hexToByteArray(hex: string): number[] {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.substring(i, i + 2), 16));
  }
  return bytes;
}

interface TxAction {
  type: 'transfer' | 'call';
  to?: string;      // for transfer
  target?: string;  // for call
  amount?: string;
  method?: string;
  args?: string;    // hex-encoded args
}

interface TxParams {
  to?: string;
  amount?: string;
  // Token transfer fields (optional — if present, builds a Call action instead of Transfer).
  token?: string;   // SRC-20 contract address
  method?: string;  // contract method (default: "transfer")
  args?: string;    // hex args for direct contract call
  // Multi-action support.
  actions?: TxAction[];
}

function u128ToLeBytes(val: bigint): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < 16; i++) {
    bytes.push(Number(val & 0xFFn));
    val >>= 8n;
  }
  return bytes;
}

async function buildSignAndSubmit(
  account: WalletAccount,
  params: TxParams,
): Promise<unknown> {
  const info = await getAccount(network, account.accountId);
  const senderBytes = Array.from(addressToBytes(account.accountId));
  const chainId = networks[network].chainId;

  let rustActions: unknown[];

  if (params.actions && params.actions.length > 0) {
    // Multi-action operation.
    rustActions = params.actions.map((a: TxAction) => {
      if (a.type === 'transfer') {
        const toBytes = Array.from(addressToBytes(a.to!));
        const rawAmount = parseAmount(a.amount || '0');
        const amountNum = parseInt(rawAmount);
        return { Transfer: { to: toBytes, amount: amountNum } };
      } else if (a.type === 'call') {
        const targetAddr = a.target!;
        const targetBytes = Array.from(addressToBytes(targetAddr));
        const method = a.method || 'call';
        const args = a.args ? Array.from(hexToBytes(a.args)) : [];
        return { Call: { target: targetBytes, method, args } };
      }
      throw new Error('Unknown action type: ' + a.type);
    });
  } else if (params.token) {
    // SRC-20 token transfer via Call action.
    const recipientBytes = Array.from(addressToBytes(params.to!));
    const rawAmount = parseAmount(params.amount || '0');
    const amountBigInt = BigInt(rawAmount);
    const amountLeBytes = u128ToLeBytes(amountBigInt);
    const args = [...recipientBytes, ...amountLeBytes];
    const targetBytes = Array.from(addressToBytes(params.token));
    const method = params.method || "transfer";
    rustActions = [{ Call: { target: targetBytes, method, args } }];
  } else if (params.method && params.to) {
    // Direct contract call (single action).
    const targetBytes = Array.from(addressToBytes(params.to));
    const args = params.args ? Array.from(hexToBytes(params.args)) : [];
    rustActions = [{ Call: { target: targetBytes, method: params.method, args } }];
  } else {
    // Native SOLEN transfer.
    const toBytes = Array.from(addressToBytes(params.to!));
    const rawAmount = parseAmount(params.amount || '0');
    const amountNum = parseInt(rawAmount);
    rustActions = [{ Transfer: { to: toBytes, amount: amountNum } }];
  }

  const sigMsg = buildSigningMessage(senderBytes, info.nonce, 100000, rustActions, chainId);
  const signature = await signMessage(account.secretKey, sigMsg);

  const operation = {
    sender: senderBytes,
    nonce: info.nonce,
    actions: rustActions,
    max_fee: 100000,
    signature: hexToByteArray(signature),
  };

  return submitOperation(network, operation);
}

// ── Message handler ───────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg: BackgroundRequest, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse);
  return true; // async response
});

async function handleMessage(msg: BackgroundRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  resetLockTimer();

  switch (msg.type) {
    case "GET_STATE": {
      await initReady; // Wait for storage to finish loading before returning state.
      const hasPw = await storage.hasPassword();
      return { ...getState(), hasPassword: hasPw };
    }

    case "UNLOCK":
      return { success: await unlock(msg.password) };

    case "LOCK":
      lock();
      return { success: true };

    case "CREATE_ACCOUNT": {
      const kp = await generateKeypair();
      const account: WalletAccount = {
        name: msg.name,
        accountId: kp.accountId,
        publicKey: kp.publicKey,
        secretKey: kp.secretKey,
      };
      const next: Keystore = { ...keystore, accounts: [...keystore.accounts, dehydrateAccount(account)] };
      await applyKeystore(next);
      if (!activeAccountId) activeAccountId = account.accountId;
      await storage.setActiveAccountId(activeAccountId!);
      refreshBalance();
      return { success: true, accountId: account.accountId };
    }

    case "IMPORT_ACCOUNT": {
      const kp = await keypairFromSecret(msg.secretKey);
      const account: WalletAccount = {
        name: msg.name,
        accountId: kp.accountId,
        publicKey: kp.publicKey,
        secretKey: kp.secretKey,
      };
      const next: Keystore = { ...keystore, accounts: [...keystore.accounts, dehydrateAccount(account)] };
      await applyKeystore(next);
      if (!activeAccountId) activeAccountId = account.accountId;
      await storage.setActiveAccountId(activeAccountId!);
      refreshBalance();
      return { success: true, accountId: account.accountId };
    }

    case "REMOVE_ACCOUNT": {
      const next: Keystore = {
        ...keystore,
        accounts: keystore.accounts.filter((a) => a.accountId !== msg.accountId),
        // Leave orphaned mnemonics in place — they're harmless and let the
        // user re-derive an accidentally-removed account.
      };
      await applyKeystore(next);
      if (activeAccountId === msg.accountId) {
        activeAccountId = accounts[0]?.accountId || null;
      }
      refreshBalance();
      return { success: true };
    }

    case "CREATE_MNEMONIC_ACCOUNT": {
      if (!(await storage.hasPassword())) {
        return { error: "Set a password before creating a recovery phrase" };
      }
      if (isLocked) return { error: "Wallet is locked" };
      const mnemonic = generateMnemonic24();
      const mnemonicId = uuid();
      const derived = await accountFromMnemonic(mnemonic, 0);
      const account: WalletAccount = {
        name: msg.name,
        accountId: derived.accountId,
        publicKey: bytesToHex(derived.publicKey),
        secretKey: bytesToHex(derived.privateSeed) + bytesToHex(derived.publicKey),
        hd: { mnemonicId, derivationIndex: 0 },
      };
      const next: Keystore = {
        ...keystore,
        mnemonics: [...keystore.mnemonics, { id: mnemonicId, label: "Default", mnemonic }],
        accounts: [...keystore.accounts, dehydrateAccount(account)],
      };
      await applyKeystore(next);
      if (!activeAccountId) activeAccountId = account.accountId;
      await storage.setActiveAccountId(activeAccountId!);
      refreshBalance();
      return { success: true, accountId: account.accountId, mnemonic, mnemonicId };
    }

    case "IMPORT_MNEMONIC_ACCOUNT": {
      if (!(await storage.hasPassword())) {
        return { error: "Set a password before importing a recovery phrase" };
      }
      if (isLocked) return { error: "Wallet is locked" };
      const trimmed = msg.mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
      if (!isValidMnemonic(trimmed)) {
        return { error: "Invalid recovery phrase (checksum failed)" };
      }
      const mnemonicId = uuid();
      const derived = await accountFromMnemonic(trimmed, 0);
      const account: WalletAccount = {
        name: msg.name,
        accountId: derived.accountId,
        publicKey: bytesToHex(derived.publicKey),
        secretKey: bytesToHex(derived.privateSeed) + bytesToHex(derived.publicKey),
        hd: { mnemonicId, derivationIndex: 0 },
      };
      const next: Keystore = {
        ...keystore,
        mnemonics: [...keystore.mnemonics, { id: mnemonicId, label: msg.label || "Imported", mnemonic: trimmed }],
        accounts: [...keystore.accounts, dehydrateAccount(account)],
      };
      await applyKeystore(next);
      if (!activeAccountId) activeAccountId = account.accountId;
      await storage.setActiveAccountId(activeAccountId!);
      refreshBalance();
      return { success: true, accountId: account.accountId };
    }

    case "ADD_FROM_MNEMONIC": {
      if (isLocked) return { error: "Wallet is locked" };
      const mnem = keystore.mnemonics.find((m) => m.id === msg.mnemonicId);
      if (!mnem) return { error: "Recovery phrase not found" };
      const nextIndex = highestIndexFor(keystore, msg.mnemonicId) + 1;
      const derived = await accountFromMnemonic(mnem.mnemonic, nextIndex);
      const account: WalletAccount = {
        name: msg.name,
        accountId: derived.accountId,
        publicKey: bytesToHex(derived.publicKey),
        secretKey: bytesToHex(derived.privateSeed) + bytesToHex(derived.publicKey),
        hd: { mnemonicId: msg.mnemonicId, derivationIndex: nextIndex },
      };
      const next: Keystore = { ...keystore, accounts: [...keystore.accounts, dehydrateAccount(account)] };
      await applyKeystore(next);
      if (!activeAccountId) activeAccountId = account.accountId;
      await storage.setActiveAccountId(activeAccountId!);
      refreshBalance();
      return { success: true, accountId: account.accountId };
    }

    case "REVEAL_MNEMONIC": {
      if (isLocked) return { error: "Wallet is locked" };
      const valid = await storage.verifyPassword(msg.password);
      if (!valid) return { error: "Wrong password" };
      const mnem = keystore.mnemonics.find((m) => m.id === msg.mnemonicId);
      if (!mnem) return { error: "Recovery phrase not found" };
      return { success: true, mnemonic: mnem.mnemonic };
    }

    case "EXPORT_KEY": {
      if (isLocked) return { error: "Wallet is locked" };
      const account = accounts.find((a) => a.accountId === msg.accountId);
      if (!account) return { error: "Account not found" };
      // `secretKey` is stored as seed[32] || pubkey[32] (libsodium-style
      // expanded form = 128 hex chars). The private key the user needs is
      // just the 32-byte seed; `keypairFromSecret` re-derives the pubkey on
      // import, so round-tripping the sliced value works.
      return { success: true, secretKey: account.secretKey.slice(0, 64) };
    }

    case "SET_ACTIVE_ACCOUNT": {
      activeAccountId = msg.accountId;
      await storage.setActiveAccountId(msg.accountId);
      await hydrateSnapshot();
      refreshBalance();
      return { success: true };
    }

    case "SET_NETWORK": {
      network = msg.network as NetworkId;
      await storage.setNetwork(network);
      await hydrateSnapshot();
      refreshBalance();
      return { success: true };
    }

    case "SET_PASSWORD": {
      await storage.setPassword(msg.password, keystore);
      sessionPassword = msg.password;
      return { success: true };
    }

    case "GET_BALANCE": {
      await refreshBalance();
      return { balance };
    }

    case "SIGN_AND_SUBMIT": {
      if (isLocked) return { error: "Wallet is locked" };
      const account = accounts.find((a) => a.accountId === activeAccountId);
      if (!account) return { error: "No active account" };
      try {
        return await buildSignAndSubmit(account, msg.operation as TxParams);
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Submit failed" };
      }
    }

    // ── dApp requests ──────────────────────────────────────

    case "DAPP_CONNECT": {
      if (isLocked) return { error: "Wallet is locked" };
      const sites = await storage.getConnectedSites();
      if (sites.includes(msg.origin)) {
        return { approved: true, accounts: accounts.map((a) => a.accountId) };
      }
      // Queue and wait for user approval.
      const connectId = uuid();
      pendingDappRequest = { id: connectId, origin: msg.origin, type: "connect" };
      setBadge("1");
      openApprovalWindow();
      return new Promise((resolve) => {
        dappRequestResolvers.set(connectId, resolve);
        // Timeout after 2 minutes.
        setTimeout(() => {
          if (dappRequestResolvers.has(connectId)) {
            dappRequestResolvers.delete(connectId);
            if (pendingDappRequest?.id === connectId) pendingDappRequest = null;
            setBadge("");
            resolve({ error: "Request timed out" });
          }
        }, 120_000);
      });
    }

    case "DAPP_GET_ACCOUNTS": {
      const sites = await storage.getConnectedSites();
      if (!sites.includes(msg.origin)) return { accounts: [] };
      return { accounts: accounts.map((a) => a.accountId) };
    }

    case "DAPP_SIGN_MESSAGE": {
      if (isLocked) return { error: "Wallet is locked" };
      const account = accounts.find((a) => a.accountId === activeAccountId);
      if (!account) return { error: "No active account" };
      try {
        const msgHex = (msg as { origin: string; message: string }).message;
        const sig = await signMessage(account.secretKey, hexToBytes(msgHex));
        return { signature: sig };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Sign failed" };
      }
    }

    case "DAPP_SIGN_AND_SUBMIT": {
      if (isLocked) return { error: "Wallet is locked" };

      // Clean up any stale pending request.
      if (pendingDappRequest) {
        const oldResolver = dappRequestResolvers.get(pendingDappRequest.id);
        if (oldResolver) oldResolver({ error: "Replaced by new request" });
        dappRequestResolvers.delete(pendingDappRequest.id);
        pendingDappRequest = null;
        closeApprovalWindow();
      }

      const signId = uuid();
      pendingDappRequest = {
        id: signId,
        origin: msg.origin,
        type: "sign",
        data: msg.operation,
      };
      setBadge("!");
      openApprovalWindow();
      return new Promise((resolve) => {
        dappRequestResolvers.set(signId, resolve);
        setTimeout(() => {
          if (dappRequestResolvers.has(signId)) {
            dappRequestResolvers.delete(signId);
            if (pendingDappRequest?.id === signId) pendingDappRequest = null;
            setBadge("");
            resolve({ error: "Request timed out" });
          }
        }, 120_000);
      });
    }

    case "APPROVE_DAPP_REQUEST": {
      if (!pendingDappRequest || pendingDappRequest.id !== msg.requestId) {
        return { error: "No matching request" };
      }
      const req = pendingDappRequest;
      const resolver = dappRequestResolvers.get(req.id);
      pendingDappRequest = null;
      dappRequestResolvers.delete(req.id);
      setBadge("");

      let result: unknown;
      if (req.type === "connect") {
        await storage.addConnectedSite(req.origin);
        result = { approved: true, accounts: accounts.map((a) => a.accountId) };
      } else if (req.type === "sign") {
        const account = accounts.find((a) => a.accountId === activeAccountId);
        if (!account) {
          result = { error: "No active account" };
        } else {
          try {
            result = await buildSignAndSubmit(account, req.data as TxParams);
          } catch (e) {
            result = { error: e instanceof Error ? e.message : "Submit failed" };
          }
        }
      } else {
        result = { error: "Unknown request type" };
      }

      // Resolve the waiting content script promise.
      if (resolver) resolver(result);
      closeApprovalWindow();
      return result;
    }

    case "REJECT_DAPP_REQUEST": {
      if (pendingDappRequest) {
        const resolver = dappRequestResolvers.get(pendingDappRequest.id);
        dappRequestResolvers.delete(pendingDappRequest.id);
        pendingDappRequest = null;
        setBadge("");
        if (resolver) resolver({ error: "User rejected" });
      }
      closeApprovalWindow();
      return { rejected: true };
    }

    default:
      return { error: "Unknown message type" };
  }
}
