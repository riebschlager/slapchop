import { PolygonPoint, PolygonLayer, BlendMode } from '../types';

export function createPresetPolygonPoints(type: 'triangle' | 'rectangle' | 'star' | 'hexagon', radius: number = 180): PolygonPoint[] {
  if (type === 'triangle') {
    return [
      { x: 0, y: -radius },
      { x: Math.cos(Math.PI / 6) * radius, y: Math.sin(Math.PI / 6) * radius },
      { x: -Math.cos(Math.PI / 6) * radius, y: Math.sin(Math.PI / 6) * radius }
    ];
  }

  if (type === 'rectangle') {
    const half = radius * 0.85;
    return [
      { x: -half, y: -half },
      { x: half, y: -half },
      { x: half, y: half },
      { x: -half, y: half }
    ];
  }

  if (type === 'hexagon') {
    const points: PolygonPoint[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3 - Math.PI / 2;
      points.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius
      });
    }
    return points;
  }

  if (type === 'star') {
    const points: PolygonPoint[] = [];
    const outerR = radius;
    const innerR = radius * 0.45;
    for (let i = 0; i < 10; i++) {
      const angle = (i * Math.PI) / 5 - Math.PI / 2;
      const r = i % 2 === 0 ? outerR : innerR;
      points.push({
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r
      });
    }
    return points;
  }

  return [];
}

export function createNewPolygonLayer(
  name: string,
  points: PolygonPoint[],
  options?: Partial<PolygonLayer>
): PolygonLayer {
  return {
    id: crypto.randomUUID(),
    name: name,
    points: points,
    textureScale: 1.0,
    textureRotation: 0,
    textureOffsetX: 0,
    textureOffsetY: 0,
    opacity: 1.0,
    blendMode: 'normal' as BlendMode,
    strokeColor: '#ffffff',
    strokeWidth: 2,
    fillColor: '#6366f1',
    gifSpeed: 1,
    ...options
  };
}

/**
 * Calculates centroid (center of mass) of polygon points
 */
export function getPolygonCentroid(points: PolygonPoint[]): PolygonPoint {
  if (points.length === 0) return { x: 0, y: 0 };
  let sumX = 0;
  let sumY = 0;
  points.forEach(pt => {
    sumX += pt.x;
    sumY += pt.y;
  });
  return {
    x: sumX / points.length,
    y: sumY / points.length
  };
}

/**
 * Ray-casting algorithm to test if a 2D point is inside a polygon
 */
export function isPointInPolygon(pt: PolygonPoint, polyPoints: PolygonPoint[]): boolean {
  if (polyPoints.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polyPoints.length - 1; i < polyPoints.length; j = i++) {
    const xi = polyPoints[i].x, yi = polyPoints[i].y;
    const xj = polyPoints[j].x, yj = polyPoints[j].y;

    const intersect = ((yi > pt.y) !== (yj > pt.y))
        && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
