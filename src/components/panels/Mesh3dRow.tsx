import { ChangeEvent, useRef } from 'react';
import { Mesh3dLayer } from '../../types';
import { Trash2, GripVertical, Eye, EyeOff, Copy, Image as ImageIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { MESH3D_PRIMITIVE_EMOJI } from '../../lib/mesh3dUtils';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export default function Mesh3dRow({ mesh, selectedMesh3dId, onSelectMesh3d, onUpdateMesh3d, onDeleteMesh3d, onDuplicateMesh3d, onUploadTexture }: {
  key?: string,
  mesh: Mesh3dLayer,
  selectedMesh3dId: string | null,
  onSelectMesh3d: (id: string) => void,
  onUpdateMesh3d?: (id: string, updates: Partial<Mesh3dLayer>) => void,
  onDeleteMesh3d: (id: string) => void,
  onDuplicateMesh3d?: (id: string) => void,
  // Selects this mesh, then applies the chosen file to it — mirrors the
  // store's own "apply to selection, else create" uploadMesh3dTexture
  // convention, just scoped to a specific row instead of the current
  // selection at click time.
  onUploadTexture?: (id: string, file: File) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: mesh.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleTextureChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file && onUploadTexture) onUploadTexture(mesh.id, file);
  };

  return (
    <div
      ref={setNodeRef} style={style}
      onClick={() => onSelectMesh3d(mesh.id)}
      className={cn(
        "flex items-center gap-2 p-1.5 rounded cursor-pointer group transition-colors",
        mesh.hidden ? "opacity-50 grayscale" : "",
        selectedMesh3dId === mesh.id ? "bg-ui-accent/10 border border-ui-accent" : "hover:bg-ui-surface border border-transparent"
      )}
    >
       <div {...attributes} {...listeners} className="p-0.5 cursor-grab active:cursor-grabbing text-ui-text-subtle hover:text-ui-text">
         <GripVertical className="w-3.5 h-3.5" />
       </div>
       <div className="w-8 h-8 rounded-sm overflow-hidden bg-black/50 shrink-0 border border-ui-border flex items-center justify-center text-base">
         {mesh.src ? (
           <img src={mesh.src} className="w-full h-full object-cover" />
         ) : (
           <span>{MESH3D_PRIMITIVE_EMOJI[mesh.primitive]}</span>
         )}
       </div>
       <div className="flex-1 min-w-0 pl-1">
         <div className="text-[13px] font-medium text-ui-text truncate">{mesh.name}</div>
         <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide bg-ui-surface border border-ui-border text-ui-text-muted">
           {mesh.primitive}
         </span>
       </div>

       {/* Visibility, texture upload, and duplicate stay visible at all times
           so a hidden or textureless mesh is identifiable at a glance; only
           the destructive delete waits for hover to reduce accidental clicks. */}
       <div className="flex items-center gap-0.5 shrink-0">
         {onUploadTexture && (
           <>
             <button
               onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
               className="p-1 rounded text-ui-text-muted hover:text-ui-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
               title="Upload Texture / GIF"
             >
               <ImageIcon className="w-3.5 h-3.5" />
             </button>
             <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleTextureChange} />
           </>
         )}
         {onUpdateMesh3d && (
           <button
             onClick={(e) => { e.stopPropagation(); onUpdateMesh3d(mesh.id, { hidden: !mesh.hidden }); }}
             className="p-1 rounded text-ui-text-muted hover:text-ui-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
             title={mesh.hidden ? "Show Mesh" : "Hide Mesh"}
           >
             {mesh.hidden ? <EyeOff className="w-3.5 h-3.5 text-amber-400" /> : <Eye className="w-3.5 h-3.5" />}
           </button>
         )}
         {onDuplicateMesh3d && (
           <button
             onClick={(e) => { e.stopPropagation(); onDuplicateMesh3d(mesh.id); }}
             className="p-1 rounded text-ui-text-muted hover:text-ui-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
             title="Duplicate Mesh"
           >
             <Copy className="w-3.5 h-3.5" />
           </button>
         )}
         <button
           onClick={(e) => { e.stopPropagation(); onDeleteMesh3d(mesh.id); }}
           className="p-1 rounded text-ui-text-muted hover:text-red-400 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
           title="Delete Mesh"
         >
           <Trash2 className="w-3.5 h-3.5" />
         </button>
       </div>
    </div>
  );
}
