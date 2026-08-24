import { TunnelAsset, TunnelConfig } from '../types';
import { applyMotion } from './motion';

export type TunnelVec3 = [number, number, number];

export interface TunnelUvRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface ResolvedTunnelPane {
  ringIndex: number;
  sideIndex: number;
  corners: [TunnelVec3, TunnelVec3, TunnelVec3, TunnelVec3];
  asset: TunnelAsset | null;
  color: string | null;
  sourceTime: number;
  uv: TunnelUvRect;
  distance: number;
}

export interface ResolvedTunnelScene {
  cameraPosition: TunnelVec3;
  cameraTarget: TunnelVec3;
  cameraUp: TunnelVec3;
  fov: number;
  fogColor: string;
  fogDensity: number;
  panes: ResolvedTunnelPane[];
}

const WORLD_UP: TunnelVec3 = [0, 1, 0];

function add(a: TunnelVec3, b: TunnelVec3): TunnelVec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: TunnelVec3, b: TunnelVec3): TunnelVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function multiply(v: TunnelVec3, amount: number): TunnelVec3 {
  return [v[0] * amount, v[1] * amount, v[2] * amount];
}

function length(v: TunnelVec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v: TunnelVec3): TunnelVec3 {
  const magnitude = length(v) || 1;
  return [v[0] / magnitude, v[1] / magnitude, v[2] / magnitude];
}

