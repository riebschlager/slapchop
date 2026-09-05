import { textureMirrorAxes } from '../lib/textureMapping';
import * as THREE from 'three';
import { getGifFrameIndexAtTime } from '../lib/gifUtils';
import { resolveLandscapeCells, resolveLandscapeFrame } from '../lib/landscape';
import { GifData, LandscapeAsset, LandscapeConfig, LandscapeSkySource } from '../types';
import { renderLandscapeSky } from './landscape2d';

/** Three.js terrain renderer owned exclusively by GIF Landscape mode. */
export class LandscapeRenderer {
  private renderer: THREE.WebGLRenderer;
  private webglCanvas: HTMLCanvasElement;
  private skyCanvas = document.createElement('canvas');
  private outputCanvas = document.createElement('canvas');
  private outputContext: CanvasRenderingContext2D;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(66, 1, 2, 30000);
  private terrain: THREE.Mesh<THREE.BufferGeometry, THREE.Material[]>;
  private wireframe: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private fallbackMaterial = new THREE.MeshBasicMaterial({ color: '#173c3c', side: THREE.DoubleSide, fog: true });
  private wireframeMaterial = new THREE.MeshBasicMaterial({ color: '#c9ff5d', wireframe: true, transparent: true, opacity: 0.45, depthWrite: false });
  private assetMaterials = new Map<string, THREE.MeshBasicMaterial>();
  private gifTextures = new Map<GifData, THREE.Texture[]>();
  private fog = new THREE.FogExp2('#090d18', 0.00016);
  private topologyKey = '';
  private width = 0;
  private height = 0;

  private constructor(renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement, outputContext: CanvasRenderingContext2D) {
    this.renderer = renderer;
    this.webglCanvas = canvas;
    this.outputContext = outputContext;
    const geometry = new THREE.BufferGeometry();
    this.terrain = new THREE.Mesh(geometry, [this.fallbackMaterial]);
    this.wireframe = new THREE.Mesh(geometry, this.wireframeMaterial);
    this.terrain.frustumCulled = false;
    this.wireframe.frustumCulled = false;
    this.scene.add(this.terrain, this.wireframe);
  }

  static create(): LandscapeRenderer {
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      powerPreference: 'high-performance'
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    const outputCanvas = document.createElement('canvas');
    const context = outputCanvas.getContext('2d');
    if (!context) throw new Error('Could not create Landscape composite canvas.');
    const instance = new LandscapeRenderer(renderer, canvas, context);
    instance.outputCanvas = outputCanvas;
    return instance;
  }

  renderToCanvas(
    t: number,
    terrainAssets: LandscapeAsset[],
    skySources: LandscapeSkySource[],
    config: LandscapeConfig,
    width: number,
    height: number
  ): HTMLCanvasElement {
    if (this.width !== width || this.height !== height) {
      this.renderer.setSize(width, height, false);
      this.skyCanvas.width = width;
      this.skyCanvas.height = height;
      this.outputCanvas.width = width;
      this.outputCanvas.height = height;
      this.width = width;
      this.height = height;
    }

    const frame = resolveLandscapeFrame(config, skySources, t);
    const resolved = frame.config;
    const skyContext = this.skyCanvas.getContext('2d');
    if (skyContext) renderLandscapeSky(skyContext, t, frame.skySources, resolved, width, height);

    this.camera.aspect = width / height;
    this.camera.fov = resolved.fov;
    this.camera.position.set(resolved.cameraX, resolved.cameraHeight, 1500);
    this.camera.lookAt(0, 0, -resolved.lookAhead);
    this.camera.far = Math.max(30000, resolved.terrainDepth * 2.5);
    this.camera.updateProjectionMatrix();
    this.fog.color.set(resolved.fogColor);
    this.fog.density = resolved.fogDensity;
    this.scene.fog = resolved.fogDensity > 0 ? this.fog : null;

    const cells = resolveLandscapeCells(resolved, t, terrainAssets.length, frame.travel);
    this.syncGeometry(cells, resolved);
    this.syncMaterials(terrainAssets, resolved, t);
    this.terrain.material = [this.fallbackMaterial, ...terrainAssets.map(asset => this.assetMaterials.get(asset.id) ?? this.fallbackMaterial)];
    this.wireframe.visible = resolved.wireframe;
    this.wireframeMaterial.color.set(resolved.wireframeColor);
    this.renderer.render(this.scene, this.camera);

    this.outputContext.setTransform(1, 0, 0, 1, 0, 0);
    this.outputContext.clearRect(0, 0, width, height);
    this.outputContext.drawImage(this.skyCanvas, 0, 0);
    this.outputContext.drawImage(this.webglCanvas, 0, 0);
    this.sweepAssets(terrainAssets);
    return this.outputCanvas;
  }

