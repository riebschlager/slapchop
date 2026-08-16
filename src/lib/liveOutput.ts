export const DEFAULT_SIGNALING_URL = 'ws://127.0.0.1:9980';
export const TOUCHDESIGNER_SIGNALING_API_VERSION = '1.0.1';
export const LIVE_OUTPUT_BITRATE_30_FPS = 12_000_000;
export const LIVE_OUTPUT_BITRATE_60_FPS = 24_000_000;

export type LiveOutputPhase =
  | 'idle'
  | 'connecting'
  | 'discovering'
  | 'ready'
  | 'negotiating'
  | 'streaming'
  | 'error';

export interface SignalingClient {
  id: string;
  address: string;
  properties: Record<string, unknown>;
}

export interface LiveOutputMetrics {
  sourceWidth: number;
  sourceHeight: number;
  encodedWidth?: number;
  encodedHeight?: number;
  framesPerSecond?: number;
  bitrateMbps?: number;
  qualityLimitationReason?: RTCQualityLimitationReason;
}

export interface LiveOutputState {
  phase: LiveOutputPhase;
  receivers: SignalingClient[];
  connectedReceiver?: string;
  message: string;
  error?: string;
  qualityWarning?: string;
  metrics?: LiveOutputMetrics;
}

export const INITIAL_LIVE_OUTPUT_STATE: LiveOutputState = {
  phase: 'idle',
  receivers: [],
  message: 'Live output is off.'
};

type SignalingType = 'Offer' | 'Answer' | 'Ice';

interface SignalingMessage {
  metadata?: Record<string, unknown>;
  signalingType: string;
  sender?: string;
  target?: string;
  content?: Record<string, unknown>;
}

interface SignalMetadata {
  apiVersion: string;
  compVersion: string;
  compOrigin: string;
  projectName: string;
}

const SIGNAL_METADATA: SignalMetadata = {
  apiVersion: TOUCHDESIGNER_SIGNALING_API_VERSION,
  compVersion: '0.1.0',
  compOrigin: 'slapchop://live-output',
  projectName: 'Slapchop'
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSignalingClient(value: unknown): value is SignalingClient {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.address === 'string';
}

export function normalizeSignalingUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Enter a TouchDesigner signaling server address.');

  const withProtocol = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `ws://${trimmed}`;
  const url = new URL(withProtocol);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error('The signaling server address must use ws:// or wss://.');
  }
  return url.toString().replace(/\/$/, '');
}

export function createSignalingMessage(
  signalingType: SignalingType,
  sender: string,
  target: string,
  content: Record<string, unknown>
) {
  return {
    metadata: { ...SIGNAL_METADATA },
    signalingType,
    sender,
    target,
    content
  };
}

export function parseSignalingMessage(raw: string): SignalingMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.signalingType !== 'string') return null;
  return parsed as unknown as SignalingMessage;
}

function receiverLabel(client: SignalingClient): string {
  const customName = client.properties.name;
  return typeof customName === 'string' && customName.trim()
    ? customName
    : client.address;
}

export function getLiveOutputMaxBitrate(fps: number): number {
  return fps >= 60 ? LIVE_OUTPUT_BITRATE_60_FPS : LIVE_OUTPUT_BITRATE_30_FPS;
}

interface OutboundStatsSample {
  timestamp: number;
  bytesSent: number;
}

export class TouchDesignerWebRtcOutput {
  private state: LiveOutputState = { ...INITIAL_LIVE_OUTPUT_STATE };
  private socket: WebSocket | null = null;
  private localClient: SignalingClient | null = null;
  private peer: RTCPeerConnection | null = null;
  private sender: RTCRtpSender | null = null;
  private stream: MediaStream | null = null;
  private receiverAddress: string | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private manualSocketClose = false;
  private destroyed = false;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private previousStatsSample: OutboundStatsSample | null = null;
  private sourceWidth = 0;
  private sourceHeight = 0;
  private qualityWarning: string | undefined;

  constructor(private readonly onStateChange: (state: LiveOutputState) => void) {}

