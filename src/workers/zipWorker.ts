import JSZip from 'jszip';

// One worker instance per export job: frames stream in as they render, then
// DEFLATE runs here so the UI thread never stutters during compression.

type InMsg =
  | { type: 'add'; name: string; data: Blob }
  | { type: 'finish' };

type OutMsg =
  | { type: 'progress'; percent: number }
  | { type: 'done'; blob: Blob }
  | { type: 'error'; message: string };

const zip = new JSZip();
const post = (msg: OutMsg) => postMessage(msg);

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === 'add') {
    zip.file(msg.name, msg.data);
  } else if (msg.type === 'finish') {
    try {
      const blob = await zip.generateAsync({ type: 'blob' }, (meta) => {
        post({ type: 'progress', percent: Math.round(meta.percent) });
      });
      post({ type: 'done', blob });
    } catch (err) {
      post({ type: 'error', message: String(err) });
    }
  }
};
