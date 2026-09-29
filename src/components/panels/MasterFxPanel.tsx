import ControlSection from '../controls/ControlSection';
import { RotateCcw } from 'lucide-react';
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

  return (
    <ControlSection sectionKey="fx-master" title={<span className="text-ui-creative-text">Master FX &amp; Shaders</span>} defaultOpen={false} actions={<Toggle checked={masterFx.enabled} onChange={(enabled) => onUpdateFx({ enabled })} title={masterFx.enabled ? "Disable Master FX" : "Enable Master FX"} />} className="bg-ui-canvas/40">

      {/* Expanded Controls */}

        <div className="space-y-2">
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
          <ControlSection sectionKey="fx-color" title="Color Grading" defaultOpen={false} actions={<input aria-label="Enable Color Grading"
                  type="checkbox"
                  checked={masterFx.colorAdjustEnabled}
                  onChange={(e) => { e.stopPropagation(); onUpdateFx({ colorAdjustEnabled: e.target.checked }); }}
                  className="rounded border-ui-border-strong bg-ui-canvas accent-ui-accent w-3.5 h-3.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
                />} className="bg-ui-canvas/40">

              <div className="space-y-2">
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

          </ControlSection>

          {/* Module 2: Chromatic Aberration / RGB Split */}
          <ControlSection sectionKey="fx-rgb" title="Chromatic Aberration (RGB Split)" defaultOpen={false} actions={<input aria-label="Enable Chromatic Aberration (RGB Split)"
                  type="checkbox"
                  checked={masterFx.rgbSplitEnabled}
                  onChange={(e) => { e.stopPropagation(); onUpdateFx({ rgbSplitEnabled: e.target.checked }); }}
                  className="rounded border-ui-border-strong bg-ui-canvas accent-ui-accent w-3.5 h-3.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
                />} className="bg-ui-canvas/40">

              <div className="space-y-2">
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

          </ControlSection>

          {/* Module 3: Duotone / Gradient Map */}
          <ControlSection sectionKey="fx-duotone" title="Duotone / Gradient Map" defaultOpen={false} actions={<input aria-label="Enable Duotone / Gradient Map"
                  type="checkbox"
                  checked={masterFx.duotoneEnabled}
                  onChange={(e) => { e.stopPropagation(); onUpdateFx({ duotoneEnabled: e.target.checked }); }}
                  className="rounded border-ui-border-strong bg-ui-canvas accent-ui-accent w-3.5 h-3.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
                />} className="bg-ui-canvas/40">

              <div className="space-y-2">
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

          </ControlSection>

          {/* Module 4: CRT Scanlines */}
          <ControlSection sectionKey="fx-scanlines" title="CRT Scanlines" defaultOpen={false} actions={<input aria-label="Enable CRT Scanlines"
                  type="checkbox"
                  checked={masterFx.scanlinesEnabled}
                  onChange={(e) => { e.stopPropagation(); onUpdateFx({ scanlinesEnabled: e.target.checked }); }}
                  className="rounded border-ui-border-strong bg-ui-canvas accent-ui-accent w-3.5 h-3.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
                />} className="bg-ui-canvas/40">

              <div className="space-y-2">
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

          </ControlSection>

          {/* Module 5: Film Grain & Noise */}
          <ControlSection sectionKey="fx-noise" title="Film Grain & Noise" defaultOpen={false} actions={<input aria-label="Enable Film Grain & Noise"
                  type="checkbox"
                  checked={masterFx.noiseEnabled}
                  onChange={(e) => { e.stopPropagation(); onUpdateFx({ noiseEnabled: e.target.checked }); }}
                  className="rounded border-ui-border-strong bg-ui-canvas accent-ui-accent w-3.5 h-3.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
                />} className="bg-ui-canvas/40">

              <div className="space-y-2">
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

          </ControlSection>

          {/* Module 6: Bloom & Soft Glow */}
          <ControlSection sectionKey="fx-bloom" title="Bloom & Soft Glow" defaultOpen={false} actions={<input aria-label="Enable Bloom & Soft Glow"
                  type="checkbox"
                  checked={masterFx.bloomEnabled}
                  onChange={(e) => { e.stopPropagation(); onUpdateFx({ bloomEnabled: e.target.checked }); }}
                  className="rounded border-ui-border-strong bg-ui-canvas accent-ui-accent w-3.5 h-3.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
                />} className="bg-ui-canvas/40">

              <div className="space-y-2">
                <Slider
                  size="sm"
                  label="Glow Radius"
                  display={masterFx.bloomStrength.toFixed(1)}
                  value={masterFx.bloomStrength}
                  min={1} max={15} step={0.5}
                  onChange={(bloomStrength) => onUpdateFx({ bloomStrength })}
                />
              </div>

          </ControlSection>
        </div>

    </ControlSection>
  );
}
