import { GIFEncoder, quantize, applyPalette } from 'gifenc';

// Receives raw RGBA frames (transferred, not copied), quantizes each to a
// 256-color palette, and assembles the animated GIF off the main thread.

type InMsg =
  | { type: 'frame'; data: ArrayBuffer; width: number; height: number; delay: number }
  | { type: 'finish' };

type OutMsg =
  | { type: 'frameDone' }
  | { type: 'done'; data: ArrayBuffer }
  | { type: 'error'; message: string };

const gif = GIFEncoder();
const post = (msg: OutMsg, transfer?: Transferable[]) =>
  (postMessage as (m: OutMsg, t?: Transferable[]) => void)(msg, transfer);

self.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  try {
    if (msg.type === 'frame') {
      const rgba = new Uint8Array(msg.data);
      const palette = quantize(rgba, 256);
      const index = applyPalette(rgba, palette);
      gif.writeFrame(index, msg.width, msg.height, { palette, delay: msg.delay });
      post({ type: 'frameDone' });
    } else if (msg.type === 'finish') {
      gif.finish();
      const bytes = gif.bytes();
      post({ type: 'done', data: bytes.buffer as ArrayBuffer }, [bytes.buffer as ArrayBuffer]);
    }
  } catch (err) {
    post({ type: 'error', message: String(err) });
  }
};
