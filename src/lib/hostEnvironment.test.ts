import { describe, expect, it } from 'vitest';
import { isInsecureWebSocketUrl, isSecurePageOrigin, liveOutputBlockedReason } from './hostEnvironment';

describe('isSecurePageOrigin', () => {
  it('recognizes HTTPS pages only', () => {
    expect(isSecurePageOrigin('https:')).toBe(true);
    expect(isSecurePageOrigin('HTTPS:')).toBe(true);
    expect(isSecurePageOrigin('http:')).toBe(false);
    expect(isSecurePageOrigin('tauri:')).toBe(false);
    expect(isSecurePageOrigin('file:')).toBe(false);
  });
});

describe('isInsecureWebSocketUrl', () => {
  it('recognizes plaintext WebSocket endpoints', () => {
    expect(isInsecureWebSocketUrl('ws://127.0.0.1:9980')).toBe(true);
    expect(isInsecureWebSocketUrl('  WS://localhost:9980  ')).toBe(true);
  });

  it('leaves secure endpoints alone', () => {
    expect(isInsecureWebSocketUrl('wss://td.local:9980')).toBe(false);
  });

  it('does not claim a scheme for unparsable input', () => {
    expect(isInsecureWebSocketUrl('127.0.0.1:9980')).toBe(false);
    expect(isInsecureWebSocketUrl('')).toBe(false);
  });
});

describe('liveOutputBlockedReason', () => {
  const insecure = 'ws://127.0.0.1:9980';

  it('allows the desktop app regardless of the endpoint', () => {
    expect(liveOutputBlockedReason({ native: true, pageProtocol: 'https:', signalingUrl: insecure }))
      .toBeNull();
  });

  it('allows a local http dev session', () => {
    expect(liveOutputBlockedReason({ native: false, pageProtocol: 'http:', signalingUrl: insecure }))
      .toBeNull();
  });

  it('blocks an insecure endpoint from a hosted HTTPS page', () => {
    expect(liveOutputBlockedReason({ native: false, pageProtocol: 'https:', signalingUrl: insecure }))
      .toContain('blocks an insecure ws://');
  });

  it('does not block a secure endpoint from a hosted HTTPS page', () => {
    expect(liveOutputBlockedReason({
      native: false,
      pageProtocol: 'https:',
      signalingUrl: 'wss://td.local:9980'
    })).toBeNull();
  });
});
