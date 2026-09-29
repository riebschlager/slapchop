import ControlSection from '../../components/controls/ControlSection';
import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, FolderOpen, Plus, X } from 'lucide-react';
import { useStore } from '../../store';
import { isNative, pickGifFiles, pickGifFolder } from '../../lib/native';

const buttonClass = 'rounded border border-ui-border px-2 py-2 text-xs text-ui-text-muted hover:border-ui-accent hover:text-ui-text focus-visible:ring-2 focus-visible:ring-ui-accent disabled:opacity-40';
export default function GridLibrary() {
  const assets = useStore(s => s.gridAssets);
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async (files: File[], replace: boolean) => {
    if (!files.length) return;
    setBusy(true); setError(null);
    try {
      await (replace ? useStore.getState().replaceGridAssets(files) : useStore.getState().addGridAssets(files));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the GIF library.'); }
    finally { setBusy(false); }
  };
  const choose = async (folder: boolean) => {
    if (!isNative()) {
      const input = folder ? folderInput.current : filesInput.current;
      if (folder) input?.setAttribute('webkitdirectory', '');
      input?.click();
      return;
    }
    setError(null);
    try {
      const files = await (folder ? pickGifFolder() : pickGifFiles());
      if (files) await load(files, folder);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open the file picker.'); }
  };
  return <div className="min-h-0 overflow-y-auto space-y-3 p-3">
    <ControlSection sectionKey="grid-sources" title="Sources">
    <button type="button" disabled={busy} onClick={() => void choose(true)} className={`${buttonClass} flex w-full items-center gap-2`}>
      <FolderOpen className="size-4 text-ui-accent" /><span>{busy ? 'Decoding GIFs…' : 'Choose GIF folder'}</span>
    </button>
    <button type="button" disabled={busy} onClick={() => void choose(false)} className={`${buttonClass} flex w-full items-center gap-2`}><Plus className="size-4" />Add GIF files</button>
    <input ref={folderInput} type="file" multiple accept="image/gif,.gif" className="hidden" onChange={e => { void load(Array.from(e.target.files ?? []), true); e.target.value = ''; }} />
    <input ref={filesInput} type="file" multiple accept="image/gif,.gif" className="hidden" onChange={e => { void load(Array.from(e.target.files ?? []), false); e.target.value = ''; }} />
    </ControlSection>
    {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-ui-text-muted">
      <span>Grid sources · {assets.length}</span>
      {assets.length > 0 && <button type="button" disabled={busy} onClick={() => useStore.getState().clearGridAssets()} className="hover:text-red-400 focus-visible:ring-2 focus-visible:ring-ui-accent">Clear</button>}
    </div>
    <p className="text-[10px] leading-relaxed text-ui-text-subtle">Choosing a folder replaces this library. Files start in filename order; use the arrows to rearrange them.</p>
    {assets.map((asset, i) => <div key={asset.id} className="flex items-center gap-2 rounded border border-ui-border bg-ui-surface p-2">
      <img src={asset.src} alt="" className="size-9 rounded object-cover" />
      <span className="min-w-0 flex-1 truncate text-[11px] text-ui-text-muted" title={asset.name}>{asset.name}</span>
      <button type="button" disabled={busy || i === 0} aria-label={`Move ${asset.name} earlier`} className="disabled:opacity-25 focus-visible:ring-2 focus-visible:ring-ui-accent" onClick={() => useStore.getState().reorderGridAssets(asset.id, assets[i - 1].id)}><ArrowUp className="size-3" /></button>
      <button type="button" disabled={busy || i === assets.length - 1} aria-label={`Move ${asset.name} later`} className="disabled:opacity-25 focus-visible:ring-2 focus-visible:ring-ui-accent" onClick={() => useStore.getState().reorderGridAssets(asset.id, assets[i + 1].id)}><ArrowDown className="size-3" /></button>
      <button type="button" disabled={busy} aria-label={`Remove ${asset.name}`} className="hover:text-red-400 focus-visible:ring-2 focus-visible:ring-ui-accent" onClick={() => useStore.getState().removeGridAsset(asset.id)}><X className="size-3" /></button>
    </div>)}
  </div>;
}
