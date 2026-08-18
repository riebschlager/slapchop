import { Clapperboard, Download, Film, Loader2, Repeat, Video, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { isNative } from '../../lib/native';
import { supportsWebCodecs } from '../../lib/videoExport';
import { ExportApi, ExportType } from '../../hooks/useExport';

export default function ExportModal({ api }: { api: ExportApi }) {
  const {
    exportType, setExportType,
    exportResolution, setExportResolution,
    exportFormat, setExportFormat,
    exportDuration, setExportDuration,
    exportFps, setExportFps,
    exportJob,
    cancelExport,
    startExport
  } = api;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 text-gray-100 shadow-2xl relative">
        <button
          onClick={cancelExport}
          className="absolute top-4 right-4 text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-lg font-bold text-white mb-1">Export Animation</h3>
        <p className="text-xs text-gray-400 mb-5">Export sequence frames or video file for social media</p>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">Export Format</label>
            <div className="grid grid-cols-2 gap-2 p-1 bg-gray-950 rounded-lg border border-gray-800">
              {([
                { id: 'mp4', label: 'MP4 (H.264)', Icon: Film },
                { id: 'webm', label: 'WebM (VP9)', Icon: Video },
                ...(isNative() ? [{ id: 'prores', label: 'ProRes 4444', Icon: Clapperboard }] : []),
                { id: 'gif', label: 'Animated GIF', Icon: Repeat },
                { id: 'zip', label: 'Frames (ZIP)', Icon: Download }
              ] as { id: ExportType; label: string; Icon: typeof Film }[]).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  onClick={() => setExportType(id)}
                  className={cn(
                    "py-2 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-2",
                    exportType === id ? "bg-indigo-600 text-white shadow" : "text-gray-400 hover:text-white"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>
            {(exportType === 'mp4' || exportType === 'webm') && !supportsWebCodecs() && (
              <p className="text-[10px] text-amber-400/90 mt-1.5">
                WebCodecs is unavailable in this browser — video will be recorded in real time as WebM.
              </p>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">Resolution</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'full', label: '1080x1920', sub: 'Full 1080p' },
                { id: 'hd', label: '720x1280', sub: 'HD Ready' },
                { id: 'compact', label: '540x960', sub: 'Compact' }
              ].map((res) => (
                <button
                  key={res.id}
                  onClick={() => setExportResolution(res.id as 'full' | 'hd' | 'compact')}
                  className={cn(
                    "p-2 rounded-lg border text-left transition-colors",
                    exportResolution === res.id
                      ? "bg-indigo-950/50 border-indigo-500 text-white"
                      : "bg-gray-950/50 border-gray-800 text-gray-400 hover:border-gray-700"
                  )}
                >
                  <div className="text-xs font-semibold">{res.label}</div>
                  <div className="text-[10px] text-gray-500">{res.sub}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-1">Duration (Sec)</label>
              <input
                type="number"
                min="1"
                max="10"
                value={exportDuration}
                onChange={(e) => setExportDuration(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-1.5 text-xs text-white"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-1">FPS</label>
              <select
                value={exportFps}
                onChange={(e) => setExportFps(parseInt(e.target.value))}
                className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-1.5 text-xs text-white"
              >
                <option value={15}>15 FPS</option>
                <option value={30}>30 FPS</option>
                <option value={60}>60 FPS</option>
              </select>
            </div>
          </div>

          {exportType === 'zip' && (
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">Image File Format</label>
              <div className="flex items-center gap-4 text-xs">
                <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
                  <input
                    type="radio"
                    name="format"
                    value="png"
                    checked={exportFormat === 'png'}
                    onChange={() => setExportFormat('png')}
                    className="accent-indigo-500"
                  />
                  PNG (Lossless)
                </label>
                <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
                  <input
                    type="radio"
                    name="format"
                    value="jpeg"
                    checked={exportFormat === 'jpeg'}
                    onChange={() => setExportFormat('jpeg')}
                    className="accent-indigo-500"
                  />
                  JPEG (Smaller ZIP)
                </label>
              </div>
            </div>
          )}

          {/* Exporting Progress bar */}
          {exportJob && (
            <div className="p-3 bg-gray-950 rounded-lg border border-gray-800 space-y-2">
              <div className="flex justify-between text-xs text-gray-300">
                <span>{exportJob.label}</span>
                <span>{Math.round(exportJob.percent)}%</span>
              </div>
              <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 transition-all duration-150"
                  style={{ width: `${exportJob.percent}%` }}
                />
              </div>
            </div>
          )}

          <div className="pt-3 border-t border-gray-800 flex justify-end gap-2">
            <button
              onClick={cancelExport}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={startExport}
              disabled={exportJob !== null}
              className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-lg text-xs shadow-lg shadow-indigo-600/20 transition-all"
            >
              {exportJob !== null && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Start Export
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
