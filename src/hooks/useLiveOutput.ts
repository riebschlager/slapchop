import { RefObject, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_SIGNALING_URL,
  INITIAL_LIVE_OUTPUT_STATE,
  LiveOutputState,
  TouchDesignerWebRtcOutput
} from '../lib/liveOutput';

// Unlike export, streaming needs the live on-screen canvas — the caller must
// pass the same ref the Stage attaches to its <canvas>, so this hook can be
// driven from the Inspector column while the pixels stay owned by the Stage.
export function useLiveOutput(canvasRef: RefObject<HTMLCanvasElement | null>) {
  // Connection state, not document state, so it intentionally stays outside
  // Zustand history and is torn down with whatever mounts this hook.
  const liveOutputRef = useRef<TouchDesignerWebRtcOutput | null>(null);
  const [showLiveOutputModal, setShowLiveOutputModal] = useState(false);
  const [liveOutputState, setLiveOutputState] = useState<LiveOutputState>(INITIAL_LIVE_OUTPUT_STATE);
  const [liveOutputUrl, setLiveOutputUrl] = useState(DEFAULT_SIGNALING_URL);
  const [liveOutputFps, setLiveOutputFps] = useState(30);
  const [selectedReceiverAddress, setSelectedReceiverAddress] = useState('');
  const [liveOutputActionError, setLiveOutputActionError] = useState<string | null>(null);

  useEffect(() => {
    const output = new TouchDesignerWebRtcOutput((nextState) => {
      setLiveOutputState(nextState);
      setSelectedReceiverAddress((current) => {
        if (nextState.receivers.some((receiver) => receiver.address === current)) return current;
        return nextState.receivers[0]?.address ?? '';
      });
    });
    liveOutputRef.current = output;
    return () => {
      output.destroy();
      liveOutputRef.current = null;
    };
  }, []);

  const connectLiveOutput = async () => {
    setLiveOutputActionError(null);
    try {
      await liveOutputRef.current?.connect(liveOutputUrl);
    } catch (error) {
      setLiveOutputActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const startLiveOutput = async () => {
    const canvas = canvasRef.current;
    const output = liveOutputRef.current;
    if (!canvas || !output) return;
    setLiveOutputActionError(null);
    try {
      await output.startStreaming(canvas, selectedReceiverAddress, liveOutputFps);
    } catch (error) {
      output.stopStreaming();
      setLiveOutputActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const stopLiveOutput = () => {
    liveOutputRef.current?.stopStreaming();
    setLiveOutputActionError(null);
  };

  const disconnectLiveOutput = () => {
    liveOutputRef.current?.disconnect();
    setLiveOutputActionError(null);
  };

  const liveOutputConnected = !['idle', 'error'].includes(liveOutputState.phase);
  const liveOutputBusy = ['connecting', 'negotiating'].includes(liveOutputState.phase);
  const liveOutputStreaming = liveOutputState.phase === 'streaming';
  const liveOutputMetrics = liveOutputState.metrics;
  const liveOutputDownscaled = liveOutputMetrics?.encodedWidth !== undefined
    && liveOutputMetrics.encodedHeight !== undefined
    && (liveOutputMetrics.encodedWidth < liveOutputMetrics.sourceWidth
      || liveOutputMetrics.encodedHeight < liveOutputMetrics.sourceHeight);

  return {
    showLiveOutputModal,
    setShowLiveOutputModal,
    liveOutputState,
    liveOutputUrl,
    setLiveOutputUrl,
    liveOutputFps,
    setLiveOutputFps,
    selectedReceiverAddress,
    setSelectedReceiverAddress,
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
  };
}

export type LiveOutputApi = ReturnType<typeof useLiveOutput>;
