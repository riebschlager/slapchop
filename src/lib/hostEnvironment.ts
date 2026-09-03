/**
 * Where this session is running, for the few places the hosted browser edition
 * genuinely cannot do what the desktop app does.
 *
 * The distinction that matters is not "browser versus desktop" — a local
 * `npm run dev` session is a browser session with none of these limits. It is
 * the page's origin: a secure (HTTPS) page is refused an insecure `ws://`
 * connection by browser mixed-content rules, which is exactly the shape of
 * TouchDesigner's signaling endpoint. Keeping that as a pure function of the
 * page protocol and the entered URL means a future secure local endpoint
 * (`wss://`) is not pre-emptively blocked.
 */

/** True when the page itself was served over HTTPS. */
export function isSecurePageOrigin(pageProtocol: string): boolean {
  return pageProtocol.toLowerCase() === 'https:';
}

/** True for a plaintext `ws://` endpoint, which HTTPS pages may not open. */
export function isInsecureWebSocketUrl(url: string): boolean {
  const trimmed = url.trim();
  try {
    return new URL(trimmed).protocol.toLowerCase() === 'ws:';
  } catch {
    // An unparsable value still fails at connect time; only claim the
    // mixed-content reason when the scheme is unambiguously plaintext.
    return trimmed.toLowerCase().startsWith('ws://');
  }
}

export interface LiveOutputEnvironment {
  /** The Tauri desktop shell, which is not subject to page mixed-content rules. */
  native: boolean;
  /** `window.location.protocol`. */
  pageProtocol: string;
  /** The signaling URL the user is about to connect to. */
  signalingUrl: string;
}

/**
 * The reason Live Output cannot connect from this session, or null when the
 * browser will at least permit the attempt. Hosted Live Output stays out of
 * scope until the secure-local-endpoint work in
 * `docs/github-pages-deployment.md` Phase 5 is done.
 */
export function liveOutputBlockedReason(env: LiveOutputEnvironment): string | null {
  if (env.native) return null;
  if (!isSecurePageOrigin(env.pageProtocol)) return null;
  if (!isInsecureWebSocketUrl(env.signalingUrl)) return null;
  return 'This page is served over HTTPS, so the browser blocks an insecure ws:// connection to TouchDesigner. Live Output is a desktop-app feature until a secure local signaling endpoint ships.';
}
