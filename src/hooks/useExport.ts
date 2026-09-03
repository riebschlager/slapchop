import { useEffect, useRef, useState } from 'react';
import { getDocumentSnapshot, useStore } from '../store';
import { CANVAS_HEIGHT, CANVAS_WIDTH, RenderState } from '../renderer/render2d';
import {
  createRawFrameSource,
  getActiveRendererName,
  getPlaybackTime,
  renderExportFrame
} from '../renderer/loop';
import { suspendLivePreviewRendering } from '../renderer/livePreviewSuspension';
import { exportVideo } from '../lib/videoExport';
import { MediaRecorderVideoExportPlan, planVideoExport, VideoExportPlan } from '../lib/videoCapabilities';
import { exportZipSequence } from '../lib/zipExport';
import { exportGif } from '../lib/gifExport';
import { exportNativeImageSequence } from '../lib/imageSequenceExport';
import { ExportSpeed, exportNativeVideo } from '../lib/ffmpegExport';
import { getExportFailureMessage } from '../lib/exportErrors';
import { beginExportProfile } from '../lib/exportProfiler';
import { isNative, pickDirectoryPath, pickSavePath, saveBlob } from '../lib/native';

export type ExportType = 'mp4' | 'webm' | 'prores' | 'gif' | 'zip' | 'sequence';
export type ExportResolution = 'full' | 'hd' | 'compact';
export type ExportImageFormat = 'png' | 'jpeg';

export interface ExportJob {
  label: string;
  percent: number;
}

/** Output sizes, all portrait subdivisions of the 1080x1920 design space. */
export const EXPORT_RESOLUTIONS: Record<ExportResolution, readonly [number, number]> = {
  full: [1080, 1920],
  hd: [720, 1280],
  compact: [540, 960]
};

function getExportTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// Export/live-output orchestration, standalone from the Stage: every export
// path renders into its own offscreen canvas via renderExportFrame, so this
// hook needs no reference to the live on-screen canvas. This is what lets the
// Inspector column trigger and configure exports while the canvas itself
// stays owned by CanvasWorkspace.
interface UseExportOptions {
  liveOutputStreaming?: boolean;
}

