import { parseGifFile } from '../../lib/gifUtils';
import type { GridAsset } from './model';

export function releaseGridAssets(assets: GridAsset[]) {
  for (const asset of assets) {
    URL.revokeObjectURL(asset.src);
    for (const frame of asset.gifData.frames) if ('close' in frame.image) frame.image.close();
  }
}
export async function loadGridAssets(files: File[]): Promise<GridAsset[]> {
  const gifs = files.filter(file => /\.gif$/i.test(file.name) || file.type === 'image/gif')
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!gifs.length) throw new Error('This folder contains no GIF files. Choose a folder with animated GIFs.');
  const assets: GridAsset[] = [];
  try {
    for (const file of gifs) {
      const gifData = await parseGifFile(file);
      if (!gifData) throw new Error(`“${file.name}” could not be decoded as an animated GIF.`);
      assets.push({ id: crypto.randomUUID(), name: file.name, src: URL.createObjectURL(file), gifData });
    }
    return assets;
  } catch (error) {
    releaseGridAssets(assets);
    throw error;
  }
}
