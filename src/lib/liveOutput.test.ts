import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LIVE_OUTPUT_BITRATE_30_FPS,
  LIVE_OUTPUT_BITRATE_60_FPS,
  LiveOutputState,
  TOUCHDESIGNER_SIGNALING_API_VERSION,
  TouchDesignerWebRtcOutput,
  createSignalingMessage,
  getLiveOutputMaxBitrate,
  normalizeSignalingUrl,
  parseSignalingMessage
} from './liveOutput';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('live output quality profiles', () => {
  it('allows more encoder bandwidth at 60 fps', () => {
    expect(getLiveOutputMaxBitrate(30)).toBe(LIVE_OUTPUT_BITRATE_30_FPS);
    expect(getLiveOutputMaxBitrate(60)).toBe(LIVE_OUTPUT_BITRATE_60_FPS);
  });
});

describe('normalizeSignalingUrl', () => {
  it('adds the websocket protocol and removes a trailing slash', () => {
    expect(normalizeSignalingUrl('127.0.0.1:9980')).toBe('ws://127.0.0.1:9980');
  });

  it('maps HTTP protocols to their websocket equivalents', () => {
    expect(normalizeSignalingUrl('http://localhost:9980')).toBe('ws://localhost:9980');
    expect(normalizeSignalingUrl('https://example.com/live')).toBe('wss://example.com/live');
  });

  it('rejects unsupported protocols', () => {
    expect(() => normalizeSignalingUrl('ftp://localhost:9980')).toThrow(/ws:\/\//);
  });
});

describe('TouchDesigner signaling messages', () => {
  it('creates an Offer matching the Signaling API envelope', () => {
    expect(createSignalingMessage('Offer', '127.0.0.1:5000', '127.0.0.1:6000', { sdp: 'v=0' }))
      .toEqual({
        metadata: {
          apiVersion: TOUCHDESIGNER_SIGNALING_API_VERSION,
          compVersion: '0.1.0',
          compOrigin: 'slapchop://live-output',
          projectName: 'Slapchop'
        },
        signalingType: 'Offer',
        sender: '127.0.0.1:5000',
        target: '127.0.0.1:6000',
        content: { sdp: 'v=0' }
      });
  });

  it('accepts signaling envelopes and rejects malformed input', () => {
    expect(parseSignalingMessage('{"signalingType":"Clients","content":{"clients":[]}}'))
      .toMatchObject({ signalingType: 'Clients' });
    expect(parseSignalingMessage('not json')).toBeNull();
    expect(parseSignalingMessage('{"content":{}}')).toBeNull();
  });
});

describe('TouchDesignerWebRtcOutput', () => {
  it('discovers a receiver and sends the canvas offer through TouchDesigner signaling', async () => {
    vi.useFakeTimers();
    const sockets: FakeWebSocket[] = [];
    const peers: FakePeerConnection[] = [];

    class TestWebSocket extends FakeWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    }
    class TestPeerConnection extends FakePeerConnection {
      constructor() {
        super();
        peers.push(this);
      }
    }

    vi.stubGlobal('WebSocket', TestWebSocket);
    vi.stubGlobal('RTCPeerConnection', TestPeerConnection);

    const states: LiveOutputState[] = [];
    const output = new TouchDesignerWebRtcOutput((state) => states.push(state));
    const connectPromise = output.connect('ws://127.0.0.1:9980');
    sockets[0].open();
    await connectPromise;

    sockets[0].receive({
      signalingType: 'ClientEntered',
      content: { self: { id: 'slapchop', address: '127.0.0.1:5000', properties: {} } }
    });
    sockets[0].receive({
      signalingType: 'Clients',
      content: {
        clients: [{ id: 'touchdesigner', address: '127.0.0.1:6000', properties: { name: 'TD' } }]
      }
    });
    await Promise.resolve();
    expect(states.at(-1)).toMatchObject({ phase: 'ready' });

    const track = { contentHint: '', stop: vi.fn() };
    const stream = {
      getVideoTracks: () => [track],
      getTracks: () => [track]
    } as unknown as MediaStream;
    const canvas = {
      width: 1080,
      height: 1920,
      captureStream: vi.fn(() => stream)
    } as unknown as HTMLCanvasElement;

    await output.startStreaming(canvas, '127.0.0.1:6000', 30);

    expect(canvas.captureStream).toHaveBeenCalledWith(30);
    expect(peers).toHaveLength(1);
    expect(peers[0].sender.setParameters).toHaveBeenCalledWith(expect.objectContaining({
      degradationPreference: 'maintain-resolution',
      encodings: [expect.objectContaining({
        scaleResolutionDownBy: 1,
        maxFramerate: 30,
        maxBitrate: LIVE_OUTPUT_BITRATE_30_FPS
      })]
    }));
    const offer = JSON.parse(sockets[0].sent.at(-1)!);
    expect(offer).toMatchObject({
      signalingType: 'Offer',
      sender: '127.0.0.1:5000',
      target: '127.0.0.1:6000',
      content: { sdp: 'offer-sdp' }
    });

    sockets[0].receive({
      signalingType: 'Answer',
      sender: '127.0.0.1:6000',
      content: { sdp: 'answer-sdp' }
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(peers[0].remoteDescription).toEqual({ type: 'answer', sdp: 'answer-sdp' });

    peers[0].connectionState = 'connected';
    peers[0].onconnectionstatechange?.(new Event('connectionstatechange'));
    await Promise.resolve();
    await Promise.resolve();
    expect(states.at(-1)).toMatchObject({
      phase: 'streaming',
      metrics: {
        sourceWidth: 1080,
        sourceHeight: 1920,
        encodedWidth: 1080,
        encodedHeight: 1920,
        framesPerSecond: 30,
        qualityLimitationReason: 'none'
      }
    });

    peers[0].sender.stats = createOutboundStats(2_000, 1_501_000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(states.at(-1)?.metrics?.bitrateMbps).toBeCloseTo(12);

    peers[0].connectionState = 'failed';
    peers[0].onconnectionstatechange?.(new Event('connectionstatechange'));
    expect(track.stop).toHaveBeenCalledOnce();
    expect(states.at(-1)).toMatchObject({
      phase: 'ready',
      connectedReceiver: undefined,
      error: expect.stringContaining('WebRTC connection failed')
    });
    expect(vi.getTimerCount()).toBe(0);

    output.disconnect();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(states.at(-1)).toMatchObject({ phase: 'idle' });
  });
});

class FakeWebSocket {
  static readonly OPEN = 1;
  readonly url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  receive(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>);
  }

  send(message: string) {
    this.sent.push(message);
  }

  close() {
    this.readyState = 3;
  }
}

class FakePeerConnection {
  connectionState: RTCPeerConnectionState = 'new';
  localDescription: RTCSessionDescription | null = null;
  remoteDescription: RTCSessionDescription | null = null;
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  onconnectionstatechange: ((event: Event) => void) | null = null;
  sender = new FakeRtpSender();

  addTrack() {
    return this.sender as unknown as RTCRtpSender;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'offer-sdp' };
  }

  async setLocalDescription(description: RTCLocalSessionDescriptionInit) {
    this.localDescription = description as RTCSessionDescription;
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description as RTCSessionDescription;
  }

  async addIceCandidate() {}

  close() {
    this.connectionState = 'closed';
  }
}

class FakeRtpSender {
  parameters: RTCRtpSendParameters = {
    codecs: [],
    headerExtensions: [],
    rtcp: {},
    encodings: [{}],
    transactionId: 'test-transaction'
  };
  stats = createOutboundStats(1_000, 1_000);
  setParameters = vi.fn(async (parameters: RTCRtpSendParameters) => {
    this.parameters = parameters;
  });

  getParameters() {
    return this.parameters;
  }

  async getStats() {
    return new Map([['video', this.stats]]) as unknown as RTCStatsReport;
  }
}

function createOutboundStats(timestamp: number, bytesSent: number): RTCOutboundRtpStreamStats {
  return {
    id: 'video',
    type: 'outbound-rtp',
    timestamp,
    kind: 'video',
    ssrc: 1,
    bytesSent,
    packetsSent: 1,
    frameWidth: 1080,
    frameHeight: 1920,
    framesPerSecond: 30,
    qualityLimitationReason: 'none'
  };
}