  destroy() {
    this.terrain.geometry.dispose();
    this.fallbackMaterial.dispose();
    this.wireframeMaterial.dispose();
    for (const material of this.assetMaterials.values()) material.dispose();
    for (const textures of this.gifTextures.values()) textures.forEach(texture => texture.dispose());
    this.assetMaterials.clear();
    this.gifTextures.clear();
    this.renderer.dispose();
  }

  private syncGeometry(cells: ReturnType<typeof resolveLandscapeCells>, config: LandscapeConfig) {
    const key = `${Math.round(config.meshColumns)}|${Math.round(config.meshRows)}`;
    if (key !== this.topologyKey) {
      const positions = new Float32Array(cells.length * 12);
      const uvs = new Float32Array(cells.length * 8);
      const indices = new Uint32Array(cells.length * 6);
      for (let index = 0; index < cells.length; index++) {
        const vertex = index * 4;
        const uv = index * 8;
        uvs.set([0, 0, 1, 0, 1, 1, 0, 1], uv);
        indices.set([vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3], index * 6);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      this.terrain.geometry.dispose();
      this.terrain.geometry = geometry;
      this.wireframe.geometry = geometry;
      this.topologyKey = key;
    }

    const geometry = this.terrain.geometry;
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    geometry.clearGroups();
    cells.forEach((cell, index) => {
      cell.corners.forEach((corner, cornerIndex) => {
        positions.setXYZ(index * 4 + cornerIndex, corner.x, corner.y, corner.z);
      });
      geometry.addGroup(index * 6, 6, cell.assetIndex + 1);
    });
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }

  private syncMaterials(assets: LandscapeAsset[], config: LandscapeConfig, t: number) {
    for (const asset of assets) {
      let material = this.assetMaterials.get(asset.id);
      if (!material) {
        material = new THREE.MeshBasicMaterial({
          transparent: false,
          depthTest: true,
          depthWrite: true,
          side: THREE.DoubleSide,
          toneMapped: false,
          fog: true
        });
        this.assetMaterials.set(asset.id, material);
      }
      const frameIndex = getGifFrameIndexAtTime(asset.gifData, t, config.terrainGifSpeed);
      const texture = this.getGifTextures(asset.gifData)[frameIndex];
      if (texture && material.map !== texture) {
        material.map = texture;
        material.needsUpdate = true;
      }
      if (texture) {
        const repeat = 1 / Math.max(0.25, config.terrainTextureScale);
        const mode = config.terrainTextureTiling ?? 'clamp';
        const [mx, my] = textureMirrorAxes(mode);
        texture.wrapS = mode === 'clamp' ? THREE.ClampToEdgeWrapping : mx ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
        texture.wrapT = mode === 'clamp' ? THREE.ClampToEdgeWrapping : my ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
        texture.center.set(0.5, 0.5);
        texture.rotation = -(config.terrainTextureRotation ?? 0) * Math.PI / 180;
        texture.repeat.set(repeat, -repeat);
        texture.offset.set(
          config.terrainTextureOffsetX,
          config.terrainTextureOffsetY
        );
        texture.needsUpdate = true;
      }
    }
  }

  private getGifTextures(gif: GifData): THREE.Texture[] {
    let textures = this.gifTextures.get(gif);
    if (!textures) {
      textures = gif.frames.map(frame => {
        const texture = new THREE.Texture(frame.image as ImageBitmap);
        texture.flipY = false;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;
        return texture;
      });
      this.gifTextures.set(gif, textures);
    }
    return textures;
  }

  private sweepAssets(assets: LandscapeAsset[]) {
    const ids = new Set(assets.map(asset => asset.id));
    const gifs = new Set(assets.map(asset => asset.gifData));
    for (const [id, material] of this.assetMaterials) {
      if (!ids.has(id)) {
        material.dispose();
        this.assetMaterials.delete(id);
      }
    }
    for (const [gif, textures] of this.gifTextures) {
      if (!gifs.has(gif)) {
        textures.forEach(texture => texture.dispose());
        this.gifTextures.delete(gif);
      }
    }
  }
}
