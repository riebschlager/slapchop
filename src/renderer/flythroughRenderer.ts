import * as THREE from 'three';
import { FlythroughAsset, FlythroughConfig, GifData } from '../types';
import { resolveFlythroughParticles } from '../lib/flythrough';
import { getGifFrameIndexAtTime } from '../lib/gifUtils';
import { getCachedImage } from './render2d';

const NEAR = 1;
const FAR = 30000;

interface AssetMaterial {
  material: THREE.MeshBasicMaterial;
  textureKey: string;
}

/** Three.js renderer owned exclusively by GIF Flythrough mode. */
export class FlythroughRenderer {
  private renderer: THREE.WebGLRenderer;
  private canvas: HTMLCanvasElement;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(68, 1, NEAR, FAR);
  private group = new THREE.Group();
  private geometry = new THREE.PlaneGeometry(1, 1);
  private meshes: THREE.Mesh[] = [];
  private materials = new Map<string, AssetMaterial>();
  private gifTextures = new Map<GifData, THREE.Texture[]>();
  private staticTextures = new Map<string, THREE.Texture>();
  private width = 0;
  private height = 0;

  private constructor(renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement) {
    this.renderer = renderer;
    this.canvas = canvas;
    this.renderer.setClearColor(0x000000, 0);
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(0, 0, -1);
    this.scene.add(this.group);
  }

  static create(): FlythroughRenderer {
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    return new FlythroughRenderer(renderer, canvas);
  }

  renderToCanvas(
    t: number,
    assets: FlythroughAsset[],
    config: FlythroughConfig,
    width: number,
    height: number
  ): HTMLCanvasElement {
    if (this.width !== width || this.height !== height) {
      this.renderer.setSize(width, height, false);
      this.width = width;
      this.height = height;
    }
    this.camera.aspect = width / height;
    this.camera.fov = config.fov;
    this.camera.far = Math.max(FAR, config.depth * 2);
    this.camera.updateProjectionMatrix();

    const particles = resolveFlythroughParticles(assets, config, t);
    this.reconcileMeshes(particles.length);
    const DEG = Math.PI / 180;
    particles.forEach((particle, index) => {
      const mesh = this.meshes[index];
      const texture = this.resolveTexture(particle.asset, t);
      mesh.visible = Boolean(texture);
      if (!texture) return;
      mesh.material = this.resolveMaterial(particle.asset, texture, config.opacity);
      mesh.position.set(particle.x, particle.y, particle.z);
      mesh.scale.set(particle.width, particle.height, 1);

      if (config.plane === 'billboard') {
        mesh.lookAt(this.camera.position);
        mesh.rotateZ(particle.rotation * DEG);
      } else if (config.plane === 'xy') {
        mesh.rotation.set(0, 0, particle.rotation * DEG);
      } else if (config.plane === 'xz') {
        mesh.rotation.set(Math.PI / 2, 0, particle.rotation * DEG);
      } else {
        mesh.rotation.set(0, Math.PI / 2, particle.rotation * DEG);
      }
    });

    this.sweepAssets(assets);
    this.renderer.render(this.scene, this.camera);
    return this.canvas;
  }

  destroy() {
    this.geometry.dispose();
    for (const { material } of this.materials.values()) material.dispose();
    for (const textures of this.gifTextures.values()) textures.forEach(texture => texture.dispose());
    for (const texture of this.staticTextures.values()) texture.dispose();
    this.materials.clear();
    this.gifTextures.clear();
    this.staticTextures.clear();
    this.renderer.dispose();
  }

  private reconcileMeshes(count: number) {
    while (this.meshes.length < count) {
      const mesh = new THREE.Mesh(this.geometry);
      mesh.renderOrder = this.meshes.length;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    while (this.meshes.length > count) {
      const mesh = this.meshes.pop()!;
      this.group.remove(mesh);
    }
  }

  private resolveMaterial(asset: FlythroughAsset, texture: THREE.Texture, opacity: number): THREE.Material {
    let entry = this.materials.get(asset.id);
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
      this.materials.set(asset.id, entry);
    }
    if (entry.textureKey !== texture.uuid) {
      entry.material.map = texture;
      entry.material.needsUpdate = true;
      entry.textureKey = texture.uuid;
    }
    entry.material.opacity = Math.max(0, Math.min(1, opacity));
    return entry.material;
  }

  private resolveTexture(asset: FlythroughAsset, t: number): THREE.Texture | null {
    if (asset.gifData) {
      const index = getGifFrameIndexAtTime(asset.gifData, t, 1);
      if (index >= 0) return this.getGifTextures(asset.gifData)[index] ?? null;
    }
    return this.getStaticTexture(asset.src);
  }

  private getGifTextures(gif: GifData): THREE.Texture[] {
    let textures = this.gifTextures.get(gif);
    if (!textures) {
      textures = gif.frames.map(frame => {
        const texture = new THREE.Texture(frame.image as ImageBitmap);
        // Three cannot apply Texture.flipY while uploading an ImageBitmap.
        // Flip in UV space instead so GIF frames match HTMLImage textures and
        // the Canvas 2D fallback rather than appearing upside-down.
        texture.flipY = false;
        texture.repeat.y = -1;
        texture.offset.y = 1;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
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
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    this.staticTextures.set(src, texture);
    return texture;
  }

  private sweepAssets(assets: FlythroughAsset[]) {
    const ids = new Set(assets.map(asset => asset.id));
    const gifs = new Set(assets.flatMap(asset => asset.gifData ? [asset.gifData] : []));
    const sources = new Set(assets.map(asset => asset.src));
    for (const [id, entry] of this.materials) {
      if (!ids.has(id)) {
        entry.material.dispose();
        this.materials.delete(id);
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
