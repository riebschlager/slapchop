import type { FrameExportOptions } from './videoExport';

export interface NativeImageSequenceOptions extends FrameExportOptions {
  directory: string;
  imageFormat: 'png' | 'jpeg';
  resume: boolean;
}

export interface NativeImageSequenceResult {
  completedFrames: number;
  skippedFrames: number;
  cancelled: boolean;
}

export interface SequenceManifest {
  version: 1;
  status: 'exporting' | 'complete' | 'cancelled' | 'failed';
  width: number;
  height: number;
  fps: number;
  startTime: number;
  duration: number;
  startFrame: number;
  totalFrames: number;
  firstFrameNumber: number;
  lastFrameNumber: number;
  imageFormat: 'png' | 'jpeg';
  filenamePattern: string;
  completedFrames: number;
  skippedFrames: number;
  updatedAt: string;
}

const FRAME_DIGITS = 8;

export function getSequenceStartFrame(startTime: number, fps: number): number {
  return Math.round(Math.max(0, startTime) * fps);
}

export function getSequenceFrameName(frameNumber: number, imageFormat: 'png' | 'jpeg'): string {
  const ext = imageFormat === 'jpeg' ? 'jpg' : 'png';
  return `frame_${String(frameNumber).padStart(FRAME_DIGITS, '0')}.${ext}`;
}

export function getSequenceCompatibilityError(
  manifest: Partial<SequenceManifest>,
  expected: Pick<SequenceManifest, 'width' | 'height' | 'fps' | 'imageFormat'>
): string | null {
  if (manifest.width !== expected.width || manifest.height !== expected.height) {
    return 'The existing sequence uses a different resolution.';
  }
  if (manifest.fps !== expected.fps) {
    return 'The existing sequence uses a different frame rate.';
  }
  if (manifest.imageFormat !== expected.imageFormat) {
    return 'The existing sequence uses a different image format.';
  }
  return null;
}

function canvasToImageBytes(
  canvas: HTMLCanvasElement,
  imageFormat: 'png' | 'jpeg'
): Promise<Uint8Array> {
  const mimeType = imageFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error(`Could not encode the export frame as ${imageFormat.toUpperCase()}.`));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, mimeType, 0.92);
  });
}

/**
 * Write a native image sequence one frame at a time. Completed files remain
 * usable after cancellation or failure, and resume mode skips existing frames.
 */
export async function exportNativeImageSequence(
  opts: NativeImageSequenceOptions
): Promise<NativeImageSequenceResult> {
  const {
    width, height, fps, duration, startTime = 0, renderFrame, onProgress,
    isCancelled, directory, imageFormat, resume
  } = opts;
  const totalFrames = Math.round(fps * duration);
  const startFrame = getSequenceStartFrame(startTime, fps);
  const firstFrameNumber = startFrame + 1;
  const lastFrameNumber = startFrame + totalFrames;
  const { exists, readDir, readTextFile, writeFile, writeTextFile } = await import('@tauri-apps/plugin-fs');
  const { join } = await import('@tauri-apps/api/path');
  const entries = await readDir(directory);

  if (!resume && entries.some(entry => entry.isFile && /^frame_\d+\.(png|jpe?g)$/i.test(entry.name))) {
    throw new Error('The selected folder already contains sequence frames. Choose an empty folder or enable Resume.');
  }

  const existingManifestEntry = entries.find(entry => entry.isFile && entry.name === 'sequence.json');
  if (resume && existingManifestEntry) {
    try {
      const existing = JSON.parse(await readTextFile(await join(directory, existingManifestEntry.name))) as Partial<SequenceManifest>;
      const compatibilityError = getSequenceCompatibilityError(existing, { width, height, fps, imageFormat });
      if (compatibilityError) throw new Error(compatibilityError);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error('The existing sequence manifest is not valid JSON.');
      }
      throw error;
    }
  }

  let completedFrames = 0;
  let skippedFrames = 0;
  const manifestPath = await join(directory, 'sequence.json');
  const manifest = (status: SequenceManifest['status']): SequenceManifest => ({
    version: 1,
    status,
    width,
    height,
    fps,
    startTime: startFrame / fps,
    duration,
    startFrame,
    totalFrames,
    firstFrameNumber,
    lastFrameNumber,
    imageFormat,
    filenamePattern: `frame_%0${FRAME_DIGITS}d.${imageFormat === 'jpeg' ? 'jpg' : 'png'}`,
    completedFrames,
    skippedFrames,
    updatedAt: new Date().toISOString()
  });
  const writeManifest = (status: SequenceManifest['status']) =>
    writeTextFile(manifestPath, `${JSON.stringify(manifest(status), null, 2)}\n`);

  await writeManifest('exporting');
  const canvas = document.createElement('canvas');

  try {
    for (let n = 0; n < totalFrames; n++) {
      if (isCancelled?.()) {
        await writeManifest('cancelled');
        return { completedFrames, skippedFrames, cancelled: true };
      }

      const frameNumber = firstFrameNumber + n;
      const framePath = await join(directory, getSequenceFrameName(frameNumber, imageFormat));
      if (resume && await exists(framePath)) {
        skippedFrames++;
      } else {
        renderFrame(canvas, (startFrame + n) / fps);
        await writeFile(framePath, await canvasToImageBytes(canvas, imageFormat), { createNew: true });
        completedFrames++;
      }

      onProgress?.(n + 1, totalFrames);
      if ((n + 1) % 100 === 0) await writeManifest('exporting');
      await new Promise((resolve) => setTimeout(resolve));
    }

    await writeManifest('complete');
    return { completedFrames, skippedFrames, cancelled: false };
  } catch (error) {
    await writeManifest('failed').catch(() => {});
    throw error;
  }
}