export function useExport({ liveOutputStreaming = false }: UseExportOptions = {}) {
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportType, setExportType] = useState<ExportType>('mp4');
  const [exportResolution, setExportResolution] = useState<ExportResolution>('hd');
  const [exportFormat, setExportFormat] = useState<ExportImageFormat>('png');
  const [exportStartTime, setExportStartTime] = useState<number>(0);
  const [exportDuration, setExportDuration] = useState<number>(3);
  const [exportFps, setExportFps] = useState<number>(30);
  // Defaults to the settings that shipped before speeds existed, so an export
  // never quietly changes quality; faster profiles are opt-in.
  const [exportSpeed, setExportSpeed] = useState<ExportSpeed>('quality');
  const [resumeSequence, setResumeSequence] = useState(false);
  const [pausePreviewDuringExport, setPausePreviewDuringExport] = useState(true);
  const [exportJob, setExportJob] = useState<ExportJob | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  // Resolved ahead of the export so the modal can warn about a format or
  // timing fallback before the user commits to it.
  const [browserVideoPlan, setBrowserVideoPlan] = useState<VideoExportPlan | null>(null);
  const [browserVideoError, setBrowserVideoError] = useState<string | null>(null);

  const isCancelExportRef = useRef(false);
  const liveOutputStreamingRef = useRef(liveOutputStreaming);
  const resumePreviewRef = useRef<(() => void) | null>(null);
  liveOutputStreamingRef.current = liveOutputStreaming;

  useEffect(() => {
    if (!liveOutputStreaming) return;
    resumePreviewRef.current?.();
    resumePreviewRef.current = null;
  }, [liveOutputStreaming]);

  useEffect(() => () => {
    resumePreviewRef.current?.();
    resumePreviewRef.current = null;
  }, []);

  // Probe the browser video path whenever the request changes. Encoder support
  // is resolution- and frame-rate-dependent, so this cannot be cached per
  // format. Native video goes through ffmpeg and needs no probe.
  useEffect(() => {
    if (isNative() || (exportType !== 'mp4' && exportType !== 'webm')) {
      setBrowserVideoPlan(null);
      setBrowserVideoError(null);
      return;
    }
    let stale = false;
    const [width, height] = EXPORT_RESOLUTIONS[exportResolution];
    planVideoExport({ format: exportType, width, height, fps: exportFps }).then(
      (plan) => {
        if (stale) return;
        setBrowserVideoPlan(plan);
        setBrowserVideoError(null);
      },
      (e) => {
        if (stale) return;
        setBrowserVideoPlan(null);
        setBrowserVideoError(getExportFailureMessage(exportType, e));
      }
    );
    return () => { stale = true; };
  }, [exportType, exportResolution, exportFps]);

  const openExportModal = () => {
    setExportError(null);
    setExportNotice(null);
    setShowExportModal(true);
  };
  const cancelExport = () => {
    isCancelExportRef.current = true;
    setShowExportModal(false);
  };

  // Reads through getState() so it stays correct inside long-lived listeners.
  const snapshotRenderState = (): RenderState => ({
    appMode: useStore.getState().appMode,
    ...getDocumentSnapshot()
  });

  const handleExportHighRes = async () => {
    try {
      const canvas = document.createElement('canvas');
      renderExportFrame(canvas, getPlaybackTime(), snapshotRenderState(), CANVAS_WIDTH, CANVAS_HEIGHT);
      const blob = await (await fetch(canvas.toDataURL('image/png'))).blob();
      await saveBlob(blob, `slapchop-art-${getExportTimestamp()}.png`);
    } catch (e) {
      console.error('High-Res export failed', e);
    }
  };

  const finishExport = async (blob: Blob, filename: string) => {
    await saveBlob(blob, filename);
    setShowExportModal(false);
  };

  /**
   * Hands a finished blob to the save path without awaiting it, so the export
   * profiler's elapsed window still ends at the last encoded frame. Without
   * the handler a failed save would only ever surface as an unhandled
   * rejection.
   */
  const saveExportResult = (blob: Blob, filename: string) => {
    void finishExport(blob, filename)
      .catch((e) => setExportError(getExportFailureMessage(exportType, e)));
  };

  const runWithPreviewPaused = async <T,>(work: () => Promise<T>): Promise<T> => {
    if (!isNative() || !pausePreviewDuringExport || liveOutputStreamingRef.current) return work();

    const resumePreview = suspendLivePreviewRendering();
    resumePreviewRef.current = resumePreview;
    try {
      return await work();
    } finally {
      resumePreview();
      if (resumePreviewRef.current === resumePreview) resumePreviewRef.current = null;
    }
  };

  /**
   * Real-time canvas capture, used when no WebCodecs configuration matches the
   * request. Output is always WebM, so the plan — not the requested format —
   * decides the extension and mime type.
   */
  const recordVideoFallback = (
    plan: MediaRecorderVideoExportPlan,
    doc: RenderState,
    resW: number,
    resH: number,
    ts: string
  ) =>
    new Promise<void>((resolve, reject) => {
      const offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = resW;
      offscreenCanvas.height = resH;

      const stream = offscreenCanvas.captureStream(exportFps);
      const mediaRecorder = new MediaRecorder(stream, { mimeType: plan.recorderMimeType });
      let interval: ReturnType<typeof setInterval> | null = null;
      // captureStream keeps a live track bound to the canvas; without an
      // explicit stop it keeps sampling after the recorder is done.
      const releaseCapture = () => {
        if (interval !== null) clearInterval(interval);
        interval = null;
        stream.getTracks().forEach((track) => track.stop());
      };

      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onerror = (e) => {
        releaseCapture();
        reject((e as unknown as { error?: unknown }).error ?? new Error('Real-time recording failed'));
      };

      mediaRecorder.onstop = () => {
        releaseCapture();
        if (isCancelExportRef.current) {
          chunks.length = 0;
          resolve();
          return;
        }
        const blob = new Blob(chunks, { type: plan.mimeType });
        finishExport(blob, `slapchop-video-${ts}-${exportDuration}s.${plan.extension}`).then(resolve, reject);
      };

      mediaRecorder.start();

      const startTime = performance.now();
      interval = setInterval(() => {
        const elapsed = (performance.now() - startTime) / 1000;
        setExportJob({
          label: `Recording in real time as ${plan.extension.toUpperCase()}… ${elapsed.toFixed(1)}s / ${exportDuration}s`,
          percent: Math.min(100, (elapsed / exportDuration) * 100)
        });

        renderExportFrame(offscreenCanvas, elapsed, doc, resW, resH);

        if (elapsed >= exportDuration || isCancelExportRef.current) {
          if (interval !== null) clearInterval(interval);
          interval = null;
          if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
          else releaseCapture();
        }
      }, 1000 / exportFps);
    });

  const startExport = async () => {
    isCancelExportRef.current = false;
    setExportError(null);
    setExportNotice(null);
    const doc = snapshotRenderState();
    const [resW, resH] = EXPORT_RESOLUTIONS[exportResolution];
    const ts = getExportTimestamp();

    const common = {
      width: resW,
      height: resH,
      fps: exportFps,
      duration: exportDuration,
      startTime: isNative() ? exportStartTime : 0,
      renderFrame: (canvas: HTMLCanvasElement, t: number) =>
        renderExportFrame(canvas, t, doc, resW, resH),
      isCancelled: () => isCancelExportRef.current
    };
    const frameProgress = (verb: string) => (done: number, total: number) =>
      setExportJob({ label: `${verb} frame ${done}/${total}…`, percent: (done / total) * 100 });

    // Opt-in stage timing (see docs/architecture/video-export-benchmark.md).
    // No-op unless ?profileExport=1 or the localStorage flag is set.
    const { finish: finishProfile } = beginExportProfile(`${exportType} export`, {
      exportType,
      resolution: `${resW}x${resH}`,
      fps: exportFps,
      duration: exportDuration,
      speed: exportSpeed,
      renderer: getActiveRendererName(),
      native: isNative(),
      previewPaused: pausePreviewDuringExport
    });

    setExportJob({ label: 'Preparing export…', percent: 0 });
    try {
      if (exportType === 'sequence') {
        const directory = await pickDirectoryPath();
        if (directory) {
          const result = await runWithPreviewPaused(() => exportNativeImageSequence({
            ...common,
            directory,
            imageFormat: exportFormat,
            resume: resumeSequence,
            onProgress: frameProgress(resumeSequence ? 'Rendering/resuming' : 'Rendering')
          }));
          if (!result.cancelled) setShowExportModal(false);
        }
      } else if (exportType === 'zip') {
        const blob = await exportZipSequence({
          ...common,
          imageFormat: exportFormat,
          onProgress: frameProgress('Rendering'),
          onZipProgress: (percent) => setExportJob({ label: 'Compressing ZIP…', percent })
        });
        if (blob) saveExportResult(blob, `slapchop-sequence-${ts}-${exportResolution}-${exportDuration}s.zip`);
      } else if (exportType === 'gif') {
        const blob = await runWithPreviewPaused(() =>
          exportGif({ ...common, onProgress: frameProgress('Encoding GIF') }));
        if (blob) saveExportResult(blob, `slapchop-anim-${ts}-${exportDuration}s.gif`);
      } else if (isNative() && (exportType === 'mp4' || exportType === 'webm' || exportType === 'prores')) {
        const extension = exportType === 'prores' ? 'mov' : exportType;
        const savePath = await pickSavePath(`slapchop-video-${ts}-${exportDuration}s.${extension}`);
        if (savePath) {
          // ffmpeg reads rawvideo, so frames go straight from the renderer to
          // the encoder without a canvas or PNG in between.
          const frames = createRawFrameSource(resW, resH);
          try {
            const ok = await runWithPreviewPaused(() => exportNativeVideo(exportType, {
              ...common,
              savePath,
              speed: exportSpeed,
              renderRgbaFrame: (t) => frames.frame(t, doc),
              onProgress: frameProgress('Rendering and encoding'),
              onEncoderFallback: (encoder) => setExportNotice(
                `Hardware encoding was unavailable, so this export used ${encoder}.`
              ),
              onFinalizing: () => setExportJob({ label: 'Finalizing video…', percent: 100 })
            }));
            if (ok) setShowExportModal(false);
          } finally {
            frames.dispose();
          }
        }
      } else if (exportType === 'mp4' || exportType === 'webm') {
        // Browser video. Re-plan at export time so the run uses the authoritative
        // capability answer for the current request, not a stale probe.
        const plan = await planVideoExport({
          format: exportType, width: resW, height: resH, fps: exportFps
        });
        setBrowserVideoPlan(plan);
        // The modal already shows a degraded plan inline; only escalate to the
        // notice box if the export-time answer differs from what was displayed.
        if (plan.degraded && plan.summary !== browserVideoPlan?.summary) setExportNotice(plan.summary);

        if (plan.path === 'webcodecs') {
          const blob = await exportVideo(plan.format, {
            ...common,
            encoderConfig: plan.encoderConfig,
            onProgress: frameProgress('Encoding')
          });
          if (blob) saveExportResult(blob, `slapchop-video-${ts}-${exportDuration}s.${plan.extension}`);
        } else {
          await recordVideoFallback(plan, doc, resW, resH, ts);
        }
      } else {
        throw new Error(`${exportType} export is only available in the desktop app.`);
      }
    } catch (e) {
      console.error('Export failed:', e);
      setExportError(getExportFailureMessage(exportType, e));
    } finally {
      finishProfile();
      setExportJob(null);
    }
  };

  // Native menu items (File > Export…) reach us via window events.
  useEffect(() => {
    const showExport = () => {
      setExportError(null);
      setShowExportModal(true);
    };
    const exportPng = () => void handleExportHighRes();
    window.addEventListener('slapchop:show-export', showExport);
    window.addEventListener('slapchop:export-png', exportPng);
    return () => {
      window.removeEventListener('slapchop:show-export', showExport);
      window.removeEventListener('slapchop:export-png', exportPng);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleExportHighRes reads all state through the store
  }, []);

  return {
    showExportModal,
    openExportModal,
    cancelExport,
    exportType,
    setExportType,
    exportResolution,
    setExportResolution,
    exportFormat,
    setExportFormat,
    exportStartTime,
    setExportStartTime,
    exportDuration,
    setExportDuration,
    exportFps,
    setExportFps,
    exportSpeed,
    setExportSpeed,
    resumeSequence,
    setResumeSequence,
    pausePreviewDuringExport,
    setPausePreviewDuringExport,
    liveOutputStreaming,
    exportJob,
    exportError,
    exportNotice,
    browserVideoPlan,
    browserVideoError,
    handleExportHighRes,
    startExport
  };
}

export type ExportApi = ReturnType<typeof useExport>;
