import { Layer } from '../../types';
import { Trash2, GripVertical, Eye, EyeOff, Copy } from 'lucide-react';
import { cn } from '../../lib/utils';
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
        selectedLayerId === layer.id ? "bg-indigo-900/40 border border-indigo-500/50" : "hover:bg-gray-800 border border-transparent"
      )}
    >
       <div {...attributes} {...listeners} className="p-0.5 cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-300">
         <GripVertical className="w-3.5 h-3.5" />
       </div>
       <div className="w-8 h-8 rounded-sm overflow-hidden bg-black/50 shrink-0 border border-gray-700">
         <img src={layer.src} className="w-full h-full object-contain" />
       </div>
       <div className="flex-1 truncate pl-1">
         <div className="text-[13px] font-medium text-gray-200 truncate">{layer.name}</div>
         <div className="text-[10px] text-gray-500">{layer.symmetry.replace('-', ' ')}</div>
       </div>
       
       <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
         {onUpdateLayer && (
           <button 
             onClick={(e) => { e.stopPropagation(); onUpdateLayer(layer.id, { hidden: !layer.hidden }); }}
             className="p-1 hover:text-white text-gray-400"
             title={layer.hidden ? "Show Layer" : "Hide Layer"}
           >
             {layer.hidden ? <EyeOff className="w-3.5 h-3.5 text-amber-400" /> : <Eye className="w-3.5 h-3.5" />}
           </button>
         )}
         {onDuplicateLayer && (
           <button 
             onClick={(e) => { e.stopPropagation(); onDuplicateLayer(layer.id); }}
             className="p-1 hover:text-white text-gray-400"
             title="Duplicate Layer"
           >
             <Copy className="w-3.5 h-3.5" />
           </button>
         )}
         <button onClick={(e) => { e.stopPropagation(); onDeleteLayer(layer.id); }} className="p-1 hover:text-red-400 text-gray-400" title="Delete Layer">
           <Trash2 className="w-3.5 h-3.5" />
         </button>
       </div>
    </div>
  );
}
