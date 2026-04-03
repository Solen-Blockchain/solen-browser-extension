/**
 * Inpage provider — injected into the web page context.
 * Exposes `window.solen` for dApps to interact with the wallet.
 */

interface SolenProvider {
  connect(): Promise<string[]>;
  getAccounts(): Promise<string[]>;
  signAndSubmit(operation: unknown): Promise<unknown>;
  isConnected(): boolean;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

const pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function makeId(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, "0")).join("");
}

// Listen for responses from the content script.
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== "SOLEN_RESPONSE") return;

  const { id, result, error } = event.data;
  const pending = pendingRequests.get(id);
  if (!pending) return;
  pendingRequests.delete(id);

  if (error) {
    pending.reject(new Error(error));
  } else {
    pending.resolve(result);
  }
});

function request(method: string, params?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = makeId();
    pendingRequests.set(id, { resolve, reject });
    window.postMessage({ type: "SOLEN_REQUEST", id, method, params }, "*");

    // Timeout after 5 minutes (user might take time to approve).
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error("Request timed out"));
      }
    }, 300_000);
  });
}

let connected = false;

const solen: SolenProvider = {
  async connect() {
    const result = await request("connect") as { accounts?: string[]; approved?: boolean; pending?: boolean };
    if (result.approved && result.accounts) {
      connected = true;
      return result.accounts;
    }
    if (result.pending) {
      // Extension will open popup for approval.
      // For now, return empty — dApp should retry or listen for events.
      return [];
    }
    throw new Error("Connection rejected");
  },

  async getAccounts() {
    const result = await request("getAccounts") as { accounts?: string[] };
    return result.accounts || [];
  },

  async signAndSubmit(operation: unknown) {
    return request("signAndSubmit", operation);
  },

  isConnected() {
    return connected;
  },

  on(_event: string, _handler: (...args: unknown[]) => void) {
    // TODO: event emitter for accountsChanged, networkChanged, etc.
  },
};

// Expose on the page.
(window as unknown as Record<string, unknown>).solen = solen;

// Announce presence.
window.dispatchEvent(new Event("solen#initialized"));
