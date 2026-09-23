import { normalizeRings, RingsAsset, RingsConfig } from '../modes/rings/model';
import { DocumentState, clearHistory, getDocumentSnapshot, useStore } from '../store';
import { saveBlob } from './native';
import {
  Camera3dConfig,
  DEFAULT_BRUSH_TOOL,
  DEFAULT_CAMERA3D,
  DEFAULT_FLYTHROUGH,
  DEFAULT_GIF_VORONOI,
  DEFAULT_LANDSCAPE,
  DEFAULT_MASTER_FX,
  DEFAULT_TUNNEL,
  FlythroughAsset,
  FlythroughConfig,
  GifVoronoiAsset,
  GifVoronoiConfig,
  LandscapeAsset,
  LandscapeConfig,
  LandscapeSkySource,
  Layer,
  MasterFxConfig,
  Mesh3dLayer,
  PolygonLayer,
  PolygonTextureFolder,
  PolygonUnderpainting,
  TunnelAsset,
  TunnelConfig
} from '../types';
import { parseGifFile } from './gifUtils';
import { normalizePolygonBrush } from './brushStroke';

// .slapchop project file: the document state as JSON, with every image/GIF
// embedded as a data URL so a project is a single self-contained file.

interface ProjectAsset {
  name: string;
  type: string;
  dataUrl: string;
}

type SerializedLayer = Omit<Layer, 'src' | 'gifData'> & { assetId: string };
type SerializedPolygon = Omit<PolygonLayer, 'src' | 'gifData'> & { assetId?: string };
type SerializedMesh3d = Omit<Mesh3dLayer, 'src' | 'gifData'> & { assetId?: string };
type SerializedFlythroughAsset = Omit<FlythroughAsset, 'src' | 'gifData'> & { assetId: string };
type SerializedTunnelAsset = Omit<TunnelAsset, 'src' | 'gifData'> & { assetId: string };
type SerializedGifVoronoiAsset = Omit<GifVoronoiAsset, 'src' | 'gifData'> & { assetId: string };
type SerializedLandscapeAsset = Omit<LandscapeAsset, 'src' | 'gifData'> & { assetId: string };
type SerializedLandscapeSkySource = Omit<LandscapeSkySource, 'assets'> & { assets: SerializedLandscapeAsset[] };

interface ProjectFileV1 {
  app: 'slapchop';
  version: 1;
  savedAt: string;
  canvasBg: string;
  masterFx?: MasterFxConfig;
  layers: SerializedLayer[];
  polygonLayers: SerializedPolygon[];
  assets: Record<string, ProjectAsset>;
}

// V2 adds 3D Mesh Mode's layers and camera. Reading a V1 file simply treats
// it as a workspace with an empty mesh3dLayers array and the default camera — no
// migration step needed since the new fields are purely additive.
interface ProjectFileV2 {
  app: 'slapchop';
  version: 2;
  savedAt: string;
  canvasBg: string;
  masterFx?: MasterFxConfig;
  layers: SerializedLayer[];
  polygonLayers: SerializedPolygon[];
  mesh3dLayers: SerializedMesh3d[];
  camera3d?: Camera3dConfig;
  assets: Record<string, ProjectAsset>;
}

// V3 adds GIF Flythrough's source library and scene configuration. Folder
// paths are intentionally not persisted; every GIF is embedded like the
// assets in the other modes so projects remain local and self-contained.
interface ProjectFileV3 {
  app: 'slapchop';
  version: 3;
  savedAt: string;
  canvasBg: string;
  masterFx?: MasterFxConfig;
  layers: SerializedLayer[];
  polygonLayers: SerializedPolygon[];
  mesh3dLayers: SerializedMesh3d[];
  camera3d?: Camera3dConfig;
  flythroughAssets: SerializedFlythroughAsset[];
  flythrough?: FlythroughConfig;
  assets: Record<string, ProjectAsset>;
}

