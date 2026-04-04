# Solen Wallet — Browser Extension

Browser wallet extension for the Solen blockchain. Send, receive, stake, and interact with dApps directly from Chrome, Brave, or Edge.

## Features

- **Account management** — create new Ed25519 keypairs or import existing ones
- **Password lock** — AES-256-GCM encryption with PBKDF2 key derivation
- **Send & receive** — transfer SOLEN with full transaction signing
- **Transaction history** — recent activity with links to the block explorer
- **Multi-network** — switch between Mainnet, Testnet, and Devnet
- **dApp provider** — injects `window.solen` for web3 dApp integration
- **Approval flow** — popup window for connect and signing requests
- **Auto-lock** — configurable timeout for security

## Install (Development)

```bash
npm install
npm run build
```

Then load in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `dist/` folder

## Project Structure

```
solenbrowser/
├── public/
│   └── manifest.json          # Chrome Extension Manifest V3
├── src/
│   ├── background/
│   │   └── service-worker.ts  # Key management, signing, dApp request handling
│   ├── content/
│   │   ├── inject.ts          # Content script — bridges page and extension
│   │   └── inpage.ts          # Injected provider (window.solen)
│   ├── popup/
│   │   ├── index.html         # Popup entry point
│   │   ├── main.tsx           # React mount
│   │   └── App.tsx            # Popup UI (lock, onboarding, dashboard, send, approval)
│   └── lib/
│       ├── crypto.ts          # PBKDF2 + AES-GCM encryption
│       ├── messages.ts        # Message types between components
│       ├── networks.ts        # Network configurations
│       ├── rpc.ts             # JSON-RPC client + explorer API
│       ├── storage.ts         # chrome.storage.local wrapper
│       └── wallet.ts          # Ed25519 keys, signing, tx building
├── test-dapp.html             # Test page for dApp integration
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## dApp Integration

The extension injects a `window.solen` provider into every page. dApps use it like this:

```javascript
// Check if extension is installed
if (window.solen) {
  // Connect — opens approval window
  const accounts = await window.solen.connect();

  // Send a transaction — opens approval window
  const result = await window.solen.signAndSubmit({
    to: "recipient-account-id-hex",
    amount: "100",  // in SOLEN
  });

  // Check connection status
  const connected = window.solen.isConnected();

  // Get connected accounts
  const accts = await window.solen.getAccounts();
}

// Listen for extension availability
window.addEventListener("solen#initialized", () => {
  console.log("Solen Wallet detected");
});
```

## Testing

Serve the test dApp locally:

```bash
python3 -m http.server 4444
```

Open `http://localhost:4444/test-dapp.html` in Chrome with the extension installed. The test page lets you:

1. Detect the extension
2. Connect your wallet
3. Send a test transaction

## Architecture

```
┌─────────────┐     window.postMessage     ┌────────────────┐
│   Web Page   │ ◄──────────────────────── │ Content Script  │
│  (dApp)      │   SOLEN_REQUEST/RESPONSE  │  (inject.ts)    │
│              │                           │                 │
│ window.solen │                           │ Relays messages │
│  (inpage.ts) │                           │ to background   │
└─────────────┘                            └───────┬────────┘
                                                   │
                                    chrome.runtime.sendMessage
                                                   │
                                           ┌───────▼────────┐
                                           │   Background    │
                                           │ Service Worker  │
                                           │                 │
                                           │ • Key storage   │
                                           │ • Signing       │
                                           │ • RPC calls     │
                                           │ • dApp approval │
                                           └───────┬────────┘
                                                   │
                                           chrome.windows.create
                                                   │
                                           ┌───────▼────────┐
                                           │  Approval       │
                                           │  Popup Window   │
                                           │                 │
                                           │ Approve/Reject  │
                                           └────────────────┘
```

## Build for Production

```bash
npm run build
```

The `dist/` folder is the complete extension ready to be packed or uploaded to the Chrome Web Store.

## Tech Stack

- **React 19** + TypeScript
- **Vite** bundler
- **Tailwind CSS**
- **@noble/ed25519** + **@noble/hashes** for cryptography
- **Chrome Extension Manifest V3**
