import { EMPTY_PAINT, MAX_PAINT_DISTANCE, MAX_PAINT_DURATION, MAX_PAINT_POINTS, normalizePaintSettings, pathDistance, type PaintAsset, type PaintDocument, type PaintPoint, type PaintStroke } from './model';
import type { GifData } from '../../types';

export interface SerializedPaint {
  version: 1;
  assets: { id: string; name: string; assetId: string; retired?: boolean }[];
  strokes: PaintStroke[];
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function restorePaint(input: unknown, materialized: ReadonlyMap<string, { src: string; gifData?: GifData }>): PaintDocument {
  if (input === undefined) return { ...EMPTY_PAINT, assets: [], strokes: [] };
  if (!record(input) || input.version !== 1 || !Array.isArray(input.assets) || !Array.isArray(input.strokes)
    || input.assets.length > 256 || input.strokes.length > 256) throw new Error('Invalid GIF Paint document or unsupported paint version.');
  const ids = new Set<string>();
  const assets: PaintAsset[] = input.assets.map(source => {
    if (!record(source) || typeof source.id !== 'string' || !source.id || ids.has(source.id)
      || typeof source.name !== 'string' || typeof source.assetId !== 'string') throw new Error('Invalid or duplicate GIF Paint source.');
    ids.add(source.id);
    const asset = materialized.get(source.assetId);
    if (!asset?.gifData) throw new Error(`GIF Paint source “${source.name}” is missing or could not be decoded.`);
    return { id: source.id, name: source.name, src: asset.src, gifData: asset.gifData, retired: source.retired === true };
  });
  const strokeIds = new Set<string>();
  const strokes: PaintStroke[] = input.strokes.map(stroke => {
    if (!record(stroke) || typeof stroke.id !== 'string' || !stroke.id || strokeIds.has(stroke.id)
      || typeof stroke.assetId !== 'string' || !ids.has(stroke.assetId) || typeof stroke.name !== 'string'
      || !Array.isArray(stroke.points) || !stroke.points.length || stroke.points.length > MAX_PAINT_POINTS
      || typeof stroke.sourceOffset !== 'number' || !Number.isFinite(stroke.sourceOffset) || stroke.sourceOffset < 0
      || typeof stroke.seed !== 'number' || !Number.isSafeInteger(stroke.seed)) throw new Error('Invalid GIF Paint stroke or missing source.');
    strokeIds.add(stroke.id);
    let previous = 0;
    const points: PaintPoint[] = stroke.points.map(p => {
      if (!record(p) || typeof p.x !== 'number' || !Number.isFinite(p.x) || Math.abs(p.x) > 540
        || typeof p.y !== 'number' || !Number.isFinite(p.y) || Math.abs(p.y) > 960
        || typeof p.time !== 'number' || !Number.isFinite(p.time) || p.time < previous || p.time > MAX_PAINT_DURATION) throw new Error('Invalid GIF Paint path coordinates or timing.');
      previous = p.time;
      return { x: p.x, y: p.y, time: p.time };
    });
    if (points[0].time !== 0 || pathDistance(points) > MAX_PAINT_DISTANCE) throw new Error('GIF Paint path exceeds the supported length or has an invalid start time.');
    return { ...normalizePaintSettings(stroke), id: stroke.id, name: stroke.name, assetId: stroke.assetId,
      sourceOffset: stroke.sourceOffset, seed: stroke.seed, hidden: stroke.hidden === true, points };
  });
  return { assets, strokes };
}