// V4 adds GIF Tunnel's ordered mixed image/GIF wallpaper library and its
// independently owned procedural configuration.
interface ProjectFileV4 {
  app: 'slapchop';
  version: 4;
  savedAt: string;
  canvasBg: string;
  masterFx?: MasterFxConfig;
  layers: SerializedLayer[];
  polygonLayers: SerializedPolygon[];
  mesh3dLayers: SerializedMesh3d[];
  camera3d?: Camera3dConfig;
  flythroughAssets: SerializedFlythroughAsset[];
  flythrough?: FlythroughConfig;
  tunnelAssets: SerializedTunnelAsset[];
  tunnel?: TunnelConfig;
  assets: Record<string, ProjectAsset>;
}

// V5 adds the flat GIF Voronoi library and its mode-owned mosaic controls.
interface ProjectFileV5 {
  app: 'slapchop';
  version: 5;
  savedAt: string;
  canvasBg: string;
  masterFx?: MasterFxConfig;
  layers: SerializedLayer[];
  polygonLayers: SerializedPolygon[];
  mesh3dLayers: SerializedMesh3d[];
  camera3d?: Camera3dConfig;
  flythroughAssets: SerializedFlythroughAsset[];
  flythrough?: FlythroughConfig;
  tunnelAssets: SerializedTunnelAsset[];
  tunnel?: TunnelConfig;
  gifVoronoiAssets: SerializedGifVoronoiAsset[];
  gifVoronoi?: GifVoronoiConfig;
  assets: Record<string, ProjectAsset>;
}

// V6 adds the flyover landscape's terrain library, independent sky-folder
// sources, and mode-owned procedural scene configuration.
interface ProjectFileV6 {
  app: 'slapchop';
  version: 6;
  savedAt: string;
  canvasBg: string;
  masterFx?: MasterFxConfig;
  layers: SerializedLayer[];
  polygonLayers: SerializedPolygon[];
  mesh3dLayers: SerializedMesh3d[];
  camera3d?: Camera3dConfig;
  flythroughAssets: SerializedFlythroughAsset[];
  flythrough?: FlythroughConfig;
  tunnelAssets: SerializedTunnelAsset[];
  tunnel?: TunnelConfig;
  gifVoronoiAssets: SerializedGifVoronoiAsset[];
  gifVoronoi?: GifVoronoiConfig;
  landscapeTerrainAssets: SerializedLandscapeAsset[];
  landscapeSkySources: SerializedLandscapeSkySource[];
  landscape?: LandscapeConfig;
  assets: Record<string, ProjectAsset>;
}

type SerializedPolygonUnderpainting = Omit<PolygonUnderpainting, 'src'> & { assetId: string };
type SerializedPolygonTextureFolder = Omit<PolygonTextureFolder, 'assets'> & {
  assets: { id: string; name: string; assetId: string }[];
};

// V7 adds GIF Rings; versions 1–6 open with an empty ring library.
// `polygonUnderpainting` was added later as an optional V7 field rather than a
// version bump: it is editor-only (never rendered or exported), so a build
// that ignores it still opens the file with identical output.
interface ProjectFileV7 extends Omit<ProjectFileV6, 'version'> {
  version: 7;
  ringsAssets: (Omit<RingsAsset, 'src' | 'gifData'> & { assetId: string })[];
  rings: RingsConfig;
  polygonUnderpainting?: SerializedPolygonUnderpainting;
}

// V8 adds brush-painted Tiled GIF shapes (`PolygonLayer.brush`). A brush
// polygon's `points` are an open centerline, which a V7 reader would fill as a
// closed outline, so older builds must refuse the file rather than misrender
// it. The payload shape is otherwise identical to V7.
//
// `polygonTextureFolder` is an optional V8 field for the same reason as the
// underpainting: it only feeds new shapes, and every shape already embeds its
// own texture, so a build that ignores it renders the file identically.
interface ProjectFileV8 extends Omit<ProjectFileV7, 'version'> {
  version: 8;
  polygonTextureFolder?: SerializedPolygonTextureFolder;
}

