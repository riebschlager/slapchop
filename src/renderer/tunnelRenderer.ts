import * as THREE from 'three';
import { TunnelAsset, TunnelConfig, GifData } from '../types';
import { resolveTunnelScene, ResolvedTunnelPane } from '../lib/tunnel';
import { getGifFrameIndexAtTime } from '../lib/gifUtils';
import { getCachedImage } from './render2d';

interface MaterialEntry {
  material: THREE.MeshBasicMaterial;
  textureKey: string;
}

/** Three.js renderer owned exclusively by GIF Tunnel mode. */
export class TunnelRenderer {
  private renderer: THREE.WebGLRenderer;
  private canvas: HTMLCanvasElement;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(74, 1, 1, 60000);
  private group = new THREE.Group();
  private meshes: THREE.Mesh<THREE.BufferGeometry, THREE.Material>[] = [];
  private materials = new Map<string, MaterialEntry>();
  private gifTextures = new Map<GifData, THREE.Texture[]>();
  private staticTextures = new Map<string, THREE.Texture>();
  private fog = new THREE.FogExp2('#03040a', 0.00012);
  private fallbackMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  private width = 0;
  private height = 0;

  private constructor(renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement) {
    this.renderer = renderer;
    this.canvas = canvas;
    this.scene.add(this.group);
  }

  static create(): TunnelRenderer {
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: false,
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    return new TunnelRenderer(renderer, canvas);
  }

  renderToCanvas(
    t: number,
    assets: TunnelAsset[],
    config: TunnelConfig,
    width: number,
    height: number
  ): HTMLCanvasElement {
    if (this.width !== width || this.height !== height) {
      this.renderer.setSize(width, height, false);
      this.width = width;
      this.height = height;
    }

    const resolved = resolveTunnelScene(assets, config, t);
    this.camera.aspect = width / height;
    this.camera.fov = resolved.fov;
    this.camera.far = Math.max(30000, config.ringLength * (config.ringCount + 4) * 2);
    this.camera.position.set(...resolved.cameraPosition);
    this.camera.up.set(...resolved.cameraUp);
    this.camera.lookAt(...resolved.cameraTarget);
    this.camera.updateProjectionMatrix();
    this.renderer.setClearColor(config.voidColor, 1);
    this.fog.color.set(resolved.fogColor);
    this.fog.density = resolved.fogDensity;
    this.scene.fog = resolved.fogDensity > 0 ? this.fog : null;

    this.reconcileMeshes(resolved.panes.length);
    resolved.panes.forEach((pane, index) => this.syncPane(this.meshes[index], pane));
    this.sweepAssets(assets, config.palette);
    this.renderer.render(this.scene, this.camera);
    return this.canvas;
  }

  destroy() {
    for (const mesh of this.meshes) mesh.geometry.dispose();
    for (const { material } of this.materials.values()) material.dispose();
    for (const textures of this.gifTextures.values()) textures.forEach(texture => texture.dispose());
    for (const texture of this.staticTextures.values()) texture.dispose();
    this.fallbackMaterial.dispose();
    this.materials.clear();
    this.gifTextures.clear();
    this.staticTextures.clear();
    this.renderer.dispose();
  }

