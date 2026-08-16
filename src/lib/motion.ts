import { Layer, MotionConfig } from '../types';

export function applyMotion(baseValue: number, config: MotionConfig | undefined, t: number): number {
  if (!config || config.type === 'none') return baseValue;
  if (config.type === 'sine') {
    return baseValue + Math.sin(t * config.speed * Math.PI * 2 + config.phase) * config.amplitude;
  }
  if (config.type === 'noise') {
    const noise = Math.sin(t * config.speed * 1.5 + config.phase)
                * Math.sin(t * config.speed * 0.8 + config.phase * 1.3)
                * Math.cos(t * config.speed * 2.2 - config.phase);
    return baseValue + noise * config.amplitude;
  }
  return baseValue;
}

export function getModulatedLayer(layer: Layer, t: number): Layer {
  return {
    ...layer,
    x: applyMotion(layer.x, layer.motionX, t),
    y: applyMotion(layer.y, layer.motionY, t),
    rotation: applyMotion(layer.rotation, layer.motionRotation, t),
    scaleX: Math.sign(layer.scaleX || 1) * applyMotion(Math.abs(layer.scaleX), layer.motionScale, t),
    scaleY: Math.sign(layer.scaleY || 1) * applyMotion(Math.abs(layer.scaleY), layer.motionScale, t),
  };
}

export type LayerInstance = Layer & { isPrimary: boolean };

export function getInstances(layer: Layer, t: number): LayerInstance[] {
  const m = getModulatedLayer(layer, t);
  switch (m.symmetry) {
    case 'none':
      return [{ ...m, isPrimary: true }];
    case 'mirror-x':
      return [
        { ...m, isPrimary: true },
        { ...m, x: -m.x, rotation: -m.rotation, scaleX: -m.scaleX, isPrimary: false }
      ];
    case 'mirror-y':
      return [
        { ...m, isPrimary: true },
        { ...m, y: -m.y, rotation: -m.rotation, scaleY: -m.scaleY, isPrimary: false }
      ];
    case 'quad':
      return [
        { ...m, isPrimary: true },
        { ...m, x: -m.x, rotation: -m.rotation, scaleX: -m.scaleX, isPrimary: false },
        { ...m, y: -m.y, rotation: -m.rotation, scaleY: -m.scaleY, isPrimary: false },
        { ...m, x: -m.x, y: -m.y, rotation: m.rotation, scaleX: -m.scaleX, scaleY: -m.scaleY, isPrimary: false }
      ];
    case 'radial': {
      const instances: LayerInstance[] = [];
      const N = Math.max(2, m.radialSegments || 6);
      for (let i = 0; i < N; i++) {
        const angle = i * (2 * Math.PI / N);
        const deg = i * (360 / N);
        const nx = m.x * Math.cos(angle) - m.y * Math.sin(angle);
        const ny = m.x * Math.sin(angle) + m.y * Math.cos(angle);
        instances.push({ ...m, x: nx, y: ny, rotation: m.rotation + deg, isPrimary: i === 0 });
      }
      return instances;
    }
    default:
      return [{ ...m, isPrimary: true }];
  }
}
