export function getExportErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return 'The export failed for an unknown reason.';
}

const EXPORT_LABELS: Record<string, string> = {
  mp4: 'MP4',
  webm: 'WebM',
  prores: 'ProRes 4444',
  gif: 'Animated GIF',
  zip: 'Frame-sequence ZIP',
  sequence: 'Frame-sequence'
};

/**
 * Allocation failures reach us as several unrelated shapes: a RangeError from
 * an oversized ArrayBuffer, a DOMException from the encoder, or a bare string
 * from a worker. Match on the observable text rather than the error class.
 */
export function looksLikeMemoryFailure(error: unknown): boolean {
  if (error instanceof RangeError) return true;
  const message = getExportErrorMessage(error).toLowerCase();
  return /out of memory|oom|allocation (failed|size)|array buffer allocation|invalid (string|array) length|too large|exceeds/.test(message);
}

/**
 * A user-facing export failure: names the format that failed, since a browser
 * session can have several export types configured, and adds the memory advice
 * that is the usual cause when a long or full-resolution browser export dies.
 */
export function getExportFailureMessage(exportType: string, error: unknown): string {
  const label = EXPORT_LABELS[exportType];
  const detail = getExportErrorMessage(error).trim();
  const sentence = /[.!?]$/.test(detail) ? detail : `${detail}.`;
  const base = label ? `${label} export failed: ${sentence}` : `Export failed: ${sentence}`;
  return looksLikeMemoryFailure(error)
    ? `${base} This looks like an out-of-memory failure — try a lower resolution, a shorter duration, or a lower frame rate.`
    : base;
}