  private createPaneGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(8), 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    return geometry;
  }

  private reconcileMeshes(count: number) {
    while (this.meshes.length < count) {
      const mesh = new THREE.Mesh(this.createPaneGeometry(), this.fallbackMaterial);
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    while (this.meshes.length > count) {
      const mesh = this.meshes.pop()!;
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
  }

  private syncPane(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>, pane: ResolvedTunnelPane) {
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    pane.corners.forEach((corner, index) => position.setXYZ(index, corner[0], corner[1], corner[2]));
    position.needsUpdate = true;
    const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
    uv.setXY(0, pane.uv.u0, pane.uv.v0);
    uv.setXY(1, pane.uv.u1, pane.uv.v0);
    uv.setXY(2, pane.uv.u1, pane.uv.v1);
    uv.setXY(3, pane.uv.u0, pane.uv.v1);
    uv.needsUpdate = true;

    if (pane.asset) {
      const texture = this.resolveTexture(pane.asset, pane.sourceTime);
      mesh.visible = Boolean(texture);
      if (texture) mesh.material = this.resolveAssetMaterial(pane.asset, texture);
    } else if (pane.color) {
      mesh.visible = true;
      mesh.material = this.resolveColorMaterial(pane.color);
    } else {
      mesh.visible = false;
    }
  }

  private resolveAssetMaterial(asset: TunnelAsset, texture: THREE.Texture): THREE.MeshBasicMaterial {
    const key = `asset:${asset.id}`;
    let entry = this.materials.get(key);
    if (!entry) {
      entry = {
        material: new THREE.MeshBasicMaterial({
          transparent: true,
          alphaTest: 0.015,
          depthTest: true,
          depthWrite: true,
          side: THREE.DoubleSide,
          toneMapped: false
        }),
        textureKey: ''
      };
      this.materials.set(key, entry);
    }
    if (entry.textureKey !== texture.uuid) {
      entry.material.map = texture;
      entry.material.needsUpdate = true;
      entry.textureKey = texture.uuid;
    }
    return entry.material;
  }

  private resolveColorMaterial(color: string): THREE.MeshBasicMaterial {
    const key = `color:${color}`;
    let entry = this.materials.get(key);
    if (!entry) {
      entry = {
        material: new THREE.MeshBasicMaterial({
          color,
          depthTest: true,
          depthWrite: true,
          side: THREE.DoubleSide,
          toneMapped: false
        }),
        textureKey: ''
      };
      this.materials.set(key, entry);
    }
    return entry.material;
  }

  private resolveTexture(asset: TunnelAsset, t: number): THREE.Texture | null {
    if (asset.gifData) {
      const index = getGifFrameIndexAtTime(asset.gifData, t, 1);
      if (index >= 0) return this.getGifTextures(asset.gifData)[index] ?? null;
    }
    return this.getStaticTexture(asset.src);
  }

  private configureTexture(texture: THREE.Texture) {
    // ImageBitmap uploads cannot use Texture.flipY. Applying the same UV-space
    // flip to every source keeps animated and static wallpaper aligned.
    texture.flipY = false;
    texture.repeat.y = -1;
    texture.offset.y = 1;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
  }

  private getGifTextures(gif: GifData): THREE.Texture[] {
    let textures = this.gifTextures.get(gif);
    if (!textures) {
      textures = gif.frames.map(frame => {
        const texture = new THREE.Texture(frame.image as ImageBitmap);
        this.configureTexture(texture);
        return texture;
      });
      this.gifTextures.set(gif, textures);
    }
    return textures;
  }

  private getStaticTexture(src: string): THREE.Texture | null {
    const existing = this.staticTextures.get(src);
    if (existing) return existing;
    const image = getCachedImage(src);
    if (!image) return null;
    const texture = new THREE.Texture(image);
    this.configureTexture(texture);
    this.staticTextures.set(src, texture);
    return texture;
  }

  private sweepAssets(assets: TunnelAsset[], palette: string[]) {
    const assetIds = new Set(assets.map(asset => `asset:${asset.id}`));
    const colorKeys = new Set(palette.map(color => `color:${color}`));
    const gifs = new Set(assets.flatMap(asset => asset.gifData ? [asset.gifData] : []));
    const sources = new Set(assets.map(asset => asset.src));
    for (const [key, entry] of this.materials) {
      if (!assetIds.has(key) && !colorKeys.has(key)) {
        entry.material.dispose();
        this.materials.delete(key);
      }
    }
    for (const [gif, textures] of this.gifTextures) {
      if (!gifs.has(gif)) {
        textures.forEach(texture => texture.dispose());
        this.gifTextures.delete(gif);
      }
    }
    for (const [src, texture] of this.staticTextures) {
      if (!sources.has(src)) {
        texture.dispose();
        this.staticTextures.delete(src);
      }
    }
  }
}
