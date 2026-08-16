import { MasterFxConfig, DEFAULT_MASTER_FX } from '../types';

export interface FxPreset {
  id: string;
  name: string;
  description: string;
  config: Partial<MasterFxConfig>;
}

export const FX_PRESETS: FxPreset[] = [
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    description: 'Neon split with cyan/magenta duotone and scanlines',
    config: {
      enabled: true,
      rgbSplitEnabled: true,
      rgbSplitOffset: 14,
      rgbSplitAngle: 35,
      motionRgbSplitOffset: undefined,
      duotoneEnabled: true,
      duotoneShadowColor: '#12002b',
      duotoneHighlightColor: '#00f6ff',
      duotoneIntensity: 0.85,
      noiseEnabled: false,
      scanlinesEnabled: true,
      scanlinesCount: 380,
      scanlinesOpacity: 0.25,
      scanlinesSpeed: 0.6,
      bloomEnabled: false,
      colorAdjustEnabled: true,
      contrast: 0.25,
      saturation: 0.3,
      brightness: 0.05,
      hueRotate: 0
    }
  },
  {
    id: 'vhs',
    name: 'VHS Tape',
    description: 'Analog video noise, horizontal chromatic slip, and rolling CRT lines',
    config: {
      enabled: true,
      rgbSplitEnabled: true,
      rgbSplitOffset: 8,
      rgbSplitAngle: 0,
      motionRgbSplitOffset: undefined,
      duotoneEnabled: false,
      noiseEnabled: true,
      noiseAmount: 0.18,
      noiseSpeed: 2.0,
      scanlinesEnabled: true,
      scanlinesCount: 260,
      scanlinesOpacity: 0.32,
      scanlinesSpeed: 1.2,
      bloomEnabled: false,
      colorAdjustEnabled: true,
      contrast: 0.15,
      saturation: -0.1,
      brightness: 0.05,
      hueRotate: 0
    }
  },
  {
    id: 'risograph',
    name: 'Risograph',
    description: 'Deep midnight indigo + hot pink duotone print with paper grain',
    config: {
      enabled: true,
      rgbSplitEnabled: false,
      duotoneEnabled: true,
      duotoneShadowColor: '#181236',
      duotoneHighlightColor: '#ff2d75',
      duotoneIntensity: 1.0,
      noiseEnabled: true,
      noiseAmount: 0.2,
      noiseSpeed: 0.2,
      scanlinesEnabled: false,
      bloomEnabled: false,
      colorAdjustEnabled: true,
      contrast: 0.4,
      saturation: 0.1,
      brightness: 0,
      hueRotate: 0
    }
  },
  {
    id: 'thermal',
    name: 'Thermal IR',
    description: 'High-contrast infrared false-color thermal heatmap',
    config: {
      enabled: true,
      rgbSplitEnabled: false,
      duotoneEnabled: true,
      duotoneShadowColor: '#0b0033',
      duotoneHighlightColor: '#ffbb00',
      duotoneIntensity: 1.0,
      noiseEnabled: false,
      scanlinesEnabled: false,
      bloomEnabled: false,
      colorAdjustEnabled: true,
      contrast: 0.5,
      saturation: 0.4,
      brightness: 0.05,
      hueRotate: 0
    }
  },
  {
    id: 'dreamy',
    name: 'Ethereal Glow',
    description: 'Soft highlight bloom with enhanced vibrant saturation',
    config: {
      enabled: true,
      rgbSplitEnabled: false,
      duotoneEnabled: false,
      noiseEnabled: false,
      scanlinesEnabled: false,
      bloomEnabled: true,
      bloomStrength: 5,
      bloomQuality: 3,
      colorAdjustEnabled: true,
      contrast: 0.1,
      saturation: 0.35,
      brightness: 0.08,
      hueRotate: 0
    }
  },
  {
    id: 'acid',
    name: 'Acid Motion',
    description: 'Pulsing chromatic split with continuous animated hue shift',
    config: {
      enabled: true,
      rgbSplitEnabled: true,
      rgbSplitOffset: 12,
      rgbSplitAngle: 90,
      motionRgbSplitOffset: {
        type: 'sine',
        speed: 1.5,
        amplitude: 15,
        phase: 0
      },
      duotoneEnabled: false,
      noiseEnabled: false,
      scanlinesEnabled: false,
      bloomEnabled: false,
      colorAdjustEnabled: true,
      contrast: 0.2,
      saturation: 0.4,
      brightness: 0,
      hueRotate: 0,
      motionHueRotate: {
        type: 'sine',
        speed: 0.4,
        amplitude: 180,
        phase: 0
      }
    }
  }
];

export function createCleanMasterFx(): MasterFxConfig {
  return { ...DEFAULT_MASTER_FX };
}
