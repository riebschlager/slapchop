import type { FrameExportOptions } from './videoExport';

export interface ProResExportOptions extends FrameExportOptions {
  /** Destination .mov path, chosen via the native save dialog before rendering. */
  savePath: string;
  onEncodeProgress?: (done: number, total: number) => void;
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error('canvas.toBlob returned null'));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/png');
  });
}

/**
 * ProRes 4444 export through the bundled ffmpeg sidecar (desktop app only):
 * renders fps × duration frames as PNGs into a temp directory, then encodes
 * them with prores_ks. Frame-exact and alpha-capable, same determinism
 * contract as the WebCodecs path. Returns false if cancelled.
 */
export async function exportProRes(opts: ProResExportOptions): Promise<boolean> {
  const { fps, duration, renderFrame, savePath, onProgress, onEncodeProgress, isCancelled } = opts;
  const totalFrames = Math.round(fps * duration);

  const { tempDir, join } = await import('@tauri-apps/api/path');
  const { mkdir, remove, writeFile } = await import('@tauri-apps/plugin-fs');
  const { Command } = await import('@tauri-apps/plugin-shell');

  const stageDir = await join(await tempDir(), `slapchop-prores-${crypto.randomUUID()}`);
  await mkdir(stageDir, { recursive: true });

  const canvas = document.createElement('canvas');
  try {
    for (let n = 0; n < totalFrames; n++) {
      if (isCancelled?.()) return false;
      renderFrame(canvas, n / fps);
      const name = `frame${String(n).padStart(5, '0')}.png`;
      await writeFile(await join(stageDir, name), await canvasToPngBytes(canvas));
      onProgress?.(n + 1, totalFrames);
    }

    if (isCancelled?.()) return false;

    const command = Command.sidecar('binaries/ffmpeg', [
      '-y',
      '-framerate', String(fps),
      '-start_number', '0',
      '-i', await join(stageDir, 'frame%05d.png'),
      '-c:v', 'prores_ks',
      '-profile:v', '4444',
      '-pix_fmt', 'yuva444p10le',
      '-vendor', 'apl0',
      savePath
    ]);

    let stderr = '';
    command.stderr.on('data', (line: string) => {
      stderr += line;
      const match = /frame=\s*(\d+)/.exec(line);
      if (match) onEncodeProgress?.(Math.min(totalFrames, Number(match[1])), totalFrames);
    });

    const child = await command.spawn();
    const status = await new Promise<{ code: number | null }>((resolve, reject) => {
      command.on('close', resolve);
      command.on('error', reject);
      const poll = setInterval(() => {
        if (isCancelled?.()) {
          clearInterval(poll);
          child.kill().catch(() => {});
        }
      }, 250);
      command.on('close', () => clearInterval(poll));
    });

    if (isCancelled?.()) return false;
    if (status.code !== 0) {
      throw new Error(`ffmpeg exited with code ${status.code}: ${stderr.slice(-500)}`);
    }
    return true;
  } finally {
    await remove(stageDir, { recursive: true }).catch(() => {});
  }
}
