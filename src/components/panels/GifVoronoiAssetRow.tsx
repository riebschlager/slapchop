import { GripVertical, Trash2 } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GifVoronoiAsset } from '../../types';

export default function GifVoronoiAssetRow({
  asset,
  index,
  onRemove
}: {
  key?: string;
  asset: GifVoronoiAsset;
  index: number;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: asset.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="group flex items-center gap-2 rounded-md border border-transparent p-1.5 hover:border-emerald-900/70 hover:bg-emerald-950/20"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab p-0.5 text-gray-700 hover:text-lime-300 active:cursor-grabbing"
        aria-label={`Reorder ${asset.name}`}
      >
        <GripVertical className="size-3.5" />
      </button>
      <div className="relative size-10 shrink-0 overflow-hidden rounded-sm bg-black ring-1 ring-emerald-950">
        <img src={asset.src} alt="" className="size-full object-cover" />
        <span className="absolute bottom-0 right-0 bg-black/85 px-1 font-mono text-[8px] text-lime-300">
          {String(index + 1).padStart(2, '0')}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] text-gray-200" title={asset.name}>{asset.name}</div>
        <div className="mt-0.5 font-mono text-[9px] text-emerald-900">
          GIF · {asset.width}×{asset.height}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onRemove(asset.id)}
        className="p-1 text-gray-600 opacity-0 transition-all hover:text-red-300 group-hover:opacity-100 focus:opacity-100"
        title={`Remove ${asset.name}`}
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}