  async connect(signalingUrl: string): Promise<void> {
    const url = normalizeSignalingUrl(signalingUrl);
    this.closeSocket(false);
    this.destroyed = false;
    this.manualSocketClose = false;
    this.localClient = null;
    this.updateState({
      phase: 'connecting',
      receivers: [],
      connectedReceiver: undefined,
      message: 'Connecting to the TouchDesigner signaling server…',
      error: undefined,
      qualityWarning: undefined,
      metrics: undefined
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch (error) {
        const message = `Could not open the TouchDesigner signaling connection: ${errorMessage(error)}`;
        this.fail(message);
        reject(new Error(message));
        return;
      }
      this.socket = socket;

      socket.onopen = () => {
        if (socket !== this.socket) return;
        settled = true;
        this.updateState({
          phase: 'discovering',
          message: 'Connected. Waiting for TouchDesigner receivers…',
          error: undefined
        });
        resolve();
      };

      socket.onmessage = (event) => {
        if (socket !== this.socket || typeof event.data !== 'string') return;
        void this.handleMessage(event.data).catch((error) => {
          const message = `Could not process a signaling message: ${errorMessage(error)}`;
          if (this.peer) this.failPeer(message);
          else this.fail(message);
        });
      };

      socket.onerror = () => {
        const message = `Could not connect to the TouchDesigner signaling server at ${url}.`;
        if (!settled) {
          settled = true;
          this.fail(message);
          reject(new Error(message));
        }
      };

      socket.onclose = () => {
        if (socket !== this.socket) return;
        this.socket = null;
        this.stopPeer();
        if (!this.manualSocketClose && !this.destroyed) {
          this.updateState({
            phase: 'error',
            receivers: [],
            connectedReceiver: undefined,
            message: 'The TouchDesigner signaling server disconnected.',
            error: 'Reconnect after confirming that signalingServer is active.'
          });
        }
      };
    });
  }

