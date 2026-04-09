/**
 * Content script — bridges between the web page and the extension background.
 *
 * Injects the inpage provider script and relays messages.
 */

// Inject the inpage provider into the page context.
const script = document.createElement("script");
script.src = chrome.runtime.getURL("inpage.js");
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

// Send message to background with retry on service worker wake failure.
async function sendWithRetry(msg: unknown, retries = 2): Promise<unknown> {
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await chrome.runtime.sendMessage(msg);
      if (resp !== undefined) return resp;
    } catch {
      if (i < retries) await new Promise(r => setTimeout(r, 300));
    }
  }
  throw new Error("Extension not responding");
}

// Relay messages from the page to the background.
window.addEventListener("message", async (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== "SOLEN_REQUEST") return;

  const { id, method, params } = event.data;
  const origin = window.location.origin;

  try {
    let response: unknown;

    switch (method) {
      case "connect":
        response = await sendWithRetry({ type: "DAPP_CONNECT", origin });
        break;
      case "getAccounts":
        response = await sendWithRetry({ type: "DAPP_GET_ACCOUNTS", origin });
        break;
      case "signAndSubmit":
        response = await sendWithRetry({ type: "DAPP_SIGN_AND_SUBMIT", origin, operation: params });
        break;
      case "signMessage":
        response = await sendWithRetry({ type: "DAPP_SIGN_MESSAGE", origin, message: (params as { message: string }).message });
        break;
      default:
        response = { error: `Unknown method: ${method}` };
    }

    window.postMessage({ type: "SOLEN_RESPONSE", id, result: response }, "*");
  } catch (e) {
    window.postMessage({
      type: "SOLEN_RESPONSE",
      id,
      error: e instanceof Error ? e.message : "Extension error",
    }, "*");
  }
});
