import { useState, useEffect, useCallback } from "react";
import type { WalletState, BackgroundRequest, TokenBalance } from "../lib/messages";
import { networks, type NetworkId } from "../lib/networks";
import { formatBalance } from "../lib/wallet";
import {
  backingValue,
  formatBaseUnits,
  isStsolenContract,
  openStakeDapp,
  readCachedExchangeRate,
} from "../lib/stsolen";
import { TokenIcon } from "./TokenIcon";

function send(msg: BackgroundRequest): Promise<any> {
  return chrome.runtime.sendMessage(msg);
}

export function App() {
  const [state, setState] = useState<WalletState | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const refresh = useCallback(async () => {
    const s = await send({ type: "GET_STATE" });
    setState(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (loading || !state) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-700 border-t-emerald-400" />
      </div>
    );
  }

  if (state.pendingDappRequest) {
    return <DappApproval request={state.pendingDappRequest} onDone={refresh} />;
  }

  if (state.accounts.length === 0 && !state.isLocked) {
    return <Onboarding onDone={refresh} />;
  }

  if (state.isLocked) {
    return <LockScreen onDone={refresh} />;
  }

  if (showSettings) {
    return <SettingsView state={state} onBack={() => { setShowSettings(false); refresh(); }} onRefresh={refresh} />;
  }

  return <Dashboard state={state} onRefresh={refresh} onOpenSettings={() => setShowSettings(true)} />;
}

// ── Lock Screen ───────────────────────────────────────────────

function LockScreen({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const result = await send({ type: "UNLOCK", password });
    if (result.success) {
      onDone();
    } else {
      setError("Wrong password");
    }
    setPassword("");
  };

  return (
    <div className="flex flex-col items-center justify-center h-full px-6">
      <div className="w-12 h-12 mb-4 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-indigo-500/20 flex items-center justify-center">
        <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
      <h2 className="text-lg font-bold text-gray-200 mb-1">Solen Wallet</h2>
      <p className="text-gray-500 text-xs mb-5">Enter your password to unlock</p>
      <form onSubmit={handleUnlock} className="w-full space-y-3">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500/50"
        />
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-3 rounded-xl transition-colors">
          Unlock
        </button>
      </form>
    </div>
  );
}

// ── Onboarding ────────────────────────────────────────────────

function Onboarding({ onDone }: { onDone: () => void }) {
  const [tab, setTab] = useState<"create" | "import">("create");
  const [name, setName] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [error, setError] = useState("");

  const handleCreate = async () => {
    if (!name.trim()) { setError("Enter an account name"); return; }
    await send({ type: "CREATE_ACCOUNT", name: name.trim() });
    onDone();
  };

  const handleImport = async () => {
    if (!name.trim()) { setError("Enter an account name"); return; }
    if (!secretKey.trim() || secretKey.trim().length < 64) { setError("Enter a valid secret key"); return; }
    await send({ type: "IMPORT_ACCOUNT", name: name.trim(), secretKey: secretKey.trim() });
    onDone();
  };

  return (
    <div className="flex flex-col h-full px-5 py-6">
      <div className="text-center mb-6">
        <div className="text-xl font-bold"><span className="text-emerald-400">Solen</span> <span className="text-gray-400">Wallet</span></div>
        <p className="text-gray-500 text-xs mt-1">Create or import an account to get started</p>
      </div>

      <div className="flex gap-1 bg-gray-900 rounded-lg p-1 mb-4">
        <button onClick={() => setTab("create")} className={`flex-1 py-2 text-xs rounded-md font-medium ${tab === "create" ? "bg-gray-700 text-white" : "text-gray-400"}`}>
          Create New
        </button>
        <button onClick={() => setTab("import")} className={`flex-1 py-2 text-xs rounded-md font-medium ${tab === "import" ? "bg-gray-700 text-white" : "text-gray-400"}`}>
          Import
        </button>
      </div>

      <div className="space-y-3 flex-1">
        <input
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(""); }}
          placeholder="Account name"
          autoFocus
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500/50"
        />
        {tab === "import" && (
          <textarea
            value={secretKey}
            onChange={(e) => { setSecretKey(e.target.value); setError(""); }}
            placeholder="Secret key (64 hex chars)"
            rows={3}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500/50 font-mono resize-none"
          />
        )}
        {error && <p className="text-red-400 text-xs">{error}</p>}
      </div>

      <button
        onClick={tab === "create" ? handleCreate : handleImport}
        className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-3 rounded-xl transition-colors mt-4"
      >
        {tab === "create" ? "Create Account" : "Import Account"}
      </button>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────

function Dashboard({ state, onRefresh, onOpenSettings }: { state: WalletState; onRefresh: () => void; onOpenSettings: () => void }) {
  const [showSend, setShowSend] = useState(false);
  const [activeTab, setActiveTab] = useState<"tokens" | "activity">("tokens");
  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(null);
  const [copied, setCopied] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showBackupKey, setShowBackupKey] = useState(false);
  const [backupKey, setBackupKey] = useState("");
  const activeAccount = state.accounts.find((a) => a.accountId === state.activeAccountId);
  const net = networks[state.network as NetworkId];

  const copyAddress = () => {
    if (activeAccount) {
      navigator.clipboard.writeText(activeAccount.accountId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Token detail view
  if (selectedToken) {
    return (
      <TokenDetail
        token={selectedToken}
        net={net}
        onBack={() => setSelectedToken(null)}
        onRefresh={onRefresh}
        network={state.network as NetworkId}
        activeAccountId={state.activeAccountId}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src={chrome.runtime.getURL("icons/icon48.png")} alt="Solen" className="w-5 h-5" />
          <div className="text-sm font-bold"><span className="text-emerald-400">Solen</span></div>
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: net.color + "20", color: net.color }}>
            {net.name}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <div className="relative">
            <button
              onClick={() => setShowAccountMenu(!showAccountMenu)}
              className="flex items-center gap-1 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300 hover:border-gray-600"
            >
              <div className="w-4 h-4 rounded-full bg-emerald-500/20 flex items-center justify-center text-[8px] font-bold text-emerald-400">
                {(activeAccount?.name || "?")[0].toUpperCase()}
              </div>
              <span className="max-w-[80px] truncate">{activeAccount?.name || "Account"}</span>
              <svg className="w-3 h-3 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showAccountMenu && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-gray-900 border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
                <div className="max-h-48 overflow-y-auto">
                  {state.accounts.map((a) => (
                    <button
                      key={a.accountId}
                      onClick={() => {
                        send({ type: "SET_ACTIVE_ACCOUNT", accountId: a.accountId });
                        setShowAccountMenu(false);
                        onRefresh();
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-800 transition-colors ${
                        a.accountId === state.activeAccountId ? "bg-gray-800/50" : ""
                      }`}
                    >
                      <div className="w-6 h-6 rounded-full bg-emerald-500/15 flex items-center justify-center text-[9px] font-bold text-emerald-400 shrink-0">
                        {a.name[0].toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs text-gray-200 font-medium truncate">{a.name}</div>
                        <div className="text-[9px] text-gray-500 font-mono truncate">{a.accountId.slice(0, 10)}...{a.accountId.slice(-4)}</div>
                      </div>
                      {a.accountId === state.activeAccountId && (
                        <svg className="w-3.5 h-3.5 text-emerald-400 ml-auto shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
                <div className="border-t border-gray-700">
                  <button
                    onClick={() => { setShowAccountMenu(false); setShowAddAccount(true); }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-800 transition-colors"
                  >
                    <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-xs text-gray-400 shrink-0">+</div>
                    <span className="text-xs text-gray-400">Add Account</span>
                  </button>
                  <button
                    onClick={async () => {
                      setShowAccountMenu(false);
                      const res = await send({ type: "EXPORT_KEY", accountId: state.activeAccountId! });
                      if (res.secretKey) { setBackupKey(res.secretKey); setShowBackupKey(true); }
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-800 transition-colors"
                  >
                    <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
                      <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                      </svg>
                    </div>
                    <span className="text-xs text-gray-400">Backup Private Key</span>
                  </button>
                  <button
                    onClick={() => { setShowAccountMenu(false); onOpenSettings(); }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-800 transition-colors"
                  >
                    <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
                      <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <span className="text-xs text-gray-400">Settings</span>
                  </button>
                </div>
              </div>
            )}
          </div>
          <button onClick={() => { send({ type: "LOCK" }); onRefresh(); }} title="Lock" className="p-1.5 text-gray-500 hover:text-gray-300">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Backup Key Modal */}
      {showBackupKey && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 w-full max-w-xs">
            <h3 className="text-sm font-bold text-white mb-2">Private Key Backup</h3>
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2 mb-3">
              <p className="text-[10px] text-red-400 font-medium">Never share your private key. Anyone with this key has full control of your account.</p>
            </div>
            <div
              className="bg-gray-800 rounded-lg p-3 mb-3 cursor-pointer hover:bg-gray-750 transition-colors"
              onClick={() => { navigator.clipboard.writeText(backupKey); }}
              title="Click to copy"
            >
              <p className="text-[10px] text-gray-500 mb-1">Click to copy</p>
              <p className="text-[10px] text-gray-300 font-mono break-all select-all">{backupKey}</p>
            </div>
            <button
              onClick={() => { setShowBackupKey(false); setBackupKey(""); }}
              className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs py-2 rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Account ID */}
      <div className="px-4 pt-4 pb-2">
        <p className="text-xs text-gray-500 mb-1">{activeAccount?.name || "Account"}</p>
        <button
          onClick={copyAddress}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-400 font-mono truncate hover:border-gray-600 transition-colors text-center"
        >
          {copied ? "Copied!" : activeAccount?.accountId ? `${activeAccount.accountId.slice(0, 12)}...${activeAccount.accountId.slice(-6)}` : "No account"}
        </button>
      </div>

      {/* Send / Receive */}
      <div className="px-4 flex gap-2 mb-3">
        <button
          onClick={() => setShowSend(true)}
          className="flex-1 flex flex-col items-center gap-1 bg-gray-900 hover:bg-gray-800 text-gray-300 text-xs font-medium py-3 rounded-xl transition-colors"
        >
          <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-4 4m4-4l4 4" />
          </svg>
          Send
        </button>
        <button
          onClick={copyAddress}
          className="flex-1 flex flex-col items-center gap-1 bg-gray-900 hover:bg-gray-800 text-gray-300 text-xs font-medium py-3 rounded-xl transition-colors"
        >
          <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m0 0l-4-4m4 4l4-4" />
          </svg>
          Receive
        </button>
      </div>

      {/* Send form */}
      {showSend && <SendForm network={state.network as NetworkId} onClose={() => setShowSend(false)} onRefresh={onRefresh} />}

      {/* Add Account */}
      {showAddAccount && <AddAccountPanel state={state} onClose={() => setShowAddAccount(false)} onRefresh={onRefresh} />}

      {/* Tabs */}
      <div className="px-4 flex gap-1 mb-2">
        <button
          onClick={() => setActiveTab("tokens")}
          className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
            activeTab === "tokens" ? "bg-gray-800 text-white" : "text-gray-500 hover:text-gray-300"
          }`}
        >
          Tokens
        </button>
        <button
          onClick={() => setActiveTab("activity")}
          className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
            activeTab === "activity" ? "bg-gray-800 text-white" : "text-gray-500 hover:text-gray-300"
          }`}
        >
          Activity
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4">
        {activeTab === "tokens" ? (
          <TokensList
            balance={state.balance}
            tokens={Array.isArray(state.tokens) ? state.tokens : []}
            network={state.network as NetworkId}
            activeAccountId={state.activeAccountId}
            onSelect={setSelectedToken}
          />
        ) : (
          <ActivityList
            transactions={state.transactions}
            activeAccountId={state.activeAccountId}
            explorerUrl={net.explorerUrl}
          />
        )}
      </div>

      {/* Network selector at bottom */}
      <div className="mt-auto px-4 py-3 border-t border-gray-800">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Network</span>
          <select
            value={state.network}
            onChange={(e) => { send({ type: "SET_NETWORK", network: e.target.value }); onRefresh(); }}
            className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300"
          >
            <option value="mainnet">Mainnet</option>
            <option value="testnet">Testnet</option>
            <option value="devnet">Devnet</option>
          </select>
        </div>
      </div>
    </div>
  );
}

// ── Tokens List ──────────────────────────────────────────────

function TokensList({ balance, tokens, network, activeAccountId, onSelect }: {
  balance: string | null;
  tokens: TokenBalance[];
  network: NetworkId;
  activeAccountId: string | null;
  onSelect: (t: TokenBalance) => void;
}) {
  const solenToken: TokenBalance = {
    contract: "native",
    symbol: "SOLEN",
    name: "Solen",
    balance: balance || "0",
    decimals: 8,
  };

  const allTokens = [solenToken, ...tokens];

  // Fetch the stSOLEN exchange rate once if any row is stSOLEN — used to
  // render the "≈ N.NN SOLEN" backing pill.
  const hasStsolen = allTokens.some((t) => isStsolenContract(t.contract, network));
  const [stsolenRate, setStsolenRate] = useState<{ pool: bigint; supply: bigint } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!hasStsolen) return;
    (async () => {
      const r = await readCachedExchangeRate(network);
      if (!cancelled) setStsolenRate(r);
    })();
    return () => {
      cancelled = true;
    };
  }, [hasStsolen, network]);

  return (
    <div className="space-y-1">
      {allTokens.map((token) => {
        const isStsolen = isStsolenContract(token.contract, network);
        const backingDisplay =
          isStsolen && stsolenRate
            ? formatBaseUnits(
                backingValue(BigInt(token.balance || "0"), stsolenRate),
              )
            : null;

        return (
          <div
            key={token.contract}
            className="w-full flex items-center justify-between py-3 px-3 rounded-xl hover:bg-gray-900/50 transition-colors text-left"
          >
            <button
              onClick={() => onSelect(token)}
              className="flex items-center gap-3 flex-1 min-w-0 text-left"
            >
              <TokenIcon contract={token.contract} symbol={token.symbol} />
              <div className="min-w-0">
                <div className="text-sm text-gray-200 font-medium">
                  {token.name}
                </div>
                <div className="text-[10px] text-gray-500">{token.symbol}</div>
              </div>
            </button>
            <div className="flex items-center gap-2 shrink-0">
              <div className="text-right">
                <div className="text-sm text-gray-200 font-medium tabular-nums">
                  {formatBalance(token.balance)}
                </div>
                {backingDisplay !== null && (
                  <div className="text-[10px] text-amber-400/80 tabular-nums">
                    ≈ {backingDisplay} SOLEN
                  </div>
                )}
              </div>
              {isStsolen && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openStakeDapp(activeAccountId ?? undefined);
                  }}
                  title="Open the staking dapp"
                  className="rounded-md border border-amber-500/40 px-2 py-1 text-[10px] font-medium text-amber-300 hover:bg-amber-500/10"
                >
                  Stake
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Token Detail ─────────────────────────────────────────────

function TokenDetail({ token, net, onBack, onRefresh, network, activeAccountId }: {
  token: TokenBalance;
  net: { name: string; color: string; explorerUrl: string };
  onBack: () => void;
  onRefresh: () => void;
  network: NetworkId;
  activeAccountId: string | null;
}) {
  const [showSend, setShowSend] = useState(false);
  const isStsolen = isStsolenContract(token.contract, network);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
        <button onClick={onBack} className="p-1 text-gray-500 hover:text-gray-300">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-bold text-gray-200">{token.name}</span>
        <span className="text-xs text-gray-500">({token.symbol})</span>
      </div>

      {/* Balance */}
      <div className="px-4 py-8 text-center">
        <div className="mx-auto mb-3 w-14 h-14">
          <TokenIcon contract={token.contract} symbol={token.symbol} sizeClass="w-14 h-14" textClass="text-lg" />
        </div>
        <p className="text-3xl font-bold text-white mb-1">
          {formatBalance(token.balance)}
        </p>
        <p className="text-xs text-gray-500">{token.symbol}</p>
      </div>

      {/* Actions */}
      <div className="px-4 flex gap-2 mb-4">
        <button
          onClick={() => setShowSend(true)}
          className="flex-1 flex flex-col items-center gap-1 bg-gray-900 hover:bg-gray-800 text-gray-300 text-xs font-medium py-3 rounded-xl transition-colors"
        >
          <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-4 4m4-4l4 4" />
          </svg>
          Send
        </button>
        <button
          onClick={onBack}
          className="flex-1 flex flex-col items-center gap-1 bg-gray-900 hover:bg-gray-800 text-gray-300 text-xs font-medium py-3 rounded-xl transition-colors"
        >
          <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m0 0l-4-4m4 4l4-4" />
          </svg>
          Receive
        </button>
        {isStsolen && (
          <button
            onClick={() => openStakeDapp(activeAccountId ?? undefined)}
            title="Open the staking dapp"
            className="flex-1 flex flex-col items-center gap-1 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/40 text-amber-200 text-xs font-medium py-3 rounded-xl transition-colors"
          >
            <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            Stake
          </button>
        )}
      </div>

      {showSend && <SendForm network={network} onClose={() => setShowSend(false)} onRefresh={onRefresh} />}

      {/* Token Info */}
      <div className="px-4 flex-1">
        <div className="bg-gray-900 rounded-xl p-4 space-y-3">
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Token</span>
            <span className="text-gray-300">{token.name} ({token.symbol})</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Decimals</span>
            <span className="text-gray-300">{token.decimals}</span>
          </div>
          {token.contract !== "native" && (
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Contract</span>
              <a
                href={`${net.explorerUrl}/account/${token.contract}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-400 hover:text-emerald-300 font-mono truncate ml-2"
              >
                {(token.contract || "").slice(0, 8)}...{(token.contract || "").slice(-6)}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Activity List ────────────────────────────────────────────

function ActivityList({ transactions, activeAccountId, explorerUrl }: {
  transactions: WalletState["transactions"];
  activeAccountId: string | null;
  explorerUrl: string;
}) {
  if (transactions.length === 0) {
    return <div className="text-center py-6 text-xs text-gray-600">No activity yet</div>;
  }

  return (
    <div className="space-y-1">
      {transactions.map((tx) => {
        const isSent = tx.sender === activeAccountId;
        const isReward = tx.type === "Reward";
        const isStake = tx.type === "Stake" || tx.type === "Unstake";
        const isIntent = tx.type === "Intent";
        const isBridge = tx.type?.startsWith("Bridge");

        return (
          <a
            key={`${tx.block_height}-${tx.index}`}
            href={`${explorerUrl}/tx/${tx.block_height}/${tx.index}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-gray-900/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-medium ${
                isBridge ? "bg-indigo-500/10 text-indigo-400"
                  : isIntent ? "bg-cyan-500/10 text-cyan-400"
                  : isReward ? "bg-amber-500/10 text-amber-400"
                  : isStake ? "bg-blue-500/10 text-blue-400"
                  : tx.success ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
              }`}>
                {isBridge ? "BR" : isIntent ? "IN" : isReward ? "RW" : isStake ? "ST" : isSent ? "OUT" : "IN"}
              </div>
              <div>
                <div className="text-xs text-gray-300">{tx.type}</div>
                <div className="text-[10px] text-gray-600">Block #{tx.block_height}</div>
              </div>
            </div>
            <div className="text-right">
              {tx.amount && (
                <div className={`text-xs font-medium ${
                  isBridge ? "text-indigo-400"
                    : isStake ? "text-blue-400"
                    : tx.token_symbol && tx.token_symbol !== "SOLEN" ? "text-indigo-400"
                    : isSent ? "text-gray-300" : "text-emerald-400"
                }`}>
                  {isBridge ? "" : isSent && !isStake ? "-" : "+"}{formatBalance(tx.amount)} {tx.token_symbol || "SOLEN"}
                </div>
              )}
              {!tx.success && <div className="text-[10px] text-red-400">Failed</div>}
            </div>
          </a>
        );
      })}
    </div>
  );
}

// ── Add Account Panel ────────────────────────────────────────

type AddAccountTab = "create" | "import-phrase" | "import-key";
type CreateStep = "name" | "show";

function AddAccountPanel({
  state,
  onClose,
  onRefresh,
}: {
  state: WalletState;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<AddAccountTab>("create");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Create flow
  const [createStep, setCreateStep] = useState<CreateStep>("name");
  const [generatedMnemonic, setGeneratedMnemonic] = useState<string>("");
  const [backedUp, setBackedUp] = useState(false);
  const [useExistingMnemonicId, setUseExistingMnemonicId] = useState<string>("");

  // Import phrase
  const [importPhrase, setImportPhrase] = useState("");

  // Import key (legacy)
  const [secretKey, setSecretKey] = useState("");

  const hasPassword = state.hasPassword && state.accounts.length > 0;

  const handleCreate = async () => {
    setError("");
    if (!name.trim()) { setError("Enter a name"); return; }
    if (useExistingMnemonicId) {
      setBusy(true);
      const res = await send({ type: "ADD_FROM_MNEMONIC", name: name.trim(), mnemonicId: useExistingMnemonicId });
      setBusy(false);
      if (res?.error) { setError(res.error); return; }
      onRefresh();
      onClose();
      return;
    }
    if (!hasPassword) {
      setError("Set a password in Settings first");
      return;
    }
    setBusy(true);
    const res = await send({ type: "CREATE_MNEMONIC_ACCOUNT", name: name.trim() });
    setBusy(false);
    if (res?.error) { setError(res.error); return; }
    setGeneratedMnemonic(res.mnemonic);
    setCreateStep("show");
    onRefresh();
  };

  const handleImportPhrase = async () => {
    setError("");
    if (!name.trim()) { setError("Enter a name"); return; }
    if (!hasPassword) { setError("Set a password in Settings first"); return; }
    setBusy(true);
    const res = await send({ type: "IMPORT_MNEMONIC_ACCOUNT", name: name.trim(), mnemonic: importPhrase });
    setBusy(false);
    if (res?.error) { setError(res.error); return; }
    onRefresh();
    onClose();
  };

  const handleImportKey = async () => {
    setError("");
    if (!name.trim()) { setError("Enter a name"); return; }
    if (!secretKey.trim() || secretKey.trim().length < 64) { setError("Enter a valid secret key (64 hex chars)"); return; }
    setBusy(true);
    await send({ type: "IMPORT_ACCOUNT", name: name.trim(), secretKey: secretKey.trim() });
    setBusy(false);
    onRefresh();
    onClose();
  };

  const handleLegacyCreate = async () => {
    setError("");
    if (!name.trim()) { setError("Enter a name"); return; }
    setBusy(true);
    await send({ type: "CREATE_ACCOUNT", name: name.trim() });
    setBusy(false);
    onRefresh();
    onClose();
  };

  if (createStep === "show") {
    return (
      <div className="px-4 pb-3">
        <div className="bg-gray-900 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-300">Recovery Phrase</span>
          </div>
          <div className="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-md p-2">
            Write these 24 words down on paper, in order. Anyone with this phrase can spend your funds.
          </div>
          <div className="bg-gray-950 border border-gray-700 rounded-lg p-2.5 grid grid-cols-3 gap-1.5 text-[10px] font-mono">
            {generatedMnemonic.split(" ").map((word, i) => (
              <div key={i} className="flex items-baseline gap-1">
                <span className="text-gray-600 w-4 text-right">{i + 1}.</span>
                <span className="text-gray-200 truncate">{word}</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => navigator.clipboard.writeText(generatedMnemonic)}
            className="w-full text-[10px] text-gray-400 hover:text-gray-200"
          >
            Copy to clipboard
          </button>
          <label className="flex items-start gap-2 text-[11px] text-gray-300 cursor-pointer">
            <input type="checkbox" checked={backedUp} onChange={(e) => setBackedUp(e.target.checked)} className="mt-0.5" />
            <span>I've written down my recovery phrase.</span>
          </label>
          <button
            onClick={() => { onRefresh(); onClose(); }}
            disabled={!backedUp}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2 rounded-lg text-xs"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pb-3">
      <div className="bg-gray-900 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-gray-300">Add Account</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xs">Close</button>
        </div>

        <div className="flex gap-1 bg-gray-950 rounded-lg p-1">
          <button onClick={() => { setTab("create"); setError(""); }} className={`flex-1 py-1.5 text-[10px] rounded-md font-medium ${tab === "create" ? "bg-gray-700 text-white" : "text-gray-400"}`}>
            Create
          </button>
          <button onClick={() => { setTab("import-phrase"); setError(""); }} className={`flex-1 py-1.5 text-[10px] rounded-md font-medium ${tab === "import-phrase" ? "bg-gray-700 text-white" : "text-gray-400"}`}>
            Phrase
          </button>
          <button onClick={() => { setTab("import-key"); setError(""); }} className={`flex-1 py-1.5 text-[10px] rounded-md font-medium ${tab === "import-key" ? "bg-gray-700 text-white" : "text-gray-400"}`}>
            Key
          </button>
        </div>

        <input
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(""); }}
          placeholder="Account name"
          autoFocus
          className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500/50"
        />

        {tab === "create" && state.mnemonics && state.mnemonics.length > 0 && (
          <select
            value={useExistingMnemonicId}
            onChange={(e) => setUseExistingMnemonicId(e.target.value)}
            className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-emerald-500/50"
          >
            <option value="">New recovery phrase</option>
            {state.mnemonics.map((m) => (
              <option key={m.id} value={m.id}>Next account from "{m.label}"</option>
            ))}
          </select>
        )}

        {tab === "create" && !hasPassword && !useExistingMnemonicId && (
          <div className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md p-2">
            A wallet password is required to create a recovery phrase. Open Settings, or use Key tab.
          </div>
        )}

        {tab === "import-phrase" && (
          <>
            <textarea
              value={importPhrase}
              onChange={(e) => { setImportPhrase(e.target.value); setError(""); }}
              placeholder="Paste 12 or 24 word recovery phrase"
              rows={3}
              className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500/50 font-mono resize-none"
            />
            {!hasPassword && (
              <div className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md p-2">
                A wallet password is required. Set one in Settings first.
              </div>
            )}
          </>
        )}

        {tab === "import-key" && (
          <textarea
            value={secretKey}
            onChange={(e) => { setSecretKey(e.target.value); setError(""); }}
            placeholder="Secret key (64 hex chars)"
            rows={2}
            className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500/50 font-mono resize-none"
          />
        )}

        {error && <p className="text-red-400 text-[10px]">{error}</p>}

        <button
          onClick={
            tab === "create" ? handleCreate :
            tab === "import-phrase" ? handleImportPhrase :
            handleImportKey
          }
          disabled={busy}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium py-2 rounded-lg transition-colors text-xs"
        >
          {busy ? "Working…" :
            tab === "create" ? (useExistingMnemonicId ? "Derive Next Account" : "Generate Recovery Phrase") :
            tab === "import-phrase" ? "Import Account" :
            "Import Account"}
        </button>

        {tab === "create" && !useExistingMnemonicId && (
          <button
            onClick={handleLegacyCreate}
            disabled={busy}
            className="w-full text-[10px] text-gray-500 hover:text-gray-300"
          >
            Or create a one-off random account
          </button>
        )}
      </div>
    </div>
  );
}

// ── Settings View ────────────────────────────────────────────

function SettingsView({ state, onBack, onRefresh }: { state: WalletState; onBack: () => void; onRefresh: () => void }) {
  const [showSetPw, setShowSetPw] = useState(false);
  const [pw, setPw] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState("");

  const [revealId, setRevealId] = useState<string | null>(null);
  const [revealPw, setRevealPw] = useState("");
  const [revealError, setRevealError] = useState("");
  const [revealedWords, setRevealedWords] = useState<string | null>(null);

  const hasRealPassword = state.hasPassword && state.accounts.length > 0;
  // hasPassword in state is true when no accounts exist OR when password is set;
  // we want to show "Set Password" only when truly no password is set AND there's
  // something to protect. Approximate: if accounts exist and !hasPassword, show
  // Set Password; if no accounts, show "Set up password before adding HD account".

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError("");
    if (pw.length < 6) { setPwError("Password must be at least 6 characters"); return; }
    if (pw !== pwConfirm) { setPwError("Passwords don't match"); return; }
    await send({ type: "SET_PASSWORD", password: pw });
    setShowSetPw(false);
    setPw("");
    setPwConfirm("");
    setPwSuccess("Password set");
    setTimeout(() => setPwSuccess(""), 3000);
    onRefresh();
  };

  const startReveal = (id: string) => {
    setRevealId(id);
    setRevealPw("");
    setRevealError("");
    setRevealedWords(null);
  };

  const cancelReveal = () => {
    setRevealId(null);
    setRevealPw("");
    setRevealError("");
    setRevealedWords(null);
  };

  const submitReveal = async (e: React.FormEvent) => {
    e.preventDefault();
    setRevealError("");
    if (!revealId) return;
    const res = await send({ type: "REVEAL_MNEMONIC", password: revealPw, mnemonicId: revealId });
    if (res?.error) { setRevealError(res.error); return; }
    setRevealedWords(res.mnemonic);
    setRevealPw("");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
        <button onClick={onBack} className="p-1 text-gray-400 hover:text-gray-200">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="text-sm font-semibold text-gray-200">Settings</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Password */}
        <section>
          <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wide mb-2">Security</h3>
          <div className="bg-gray-900 rounded-xl p-3 space-y-2">
            <div className="text-xs text-gray-400">
              Status: {hasRealPassword ? <span className="text-emerald-400">Password set</span> : <span className="text-amber-400">No password</span>}
            </div>
            {!hasRealPassword && !showSetPw && (
              <button
                onClick={() => { setShowSetPw(true); setPwError(""); }}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
              >
                Set Password
              </button>
            )}
            {showSetPw && (
              <form onSubmit={handleSetPassword} className="space-y-2 mt-2">
                <input
                  type="password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  placeholder="New password (min 6 chars)"
                  autoFocus
                  className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-emerald-500/50"
                />
                <input
                  type="password"
                  value={pwConfirm}
                  onChange={(e) => setPwConfirm(e.target.value)}
                  placeholder="Confirm password"
                  className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-emerald-500/50"
                />
                {pwError && <p className="text-red-400 text-[10px]">{pwError}</p>}
                <div className="flex gap-2">
                  <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg">Set</button>
                  <button type="button" onClick={() => { setShowSetPw(false); setPwError(""); }} className="text-gray-400 text-xs px-3 py-1.5">Cancel</button>
                </div>
              </form>
            )}
            {pwSuccess && <p className="text-emerald-400 text-[10px]">{pwSuccess}</p>}
          </div>
        </section>

        {/* Recovery phrases */}
        {state.mnemonics && state.mnemonics.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wide mb-2">Recovery Phrases</h3>
            <div className="space-y-2">
              {state.mnemonics.map((m) => {
                const isActive = revealId === m.id;
                return (
                  <div key={m.id} className="bg-gray-900 rounded-xl p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-medium text-gray-200">{m.label}</div>
                        <div className="text-[10px] text-gray-500 font-mono">{m.id.slice(0, 8)}…</div>
                      </div>
                      {!isActive ? (
                        <button onClick={() => startReveal(m.id)} className="text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-300 px-2.5 py-1 rounded">Reveal</button>
                      ) : (
                        <button onClick={cancelReveal} className="text-[10px] text-gray-500 hover:text-gray-300 px-2.5 py-1">{revealedWords ? "Hide" : "Cancel"}</button>
                      )}
                    </div>
                    {isActive && !revealedWords && (
                      <form onSubmit={submitReveal} className="mt-2 space-y-2">
                        <input
                          type="password"
                          value={revealPw}
                          onChange={(e) => setRevealPw(e.target.value)}
                          placeholder="Wallet password"
                          autoFocus
                          className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-emerald-500/50"
                        />
                        {revealError && <p className="text-red-400 text-[10px]">{revealError}</p>}
                        <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-medium px-3 py-1.5 rounded-lg">Show</button>
                      </form>
                    )}
                    {isActive && revealedWords && (
                      <div className="mt-2 space-y-2">
                        <div className="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-md p-2">
                          Don't share, screenshot, or paste online.
                        </div>
                        <div className="bg-gray-950 border border-gray-700 rounded-lg p-2 grid grid-cols-3 gap-1 text-[10px] font-mono">
                          {revealedWords.split(" ").map((w, i) => (
                            <div key={i} className="flex items-baseline gap-1">
                              <span className="text-gray-600 w-4 text-right">{i + 1}.</span>
                              <span className="text-gray-200 truncate">{w}</span>
                            </div>
                          ))}
                        </div>
                        <button
                          onClick={() => navigator.clipboard.writeText(revealedWords)}
                          className="w-full text-[10px] text-gray-400 hover:text-gray-200"
                        >
                          Copy to clipboard
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ── Send Form ─────────────────────────────────────────────────

function SendForm({ network, onClose, onRefresh }: { network: NetworkId; onClose: () => void; onRefresh: () => void }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!to || !amount) return;
    setSubmitting(true);
    setResult(null);

    // Build and sign the operation in the background.
    // For now, send a raw operation — the background worker will sign it.
    try {
      // The background needs to handle building the full operation.
      // For a simplified first version, we'll let the popup build it.
      const res = await send({
        type: "SIGN_AND_SUBMIT",
        operation: { to, amount },
      });
      if (res.error) {
        setResult({ success: false, message: res.error });
      } else {
        setResult({ success: true, message: "Transaction submitted" });
        setTo("");
        setAmount("");
        onRefresh();
      }
    } catch (e) {
      setResult({ success: false, message: e instanceof Error ? e.message : "Failed" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="px-4 pb-4">
      <div className="bg-gray-900 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-gray-300">Send SOLEN</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xs">Close</button>
        </div>
        <form onSubmit={handleSend} className="space-y-3">
          <input
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="Recipient address"
            className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500/50 font-mono"
          />
          <div className="relative">
            <input
              type="text"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2.5 pr-16 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500/50"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">SOLEN</span>
          </div>
          <button
            type="submit"
            disabled={submitting || !to || !amount}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
          >
            {submitting ? "Sending..." : "Send"}
          </button>
        </form>
        {result && (
          <div className={`text-xs p-2 rounded-lg ${result.success ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
            {result.message}
          </div>
        )}
      </div>
    </div>
  );
}

// ── dApp Approval ─────────────────────────────────────────────

function DappApproval({ request, onDone }: { request: { id: string; origin: string; type: string; data?: unknown }; onDone: () => void }) {
  const approve = async () => {
    await send({ type: "APPROVE_DAPP_REQUEST", requestId: request.id });
    onDone();
  };

  const reject = async () => {
    await send({ type: "REJECT_DAPP_REQUEST", requestId: request.id });
    onDone();
  };

  // Parse transaction details from request data.
  const txData = request.data as { to?: string; amount?: string; token?: string; method?: string; actions?: { type: string; to?: string; target?: string; amount?: string; method?: string }[] } | null;
  const isMultiAction = txData?.actions && txData.actions.length > 0;
  const isTokenTx = txData?.token;
  const isContractCall = txData?.method && !isTokenTx && !isMultiAction;
  const truncAddr = (addr: string) => addr.length > 16 ? `${addr.slice(0, 8)}...${addr.slice(-6)}` : addr;

  const getTxLabel = () => {
    if (isMultiAction) return `${txData!.actions!.length} Actions`;
    if (isContractCall) return "Contract Call";
    if (isTokenTx) return "Token Transfer";
    return "SOLEN Transfer";
  };

  return (
    <div className="flex flex-col items-center justify-center h-full px-6">
      <div className={`w-12 h-12 mb-4 rounded-2xl flex items-center justify-center ${
        request.type === "connect" ? "bg-indigo-500/20" : "bg-amber-500/20"
      }`}>
        {request.type === "connect" ? (
          <svg className="w-6 h-6 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        ) : (
          <svg className="w-6 h-6 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 19V5m0 0l-4 4m4-4l4 4" />
          </svg>
        )}
      </div>

      <h2 className="text-lg font-bold text-gray-200 mb-1">
        {request.type === "connect" ? "Connection Request" : "Sign Transaction"}
      </h2>
      <p className="text-gray-500 text-xs mb-3 text-center">{request.origin}</p>

      {request.type === "connect" ? (
        <p className="text-gray-400 text-xs mb-6 text-center">
          This site wants to connect to your Solen wallet.
        </p>
      ) : (
        <div className="w-full bg-gray-900 rounded-xl p-4 mb-4 space-y-2">
          {txData ? (
            <>
              <div className="text-center mb-2">
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                  isMultiAction ? "bg-purple-500/15 text-purple-400" :
                  isContractCall ? "bg-amber-500/15 text-amber-400" :
                  isTokenTx ? "bg-indigo-500/15 text-indigo-400" : "bg-emerald-500/15 text-emerald-400"
                }`}>
                  {getTxLabel()}
                </span>
              </div>

              {isMultiAction ? (
                <div className="space-y-1">
                  {txData.actions!.map((a, i) => (
                    <div key={i} className="flex justify-between text-xs py-1 border-t border-gray-800">
                      <span className="text-gray-500">{i + 1}. {a.type === 'transfer' ? 'Transfer' : 'Call'}</span>
                      <span className="text-gray-300 font-mono text-right">
                        {a.type === 'transfer' ? `${a.amount} SOLEN` : `${a.method || 'call'}()`}
                        {(a.to || a.target) && <><br /><span className="text-gray-500">{truncAddr(a.to || a.target || '')}</span></>}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {txData.amount && (
                    <div className="text-center">
                      <span className="text-2xl font-bold text-white">{txData.amount}</span>
                      <span className="text-sm text-gray-400 ml-1">{isTokenTx ? "Token" : "SOLEN"}</span>
                    </div>
                  )}

                  {txData.to && (
                    <div className="flex justify-between text-xs pt-2 border-t border-gray-800">
                      <span className="text-gray-500">{isContractCall ? "Contract" : "To"}</span>
                      <span className="text-gray-300 font-mono">{truncAddr(txData.to)}</span>
                    </div>
                  )}

                  {txData.method && (
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Method</span>
                      <span className="text-gray-300">{txData.method}</span>
                    </div>
                  )}

                  {isTokenTx && (
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Token</span>
                      <span className="text-gray-300 font-mono">{truncAddr(txData.token!)}</span>
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <p className="text-gray-400 text-xs text-center">
              This site wants you to sign a transaction.
            </p>
          )}
        </div>
      )}

      <div className="w-full flex gap-2">
        <button onClick={reject} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium py-3 rounded-xl transition-colors">
          Reject
        </button>
        <button onClick={approve} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-3 rounded-xl transition-colors">
          Approve
        </button>
      </div>
    </div>
  );
}
