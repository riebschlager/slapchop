import { useState } from 'react';
import { ChevronUp, ChevronDown, Wand2, RotateCcw } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useStore } from '../../store';
import { FX_PRESETS } from '../../lib/fxPresets';
import { formatRate } from '../../lib/sliderScale';
import MotionControl from '../controls/MotionControl';
import Slider from '../controls/Slider';
import Toggle from '../controls/Toggle';

export default function MasterFxPanel() {
  const masterFx = useStore(s => s.masterFx);
  const onUpdateFx = useStore(s => s.updateMasterFx);
  const onApplyPreset = useStore(s => s.applyFxPreset);
  const onResetFx = useStore(s => s.resetMasterFx);

  const [isExpanded, setIsExpanded] = useState(false);
  const [openSection, setOpenSection] = useState<'color' | 'rgb' | 'duotone' | 'scanlines' | 'noise' | 'bloom' | null>(null);

  const toggleSection = (section: 'color' | 'rgb' | 'duotone' | 'scanlines' | 'noise' | 'bloom') => {
    setOpenSection(openSection === section ? null : section);
  };

  return (
    <div className="border-b border-ui-border bg-ui-canvas/40">
      {/* Header Bar */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-ui-surface transition-colors select-none"
      >
        <div className="flex items-center gap-2">
          <Wand2 className={cn("w-4 h-4 transition-colors", masterFx.enabled ? "text-ui-creative-text" : "text-ui-text-subtle")} />
          <span className="text-xs font-semibold text-ui-text uppercase tracking-wider">Master FX &amp; Shaders</span>
        </div>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {/* Master Enable/Disable Toggle Switch */}
          <Toggle
            checked={masterFx.enabled}
            onChange={(enabled) => onUpdateFx({ enabled })}
            title={masterFx.enabled ? "Disable Master FX" : "Enable Master FX"}
          />
          <button 
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-ui-text-muted hover:text-ui-text p-0.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
          >
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Expanded Controls */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-1 space-y-3">
          {/* Presets */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-bold text-ui-creative-text uppercase tracking-wider">Aesthetic Presets</label>
              <button
                onClick={() => onResetFx()}
                className="text-[10px] text-ui-text-subtle hover:text-ui-text flex items-center gap-1 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
                title="Reset all FX to default"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                Reset
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {FX_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => onApplyPreset(preset.config)}
                  className="text-[10px] px-2 py-1 bg-ui-surface hover:bg-ui-surface-raised hover:border-ui-creative hover:text-ui-creative-text text-ui-text-muted rounded border border-ui-border transition-colors font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
                  title={preset.description}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* Module 1: Color Grading */}
          <div className="border border-ui-border rounded-md overflow-hidden bg-ui-surface">
            <div 
              onClick={() => toggleSection('color')}
              className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-ui-surface-raised select-none"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={masterFx.colorAdjustEnabled}
                  onChange={(e) => { e.stopPropagation(); onUpdateFx({ colorAdjustEnabled: e.target.checked }); }}
                  className="rounded border-ui-border-strong bg-ui-canvas accent-ui-accent w-3.5 h-3.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
                />
                <span className="text-xs font-medium text-ui-text">Color Grading</span>
              </div>
              <ChevronDown className={cn("w-3.5 h-3.5 text-ui-text-muted transition-transform", openSection === 'color' && "rotate-180")} />
            </div>

            {openSection === 'color' && (
              <div className="p-3 pt-1 space-y-2 border-t border-ui-border bg-ui-canvas/40">
                <Slider
                  size="sm"
                  label="Contrast"
                  display={masterFx.contrast > 0 ? `+${(masterFx.contrast * 100).toFixed(0)}%` : `${(masterFx.contrast * 100).toFixed(0)}%`}
                  value={masterFx.contrast}
                  min={-1} max={1} step={0.05}
                  onChange={(contrast) => onUpdateFx({ contrast })}
                />

                <Slider
                  size="sm"
                  label="Saturation"
                  display={masterFx.saturation > 0 ? `+${(masterFx.saturation * 100).toFixed(0)}%` : `${(masterFx.saturation * 100).toFixed(0)}%`}
                  value={masterFx.saturation}
                  min={-1} max={1} step={0.05}
                  onChange={(saturation) => onUpdateFx({ saturation })}
                />

                <Slider
                  size="sm"
                  label="Brightness"
                  display={masterFx.brightness > 0 ? `+${(masterFx.brightness * 100).toFixed(0)}%` : `${(masterFx.brightness * 100).toFixed(0)}%`}
                  value={masterFx.brightness}
                  min={-0.8} max={0.8} step={0.05}
                  onChange={(brightness) => onUpdateFx({ brightness })}
                />

                <Slider
                  size="sm"
                  label="Hue Rotation"
                  display={`${masterFx.hueRotate.toFixed(0)}°`}
                  value={masterFx.hueRotate}
                  min={0} max={360} step={1}
                  onChange={(hueRotate) => onUpdateFx({ hueRotate })}
                />

                <MotionControl
                  label="Hue Motion Modulation"
                  config={masterFx.motionHueRotate}
                  onChange={(c) => onUpdateFx({ motionHueRotate: c })}
                  maxAmplitude={180}
                  stepAmplitude={5}
                />
              </div>
            )}
          </div>

          {/* Module 2: Chromatic Aberration / RGB Split */}
          <div className="border border-ui-border rounded-md overflow-hidden bg-ui-surface">
            <div 
              onClick={() => toggleSection('rgb')}
              className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-ui-surface-raised select-none"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={masterFx.rgbSplitEnabled}
                  onChange={(e) => { e.stopPropagation(); onUpdateFx({ rgbSplitEnabled: e.target.checked }); }}
                  className="rounded border-ui-border-strong bg-ui-canvas accent-ui-accent w-3.5 h-3.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
                />
                <span className="text-xs font-medium text-ui-text">Chromatic Aberration (RGB Split)</span>
              </div>
              <ChevronDown className={cn("w-3.5 h-3.5 text-ui-text-muted transition-transform", openSection === 'rgb' && "rotate-180")} />
            </div>

            {openSection === 'rgb' && (
              <div className="p-3 pt-1 space-y-2 border-t border-ui-border bg-ui-canvas/40">
                <Slider
                  size="sm"
                  label="Shift Distance"
                  display={`${masterFx.rgbSplitOffset.toFixed(0)} px`}
                  value={masterFx.rgbSplitOffset}
                  min={0} max={50} step={1}
                  onChange={(rgbSplitOffset) => onUpdateFx({ rgbSplitOffset })}
                />

                <Slider
                  size="sm"
                  label="Shift Angle"
                  display={`${masterFx.rgbSplitAngle.toFixed(0)}°`}
                  value={masterFx.rgbSplitAngle}
                  min={0} max={360} step={5}
                  onChange={(rgbSplitAngle) => onUpdateFx({ rgbSplitAngle })}
                />

                <MotionControl
                  label="Distance Motion Modulation"
                  config={masterFx.motionRgbSplitOffset}
                  onChange={(c) => onUpdateFx({ motionRgbSplitOffset: c })}
                  maxAmplitude={30}
                  stepAmplitude={1}
                />
              </div>
            )}
          </div>

          {/* Module 3: Duotone / Gradient Map */}
          <div className="border border-ui-border rounded-md overflow-hidden bg-ui-surface">
            <div 
              onClick={() => toggleSection('duotone')}
              className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-ui-surface-raised select-none"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={masterFx.duotoneEnabled}
                  onChange={(e) => { e.stopPropagation(); onUpdateFx({ duotoneEnabled: e.target.checked }); }}
                  className="rounded border-ui-border-strong bg-ui-canvas accent-ui-accent w-3.5 h-3.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
                />
                <span className="text-xs font-medium text-ui-text">Duotone / Gradient Map</span>
              </div>
              <ChevronDown className={cn("w-3.5 h-3.5 text-ui-text-muted transition-transform", openSection === 'duotone' && "rotate-180")} />
            </div>

            {openSection === 'duotone' && (
              <div className="p-3 pt-1 space-y-2 border-t border-ui-border bg-ui-canvas/40">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-ui-text-muted block mb-1">Shadow Color</label>
                    <div className="flex items-center gap-1.5 bg-ui-canvas border border-ui-border rounded p-1">
                      <input
                        type="color"
                        value={masterFx.duotoneShadowColor}
                        onChange={(e) => onUpdateFx({ duotoneShadowColor: e.target.value })}
                        className="w-6 h-5 rounded cursor-pointer border-0 bg-transparent p-0"
                      />
                      <span className="text-[10px] font-mono text-ui-text">{masterFx.duotoneShadowColor}</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-ui-text-muted block mb-1">Highlight Color</label>
                    <div className="flex items-center gap-1.5 bg-ui-canvas border border-ui-border rounded p-1">
                      <input
                        type="color"
                        value={masterFx.duotoneHighlightColor}
                        onChange={(e) => onUpdateFx({ duotoneHighlightColor: e.target.value })}
                        className="w-6 h-5 rounded cursor-pointer border-0 bg-transparent p-0"
                      />
                      <span className="text-[10px] font-mono text-ui-text">{masterFx.duotoneHighlightColor}</span>
                    </div>
                  </div>
                </div>

                <Slider
                  size="sm"
                  label="Blend Intensity"
                  display={`${(masterFx.duotoneIntensity * 100).toFixed(0)}%`}
                  value={masterFx.duotoneIntensity}
                  min={0} max={1} step={0.05}
                  onChange={(duotoneIntensity) => onUpdateFx({ duotoneIntensity })}
                />
              </div>
            )}
          </div>

          {/* Module 4: CRT Scanlines */}
          <div className="border border-ui-border rounded-md overflow-hidden bg-ui-surface">
            <div 
              onClick={() => toggleSection('scanlines')}
              className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-ui-surface-raised select-none"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={masterFx.scanlinesEnabled}
                  onChange={(e) => { e.stopPropagation(); onUpdateFx({ scanlinesEnabled: e.target.checked }); }}
                  className="rounded border-ui-border-strong bg-ui-canvas accent-ui-accent w-3.5 h-3.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
                />
                <span className="text-xs font-medium text-ui-text">CRT Scanlines</span>
              </div>
              <ChevronDown className={cn("w-3.5 h-3.5 text-ui-text-muted transition-transform", openSection === 'scanlines' && "rotate-180")} />
            </div>

            {openSection === 'scanlines' && (
              <div className="p-3 pt-1 space-y-2 border-t border-ui-border bg-ui-canvas/40">
                <Slider
                  size="sm"
                  label="Line Count"
                  value={masterFx.scanlinesCount}
                  min={80} max={720} step={20}
                  onChange={(scanlinesCount) => onUpdateFx({ scanlinesCount })}
                />

                <Slider
                  size="sm"
                  label="Line Opacity"
                  display={`${(masterFx.scanlinesOpacity * 100).toFixed(0)}%`}
                  value={masterFx.scanlinesOpacity}
                  min={0} max={1} step={0.05}
                  onChange={(scanlinesOpacity) => onUpdateFx({ scanlinesOpacity })}
                />

                <Slider
                  size="sm"
                  label="Roll Speed"
                  display={`${formatRate(masterFx.scanlinesSpeed)}x`}
                  value={masterFx.scanlinesSpeed}
                  min={0} max={3} step={0.001}
                  scale="log" minPositive={0.001}
                  onChange={(scanlinesSpeed) => onUpdateFx({ scanlinesSpeed })}
                />
              </div>
            )}
          </div>

          {/* Module 5: Film Grain & Noise */}
          <div className="border border-ui-border rounded-md overflow-hidden bg-ui-surface">
            <div 
              onClick={() => toggleSection('noise')}
              className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-ui-surface-raised select-none"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={masterFx.noiseEnabled}
                  onChange={(e) => { e.stopPropagation(); onUpdateFx({ noiseEnabled: e.target.checked }); }}
                  className="rounded border-ui-border-strong bg-ui-canvas accent-ui-accent w-3.5 h-3.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
                />
                <span className="text-xs font-medium text-ui-text">Film Grain & Noise</span>
              </div>
              <ChevronDown className={cn("w-3.5 h-3.5 text-ui-text-muted transition-transform", openSection === 'noise' && "rotate-180")} />
            </div>

            {openSection === 'noise' && (
              <div className="p-3 pt-1 space-y-2 border-t border-ui-border bg-ui-canvas/40">
                <Slider
                  size="sm"
                  label="Noise Intensity"
                  display={`${(masterFx.noiseAmount * 100).toFixed(0)}%`}
                  value={masterFx.noiseAmount}
                  min={0.02} max={0.5} step={0.02}
                  onChange={(noiseAmount) => onUpdateFx({ noiseAmount })}
                />

                <Slider
                  size="sm"
                  label="Animation Speed"
                  display={`${formatRate(masterFx.noiseSpeed)}x`}
                  value={masterFx.noiseSpeed}
                  min={0} max={5} step={0.001}
                  scale="log" minPositive={0.001}
                  onChange={(noiseSpeed) => onUpdateFx({ noiseSpeed })}
                />
              </div>
            )}
          </div>

          {/* Module 6: Bloom & Soft Glow */}
          <div className="border border-ui-border rounded-md overflow-hidden bg-ui-surface">
            <div 
              onClick={() => toggleSection('bloom')}
              className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-ui-surface-raised select-none"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={masterFx.bloomEnabled}
                  onChange={(e) => { e.stopPropagation(); onUpdateFx({ bloomEnabled: e.target.checked }); }}
                  className="rounded border-ui-border-strong bg-ui-canvas accent-ui-accent w-3.5 h-3.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
                />
                <span className="text-xs font-medium text-ui-text">Bloom & Soft Glow</span>
              </div>
              <ChevronDown className={cn("w-3.5 h-3.5 text-ui-text-muted transition-transform", openSection === 'bloom' && "rotate-180")} />
            </div>

            {openSection === 'bloom' && (
              <div className="p-3 pt-1 space-y-2 border-t border-ui-border bg-ui-canvas/40">
                <Slider
                  size="sm"
                  label="Glow Radius"
                  display={masterFx.bloomStrength.toFixed(1)}
                  value={masterFx.bloomStrength}
                  min={1} max={15} step={0.5}
                  onChange={(bloomStrength) => onUpdateFx({ bloomStrength })}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
