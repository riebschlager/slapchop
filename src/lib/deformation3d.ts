import {
  Mesh3dLayer,
  NoiseDeformerConfig,
  SineWaveAxis,
  SineWaveDeformerConfig,
  TwistDeformerConfig,
  VertexJellyConfig
} from '../types';
import { Mesh3dGeometry, recomputeNormals } from './geometry3d';

// Deterministic per-vertex deformation: P'(u, v, t) = deform(P, N, u, v,
// config, t). Every function here is a pure function of its numeric
// arguments (no wall-clock time, no Math.random) so live playback and
// offline export produce byte-identical geometry for a given t.
//
// Deformers apply in a fixed pipeline, mirroring getModulatedLayer's single
// motion pass: twist (a space warp) first, then the two additive ripple
// sources (sine wave, noise), then vertex jelly last. Each stage reads the
// previous stage's output position.

const DEG = Math.PI / 180;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ~137.5deg, desyncs phase without periodic clustering

function fade(t: number): number {
  // Quintic smoothstep (Perlin's improved fade curve): zero 1st/2nd
  // derivative at both ends, so noise octaves stitch together without
  // visible seams at integer lattice boundaries.
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Deterministic hash of an integer lattice point + seed into [0, 1).
 * Pure integer arithmetic with JS's spec-guaranteed int32 bitwise ops, so
 * the result is identical across platforms/engines for the same inputs.
 */
function hashToUnit(ix: number, iy: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 3266489917) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

/**
 * Trilinearly-interpolated value noise (not gradient/Simplex noise) over a
 * unit lattice, remapped to roughly [-1, 1]. Chosen over Perlin/Simplex for
 * a compact, easy-to-verify deterministic implementation; visually similar
 * for the amplitude ranges this feature uses.
 */
function valueNoise3D(x: number, y: number, z: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const x1 = x0 + 1, y1 = y0 + 1, z1 = z0 + 1;
  const sx = fade(x - x0), sy = fade(y - y0), sz = fade(z - z0);

  const c000 = hashToUnit(x0, y0, z0, seed), c100 = hashToUnit(x1, y0, z0, seed);
  const c010 = hashToUnit(x0, y1, z0, seed), c110 = hashToUnit(x1, y1, z0, seed);
  const c001 = hashToUnit(x0, y0, z1, seed), c101 = hashToUnit(x1, y0, z1, seed);
  const c011 = hashToUnit(x0, y1, z1, seed), c111 = hashToUnit(x1, y1, z1, seed);

  const x00 = lerp(c000, c100, sx), x10 = lerp(c010, c110, sx);
  const x01 = lerp(c001, c101, sx), x11 = lerp(c011, c111, sx);
  const y0i = lerp(x00, x10, sy), y1i = lerp(x01, x11, sy);
  return lerp(y0i, y1i, sz) * 2 - 1;
}

/**
 * Multi-octave fractional Brownian motion over valueNoise3D. `roughness` is
 * the persistence applied per octave (each successive octave contributes
 * roughness^n as much amplitude at 2^n the frequency). Output is normalized
 * by the maximum possible summed amplitude so it stays within [-1, 1]
 * regardless of octave count.
 */
export function fbm3D(x: number, y: number, z: number, seed: number, octaves: number, roughness: number): number {
  const octaveCount = Math.max(1, Math.round(octaves) || 1);
  const persistence = Math.min(1, Math.max(0, roughness));
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let maxAmplitude = 0;
  for (let o = 0; o < octaveCount; o++) {
    sum += valueNoise3D(x * frequency, y * frequency, z * frequency, seed + o * 101) * amplitude;
    maxAmplitude += amplitude;
    amplitude *= persistence;
    frequency *= 2;
  }
  return maxAmplitude > 0 ? sum / maxAmplitude : 0;
}

function axisCoord(axis: SineWaveAxis, x: number, y: number, z: number, u: number): number {
  switch (axis) {
    case 'x': return x;
    case 'y': return y;
    case 'z': return z;
    case 'radial': return Math.hypot(x, y, z);
    case 'uv': return u;
  }
}

/**
 * Additive displacement along the vertex normal from a traveling sine wave.
 * `frequency` is scaled by 0.01 so a frequency of 1 spans roughly a 100px
 * wavelength, matching the app's pixel-scale coordinates.
 */
export function applySineWaveDeformer(
  x: number, y: number, z: number,
  nx: number, ny: number, nz: number,
  u: number,
  t: number,
  config: SineWaveDeformerConfig
): [number, number, number] {
  if (!config.enabled) return [0, 0, 0];
  const coord = axisCoord(config.axis, x, y, z, u);
  const decay = config.decay > 0 ? Math.exp(-config.decay * Math.abs(coord) / 100) : 1;
  const wave = Math.sin(coord * config.frequency * 0.01 + t * config.speed * Math.PI * 2 + config.phase * DEG);
  const offset = wave * config.amplitude * decay;
  return [nx * offset, ny * offset, nz * offset];
}

/**
 * Additive noise displacement. 'normal' pushes along the vertex normal
 * (good for organic surface roughness); 'axis' pushes independently along
 * world X/Y/Z using decorrelated noise samples per axis; 'spherical' pushes
 * radially from the origin.
 */
export function applyNoiseDeformer(
  x: number, y: number, z: number,
  nx: number, ny: number, nz: number,
  t: number,
  config: NoiseDeformerConfig
): [number, number, number] {
  if (!config.enabled) return [0, 0, 0];
  const scale = config.scale * 0.01;
  const timeOffset = t * config.speed + config.phase;
  const sx = x * scale, sy = y * scale, sz = z * scale + timeOffset;

  if (config.displacementMode === 'axis') {
    const dx = fbm3D(sx, sy, sz, config.seed, config.octaves, config.roughness);
    const dy = fbm3D(sx, sy, sz, config.seed + 1000, config.octaves, config.roughness);
    const dz = fbm3D(sx, sy, sz, config.seed + 2000, config.octaves, config.roughness);
    return [dx * config.amplitude, dy * config.amplitude, dz * config.amplitude];
  }

  const n = fbm3D(sx, sy, sz, config.seed, config.octaves, config.roughness);
  if (config.displacementMode === 'spherical') {
    const len = Math.hypot(x, y, z) || 1;
    const offset = n * config.amplitude;
    return [(x / len) * offset, (y / len) * offset, (z / len) * offset];
  }
  // 'normal'
  const offset = n * config.amplitude;
  return [nx * offset, ny * offset, nz * offset];
}

/**
 * A screw-like twist: rotates each vertex around `config.axis` by an angle
 * that scales with its position along that axis (config.angle spread across
 * `extent`, the mesh's full size along the axis) plus a continuous rotation
 * over time from config.speed. Unlike the other deformers this replaces the
 * position outright rather than adding an offset, since it's a rotation.
 */
export function applyTwistDeformer(
  x: number, y: number, z: number,
  t: number,
  config: TwistDeformerConfig,
  extent: number
): [number, number, number] {
  if (!config.enabled) return [x, y, z];
  const axisCoordinate = config.axis === 'x' ? x : config.axis === 'y' ? y : z;
  const norm = extent > 1e-6 ? axisCoordinate / extent : 0;
  const angleDeg = config.angle * norm + t * config.speed * 360 + config.phase;
  const rad = angleDeg * DEG;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  if (config.axis === 'x') return [x, y * cos - z * sin, y * sin + z * cos];
  if (config.axis === 'y') return [x * cos + z * sin, y, -x * sin + z * cos];
  return [x * cos - y * sin, x * sin + y * cos, z];
}

/**
 * Incoherent per-vertex "jelly" oscillation along the normal. Each vertex's
 * phase is offset by its index times the golden angle (scaled by
 * incoherence) so neighboring vertices desync smoothly instead of pulsing
 * in unison or falling into a visible repeating pattern.
 */
export function applyVertexJelly(
  nx: number, ny: number, nz: number,
  vertexIndex: number,
  t: number,
  config: VertexJellyConfig
): [number, number, number] {
  if (!config.enabled) return [0, 0, 0];
  const phase = config.phase + config.incoherence * vertexIndex * GOLDEN_ANGLE;
  const offset = Math.sin(t * config.speed * Math.PI * 2 + phase) * config.amplitude;
  return [nx * offset, ny * offset, nz * offset];
}

function hasActiveDeformer(layer: Mesh3dLayer): boolean {
  return Boolean(
    layer.twistDeformer?.enabled
    || layer.sineWaveDeformer?.enabled
    || layer.noiseDeformer?.enabled
    || layer.vertexJelly?.enabled
  );
}

/**
 * Runs the full deformer pipeline over a geometry's vertices for time `t`.
 * Returns the same geometry reference when no deformer is enabled (mirrors
 * getDeformedPoints' "unchanged" convention), so callers can cheaply skip
 * GPU buffer updates for static meshes.
 */
export function deformGeometry(geometry: Mesh3dGeometry, layer: Mesh3dLayer, t: number): Mesh3dGeometry {
  if (!hasActiveDeformer(layer)) return geometry;

  const { positions, normals, uvs } = geometry;
  const vertexCount = positions.length / 3;
  const outPositions = new Float32Array(positions.length);

  // Twist needs the mesh's extent along its axis; the layer's own authored
  // dimensions are a reasonable proxy for every primitive except
  // extruded-polygon (whose contour size isn't width/height/depth), which
  // is an accepted approximation for this deformer.
  const twistExtent = layer.twistDeformer
    ? (layer.twistDeformer.axis === 'x' ? layer.width : layer.twistDeformer.axis === 'y' ? layer.height : layer.depth)
    : 0;

  for (let i = 0; i < vertexCount; i++) {
    const pi = i * 3;
    let x = positions[pi], y = positions[pi + 1], z = positions[pi + 2];
    const nx = normals[pi], ny = normals[pi + 1], nz = normals[pi + 2];
    const u = uvs[i * 2];

    if (layer.twistDeformer) {
      [x, y, z] = applyTwistDeformer(x, y, z, t, layer.twistDeformer, twistExtent);
    }
    if (layer.sineWaveDeformer) {
      const [dx, dy, dz] = applySineWaveDeformer(x, y, z, nx, ny, nz, u, t, layer.sineWaveDeformer);
      x += dx; y += dy; z += dz;
    }
    if (layer.noiseDeformer) {
      const [dx, dy, dz] = applyNoiseDeformer(x, y, z, nx, ny, nz, t, layer.noiseDeformer);
      x += dx; y += dy; z += dz;
    }
    if (layer.vertexJelly) {
      const [dx, dy, dz] = applyVertexJelly(nx, ny, nz, i, t, layer.vertexJelly);
      x += dx; y += dy; z += dz;
    }

    outPositions[pi] = x; outPositions[pi + 1] = y; outPositions[pi + 2] = z;
  }

  return {
    positions: outPositions,
    normals: recomputeNormals(outPositions, geometry.indices),
    uvs: geometry.uvs,
    indices: geometry.indices
  };
}