type ProjectFile = ProjectFileV1 | ProjectFileV2 | ProjectFileV3 | ProjectFileV4 | ProjectFileV5 | ProjectFileV6 | ProjectFileV7 | ProjectFileV8;
type MaterializedAsset = { src: string; gifData?: Layer['gifData'] };

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

  const mesh3dLayers: SerializedMesh3d[] = [];
  for (const mesh of doc.mesh3dLayers) {
    const { src, gifData, ...rest } = mesh;
    void gifData;
    mesh3dLayers.push({
      ...rest,
      assetId: src ? await assetIdFor(src, mesh.name) : undefined
    });
  }

  const flythroughAssets: SerializedFlythroughAsset[] = [];
  for (const source of doc.flythroughAssets) {
    const { src, gifData, ...rest } = source;
    void gifData;
    flythroughAssets.push({
      ...rest,
      assetId: await assetIdFor(src, source.name)
    });
  }

  const tunnelAssets: SerializedTunnelAsset[] = [];
  for (const source of doc.tunnelAssets) {
    const { src, gifData, ...rest } = source;
    void gifData;
    tunnelAssets.push({
      ...rest,
      assetId: await assetIdFor(src, source.name)
    });
  }

  const gifVoronoiAssets: SerializedGifVoronoiAsset[] = [];
  for (const source of doc.gifVoronoiAssets) {
    const { src, gifData, ...rest } = source;
    void gifData;
    gifVoronoiAssets.push({
      ...rest,
      assetId: await assetIdFor(src, source.name)
    });
  }

  const serializeLandscapeAsset = async (source: LandscapeAsset): Promise<SerializedLandscapeAsset> => {
    const { src, gifData, ...rest } = source;
    void gifData;
    return { ...rest, assetId: await assetIdFor(src, source.name) };
  };
  const landscapeTerrainAssets = await Promise.all(doc.landscapeTerrainAssets.map(serializeLandscapeAsset));
  const landscapeSkySources: SerializedLandscapeSkySource[] = await Promise.all(doc.landscapeSkySources.map(async source => ({
    ...source,
    assets: await Promise.all(source.assets.map(serializeLandscapeAsset))
  })));

  const ringsAssets = await Promise.all(doc.ringsAssets.map(async source => {
    const { src, gifData, ...rest } = source;
    void gifData;
    return { ...rest, assetId: await assetIdFor(src, source.name) };
  }));

  const underpainting = useStore.getState().polygonUnderpainting;
  let polygonUnderpainting: SerializedPolygonUnderpainting | undefined;
  if (underpainting) {
    const { src, ...rest } = underpainting;
    polygonUnderpainting = { ...rest, assetId: await assetIdFor(src, underpainting.name) };
  }

  // Folder assets dedupe by object URL, so shapes textured from the folder
  // share its embedded copy instead of storing each GIF twice.
  const textureFolder = useStore.getState().polygonTextureFolder;
  let polygonTextureFolder: SerializedPolygonTextureFolder | undefined;
  if (textureFolder) {
    const assets = [];
    for (const { id, name, src } of textureFolder.assets) {
      assets.push({ id, name, assetId: await assetIdFor(src, name) });
    }
    polygonTextureFolder = { name: textureFolder.name, assets };
  }

  const payload: ProjectFileV8 = {
    app: 'slapchop',
    version: 8,
    savedAt: new Date().toISOString(),
    canvasBg: doc.canvasBg,
    masterFx: doc.masterFx,
    layers,
    polygonLayers,
    mesh3dLayers,
    camera3d: doc.camera3d,
    flythroughAssets,
    flythrough: doc.flythrough,
    ringsAssets,
    rings: doc.rings,
    tunnelAssets,
    tunnel: doc.tunnel,
    gifVoronoiAssets,
    gifVoronoi: doc.gifVoronoi,
    landscapeTerrainAssets,
    landscapeSkySources,
    landscape: doc.landscape,
    polygonUnderpainting,
    polygonTextureFolder,
    assets
  };

  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  await saveBlob(blob, `slapchop-${timestamp()}.slapchop`);
}

