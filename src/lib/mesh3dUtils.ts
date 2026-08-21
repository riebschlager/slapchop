import { BlendMode, Mesh3dLayer, Mesh3dPrimitive } from '../types';
import { createPresetPolygonPoints } from './polygonUtils';

// Per-primitive default dimensions, chosen so each preset appears at a
// comparable on-screen scale to the others when dropped into an empty scene.
const PRIMITIVE_DEFAULTS: Record<Mesh3dPrimitive, Partial<Mesh3dLayer>> = {
  plane: { width: 400, height: 400, subdivisionX: 8, subdivisionY: 8 },
  box: { width: 300, height: 300, depth: 300, subdivisionX: 4, subdivisionY: 4 },
  cylinder: { width: 200, height: 400, depth: 200, subdivisionX: 24, subdivisionY: 8 },
  torus: { width: 300, height: 300, depth: 100, subdivisionX: 8, subdivisionY: 24 },
  sphere: { width: 300, height: 300, depth: 300, subdivisionX: 24, subdivisionY: 16 },
  ribbon: { width: 600, height: 80, subdivisionX: 32, subdivisionY: 1 },
  'extruded-polygon': { width: 300, height: 300, depth: 60, subdivisionX: 1, subdivisionY: 1 },
  'custom-mesh': { width: 300, height: 300, depth: 300, subdivisionX: 1, subdivisionY: 1 }
};

/**
 * Creates a new Mesh3dLayer with every required field defaulted, analogous
 * to createNewPolygonLayer. `options` overrides any default, including the
 * per-primitive geometry defaults above.
 */
export function createMesh3dLayer(
  name: string,
  primitive: Mesh3dPrimitive,
  options?: Partial<Mesh3dLayer>
): Mesh3dLayer {
  const primitiveDefaults = PRIMITIVE_DEFAULTS[primitive];
  return {
    id: crypto.randomUUID(),
    name,
    primitive,
    width: 300,
    height: 300,
    depth: 300,
    subdivisionX: 8,
    subdivisionY: 8,
    contour: primitive === 'extruded-polygon' ? createPresetPolygonPoints('hexagon', 150) : undefined,
    uvScale: 1,
    uvRotation: 0,
    uvOffsetX: 0,
    uvOffsetY: 0,
    uvRepeat: false,
    fillColor: '#6366f1',
    wireframe: false,
    wireframeWidth: 1,
    wireframeColor: '#ffffff',
    doubleSided: false,
    depthTest: true,
    blendMode: 'normal' as BlendMode,
    shadingModel: 'smooth',
    x: 0,
    y: 0,
    z: 0,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
    pivotX: 0,
    pivotY: 0,
    pivotZ: 0,
    gifSpeed: 1,
    symmetry3d: 'none',
    radialSegments3d: 6,
    ...primitiveDefaults,
    ...options
  };
}

export function createMesh3dPresetName(primitive: Mesh3dPrimitive, existingCount: number): string {
  const label = primitive === 'extruded-polygon' ? 'Extruded Polygon' : primitive === 'custom-mesh' ? 'Custom Mesh' : primitive;
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} ${existingCount + 1}`;
}

// Shared between StackPanel's "Add Mesh" preset grid and Mesh3dRow's list
// thumbnail, so the two stay visually consistent without importing one
// component from the other.
export const MESH3D_PRIMITIVE_EMOJI: Record<Mesh3dPrimitive, string> = {
  plane: '▭',
  box: '🧊',
  cylinder: '🥫',
  torus: '🍩',
  sphere: '🔮',
  ribbon: '🎀',
  'extruded-polygon': '⬡',
  'custom-mesh': '🧩'
};
