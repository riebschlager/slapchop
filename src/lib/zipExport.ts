import type { FrameExportOptions } from './videoExport';

export interface ZipExportOptions extends FrameExportOptions {
  imageFormat: 'png' | 'jpeg';
  onZipProgress?: (percent: number) => void;
}

/**
 * Render fps × duration frames on the main thread (canvas work can't leave
 * it) while streaming each encoded image to a worker that owns the JSZip
 * archive; DEFLATE then runs entirely off-thread. Returns null if cancelled.
 */
export async function exportZipSequence(opts: ZipExportOptions): Promise<Blob | null> {
  const {
    fps, duration, startTime = 0, renderFrame,
    imageFormat, onProgress, onZipProgress, isCancelled
  } = opts;
  const totalFrames = Math.round(fps * duration);
  const ext = imageFormat === 'jpeg' ? 'jpg' : 'png';
  const mimeType = imageFormat === 'jpeg' ? 'image/jpeg' : 'image/png';

  const worker = new Worker(new URL('../workers/zipWorker.ts', import.meta.url), { type: 'module' });
  const canvas = document.createElement('canvas');

  try {
    for (let frame = 0; frame < totalFrames; frame++) {
      if (isCancelled?.()) return null;

      renderFrame(canvas, startTime + frame / fps);
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, mimeType, 0.92);
      });
      if (blob) {
        const name = `frame_${String(frame + 1).padStart(5, '0')}.${ext}`;
        worker.postMessage({ type: 'add', name, data: blob });
      }

      onProgress?.(frame + 1, totalFrames);
      await new Promise((r) => setTimeout(r));
    }

    if (isCancelled?.()) return null;

    return await new Promise<Blob>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<{ type: string; percent?: number; blob?: Blob; message?: string }>) => {
        const msg = e.data;
        if (msg.type === 'progress') onZipProgress?.(msg.percent!);
        else if (msg.type === 'done') resolve(msg.blob!);
        else if (msg.type === 'error') reject(new Error(msg.message));
      };
      worker.onerror = (e) => reject(new Error(e.message));
      worker.postMessage({ type: 'finish' });
    });
  } finally {
    worker.terminate();
  }
}
