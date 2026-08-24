import type { FrameExportOptions, VideoFormat } from './videoExport';

export type NativeVideoFormat = VideoFormat | 'prores';

export interface NativeVideoExportOptions extends FrameExportOptions {
  savePath: string;
  onFinalizing?: () => void;
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error('Could not encode a frame for ffmpeg.'));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/png');
  });
}

export function getPartialVideoPath(savePath: string, id: string): string {
  const slash = Math.max(savePath.lastIndexOf('/'), savePath.lastIndexOf('\\'));
  const dot = savePath.lastIndexOf('.');
  const hasExtension = dot > slash;
  return hasExtension
    ? `${savePath.slice(0, dot)}.slapchop-partial-${id}${savePath.slice(dot)}`
    : `${savePath}.slapchop-partial-${id}`;
}

/**
 * Stream PNG frames into the narrow Rust-owned ffmpeg process. Rust owns the
 * stdin handle so it can send EOF after the final frame and let ffmpeg flush
 * the encoder and container trailer before the completed file is installed.
 */
export async function exportNativeVideo(
  format: NativeVideoFormat,
  opts: NativeVideoExportOptions
): Promise<boolean> {
  const {
    fps, duration, startTime = 0, renderFrame, savePath,
    onProgress, onFinalizing, isCancelled
  } = opts;
  const totalFrames = Math.round(fps * duration);
  const startFrame = Math.round(Math.max(0, startTime) * fps);
  const partialPath = getPartialVideoPath(savePath, crypto.randomUUID());
  const { invoke } = await import('@tauri-apps/api/core');
  const { remove, rename } = await import('@tauri-apps/plugin-fs');
  const canvas = document.createElement('canvas');
  let jobId: string | null = null;

  try {
    jobId = await invoke<string>('start_native_video_export', {
      format,
      fps,
      totalFrames,
      outputPath: partialPath
    });
    for (let n = 0; n < totalFrames; n++) {
      if (isCancelled?.()) {
        await invoke('cancel_native_video_export', { jobId }).catch(() => {});
        jobId = null;
        return false;
      }

      renderFrame(canvas, (startFrame + n) / fps);
      await invoke('write_native_video_frame', {
        jobId,
        frame: await canvasToPngBytes(canvas)
      });
      onProgress?.(n + 1, totalFrames);
      await new Promise((resolve) => setTimeout(resolve));
    }

    onFinalizing?.();
    const status = await invoke<{ code: number | null; stderr: string }>(
      'finish_native_video_export',
      { jobId }
    );
    jobId = null;
    if (status.code !== 0) {
      const detail = status.stderr.trim() || 'ffmpeg did not provide an error message.';
      throw new Error(`ffmpeg exited with code ${status.code}: ${detail.slice(-1000)}`);
    }
    await rename(partialPath, savePath);
    return true;
  } catch (error) {
    if (jobId) await invoke('cancel_native_video_export', { jobId }).catch(() => {});
    throw error;
  } finally {
    await remove(partialPath).catch(() => {});
  }
}
