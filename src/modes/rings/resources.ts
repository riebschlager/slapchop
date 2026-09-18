import type { DocumentState } from '../../store';
import type { RingsAsset } from './model';

/** Keep undoable sources alive; release only after all document/history references expire. */
export function createRingsResourceTracker() {
  const tracked = new Set<RingsAsset>();
  return {
    remember(assets: RingsAsset[]) { assets.forEach(asset => tracked.add(asset)); },
    sweep(documents: Partial<DocumentState>[]) {
      const retained = documents.flatMap(doc => [
        ...(doc.ringsAssets ?? []), ...(doc.layers ?? []), ...(doc.polygonLayers ?? []),
        ...(doc.mesh3dLayers ?? []), ...(doc.flythroughAssets ?? []), ...(doc.tunnelAssets ?? []),
        ...(doc.gifVoronoiAssets ?? []), ...(doc.landscapeTerrainAssets ?? []),
        ...(doc.landscapeSkySources ?? []).flatMap(source => source.assets)
      ]);
      const sources = new Set(retained.map(asset => asset.src));
      const gifs = new Set(retained.map(asset => asset.gifData));
      const releasedSources = new Set<string>();
      const releasedGifs = new Set<RingsAsset['gifData']>();
      for (const asset of tracked) {
        if (sources.has(asset.src) || (asset.gifData && gifs.has(asset.gifData))) continue;
        if (asset.src.startsWith('blob:') && !releasedSources.has(asset.src)) {
          URL.revokeObjectURL(asset.src);
          releasedSources.add(asset.src);
        }
        if (asset.gifData && !releasedGifs.has(asset.gifData)) {
          for (const frame of asset.gifData.frames) {
            if ('close' in frame.image) frame.image.close();
          }
          releasedGifs.add(asset.gifData);
        }
        tracked.delete(asset);
      }
    }
  };
}