export async function openProject(file: File): Promise<void> {
  const payload = JSON.parse(await file.text()) as ProjectFile;
  if (payload.app !== 'slapchop' || ![1, 2, 3, 4, 5, 6, 7, 8].includes(payload.version)) {
    throw new Error('Not a recognized slapchop project file.');
  }

  // Materialize each asset once: data URL -> object URL (+ re-parsed GIF data)
  const materialized = new Map<string, MaterializedAsset>();
  for (const [id, asset] of Object.entries(payload.assets)) {
    const blob = await (await fetch(asset.dataUrl)).blob();
    const assetFile = new File([blob], asset.name, { type: asset.type });
    const src = URL.createObjectURL(assetFile);
    const gifData = await parseGifFile(assetFile);
    materialized.set(id, { src, gifData: gifData || undefined });
  }

  const doc = restoreProjectDocument(payload, materialized);
  const underpainting = restorePolygonUnderpainting(payload, materialized);
  const textureFolder = restorePolygonTextureFolder(payload, materialized);
  useStore.getState().loadDocument(doc);
  useStore.getState().setPolygonUnderpainting(underpainting);
  useStore.getState().setPolygonTextureFolder(textureFolder);
  clearHistory();
}

// Pure compatibility boundary: asset I/O happens before this function, while
// persisted mode fields are copied without reinterpretation. Keeping it pure
// makes legacy-format behavior testable as mode UIs begin to diverge.
export function restoreProjectDocument(
  payload: ProjectFile,
  materialized: ReadonlyMap<string, MaterializedAsset> = new Map()
): DocumentState {
  const layers: Layer[] = payload.layers.map((sl) => {
    const { assetId, ...rest } = sl;
    const asset = materialized.get(assetId);
    return { ...rest, src: asset?.src ?? '', gifData: asset?.gifData };
  });

  const polygonLayers: PolygonLayer[] = payload.polygonLayers.map((sp) => {
    const { assetId, ...rest } = sp;
    const asset = assetId ? materialized.get(assetId) : undefined;
    const polygon: PolygonLayer = { ...rest, src: asset?.src, gifData: asset?.gifData };
    if (polygon.brush) polygon.brush = normalizePolygonBrush(polygon.brush, polygon.points.length, DEFAULT_BRUSH_TOOL);
    return polygon;
  });

  // V1 files predate 3D Mesh Mode entirely: no mesh3dLayers key, default camera.
  const mesh3dLayers: Mesh3dLayer[] = payload.version !== 1
    ? payload.mesh3dLayers.map((sm) => {
      const { assetId, ...rest } = sm;
      const asset = assetId ? materialized.get(assetId) : undefined;
      return { ...rest, src: asset?.src, gifData: asset?.gifData };
    })
    : [];

  const camera3d: Camera3dConfig = payload.version !== 1 && payload.camera3d
    ? { ...DEFAULT_CAMERA3D, ...payload.camera3d }
    : { ...DEFAULT_CAMERA3D };

  const masterFx: MasterFxConfig = payload.masterFx
    ? { ...DEFAULT_MASTER_FX, ...payload.masterFx }
    : { ...DEFAULT_MASTER_FX };

  const hasFlythrough = 'flythroughAssets' in payload;
  const flythroughAssets: FlythroughAsset[] = hasFlythrough
    ? payload.flythroughAssets.map((source) => {
      const { assetId, ...rest } = source;
      const asset = materialized.get(assetId);
      return { ...rest, src: asset?.src ?? '', gifData: asset?.gifData };
    })
    : [];

  const flythrough: FlythroughConfig = hasFlythrough && payload.flythrough
    ? { ...DEFAULT_FLYTHROUGH, ...payload.flythrough }
    : { ...DEFAULT_FLYTHROUGH };

  const hasTunnel = 'tunnelAssets' in payload;
  const tunnelAssets: TunnelAsset[] = hasTunnel
    ? payload.tunnelAssets.map((source) => {
      const { assetId, ...rest } = source;
      const asset = materialized.get(assetId);
      return { ...rest, src: asset?.src ?? '', gifData: asset?.gifData };
    })
    : [];

  const tunnel: TunnelConfig = hasTunnel && payload.tunnel
    ? { ...DEFAULT_TUNNEL, ...payload.tunnel, palette: [...(payload.tunnel.palette ?? DEFAULT_TUNNEL.palette)] }
    : { ...DEFAULT_TUNNEL, palette: [...DEFAULT_TUNNEL.palette] };

  const hasGifVoronoi = 'gifVoronoiAssets' in payload;
  const gifVoronoiAssets: GifVoronoiAsset[] = hasGifVoronoi
    ? payload.gifVoronoiAssets.map((source) => {
      const { assetId, ...rest } = source;
      const asset = materialized.get(assetId);
      if (!asset?.gifData) {
        throw new Error(`GIF Voronoi source “${source.name}” could not be decoded.`);
      }
      return { ...rest, src: asset.src, gifData: asset.gifData };
    })
    : [];

  const gifVoronoi: GifVoronoiConfig = hasGifVoronoi && payload.gifVoronoi
    ? { ...DEFAULT_GIF_VORONOI, ...payload.gifVoronoi, palette: [...(payload.gifVoronoi.palette ?? DEFAULT_GIF_VORONOI.palette)] }
    : { ...DEFAULT_GIF_VORONOI, palette: [...DEFAULT_GIF_VORONOI.palette] };

  const materializeLandscapeAsset = (source: SerializedLandscapeAsset): LandscapeAsset => {
    const { assetId, ...rest } = source;
    const asset = materialized.get(assetId);
    if (!asset?.gifData) throw new Error(`Landscape source “${source.name}” could not be decoded.`);
    return { ...rest, src: asset.src, gifData: asset.gifData };
  };
  const landscapeTerrainAssets: LandscapeAsset[] = 'landscapeTerrainAssets' in payload
    ? payload.landscapeTerrainAssets.map(materializeLandscapeAsset)
    : [];
  const landscapeSkySources: LandscapeSkySource[] = 'landscapeTerrainAssets' in payload
    ? payload.landscapeSkySources.map(source => ({
      ...source,
      assets: source.assets.map(materializeLandscapeAsset)
    }))
    : [];
  const landscape: LandscapeConfig = 'landscapeTerrainAssets' in payload && payload.landscape
    ? { ...DEFAULT_LANDSCAPE, ...payload.landscape }
    : { ...DEFAULT_LANDSCAPE };

  const ringsAssets: RingsAsset[] = (payload.version === 7 || payload.version === 8) ? payload.ringsAssets.map(source => {
    const { assetId, ...rest } = source;
    const asset = materialized.get(assetId);
    if (!asset) throw new Error(`GIF Rings source “${source.name}” is missing.`);
    return { ...rest, src: asset.src, gifData: asset.gifData };
  }) : [];

  return {
    ringsAssets,
    rings: normalizeRings(payload.version === 7 || payload.version === 8 ? payload.rings : undefined),
    layers,
    polygonLayers,
    mesh3dLayers,
    camera3d,
    flythroughAssets,
    flythrough,
    tunnelAssets,
    tunnel,
    gifVoronoiAssets,
    gifVoronoi,
    landscapeTerrainAssets,
    landscapeSkySources,
    landscape,
    canvasBg: payload.canvasBg,
    masterFx
  };
}

