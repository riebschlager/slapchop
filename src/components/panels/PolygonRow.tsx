import { PolygonLayer } from '../../types';
import { Trash2, GripVertical, Eye, EyeOff, Copy } from 'lucide-react';
import { cn } from '../../lib/utils';
import { symmetryBadgeLabel } from '../../lib/symmetryLabels';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export default function PolygonRow({ polygon, selectedPolygonId, onSelectPolygon, onUpdatePolygon, onDeletePolygon, onDuplicatePolygon }: { 
  key?: string,
  polygon: PolygonLayer, 
  selectedPolygonId: string | null, 
  onSelectPolygon: (id: string) => void, 
  onUpdatePolygon?: (id: string, updates: Partial<PolygonLayer>) => void,
  onDeletePolygon: (id: string) => void,
  onDuplicatePolygon?: (id: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: polygon.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div 
      ref={setNodeRef} style={style}
      onClick={() => onSelectPolygon(polygon.id)}
      className={cn(
        "flex items-center gap-2 p-1.5 rounded cursor-pointer group transition-colors",
        polygon.hidden ? "opacity-50 grayscale" : "",
        selectedPolygonId === polygon.id ? "bg-indigo-900/40 border border-indigo-500/50" : "hover:bg-gray-800 border border-transparent"
      )}
    >
       <div {...attributes} {...listeners} className="p-0.5 cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-300">
         <GripVertical className="w-3.5 h-3.5" />
       </div>
       <div className="w-8 h-8 rounded-sm overflow-hidden bg-black/50 shrink-0 border border-gray-700 flex items-center justify-center">
         {polygon.src ? (
           <img src={polygon.src} className="w-full h-full object-cover" />
         ) : (
           <div className="w-4 h-4 rounded-sm border" style={{ backgroundColor: polygon.fillColor || '#6366f1' }} />
         )}
       </div>
       <div className="flex-1 min-w-0 pl-1">
         <div className="text-[13px] font-medium text-gray-200 truncate">{polygon.name}</div>
         <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide bg-gray-800 border border-gray-700 text-gray-400">
           {symmetryBadgeLabel(polygon.symmetry)}
         </span>
       </div>

       {/* Visibility and duplicate stay visible at all times so hidden polygons
           are identifiable at a glance; only the destructive delete waits for
           hover to reduce accidental clicks. */}
       <div className="flex items-center gap-0.5 shrink-0">
         {onUpdatePolygon && (
           <button
             onClick={(e) => { e.stopPropagation(); onUpdatePolygon(polygon.id, { hidden: !polygon.hidden }); }}
             className="p-1 hover:text-white text-gray-400"
             title={polygon.hidden ? "Show Polygon" : "Hide Polygon"}
           >
             {polygon.hidden ? <EyeOff className="w-3.5 h-3.5 text-amber-400" /> : <Eye className="w-3.5 h-3.5" />}
           </button>
         )}
         {onDuplicatePolygon && (
           <button
             onClick={(e) => { e.stopPropagation(); onDuplicatePolygon(polygon.id); }}
             className="p-1 hover:text-white text-gray-400"
             title="Duplicate Polygon"
           >
             <Copy className="w-3.5 h-3.5" />
           </button>
         )}
         <button
           onClick={(e) => { e.stopPropagation(); onDeletePolygon(polygon.id); }}
           className="p-1 hover:text-red-400 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity"
           title="Delete Polygon"
         >
           <Trash2 className="w-3.5 h-3.5" />
         </button>
       </div>
    </div>
  );
}
