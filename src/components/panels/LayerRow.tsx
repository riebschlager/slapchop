import { Layer } from '../../types';
import { Trash2, GripVertical, Eye, EyeOff, Copy } from 'lucide-react';
import { cn } from '../../lib/utils';
import { symmetryBadgeLabel } from '../../lib/symmetryLabels';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export default function LayerRow({ layer, selectedLayerId, onSelectLayer, onUpdateLayer, onDeleteLayer, onDuplicateLayer }: { 
  key?: string,
  layer: Layer, 
  selectedLayerId: string | null, 
  onSelectLayer: (id: string) => void, 
  onUpdateLayer?: (id: string, updates: Partial<Layer>) => void,
  onDeleteLayer: (id: string) => void,
  onDuplicateLayer?: (id: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: layer.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div 
      ref={setNodeRef} style={style}
      onClick={() => onSelectLayer(layer.id)}
      className={cn(
        "flex items-center gap-2 p-1.5 rounded cursor-pointer group transition-colors",
        layer.hidden ? "opacity-50 grayscale" : "",
        selectedLayerId === layer.id ? "bg-ui-accent/10 border border-ui-accent" : "hover:bg-ui-surface border border-transparent"
      )}
    >
       <div {...attributes} {...listeners} className="p-0.5 cursor-grab active:cursor-grabbing text-ui-text-subtle hover:text-ui-text">
         <GripVertical className="w-3.5 h-3.5" />
       </div>
       <div className="w-8 h-8 rounded-sm overflow-hidden bg-black/50 shrink-0 border border-ui-border">
         <img src={layer.src} className="w-full h-full object-contain" />
       </div>
       <div className="flex-1 min-w-0 pl-1">
         <div className="text-[13px] font-medium text-ui-text truncate">{layer.name}</div>
         <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide bg-ui-surface border border-ui-border text-ui-text-muted">
           {symmetryBadgeLabel(layer.symmetry)}
         </span>
       </div>

       {/* Visibility and duplicate stay visible at all times so hidden layers
           are identifiable at a glance; only the destructive delete waits for
           hover to reduce accidental clicks. */}
       <div className="flex items-center gap-0.5 shrink-0">
         {onUpdateLayer && (
           <button
             onClick={(e) => { e.stopPropagation(); onUpdateLayer(layer.id, { hidden: !layer.hidden }); }}
             className="p-1 rounded text-ui-text-muted hover:text-ui-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
             title={layer.hidden ? "Show Layer" : "Hide Layer"}
           >
             {layer.hidden ? <EyeOff className="w-3.5 h-3.5 text-amber-400" /> : <Eye className="w-3.5 h-3.5" />}
           </button>
         )}
         {onDuplicateLayer && (
           <button
             onClick={(e) => { e.stopPropagation(); onDuplicateLayer(layer.id); }}
             className="p-1 rounded text-ui-text-muted hover:text-ui-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
             title="Duplicate Layer"
           >
             <Copy className="w-3.5 h-3.5" />
           </button>
         )}
         <button
           onClick={(e) => { e.stopPropagation(); onDeleteLayer(layer.id); }}
           className="p-1 rounded text-ui-text-muted hover:text-red-400 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
           title="Delete Layer"
         >
           <Trash2 className="w-3.5 h-3.5" />
         </button>
       </div>
    </div>
  );
}