  async startStreaming(
    canvas: HTMLCanvasElement,
    receiverAddress: string,
    fps: number
  ): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Connect to the TouchDesigner signaling server first.');
    }
    if (!this.localClient) {
      throw new Error('TouchDesigner has not acknowledged this signaling client yet.');
    }
    const receiver = this.state.receivers.find((client) => client.address === receiverAddress);
    if (!receiver) throw new Error('The selected TouchDesigner receiver is no longer available.');
    if (!Number.isFinite(fps) || fps <= 0) throw new Error('Frame rate must be greater than zero.');

    this.stopPeer();
    this.receiverAddress = receiverAddress;
    this.updateState({
      phase: 'negotiating',
      connectedReceiver: receiverAddress,
      message: `Negotiating with ${receiverLabel(receiver)}…`,
      error: undefined,
      qualityWarning: undefined,
      metrics: {
        sourceWidth: canvas.width,
        sourceHeight: canvas.height
      }
    });

    let stream: MediaStream;
    try {
      stream = canvas.captureStream(fps);
    } catch (error) {
      this.receiverAddress = null;
      throw new Error(`Could not capture the live canvas: ${errorMessage(error)}`);
    }

    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
      this.receiverAddress = null;
      throw new Error('The browser did not create a video track for the live canvas.');
    }
    track.contentHint = 'detail';

    const peer = new RTCPeerConnection({ iceServers: [] });
    this.stream = stream;
    this.peer = peer;
    this.sourceWidth = canvas.width;
    this.sourceHeight = canvas.height;
    const sender = peer.addTrack(track, stream);
    this.sender = sender;

    this.qualityWarning = await this.configureSender(sender, fps);
    if (this.peer !== peer) return;

    peer.onicecandidate = (event) => {
      if (this.peer !== peer || !event.candidate || !this.receiverAddress || !this.localClient) return;
      const { candidate, sdpMLineIndex, sdpMid } = event.candidate;
      if (sdpMLineIndex === null || sdpMid === null) return;
      this.sendSignal('Ice', this.receiverAddress, {
        sdpCandidate: candidate,
        sdpMLineIndex,
        sdpMid
      });
    };

    peer.onconnectionstatechange = () => {
      if (this.peer !== peer) return;
      if (peer.connectionState === 'connected') {
        this.updateState({
          phase: 'streaming',
          message: `Streaming from ${canvas.width}×${canvas.height} at up to ${fps} fps.`,
          error: undefined,
          qualityWarning: this.qualityWarning
        });
        this.startStatsPolling(sender);
      } else if (peer.connectionState === 'failed') {
        this.failPeer('The WebRTC connection failed. Select a receiver and try again.');
      } else if (peer.connectionState === 'disconnected') {
        this.updateState({
          phase: 'negotiating',
          message: 'The receiver disconnected; waiting for WebRTC to recover…'
        });
      }
    };

    try {
      const offer = await peer.createOffer();
      if (this.peer !== peer) return;
      await peer.setLocalDescription(offer);
      if (this.peer !== peer || !peer.localDescription?.sdp) return;
      this.sendSignal('Offer', receiverAddress, { sdp: peer.localDescription.sdp });
    } catch (error) {
      if (this.peer === peer) this.stopPeer();
      throw new Error(`Could not start the WebRTC offer: ${errorMessage(error)}`);
    }
  }

  stopStreaming() {
    this.stopPeer();
    this.updateState({
      phase: this.state.receivers.length > 0 ? 'ready' : 'discovering',
      connectedReceiver: undefined,
      message: this.state.receivers.length > 0
        ? 'Receiver ready. Select it to start streaming.'
        : 'Waiting for TouchDesigner receivers…',
      error: undefined,
      qualityWarning: undefined,
      metrics: undefined
    });
  }

  disconnect() {
    this.closeSocket(true);
    this.updateState({ ...INITIAL_LIVE_OUTPUT_STATE });
  }

  destroy() {
    this.destroyed = true;
    this.closeSocket(false);
  }

  private async handleMessage(raw: string) {
    const message = parseSignalingMessage(raw);
    if (!message) {
      console.warn('Ignoring an invalid TouchDesigner signaling message.');
      return;
    }

    if (message.signalingType === 'ClientEntered') {
      const self = message.content?.self;
      if (isSignalingClient(self)) {
        this.localClient = {
          ...self,
          properties: isRecord(self.properties) ? self.properties : {}
        };
        this.setReceivers(this.state.receivers);
      }
      return;
    }

    if (message.signalingType === 'Clients') {
      const clients = message.content?.clients;
      if (Array.isArray(clients)) {
        this.setReceivers(clients.filter(isSignalingClient));
      }
      return;
    }

    if (message.signalingType === 'ClientEnter') {
      const client = message.content?.client;
      if (isSignalingClient(client)) {
        this.setReceivers([...this.state.receivers, client]);
      }
      return;
    }

    if (message.signalingType === 'ClientExit') {
      const client = message.content?.client;
      if (isSignalingClient(client)) {
        const wasStreaming = client.address === this.receiverAddress;
        if (wasStreaming) this.stopPeer();
        this.setReceivers(this.state.receivers.filter((item) => item.id !== client.id));
      }
      return;
    }

    if (!message.sender || message.sender !== this.receiverAddress || !this.peer) return;

    if (message.signalingType === 'Answer') {
      const sdp = message.content?.sdp;
      if (typeof sdp !== 'string') return;
      await this.peer.setRemoteDescription({ type: 'answer', sdp });
      await this.flushPendingCandidates();
      return;
    }

    if (message.signalingType === 'Ice') {
      const candidate = message.content?.sdpCandidate;
      const sdpMLineIndex = message.content?.sdpMLineIndex;
      const sdpMid = message.content?.sdpMid;
      if (typeof candidate !== 'string' || typeof sdpMLineIndex !== 'number' || typeof sdpMid !== 'string') {
        return;
      }
      const init = { candidate, sdpMLineIndex, sdpMid };
      if (this.peer.remoteDescription) await this.peer.addIceCandidate(init);
      else this.pendingCandidates.push(init);
    }
  }

  private async flushPendingCandidates() {
    const peer = this.peer;
    if (!peer) return;
    const candidates = this.pendingCandidates.splice(0);
    for (const candidate of candidates) {
      await peer.addIceCandidate(candidate);
    }
  }

  private setReceivers(receivers: SignalingClient[]) {
    const unique = new Map<string, SignalingClient>();
    for (const receiver of receivers) {
      unique.set(receiver.id, {
        ...receiver,
        properties: isRecord(receiver.properties) ? receiver.properties : {}
      });
    }
    const next = [...unique.values()];
    const signalingReady = this.localClient !== null;
    const activeReceiverExists = this.receiverAddress
      ? next.some((receiver) => receiver.address === this.receiverAddress)
      : false;

    this.updateState({
      receivers: next,
      phase: this.peer && activeReceiverExists
        ? this.state.phase
        : signalingReady && next.length > 0 ? 'ready' : 'discovering',
      connectedReceiver: activeReceiverExists ? this.receiverAddress ?? undefined : undefined,
      message: this.peer && activeReceiverExists
        ? this.state.message
        : signalingReady && next.length > 0
          ? `${next.length} TouchDesigner receiver${next.length === 1 ? '' : 's'} available.`
          : 'Connected. Waiting for TouchDesigner receivers…',
      qualityWarning: this.peer && activeReceiverExists ? this.state.qualityWarning : undefined,
      metrics: this.peer && activeReceiverExists ? this.state.metrics : undefined
    });
  }

  private async configureSender(sender: RTCRtpSender, fps: number): Promise<string | undefined> {
    const configureEncoding = (parameters: RTCRtpSendParameters) => {
      const encoding = parameters.encodings[0];
      if (!encoding) {
        throw new Error('the browser did not expose a configurable video encoding');
      }
      encoding.scaleResolutionDownBy = 1;
      encoding.maxFramerate = fps;
      encoding.maxBitrate = getLiveOutputMaxBitrate(fps);
    };

    try {
      const parameters = sender.getParameters();
      configureEncoding(parameters);
      parameters.degradationPreference = 'maintain-resolution';
      await sender.setParameters(parameters);
      return undefined;
    } catch (preferredError) {
      try {
        const fallbackParameters = sender.getParameters();
        configureEncoding(fallbackParameters);
        delete fallbackParameters.degradationPreference;
        await sender.setParameters(fallbackParameters);
        const warning = 'This browser rejected resolution-priority mode; native scale and bitrate controls are active, but adaptive downscaling may still occur.';
        console.warn(warning, preferredError);
        return warning;
      } catch (fallbackError) {
        const warning = `Native-resolution encoder controls were unavailable: ${errorMessage(fallbackError)}.`;
        console.warn(warning, preferredError);
        return warning;
      }
    }
  }

  private startStatsPolling(sender: RTCRtpSender) {
    this.stopStatsPolling();
    const poll = () => {
      void this.refreshStats(sender).catch((error) => {
        if (this.sender !== sender) return;
        this.stopStatsPolling();
        const warning = `Could not read outbound encoder statistics: ${errorMessage(error)}.`;
        console.warn(warning);
        this.qualityWarning = this.qualityWarning
          ? `${this.qualityWarning} ${warning}`
          : warning;
        this.updateState({ qualityWarning: this.qualityWarning });
      });
    };
    poll();
    this.statsTimer = setInterval(poll, 1000);
  }

  private async refreshStats(sender: RTCRtpSender) {
    const report = await sender.getStats();
    if (this.sender !== sender || this.state.phase !== 'streaming') return;

    let outbound: RTCOutboundRtpStreamStats | undefined;
    report.forEach((stat) => {
      if (stat.type === 'outbound-rtp' && (stat as RTCRtpStreamStats).kind === 'video') {
        const candidate = stat as RTCOutboundRtpStreamStats;
        const candidateArea = (candidate.frameWidth ?? 0) * (candidate.frameHeight ?? 0);
        const currentArea = (outbound?.frameWidth ?? 0) * (outbound?.frameHeight ?? 0);
        if (!outbound || candidateArea > currentArea) outbound = candidate;
      }
    });
    if (!outbound) return;

    const timestamp = outbound.timestamp;
    const bytesSent = outbound.bytesSent;
    let bitrateMbps: number | undefined;
    if (this.previousStatsSample && timestamp > this.previousStatsSample.timestamp) {
      const elapsedSeconds = (timestamp - this.previousStatsSample.timestamp) / 1000;
      const bytesDelta = bytesSent - this.previousStatsSample.bytesSent;
      if (bytesDelta >= 0) bitrateMbps = (bytesDelta * 8) / elapsedSeconds / 1_000_000;
    }
    this.previousStatsSample = { timestamp, bytesSent };

    this.updateState({
      metrics: {
        sourceWidth: this.sourceWidth,
        sourceHeight: this.sourceHeight,
        encodedWidth: outbound.frameWidth,
        encodedHeight: outbound.frameHeight,
        framesPerSecond: outbound.framesPerSecond,
        bitrateMbps,
        qualityLimitationReason: outbound.qualityLimitationReason
      }
    });
  }

  private stopStatsPolling() {
    if (this.statsTimer !== null) clearInterval(this.statsTimer);
    this.statsTimer = null;
    this.previousStatsSample = null;
  }

  private sendSignal(
    signalingType: SignalingType,
    target: string,
    content: Record<string, unknown>
  ) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.localClient) {
      throw new Error('The TouchDesigner signaling connection is not ready.');
    }
    const message = createSignalingMessage(
      signalingType,
      this.localClient.address,
      target,
      content
    );
    this.socket.send(JSON.stringify(message));
  }

  private stopPeer() {
    this.stopStatsPolling();
    const peer = this.peer;
    this.peer = null;
    this.sender = null;
    if (peer) {
      peer.onicecandidate = null;
      peer.onconnectionstatechange = null;
      peer.close();
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.receiverAddress = null;
    this.pendingCandidates = [];
    this.sourceWidth = 0;
    this.sourceHeight = 0;
    this.qualityWarning = undefined;
  }

  private closeSocket(manual: boolean) {
    this.manualSocketClose = manual;
    this.stopPeer();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    }
    this.localClient = null;
  }

  private fail(message: string) {
    this.updateState({
      phase: 'error',
      message,
      error: message
    });
  }

  private failPeer(message: string) {
    this.stopPeer();
    this.updateState({
      phase: this.state.receivers.length > 0 ? 'ready' : 'discovering',
      connectedReceiver: undefined,
      message,
      error: message,
      qualityWarning: undefined,
      metrics: undefined
    });
  }

  private updateState(patch: Partial<LiveOutputState>) {
    if (this.destroyed) return;
    this.state = { ...this.state, ...patch };
    this.onStateChange({
      ...this.state,
      receivers: [...this.state.receivers]
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
