import { DocumentState, clearHistory, getDocumentSnapshot, useStore } from '../store';
import { saveBlob } from './native';
import { Layer, PolygonLayer } from '../types';
import { parseGifFile } from './gifUtils';

// .slapchop project file: the document state as JSON, with every image/GIF
// embedded as a data URL so a project is a single self-contained file.

interface ProjectAsset {
  name: string;
  type: string;
  dataUrl: string;
}

type SerializedLayer = Omit<Layer, 'src' | 'gifData'> & { assetId: string };
type SerializedPolygon = Omit<PolygonLayer, 'src' | 'gifData'> & { assetId?: string };

interface ProjectFileV1 {
  app: 'slapchop';
  version: 1;
  savedAt: string;
  canvasBg: string;
  layers: SerializedLayer[];
  polygonLayers: SerializedPolygon[];
  assets: Record<string, ProjectAsset>;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function saveProject(): Promise<void> {
  const doc = getDocumentSnapshot();
  const assets: Record<string, ProjectAsset> = {};
  const srcToAssetId = new Map<string, string>();

  async function assetIdFor(src: string, name: string): Promise<string> {
    const existing = srcToAssetId.get(src);
    if (existing) return existing;
    const blob = await (await fetch(src)).blob();
    const id = crypto.randomUUID();
    assets[id] = { name, type: blob.type || 'application/octet-stream', dataUrl: await blobToDataUrl(blob) };
    srcToAssetId.set(src, id);
    return id;
  }

  const layers: SerializedLayer[] = [];
  for (const layer of doc.layers) {
    const { src, gifData, ...rest } = layer;
    void gifData; // decoded frames are rebuilt from the asset on load
    layers.push({ ...rest, assetId: await assetIdFor(src, layer.name) });
  }

  const polygonLayers: SerializedPolygon[] = [];
  for (const poly of doc.polygonLayers) {
    const { src, gifData, ...rest } = poly;
    void gifData;
    polygonLayers.push({
      ...rest,
      assetId: src ? await assetIdFor(src, poly.name) : undefined
    });
  }

  const payload: ProjectFileV1 = {
    app: 'slapchop',
    version: 1,
    savedAt: new Date().toISOString(),
    canvasBg: doc.canvasBg,
    layers,
    polygonLayers,
    assets
  };

  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  await saveBlob(blob, `slapchop-${timestamp()}.slapchop`);
}

export async function openProject(file: File): Promise<void> {
  const payload = JSON.parse(await file.text()) as ProjectFileV1;
  if (payload.app !== 'slapchop' || payload.version !== 1) {
    throw new Error('Not a recognized slapchop project file.');
  }

  // Materialize each asset once: data URL -> object URL (+ re-parsed GIF data)
  const materialized = new Map<string, { src: string; gifData?: Layer['gifData'] }>();
  for (const [id, asset] of Object.entries(payload.assets)) {
    const blob = await (await fetch(asset.dataUrl)).blob();
    const assetFile = new File([blob], asset.name, { type: asset.type });
    const src = URL.createObjectURL(assetFile);
    const gifData = await parseGifFile(assetFile);
    materialized.set(id, { src, gifData: gifData || undefined });
  }

  const layers: Layer[] = payload.layers.map((sl) => {
    const { assetId, ...rest } = sl;
    const asset = materialized.get(assetId);
    return { ...rest, src: asset?.src ?? '', gifData: asset?.gifData };
  });

  const polygonLayers: PolygonLayer[] = payload.polygonLayers.map((sp) => {
    const { assetId, ...rest } = sp;
    const asset = assetId ? materialized.get(assetId) : undefined;
    return { ...rest, src: asset?.src, gifData: asset?.gifData };
  });

  const doc: DocumentState = { layers, polygonLayers, canvasBg: payload.canvasBg };
  useStore.getState().loadDocument(doc);
  clearHistory();
}