export function restorePolygonUnderpainting(
  payload: ProjectFile,
  materialized: ReadonlyMap<string, MaterializedAsset> = new Map()
): PolygonUnderpainting | null {
  if ((payload.version !== 7 && payload.version !== 8) || !payload.polygonUnderpainting) return null;
  const { assetId, ...rest } = payload.polygonUnderpainting;
  const asset = materialized.get(assetId);
  if (!asset) throw new Error(`Tiled GIF underpainting “${rest.name}” is missing from the project file.`);
  return {
    ...rest,
    src: asset.src,
    visible: rest.visible !== false,
    opacity: Number.isFinite(rest.opacity) ? Math.min(1, Math.max(0, rest.opacity)) : 0.5
  };
}

export function restorePolygonTextureFolder(
  payload: ProjectFile,
  materialized: ReadonlyMap<string, MaterializedAsset> = new Map()
): PolygonTextureFolder | null {
  if (payload.version !== 8 || !payload.polygonTextureFolder) return null;
  const { name, assets } = payload.polygonTextureFolder;
  const restored = assets.map(({ id, name: assetName, assetId }) => {
    const asset = materialized.get(assetId);
    if (!asset) throw new Error(`Tiled GIF folder texture “${assetName}” is missing from the project file.`);
    return { id, name: assetName, src: asset.src, gifData: asset.gifData };
  });
  return restored.length > 0 ? { name, assets: restored } : null;
}
