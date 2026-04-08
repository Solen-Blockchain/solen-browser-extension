import { useState, useEffect, useCallback } from "react";
import type { WalletState, BackgroundRequest, TokenBalance } from "../lib/messages";
import { networks, type NetworkId } from "../lib/networks";
import { formatBalance } from "../lib/wallet";

function send(msg: BackgroundRequest): Promise<any> {
  return chrome.runtime.sendMessage(msg);
}

export function App() {
  const [state, setState] = useState<WalletState | null>(null);
  const [loading, setLoading] = useState(true);

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

  return <Dashboard state={state} onRefresh={refresh} />;
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

function Dashboard({ state, onRefresh }: { state: WalletState; onRefresh: () => void }) {
  const [showSend, setShowSend] = useState(false);
  const [activeTab, setActiveTab] = useState<"tokens" | "activity">("tokens");
  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(null);
  const [copied, setCopied] = useState(false);
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
          {state.accounts.length > 1 && (
            <select
              value={state.activeAccountId || ""}
              onChange={(e) => { send({ type: "SET_ACTIVE_ACCOUNT", accountId: e.target.value }); onRefresh(); }}
              className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300"
            >
              {state.accounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>{a.name}</option>
              ))}
            </select>
          )}
          <button onClick={() => { send({ type: "LOCK" }); onRefresh(); }} title="Lock" className="p-1.5 text-gray-500 hover:text-gray-300">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </button>
        </div>
      </div>

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

function TokensList({ balance, tokens, onSelect }: {
  balance: string | null;
  tokens: TokenBalance[];
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

  return (
    <div className="space-y-1">
      {allTokens.map((token) => (
        <button
          key={token.contract}
          onClick={() => onSelect(token)}
          className="w-full flex items-center justify-between py-3 px-3 rounded-xl hover:bg-gray-900/50 transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold ${
              token.symbol === "SOLEN" ? "bg-emerald-500/15 text-emerald-400" : "bg-indigo-500/15 text-indigo-400"
            }`}>
              {(token.symbol || "??").slice(0, 2)}
            </div>
            <div>
              <div className="text-sm text-gray-200 font-medium">{token.name}</div>
              <div className="text-[10px] text-gray-500">{token.symbol}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-200 font-medium">
              {formatBalance(token.balance)}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ── Token Detail ─────────────────────────────────────────────

function TokenDetail({ token, net, onBack, onRefresh, network }: {
  token: TokenBalance;
  net: { name: string; color: string; explorerUrl: string };
  onBack: () => void;
  onRefresh: () => void;
  network: NetworkId;
}) {
  const [showSend, setShowSend] = useState(false);

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
        <div className={`w-14 h-14 mx-auto mb-3 rounded-full flex items-center justify-center text-lg font-bold ${
          token.symbol === "SOLEN" ? "bg-emerald-500/15 text-emerald-400" : "bg-indigo-500/15 text-indigo-400"
        }`}>
          {(token.symbol || "??").slice(0, 2)}
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
                isIntent ? "bg-cyan-500/10 text-cyan-400"
                  : isReward ? "bg-amber-500/10 text-amber-400"
                  : isStake ? "bg-blue-500/10 text-blue-400"
                  : tx.success ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
              }`}>
                {isIntent ? "IN" : isReward ? "RW" : isStake ? "ST" : isSent ? "OUT" : "IN"}
              </div>
              <div>
                <div className="text-xs text-gray-300">{tx.type}</div>
                <div className="text-[10px] text-gray-600">Block #{tx.block_height}</div>
              </div>
            </div>
            <div className="text-right">
              {tx.amount && (
                <div className={`text-xs font-medium ${
                  isStake ? "text-blue-400" : isSent ? "text-gray-300" : "text-emerald-400"
                }`}>
                  {isSent && !isStake ? "-" : "+"}{formatBalance(tx.amount)} SOLEN
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
  const txData = request.data as { to?: string; amount?: string; token?: string; method?: string } | null;
  const isTokenTx = txData?.token;
  const truncAddr = (addr: string) => addr.length > 16 ? `${addr.slice(0, 8)}...${addr.slice(-6)}` : addr;

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
                  isTokenTx ? "bg-indigo-500/15 text-indigo-400" : "bg-emerald-500/15 text-emerald-400"
                }`}>
                  {isTokenTx ? "Token Transfer" : "SOLEN Transfer"}
                </span>
              </div>

              {txData.amount && (
                <div className="text-center">
                  <span className="text-2xl font-bold text-white">{txData.amount}</span>
                  <span className="text-sm text-gray-400 ml-1">{isTokenTx ? "STT" : "SOLEN"}</span>
                </div>
              )}

              {txData.to && (
                <div className="flex justify-between text-xs pt-2 border-t border-gray-800">
                  <span className="text-gray-500">To</span>
                  <span className="text-gray-300 font-mono">{truncAddr(txData.to)}</span>
                </div>
              )}

              {isTokenTx && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Contract</span>
                  <span className="text-gray-300 font-mono">{truncAddr(txData.token!)}</span>
                </div>
              )}

              {txData.method && txData.method !== "transfer" && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Method</span>
                  <span className="text-gray-300">{txData.method}</span>
                </div>
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
