import { GifReader } from 'omggif';
import { parseGIF, decompressFrames } from 'gifuct-js';
import { GifData, GifFrameData } from '../types';

export async function parseGifFile(file: File): Promise<GifData | null> {
  const isGif = file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif');
  if (!isGif) return null;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Primary: omggif with full canvas image buffer
    let gifData = parseWithOmggif(uint8Array);
    if (!gifData) {
      // Fallback: gifuct-js
      gifData = parseWithGifuct(arrayBuffer);
    }

    return gifData;
  } catch (err) {
    console.warn("Could not parse GIF file:", err);
    return null;
  }
}

function parseWithOmggif(uint8Array: Uint8Array): GifData | null {
  try {
    const reader = new GifReader(uint8Array as unknown as Buffer);
    const numFrames = reader.numFrames();
    if (numFrames <= 1) return null;

    const width = reader.width;
    const height = reader.height;

    const workCanvas = document.createElement('canvas');
    workCanvas.width = width;
    workCanvas.height = height;
    const workCtx = workCanvas.getContext('2d', { willReadFrequently: true });
    if (!workCtx) return null;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');

    const frames: GifFrameData[] = [];
    let currentTimeMs = 0;

    for (let i = 0; i < numFrames; i++) {
      const frameInfo = reader.frameInfo(i);
      let delayMs = (frameInfo.delay || 10) * 10;
      if (delayMs < 20) delayMs = 100;

      // Disposal mode 3: restore to canvas state before this frame
      if (frameInfo.disposal === 3 && tempCtx) {
        tempCtx.clearRect(0, 0, width, height);
        tempCtx.drawImage(workCanvas, 0, 0);
      }

      // CRITICAL: decodeAndBlitFrameRGBA requires a full canvas buffer (width * height * 4)
      const fullImageData = workCtx.getImageData(0, 0, width, height);
      reader.decodeAndBlitFrameRGBA(i, fullImageData.data as unknown as Uint8ClampedArray);
      workCtx.putImageData(fullImageData, 0, 0);

      // Snapshot this rendered frame
      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = width;
      frameCanvas.height = height;
      const frameCtx = frameCanvas.getContext('2d');
      if (frameCtx) {
        frameCtx.drawImage(workCanvas, 0, 0);
      }

      frames.push({
        canvas: frameCanvas,
        delayMs,
        startTimeMs: currentTimeMs,
        endTimeMs: currentTimeMs + delayMs
      });

      currentTimeMs += delayMs;

      // Post-render disposal
      if (frameInfo.disposal === 2) {
        // Restore to background (transparent)
        workCtx.clearRect(frameInfo.x, frameInfo.y, frameInfo.width, frameInfo.height);
      } else if (frameInfo.disposal === 3 && tempCtx) {
        // Restore to pre-frame snapshot
        workCtx.clearRect(0, 0, width, height);
        workCtx.drawImage(tempCanvas, 0, 0);
      }
    }

    return {
      frames,
      totalDurationMs: currentTimeMs,
      width,
      height
    };
  } catch (err) {
    console.warn("omggif parse error:", err);
    return null;
  }
}

function parseWithGifuct(arrayBuffer: ArrayBuffer): GifData | null {
  try {
    const gif = parseGIF(arrayBuffer);
    const rawFrames = decompressFrames(gif, true);
    if (!rawFrames || rawFrames.length <= 1) return null;

    const width = gif.lsd.width;
    const height = gif.lsd.height;

    const workCanvas = document.createElement('canvas');
    workCanvas.width = width;
    workCanvas.height = height;
    const workCtx = workCanvas.getContext('2d', { willReadFrequently: true });
    if (!workCtx) return null;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');

    const patchCanvas = document.createElement('canvas');
    const patchCtx = patchCanvas.getContext('2d');

    const frames: GifFrameData[] = [];
    let currentTimeMs = 0;

    for (let i = 0; i < rawFrames.length; i++) {
      const frame = rawFrames[i];
      let delayMs = frame.delay || 100;
      if (delayMs < 20) delayMs = 100;

      const { width: pW, height: pH, top: pTop, left: pLeft } = frame.dims;

      if (frame.disposalType === 3 && tempCtx) {
        tempCtx.clearRect(0, 0, width, height);
        tempCtx.drawImage(workCanvas, 0, 0);
      }

      if (pW > 0 && pH > 0 && patchCtx) {
        patchCanvas.width = pW;
        patchCanvas.height = pH;
        const patchImageData = patchCtx.createImageData(pW, pH);
        patchImageData.data.set(frame.patch);
        patchCtx.putImageData(patchImageData, 0, 0);

        workCtx.drawImage(patchCanvas, pLeft, pTop);
      }

      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = width;
      frameCanvas.height = height;
      const frameCtx = frameCanvas.getContext('2d');
      if (frameCtx) {
        frameCtx.drawImage(workCanvas, 0, 0);
      }

      frames.push({
        canvas: frameCanvas,
        delayMs,
        startTimeMs: currentTimeMs,
        endTimeMs: currentTimeMs + delayMs
      });

      currentTimeMs += delayMs;

      if (frame.disposalType === 2) {
        workCtx.clearRect(pLeft, pTop, pW, pH);
      } else if (frame.disposalType === 3 && tempCtx) {
        workCtx.clearRect(0, 0, width, height);
        workCtx.drawImage(tempCanvas, 0, 0);
      }
    }

    return {
      frames,
      totalDurationMs: currentTimeMs,
      width,
      height
    };
  } catch (err) {
    console.warn("gifuct parse error:", err);
    return null;
  }
}

/**
 * Gets the canvas element corresponding to a GIF frame at a specific timestamp t (in seconds).
 * Uses O(log N) binary search for smooth 60fps animation performance.
 */
export function getGifFrameAtTime(gifData: GifData, tInSeconds: number, speed: number = 1): HTMLCanvasElement | null {
  if (!gifData || !gifData.frames.length || gifData.totalDurationMs <= 0) return null;
  const effectiveSpeed = typeof speed === 'number' && !isNaN(speed) ? speed : 1;
  const timeMs = Math.abs(tInSeconds * effectiveSpeed * 1000) % gifData.totalDurationMs;
  
  const frames = gifData.frames;
  let low = 0;
  let high = frames.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const f = frames[mid];
    if (timeMs >= f.startTimeMs && timeMs < f.endTimeMs) {
      return f.canvas;
    } else if (timeMs < f.startTimeMs) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return frames[0].canvas;
}
