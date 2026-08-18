import { useEffect, useRef, useState } from 'react';
import { getDocumentSnapshot, useStore } from '../store';
import { CANVAS_HEIGHT, CANVAS_WIDTH, RenderState } from '../renderer/render2d';
import { getPlaybackTime, renderExportFrame } from '../renderer/loop';
import { exportVideo, supportsWebCodecs, VideoFormat } from '../lib/videoExport';
import { exportZipSequence } from '../lib/zipExport';
import { exportGif } from '../lib/gifExport';
import { exportProRes } from '../lib/proresExport';
import { pickSavePath, saveBlob } from '../lib/native';

export type ExportType = 'mp4' | 'webm' | 'prores' | 'gif' | 'zip';
export type ExportResolution = 'full' | 'hd' | 'compact';
export type ExportImageFormat = 'png' | 'jpeg';

export interface ExportJob {
  label: string;
  percent: number;
}

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
export function useExport() {
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportType, setExportType] = useState<ExportType>('mp4');
  const [exportResolution, setExportResolution] = useState<ExportResolution>('hd');
  const [exportFormat, setExportFormat] = useState<ExportImageFormat>('png');
  const [exportDuration, setExportDuration] = useState<number>(3);
  const [exportFps, setExportFps] = useState<number>(30);
  const [exportJob, setExportJob] = useState<ExportJob | null>(null);

  const isCancelExportRef = useRef(false);

  const openExportModal = () => setShowExportModal(true);
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

  // Real-time MediaRecorder capture, kept only for browsers without WebCodecs.
  const recordVideoFallback = (doc: RenderState, resW: number, resH: number) =>
    new Promise<void>((resolve) => {
      const offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = resW;
      offscreenCanvas.height = resH;

      const mimeTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
      let selectedMimeType = 'video/webm';
      for (const type of mimeTypes) {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
          selectedMimeType = type;
          break;
        }
      }

      const stream = offscreenCanvas.captureStream(exportFps);
      const mediaRecorder = new MediaRecorder(stream, { mimeType: selectedMimeType });

      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        if (!isCancelExportRef.current) {
          const blob = new Blob(chunks, { type: 'video/webm' });
          finishExport(blob, `slapchop-video-${getExportTimestamp()}-${exportDuration}s.webm`);
        }
        resolve();
      };

      mediaRecorder.start();

      const startTime = performance.now();
      const interval = setInterval(() => {
        const elapsed = (performance.now() - startTime) / 1000;
        setExportJob({
          label: `Recording in real time (WebCodecs unavailable)… ${elapsed.toFixed(1)}s / ${exportDuration}s`,
          percent: Math.min(100, (elapsed / exportDuration) * 100)
        });

        renderExportFrame(offscreenCanvas, elapsed, doc, resW, resH);

        if (elapsed >= exportDuration || isCancelExportRef.current) {
          clearInterval(interval);
          if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        }
      }, 1000 / exportFps);
    });

  const startExport = async () => {
    isCancelExportRef.current = false;
    const doc = snapshotRenderState();
    const [resW, resH] = exportResolution === 'full' ? [1080, 1920]
                       : exportResolution === 'hd' ? [720, 1280]
                       : [540, 960];
    const ts = getExportTimestamp();

    const common = {
      width: resW,
      height: resH,
      fps: exportFps,
      duration: exportDuration,
      renderFrame: (canvas: HTMLCanvasElement, t: number) =>
        renderExportFrame(canvas, t, doc, resW, resH),
      isCancelled: () => isCancelExportRef.current
    };
    const frameProgress = (verb: string) => (done: number, total: number) =>
      setExportJob({ label: `${verb} frame ${done}/${total}…`, percent: (done / total) * 100 });

    setExportJob({ label: 'Preparing export…', percent: 0 });
    try {
      if (exportType === 'zip') {
        const blob = await exportZipSequence({
          ...common,
          imageFormat: exportFormat,
          onProgress: frameProgress('Rendering'),
          onZipProgress: (percent) => setExportJob({ label: 'Compressing ZIP…', percent })
        });
        if (blob) finishExport(blob, `slapchop-sequence-${ts}-${exportResolution}-${exportDuration}s.zip`);
      } else if (exportType === 'gif') {
        const blob = await exportGif({ ...common, onProgress: frameProgress('Encoding GIF') });
        if (blob) finishExport(blob, `slapchop-anim-${ts}-${exportDuration}s.gif`);
      } else if (exportType === 'prores') {
        const savePath = await pickSavePath(`slapchop-video-${ts}-${exportDuration}s.mov`);
        if (savePath) {
          const ok = await exportProRes({
            ...common,
            savePath,
            onProgress: frameProgress('Rendering'),
            onEncodeProgress: (done, total) =>
              setExportJob({ label: `Encoding ProRes ${done}/${total}…`, percent: (done / total) * 100 })
          });
          if (ok) setShowExportModal(false);
        }
      } else if (supportsWebCodecs()) {
        const blob = await exportVideo(exportType as VideoFormat, {
          ...common,
          onProgress: frameProgress('Encoding')
        });
        if (blob) finishExport(blob, `slapchop-video-${ts}-${exportDuration}s.${exportType}`);
      } else {
        await recordVideoFallback(doc, resW, resH);
      }
    } catch (e) {
      console.error('Export failed:', e);
    } finally {
      setExportJob(null);
    }
  };

  // Native menu items (File > Export…) reach us via window events.
  useEffect(() => {
    const showExport = () => setShowExportModal(true);
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
    exportDuration,
    setExportDuration,
    exportFps,
    setExportFps,
    exportJob,
    handleExportHighRes,
    startExport
  };
}

export type ExportApi = ReturnType<typeof useExport>;
