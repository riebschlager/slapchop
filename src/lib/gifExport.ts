import type { FrameExportOptions } from './videoExport';

/**
 * True animated-GIF export via gifenc. Frames render on the main thread;
 * each RGBA buffer is transferred to a worker that quantizes and encodes.
 * Returns null if cancelled.
 *
 * GIF timing is in centiseconds, so effective playback is closest to fps
 * values that divide 100 evenly (50, 25, 20, 10); 30 fps plays at ~33 fps.
 */
export async function exportGif(opts: FrameExportOptions): Promise<Blob | null> {
  const { width, height, fps, duration, renderFrame, onProgress, isCancelled } = opts;
  const totalFrames = Math.round(fps * duration);
  const delay = 1000 / fps;

  const worker = new Worker(new URL('../workers/gifWorker.ts', import.meta.url), { type: 'module' });
  const canvas = document.createElement('canvas');

  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      let encodedFrames = 0;

      worker.onmessage = (e: MessageEvent<{ type: string; data?: ArrayBuffer; message?: string }>) => {
        const msg = e.data;
        if (msg.type === 'frameDone') {
          encodedFrames++;
          onProgress?.(encodedFrames, totalFrames);
          if (isCancelled?.()) {
            resolve(null);
          } else if (encodedFrames < totalFrames) {
            sendFrame(encodedFrames);
          } else {
            worker.postMessage({ type: 'finish' });
          }
        } else if (msg.type === 'done') {
          resolve(new Blob([msg.data!], { type: 'image/gif' }));
        } else if (msg.type === 'error') {
          reject(new Error(msg.message));
        }
      };
      worker.onerror = (e) => reject(new Error(e.message));

      const sendFrame = (frame: number) => {
        renderFrame(canvas, frame / fps);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          reject(new Error('Could not read pixels from export canvas'));
          return;
        }
        const imageData = ctx.getImageData(0, 0, width, height);
        worker.postMessage(
          { type: 'frame', data: imageData.data.buffer, width, height, delay },
          [imageData.data.buffer]
        );
      };

      sendFrame(0);
    });
  } finally {
    worker.terminate();
  }
}