function cross(a: TunnelVec3, b: TunnelVec3): TunnelVec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function mix(a: TunnelVec3, b: TunnelVec3, amount: number): TunnelVec3 {
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount
  ];
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function seededRandom(index: number, seed: number): number {
  const value = Math.sin((index + 1) * 12.9898 + seed * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function pathCenter(s: number, bendX: number, bendY: number, wavelength: number): TunnelVec3 {
  const angle = (s / Math.max(800, wavelength)) * Math.PI * 2;
  return [
    Math.sin(angle) * bendX,
    Math.cos(angle) * bendY,
    -s
  ];
}

function pathFrame(
  s: number,
  bendX: number,
  bendY: number,
  wavelength: number,
  twistRadians: number
): { center: TunnelVec3; forward: TunnelVec3; right: TunnelVec3; up: TunnelVec3 } {
  const epsilon = 1;
  const center = pathCenter(s, bendX, bendY, wavelength);
  const forward = normalize(subtract(
    pathCenter(s + epsilon, bendX, bendY, wavelength),
    pathCenter(s - epsilon, bendX, bendY, wavelength)
  ));
  let right = normalize(cross(forward, WORLD_UP));
  let up = normalize(cross(right, forward));
  const cos = Math.cos(twistRadians);
  const sin = Math.sin(twistRadians);
  const twistedRight = add(multiply(right, cos), multiply(up, sin));
  const twistedUp = add(multiply(up, cos), multiply(right, -sin));
  right = normalize(twistedRight);
  up = normalize(twistedUp);
  return { center, forward, right, up };
}

function ringVertices(
  s: number,
  ringIndex: number,
  sides: number,
  radius: number,
  bendX: number,
  bendY: number,
  wavelength: number,
  twistPerRing: number
): TunnelVec3[] {
  const twist = ringIndex * twistPerRing * Math.PI / 180;
  const frame = pathFrame(s, bendX, bendY, wavelength, twist);
  return Array.from({ length: sides }, (_, side) => {
    // Half a side of rotation keeps the default view from putting a polygon
    // vertex directly at twelve o'clock, producing broad ceiling/floor panes.
    const angle = ((side + 0.5) / sides) * Math.PI * 2;
    return add(
      frame.center,
      add(multiply(frame.right, Math.cos(angle) * radius), multiply(frame.up, Math.sin(angle) * radius))
    );
  });
}

function insetQuad(
  corners: [TunnelVec3, TunnelVec3, TunnelVec3, TunnelVec3],
  gap: number
): [TunnelVec3, TunnelVec3, TunnelVec3, TunnelVec3] {
  const inset = Math.max(0, Math.min(0.42, gap)) / 2;
  if (inset === 0) return corners;
  const [a, b, c, d] = corners;
  const sample = (u: number, v: number) => mix(mix(a, b, u), mix(d, c, u), v);
  return [
    sample(inset, inset),
    sample(1 - inset, inset),
    sample(1 - inset, 1 - inset),
    sample(inset, 1 - inset)
  ];
}

export function tunnelUvRect(
  sourceAspect: number,
  paneAspect: number,
  scale: number,
  offsetX: number,
  offsetY: number
): TunnelUvRect {
  const safeSourceAspect = Math.max(0.001, sourceAspect);
  const safePaneAspect = Math.max(0.001, paneAspect);
  let width = 1;
  let height = 1;
  if (safeSourceAspect > safePaneAspect) width = safePaneAspect / safeSourceAspect;
  else height = safeSourceAspect / safePaneAspect;
  const zoom = Math.max(1, scale);
  width /= zoom;
  height /= zoom;
  const centerX = Math.max(width / 2, Math.min(1 - width / 2, 0.5 + offsetX));
  const centerY = Math.max(height / 2, Math.min(1 - height / 2, 0.5 + offsetY));
  return {
    u0: centerX - width / 2,
    v0: centerY - height / 2,
    u1: centerX + width / 2,
    v1: centerY + height / 2
  };
}

function assetForRing(assets: TunnelAsset[], config: TunnelConfig, ringIndex: number): TunnelAsset | null {
  if (assets.length === 0) return null;
  const assetIndex = config.shuffle
    ? Math.floor(seededRandom(ringIndex, config.seed) * assets.length)
    : positiveModulo(ringIndex, assets.length);
  return assets[assetIndex] ?? null;
}

export function resolveTunnelScene(
  assets: TunnelAsset[],
  config: TunnelConfig,
  t: number
): ResolvedTunnelScene {
  const sides = Math.max(3, Math.min(24, Math.round(config.sides)));
  const ringCount = Math.max(4, Math.min(64, Math.round(config.ringCount)));
  const radius = Math.max(120, config.radius);
  const ringLength = Math.max(80, config.ringLength);
  const speed = applyMotion(config.speed, config.motionSpeed, t);
  const bendX = applyMotion(config.bendX, config.motionBendX, t);
  const bendY = applyMotion(config.bendY, config.motionBendY, t);
  const twistPerRing = applyMotion(config.twistPerRing, config.motionTwist, t);
  const cameraRoll = applyMotion(config.cameraRoll, config.motionCameraRoll, t);
  const cameraS = speed * t;
  const firstRing = Math.floor(cameraS / ringLength) - 1;
  const cameraFrame = pathFrame(cameraS, bendX, bendY, config.bendWavelength, 0);
  const cameraPosition = add(
    cameraFrame.center,
    add(multiply(cameraFrame.right, config.cameraOffsetX), multiply(cameraFrame.up, config.cameraOffsetY))
  );
  const cameraTarget = pathCenter(
    cameraS + Math.max(100, config.lookAhead),
    bendX,
    bendY,
    config.bendWavelength
  );
  const roll = cameraRoll * Math.PI / 180;
  const cameraUp = normalize(add(
    multiply(cameraFrame.up, Math.cos(roll)),
    multiply(cameraFrame.right, -Math.sin(roll))
  ));
  const palette = config.palette.length > 0 ? config.palette : ['#ffffff'];
  const gifEvery = Math.max(1, Math.min(sides, Math.round(config.gifEvery)));
  const ringPatternOffset = positiveModulo(Math.round(config.ringPatternOffset), sides);
  const panes: ResolvedTunnelPane[] = [];

  for (let row = 0; row < ringCount + 1; row++) {
    const ringIndex = firstRing + row;
    const startS = ringIndex * ringLength;
    const endS = (ringIndex + 1) * ringLength;
    const start = ringVertices(startS, ringIndex, sides, radius, bendX, bendY, config.bendWavelength, twistPerRing);
    const end = ringVertices(endS, ringIndex + 1, sides, radius, bendX, bendY, config.bendWavelength, twistPerRing);
    const ringAsset = assetForRing(assets, config, ringIndex);

    for (let side = 0; side < sides; side++) {
      const next = (side + 1) % sides;
      const corners = insetQuad([start[side], start[next], end[next], end[side]], config.paneGap);
      const shiftedSide = side + ringIndex * ringPatternOffset;
      const gifEligible = positiveModulo(shiftedSide, gifEvery) === 0;
      const asset = gifEligible ? ringAsset : null;
      const color = asset || config.nonGifFill === 'transparent'
        ? null
        : palette[positiveModulo(ringIndex + side, palette.length)];
      const paneWidth = (length(subtract(corners[1], corners[0])) + length(subtract(corners[2], corners[3]))) / 2;
      const paneHeight = (length(subtract(corners[3], corners[0])) + length(subtract(corners[2], corners[1]))) / 2;
      const sourceWidth = asset?.gifData?.width ?? asset?.width ?? 1;
      const sourceHeight = asset?.gifData?.height ?? asset?.height ?? 1;
      const durationSeconds = (asset?.gifData?.totalDurationMs ?? 0) / 1000;
      panes.push({
        ringIndex,
        sideIndex: side,
        corners,
        asset,
        color,
        sourceTime: t + positiveModulo(ringIndex * config.ringPhase, 1) * durationSeconds,
        uv: tunnelUvRect(
          sourceWidth / Math.max(1, sourceHeight),
          paneWidth / Math.max(1, paneHeight),
          config.textureScale,
          config.textureOffsetX,
          config.textureOffsetY
        ),
        distance: length(subtract(mix(corners[0], corners[2], 0.5), cameraPosition))
      });
    }
  }

  return {
    cameraPosition,
    cameraTarget,
    cameraUp,
    fov: config.fov,
    fogColor: config.fogColor,
    fogDensity: config.fogEnabled ? Math.max(0, config.fogDensity) : 0,
    panes
  };
}
