/**
 * Background service worker — manages wallet state and handles requests
 * from the popup and content scripts.
 */

import { type WalletAccount, generateKeypair, keypairFromSecret, signMessage, buildSigningMessage, formatBalance, addressToBytes } from "../lib/wallet";
import { type NetworkId, networks } from "../lib/networks";
import * as storage from "../lib/storage";
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

async function init() {
  network = await storage.getNetwork();
  const hasPw = await storage.hasPassword();
  isLocked = hasPw;

  if (!hasPw) {
    accounts = await storage.loadAccounts();
    activeAccountId = (await storage.getActiveAccountId()) || accounts[0]?.accountId || null;
    if (activeAccountId) refreshBalance();
  }
}

init();

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
  accounts = [];
  balance = null;
  if (lockTimer) { clearTimeout(lockTimer); lockTimer = null; }
}

async function unlock(password: string): Promise<boolean> {
  const valid = await storage.verifyPassword(password);
  if (!valid) return false;
  accounts = await storage.loadAccounts(password);
  activeAccountId = (await storage.getActiveAccountId()) || accounts[0]?.accountId || null;
  sessionPassword = password;
  isLocked = false;
  resetLockTimer();
  if (activeAccountId) refreshBalance();
  return true;
}

// ── Balance ───────────────────────────────────────────────────

async function refreshBalance() {
  if (!activeAccountId) { balance = null; tokens = []; transactions = []; return; }
  try {
    const [bal, toks, txs] = await Promise.all([
      getBalance(network, activeAccountId),
      getTokenBalances(network, activeAccountId),
      getAccountTxs(network, activeAccountId, 10),
    ]);
    balance = bal;
    tokens = toks;
    transactions = txs;
  } catch {
    balance = null;
  }
}

// Refresh balance every 10s when unlocked.
setInterval(() => {
  if (!isLocked && activeAccountId) refreshBalance();
}, 10_000);

// ── State snapshot ────────────────────────────────────────────

function summarizeTxs() {
  return transactions.map((tx) => {
    // Detect tx type from events.
    const transferEvt = tx.events.find((e) => e.topic === "transfer");
    const stakeEvt = tx.events.find((e) => e.topic === "delegate" || e.topic === "undelegate");
    const intentEvt = tx.events.find((e) => e.topic === "intent_fulfilled");
    const rewardEvt = tx.events.find((e) => e.topic === "epoch_reward" || e.topic === "delegator_reward");

    let type = "Transaction";
    let amount: string | null = null;
    let to: string | null = null;

    if (intentEvt) {
      type = "Intent";
    }
    if (transferEvt && transferEvt.data.length >= 96) {
      type = intentEvt ? "Intent" : "Transfer";
      to = transferEvt.data.slice(0, 64);
      // Parse LE u128 amount.
      const hex = transferEvt.data.slice(64, 96);
      const bytes = [];
      for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
      let val = BigInt(0);
      for (let i = bytes.length - 1; i >= 0; i--) val = (val << BigInt(8)) | BigInt(bytes[i]);
      amount = val.toString();
    } else if (stakeEvt && stakeEvt.data.length >= 96) {
      type = stakeEvt.topic === "delegate" ? "Stake" : "Unstake";
      const hex = stakeEvt.data.slice(64, 96);
      const bytes = [];
      for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
      let val = BigInt(0);
      for (let i = bytes.length - 1; i >= 0; i--) val = (val << BigInt(8)) | BigInt(bytes[i]);
      amount = val.toString();
    } else if (rewardEvt) {
      type = "Reward";
    }

    return {
      block_height: tx.block_height,
      index: tx.index,
      sender: tx.sender,
      success: tx.success,
      type,
      amount,
      to,
    };
  });
}

function getState(): WalletState {
  return {
    isLocked,
    hasPassword: sessionPassword !== null || accounts.length === 0,
    accounts: accounts.map((a) => ({ name: a.name, accountId: a.accountId, publicKey: a.publicKey })),
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

interface TxParams {
  to: string;
  amount: string;
  // Token transfer fields (optional — if present, builds a Call action instead of Transfer).
  token?: string;   // SRC-20 contract address
  method?: string;  // contract method (default: "transfer")
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

  if (params.token) {
    // SRC-20 token transfer via Call action.
    // Args format: recipient[32] + amount[16 LE]
    const recipientBytes = Array.from(addressToBytes(params.to));
    const rawAmount = parseAmount(params.amount);
    const amountBigInt = BigInt(rawAmount);
    const amountLeBytes = u128ToLeBytes(amountBigInt);
    const args = [...recipientBytes, ...amountLeBytes];
    const targetBytes = Array.from(addressToBytes(params.token));
    const method = params.method || "transfer";

    rustActions = [{ Call: { target: targetBytes, method, args } }];
  } else {
    // Native SOLEN transfer.
    const toBytes = Array.from(addressToBytes(params.to));
    const rawAmount = parseAmount(params.amount);
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
      accounts.push(account);
      if (!activeAccountId) activeAccountId = account.accountId;
      await storage.saveAccounts(accounts, sessionPassword || undefined);
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
      accounts.push(account);
      if (!activeAccountId) activeAccountId = account.accountId;
      await storage.saveAccounts(accounts, sessionPassword || undefined);
      await storage.setActiveAccountId(activeAccountId!);
      refreshBalance();
      return { success: true, accountId: account.accountId };
    }

    case "REMOVE_ACCOUNT": {
      accounts = accounts.filter((a) => a.accountId !== msg.accountId);
      if (activeAccountId === msg.accountId) {
        activeAccountId = accounts[0]?.accountId || null;
      }
      await storage.saveAccounts(accounts, sessionPassword || undefined);
      refreshBalance();
      return { success: true };
    }

    case "SET_ACTIVE_ACCOUNT": {
      activeAccountId = msg.accountId;
      await storage.setActiveAccountId(msg.accountId);
      refreshBalance();
      return { success: true };
    }

    case "SET_NETWORK": {
      network = msg.network as NetworkId;
      await storage.setNetwork(network);
      refreshBalance();
      return { success: true };
    }

    case "SET_PASSWORD": {
      await storage.setPassword(msg.password, accounts);
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

    case "DAPP_SIGN_AND_SUBMIT": {
      if (isLocked) return { error: "Wallet is locked" };
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
