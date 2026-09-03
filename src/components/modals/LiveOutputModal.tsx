import { Loader2, Radio, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { isNative } from '../../lib/native';
import { liveOutputBlockedReason } from '../../lib/hostEnvironment';
import { LiveOutputApi } from '../../hooks/useLiveOutput';

export default function LiveOutputModal({ api }: { api: LiveOutputApi }) {
  const {
    setShowLiveOutputModal,
    liveOutputState,
    liveOutputUrl, setLiveOutputUrl,
    liveOutputFps, setLiveOutputFps,
    selectedReceiverAddress, setSelectedReceiverAddress,
    liveOutputActionError,
    connectLiveOutput,
    startLiveOutput,
    stopLiveOutput,
    disconnectLiveOutput,
    liveOutputConnected,
    liveOutputBusy,
    liveOutputStreaming,
    liveOutputMetrics,
    liveOutputDownscaled
  } = api;

  // Recomputed per render because the user can edit the signaling URL: a
  // secure endpoint is permitted from a hosted page, a plaintext one is not.
  const blockedReason = liveOutputBlockedReason({
    native: isNative(),
    pageProtocol: window.location.protocol,
    signalingUrl: liveOutputUrl
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-ui-panel border border-ui-border rounded-2xl w-full max-w-md p-6 text-ui-text shadow-2xl relative">
        <button
          onClick={() => setShowLiveOutputModal(false)}
          className="absolute top-4 right-4 text-ui-text-muted hover:text-ui-text p-1 rounded-lg hover:bg-ui-surface transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
          aria-label="Close live output settings"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 mb-1">
          <Radio className={cn(
            "w-5 h-5",
            liveOutputStreaming ? "text-ui-accent" : "text-ui-text-muted"
          )} />
          <h3 className="text-lg font-bold text-ui-text">TouchDesigner Live Output</h3>
        </div>
        <p className="text-xs text-ui-text-muted mb-5">
          Stream the live 1080×1920 canvas over WebRTC using TouchDesigner&apos;s signaling server.
        </p>

        {blockedReason && (
          <div className="rounded-lg bg-amber-950/30 border border-amber-900 px-3 py-2 mb-4 text-[11px] leading-relaxed text-amber-200">
            {blockedReason}{' '}
            Run the desktop app, or a local build over <span className="font-mono">http://</span>,
            to stream into TouchDesigner.
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-ui-text-muted uppercase tracking-wider block mb-1">
              Signaling Server
            </label>
            <input
              type="text"
              value={liveOutputUrl}
              onChange={(event) => setLiveOutputUrl(event.target.value)}
              disabled={liveOutputConnected}
              spellCheck={false}
              className="w-full bg-ui-canvas border border-ui-border-strong rounded-lg px-3 py-2 text-xs font-mono text-ui-text disabled:text-ui-text-subtle disabled:cursor-not-allowed outline-none focus:ring-2 focus:ring-ui-accent"
            />
            <p className="text-[10px] text-ui-text-subtle mt-1">
              TouchDesigner&apos;s signalingServer COMP defaults to port 9980.
            </p>
          </div>

          <div className={cn(
            "rounded-lg border px-3 py-2 text-xs",
            liveOutputState.phase === 'error' || liveOutputActionError
              ? "bg-red-950/40 border-red-900 text-red-300"
              : liveOutputStreaming
                ? "bg-ui-accent/10 border-ui-accent/50 text-ui-accent-hover"
                : "bg-ui-canvas border-ui-border text-ui-text-muted"
          )}>
            <div className="flex items-center gap-2">
              <span className={cn(
                "w-2 h-2 rounded-full shrink-0",
                liveOutputState.phase === 'error' || liveOutputActionError
                  ? "bg-red-500"
                  : liveOutputStreaming
                    ? "bg-ui-accent animate-pulse"
                    : liveOutputConnected ? "bg-amber-500" : "bg-ui-border-strong"
              )} />
              <span>{liveOutputActionError ?? liveOutputState.message}</span>
            </div>
          </div>

          {liveOutputConnected && (
            <>
              <div>
                <label className="text-xs font-semibold text-ui-text-muted uppercase tracking-wider block mb-1">
                  Receiver
                </label>
                <select
                  value={selectedReceiverAddress}
                  onChange={(event) => setSelectedReceiverAddress(event.target.value)}
                  disabled={liveOutputState.receivers.length === 0 || liveOutputBusy || liveOutputStreaming}
                  className="w-full bg-ui-canvas border border-ui-border-strong rounded-lg px-3 py-2 text-xs text-ui-text disabled:text-ui-text-subtle outline-none focus:ring-2 focus:ring-ui-accent"
                >
                  {liveOutputState.receivers.length === 0 && (
                    <option value="">No receivers discovered</option>
                  )}
                  {liveOutputState.receivers.map((receiver) => (
                    <option key={receiver.id} value={receiver.address}>
                      {typeof receiver.properties.name === 'string'
                        ? `${receiver.properties.name} — ${receiver.address}`
                        : receiver.address}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-ui-text-muted uppercase tracking-wider block mb-1">
                  Frame Rate
                </label>
                <select
                  value={liveOutputFps}
                  onChange={(event) => setLiveOutputFps(parseInt(event.target.value))}
                  disabled={liveOutputBusy || liveOutputStreaming}
                  className="w-full bg-ui-canvas border border-ui-border-strong rounded-lg px-3 py-2 text-xs text-ui-text disabled:text-ui-text-subtle outline-none focus:ring-2 focus:ring-ui-accent"
                >
                  <option value={30}>30 FPS — recommended</option>
                  <option value={60}>60 FPS</option>
                </select>
              </div>
            </>
          )}

          {liveOutputStreaming && liveOutputMetrics && (
            <div className="rounded-lg bg-ui-canvas border border-ui-border px-3 py-3">
              <div className="text-[10px] font-semibold text-ui-text-muted uppercase tracking-wider mb-2">
                Outbound Encoder
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div>
                  <div className="text-[10px] text-ui-text-subtle">Source</div>
                  <div className="font-mono text-ui-text">
                    {liveOutputMetrics.sourceWidth}×{liveOutputMetrics.sourceHeight}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-ui-text-subtle">Encoded</div>
                  <div className={cn(
                    "font-mono",
                    liveOutputDownscaled ? "text-amber-300" : "text-ui-accent-hover"
                  )}>
                    {liveOutputMetrics.encodedWidth !== undefined
                      && liveOutputMetrics.encodedHeight !== undefined
                      ? `${liveOutputMetrics.encodedWidth}×${liveOutputMetrics.encodedHeight}`
                      : 'Measuring…'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-ui-text-subtle">Encoded FPS</div>
                  <div className="font-mono text-ui-text">
                    {liveOutputMetrics.framesPerSecond === undefined
                      ? 'Measuring…'
                      : liveOutputMetrics.framesPerSecond.toFixed(1)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-ui-text-subtle">Send Rate</div>
                  <div className="font-mono text-ui-text">
                    {liveOutputMetrics.bitrateMbps === undefined
                      ? 'Measuring…'
                      : `${liveOutputMetrics.bitrateMbps.toFixed(1)} Mbps`}
                  </div>
                </div>
              </div>
              {liveOutputMetrics.qualityLimitationReason
                && liveOutputMetrics.qualityLimitationReason !== 'none' && (
                <div className="mt-2 pt-2 border-t border-ui-border text-[10px] text-amber-300">
                  WebRTC reports a {liveOutputMetrics.qualityLimitationReason} quality limit.
                </div>
              )}
            </div>
          )}

          {liveOutputState.qualityWarning && (
            <div className="rounded-lg bg-amber-950/30 border border-amber-900 px-3 py-2 text-[10px] leading-relaxed text-amber-200">
              {liveOutputState.qualityWarning}
            </div>
          )}

          <div className="rounded-lg bg-ui-surface border border-ui-border px-3 py-2 text-[10px] leading-relaxed text-ui-text-muted">
            In TouchDesigner, connect signalingClient and webRTC COMPs to the active signalingServer,
            then use a Video Stream In TOP in WebRTC mode followed by a Null TOP.
          </div>

          <div className="pt-3 border-t border-ui-border flex items-center justify-between gap-2">
            {liveOutputConnected ? (
              <button
                onClick={disconnectLiveOutput}
                className="px-3 py-2 text-ui-text-muted hover:text-ui-text hover:bg-ui-surface rounded-lg text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
              >
                Disconnect
              </button>
            ) : (
              <span />
            )}

            {liveOutputStreaming || liveOutputState.phase === 'negotiating' ? (
              <button
                onClick={stopLiveOutput}
                className="px-5 py-2 bg-red-700 hover:bg-red-600 text-white font-semibold rounded-lg text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ui-panel"
              >
                Stop Stream
              </button>
            ) : liveOutputConnected ? (
              <button
                onClick={() => void startLiveOutput()}
                disabled={!selectedReceiverAddress || liveOutputBusy}
                className="flex items-center gap-2 px-5 py-2 bg-ui-accent hover:bg-ui-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-ui-accent-contrast font-semibold rounded-lg text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ui-panel"
              >
                {liveOutputBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Start Stream
              </button>
            ) : (
              <button
                onClick={() => void connectLiveOutput()}
                disabled={liveOutputBusy || blockedReason !== null}
                title={blockedReason ?? undefined}
                className="flex items-center gap-2 px-5 py-2 bg-ui-accent hover:bg-ui-accent-hover disabled:opacity-50 text-ui-accent-contrast font-semibold rounded-lg text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ui-panel"
              >
                {liveOutputBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Find Receivers
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
