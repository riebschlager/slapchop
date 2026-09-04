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
        selectedPolygonId === polygon.id ? "bg-ui-accent/10 border border-ui-accent" : "hover:bg-ui-surface border border-transparent"
      )}
    >
       <div {...attributes} {...listeners} className="p-0.5 cursor-grab active:cursor-grabbing text-ui-text-subtle hover:text-ui-text">
         <GripVertical className="w-3.5 h-3.5" />
       </div>
       <div className="w-8 h-8 rounded-sm overflow-hidden bg-black/50 shrink-0 border border-ui-border flex items-center justify-center">
         {polygon.src ? (
           <img src={polygon.src} className="w-full h-full object-cover" />
         ) : (
           <div className="w-4 h-4 rounded-sm border" style={{ backgroundColor: polygon.fillColor || '#6366f1' }} />
         )}
       </div>
       <div className="flex-1 min-w-0 pl-1">
         <div className="text-[13px] font-medium text-ui-text truncate">{polygon.name}</div>
         <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide bg-ui-surface border border-ui-border text-ui-text-muted">
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
             className="p-1 rounded text-ui-text-muted hover:text-ui-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
             title={polygon.hidden ? "Show Polygon" : "Hide Polygon"}
           >
             {polygon.hidden ? <EyeOff className="w-3.5 h-3.5 text-amber-400" /> : <Eye className="w-3.5 h-3.5" />}
           </button>
         )}
         {onDuplicatePolygon && (
           <button
             onClick={(e) => { e.stopPropagation(); onDuplicatePolygon(polygon.id); }}
             className="p-1 rounded text-ui-text-muted hover:text-ui-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
             title="Duplicate Polygon"
           >
             <Copy className="w-3.5 h-3.5" />
           </button>
         )}
         <button
           onClick={(e) => { e.stopPropagation(); onDeletePolygon(polygon.id); }}
           className="p-1 rounded text-ui-text-muted hover:text-red-400 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
           title="Delete Polygon"
         >
           <Trash2 className="w-3.5 h-3.5" />
         </button>
       </div>
    </div>
  );
}
