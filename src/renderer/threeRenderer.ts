import * as THREE from 'three';
import { BlendMode, Camera3dConfig, GifData, Mesh3dLayer } from '../types';
import { generateMesh3dGeometry, Mesh3dGeometry } from '../lib/geometry3d';
import { deformGeometry } from '../lib/deformation3d';
import { getMesh3dInstances, resolveCameraPose } from '../lib/motion3d';
import { getGifFrameIndexAtTime } from '../lib/gifUtils';
import { getCachedImage } from './render2d';

// GPU scene graph for 3D Mesh Mode: reconciles mesh3dLayers/camera3d into a
// Three.js scene each frame and renders it to an offscreen canvas, which
// pixiRenderer.ts composites into the Master FX stack as a texture. Pure
// function of (t, mesh3dLayers, camera3d) like PixiSceneRenderer, so live
// playback and offline export produce the same frame for the same t.
//
// Coordinate note: this renderer feeds world positions to Three.js
// completely unmodified and uses a standard up=(0,1,0) camera, so Three
// renders the scene the way it always does (+Y toward the top of its own
// output) even though the rest of the app treats +Y as "down" (see
// geometry3d.ts). Rather than fight that by negating Y (which would also
// flip triangle winding and invert every authored rotationX/rotationZ),
// pixiRenderer.ts flips the composited sprite vertically instead — a single,
// well-contained correction instead of one threaded through every transform.
// render2d.ts's CPU fallback reaches the same visual result differently
// (see its module comment) but resolveCameraPose (motion3d.ts) is the one
// source of truth both renderers use for *where the camera sits*.

const NEAR = 1;
const FAR = 100000;

function primitiveGeometryKey(layer: Mesh3dLayer): string {
  return [
    layer.primitive, layer.width, layer.height, layer.depth,
    layer.subdivisionX, layer.subdivisionY,
    layer.primitive === 'extruded-polygon' ? JSON.stringify(layer.contour) : ''
  ].join('|');
}

function materialStyleKey(layer: Mesh3dLayer, hasTexture: boolean): string {
  return [
    layer.shadingModel, layer.wireframe, layer.wireframeColor, layer.doubleSided,
    layer.depthTest, layer.blendMode, layer.fillColor, hasTexture
  ].join('|');
}

// Three's fixed-function blending only covers a handful of this app's blend
// modes exactly; unsupported ones fall back to normal blending rather than
// silently guessing. Matches the "advanced" 2D blend modes' own note that
// GPU export and live paths already differ slightly on esoteric blends.
function applyBlendMode(material: THREE.Material, mode: BlendMode) {
  material.blending = THREE.NormalBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.SrcAlphaFactor;
  material.blendDst = THREE.OneMinusSrcAlphaFactor;
  switch (mode) {
    case 'multiply':
      material.blending = THREE.MultiplyBlending;
      break;
    case 'screen':
      material.blending = THREE.CustomBlending;
      material.blendEquation = THREE.AddEquation;
      material.blendSrc = THREE.OneMinusDstColorFactor;
      material.blendDst = THREE.OneFactor;
      break;
    case 'lighten':
      material.blending = THREE.CustomBlending;
      material.blendEquation = THREE.MaxEquation;
      material.blendSrc = THREE.OneFactor;
      material.blendDst = THREE.OneFactor;
      break;
    case 'darken':
      material.blending = THREE.CustomBlending;
      material.blendEquation = THREE.MinEquation;
      material.blendSrc = THREE.OneFactor;
      material.blendDst = THREE.OneFactor;
      break;
    default:
      // normal + the non-separable/unsupported modes (overlay, difference,
      // exclusion, color-dodge/burn, hue, saturation, color, luminosity).
      break;
  }
}

// Each symmetry instance is a Mesh wrapped in a pivot anchor Group: the
// anchor sits at (position + pivot) and carries rotation/scale, while the
// mesh itself sits at -pivot inside it, so rotation/scale turn about the
// pivot point rather than the mesh's own local origin (see mat4.ts's
// buildMeshWorldMatrix doc comment for the equivalent CPU-path derivation).
// Anchor and mesh are pooled and torn down together so shrinking the
// instance count can't leave an orphaned anchor in the scene graph.
interface Mesh3dInstanceNode {
  anchor: THREE.Group;
  mesh: THREE.Mesh;
}

interface Mesh3dNode {
  instances: Mesh3dInstanceNode[];
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  baseGeometry: Mesh3dGeometry | null;
  geometryKey: string;
  styleKey: string;
  textureKey: string;
}

export class ThreeSceneRenderer {
  private renderer: THREE.WebGLRenderer;
  private canvas: HTMLCanvasElement;
  private scene = new THREE.Scene();
  private group = new THREE.Group();
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private cameraProjection: Camera3dConfig['projection'] = 'perspective';
  private ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  private headlight = new THREE.DirectionalLight(0xffffff, 1.2);

  private nodes = new Map<string, Mesh3dNode>();
  private nodeOrder = '';

  private gifTextures = new Map<GifData, THREE.Texture[]>();
  private staticTextures = new Map<string, THREE.Texture>();

  private width = 0;
  private height = 0;

  private constructor(renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement) {
    this.renderer = renderer;
    this.canvas = canvas;
    this.renderer.setClearColor(0x000000, 0);
    this.camera = new THREE.PerspectiveCamera(45, 1, NEAR, FAR);
    this.scene.add(this.group, this.ambientLight, this.headlight, this.headlight.target);
  }

  static create(): ThreeSceneRenderer {
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    return new ThreeSceneRenderer(renderer, canvas);
  }

  /** Renders the 3D scene at time t and returns the backing canvas (valid until the next call). */
  renderToCanvas(t: number, mesh3dLayers: Mesh3dLayer[], camera3d: Camera3dConfig, width: number, height: number): HTMLCanvasElement {
    if (this.width !== width || this.height !== height) {
      this.renderer.setSize(width, height, false);
      this.width = width;
      this.height = height;
    }
    this.syncCamera(camera3d, t, width / height);
    this.reconcileNodes(mesh3dLayers);
    mesh3dLayers.forEach((layer) => this.syncMesh(this.nodes.get(layer.id)!, layer, t));
    this.sweepTextures(mesh3dLayers);
    this.renderer.render(this.scene, this.camera);
    return this.canvas;
  }

  destroy() {
    for (const node of this.nodes.values()) this.disposeNode(node);
    this.nodes.clear();
    for (const arr of this.gifTextures.values()) arr.forEach((tex) => tex.dispose());
    this.gifTextures.clear();
    for (const tex of this.staticTextures.values()) tex.dispose();
    this.staticTextures.clear();
    this.renderer.dispose();
  }

  // --------------------------------------------------------------------- camera

  private syncCamera(camera3d: Camera3dConfig, t: number, aspect: number) {
    if (camera3d.projection !== this.cameraProjection) {
      this.camera = camera3d.projection === 'orthographic'
        ? new THREE.OrthographicCamera(-1, 1, 1, -1, NEAR, FAR)
        : new THREE.PerspectiveCamera(45, aspect, NEAR, FAR);
      this.cameraProjection = camera3d.projection;
    }

    const pose = resolveCameraPose(camera3d, t);
    this.camera.position.set(pose.eyeX, pose.eyeY, pose.eyeZ);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(pose.targetX, pose.targetY, pose.targetZ);
    if (pose.rollRad) this.camera.rotateZ(pose.rollRad);
    this.headlight.position.set(pose.eyeX, pose.eyeY, pose.eyeZ);
    this.headlight.target.position.set(pose.targetX, pose.targetY, pose.targetZ);

    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.fov = pose.fovDeg;
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    } else {
      const fovRad = (pose.fovDeg * Math.PI) / 180;
      const halfHeight = pose.distance * Math.tan(fovRad / 2);
      const halfWidth = halfHeight * aspect;
      this.camera.left = -halfWidth;
      this.camera.right = halfWidth;
      this.camera.top = halfHeight;
      this.camera.bottom = -halfHeight;
      this.camera.updateProjectionMatrix();
    }
  }

  // ---------------------------------------------------------------- reconcile

  private reconcileNodes(layers: Mesh3dLayer[]) {
    const ids = new Set(layers.map((l) => l.id));
    for (const [id, node] of this.nodes) {
      if (!ids.has(id)) {
        this.disposeNode(node);
        this.nodes.delete(id);
      }
    }
    for (const layer of layers) {
      if (!this.nodes.has(layer.id)) {
        const geometry = new THREE.BufferGeometry();
        const material = new THREE.MeshStandardMaterial();
        this.nodes.set(layer.id, {
          instances: [], geometry, material,
          baseGeometry: null, geometryKey: '', styleKey: '', textureKey: ''
        });
      }
    }
    const order = layers.map((l) => l.id).join('\n');
    if (order !== this.nodeOrder) {
      // Three doesn't track sibling order the way a Pixi Container's
      // children array does for opaque geometry (depth testing, not paint
      // order, decides what's visible), so membership is all that matters;
      // this just keeps group.children tidy for disposed/re-added layers.
      this.nodeOrder = order;
    }
  }

  private disposeNode(node: Mesh3dNode) {
    for (const inst of node.instances) this.group.remove(inst.anchor);
    node.geometry.dispose();
    node.material.dispose();
  }

  private syncMesh(node: Mesh3dNode, layer: Mesh3dLayer, t: number) {
    if (layer.hidden) {
      node.instances.forEach(({ mesh }) => { mesh.visible = false; });
      return;
    }

    const geometryKey = primitiveGeometryKey(layer);
    if (geometryKey !== node.geometryKey || !node.baseGeometry) {
      node.baseGeometry = generateMesh3dGeometry(layer);
      node.geometry.setAttribute('position', new THREE.BufferAttribute(node.baseGeometry.positions.slice(), 3));
      node.geometry.setAttribute('normal', new THREE.BufferAttribute(node.baseGeometry.normals.slice(), 3));
      node.geometry.setAttribute('uv', new THREE.BufferAttribute(node.baseGeometry.uvs, 2));
      node.geometry.setIndex(new THREE.BufferAttribute(node.baseGeometry.indices, 1));
      node.geometryKey = geometryKey;
    }

    const deformed = deformGeometry(node.baseGeometry, layer, t);
    if (deformed !== node.baseGeometry) {
      (node.geometry.attributes.position as THREE.BufferAttribute).set(deformed.positions);
      (node.geometry.attributes.normal as THREE.BufferAttribute).set(deformed.normals);
      node.geometry.attributes.position.needsUpdate = true;
      node.geometry.attributes.normal.needsUpdate = true;
    }

    const texture = this.resolveTexture(layer, t);
    this.syncMaterial(node, layer, texture);

    const instances = getMesh3dInstances(layer, t);
    while (node.instances.length < instances.length) {
      const anchor = new THREE.Group();
      const mesh = new THREE.Mesh(node.geometry, node.material);
      anchor.add(mesh);
      this.group.add(anchor);
      node.instances.push({ anchor, mesh });
    }
    while (node.instances.length > instances.length) {
      const { anchor } = node.instances.pop()!;
      this.group.remove(anchor);
    }

    const DEG = Math.PI / 180;
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i];
      const { anchor, mesh } = node.instances[i];
      mesh.visible = true;
      mesh.material = node.material;
      anchor.position.set(inst.x + layer.pivotX, inst.y + layer.pivotY, inst.z + layer.pivotZ);
      anchor.rotation.set(inst.rotationXDeg * DEG, inst.rotationYDeg * DEG, inst.rotationZDeg * DEG, 'XYZ');
      anchor.scale.set(inst.scaleX, inst.scaleY, inst.scaleZ);
      mesh.position.set(-layer.pivotX, -layer.pivotY, -layer.pivotZ);
    }
  }

  private syncMaterial(node: Mesh3dNode, layer: Mesh3dLayer, texture: THREE.Texture | null) {
    const styleKey = materialStyleKey(layer, texture !== null);
    const textureChanged = node.textureKey !== (texture ? texture.uuid : '');
    if (styleKey === node.styleKey && !textureChanged) return;
    node.styleKey = styleKey;
    node.textureKey = texture ? texture.uuid : '';

    node.material.dispose();
    const common = {
      side: layer.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      depthTest: layer.depthTest,
      transparent: true,
      map: texture ?? null,
      color: texture ? 0xffffff : new THREE.Color(layer.fillColor || '#6366f1')
    };
    let material: THREE.Material;
    if (layer.wireframe) {
      material = new THREE.MeshBasicMaterial({ ...common, wireframe: true, color: new THREE.Color(layer.wireframeColor) });
    } else if (layer.shadingModel === 'unlit') {
      material = new THREE.MeshBasicMaterial(common);
    } else {
      material = new THREE.MeshStandardMaterial({
        ...common,
        flatShading: layer.shadingModel === 'flat',
        roughness: 0.85,
        metalness: 0
      });
    }
    applyBlendMode(material, layer.blendMode);
    node.material = material;
    for (const { mesh } of node.instances) mesh.material = material;
  }

  // ----------------------------------------------------------------- textures

  private resolveTexture(layer: Mesh3dLayer, t: number): THREE.Texture | null {
    let texture: THREE.Texture | null = null;
    if (layer.gifData) {
      const idx = getGifFrameIndexAtTime(layer.gifData, t, layer.gifSpeed ?? 1);
      if (idx >= 0) {
        const textures = this.getGifTextures(layer.gifData);
        texture = textures[Math.min(idx, textures.length - 1)] ?? null;
      }
    }
    if (!texture && layer.src) texture = this.getStaticTexture(layer.src);
    if (texture) this.applyUv(texture, layer);
    return texture;
  }

  private applyUv(texture: THREE.Texture, layer: Mesh3dLayer) {
    texture.wrapS = texture.wrapT = layer.uvRepeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.repeat.set(layer.uvScale, layer.uvScale);
    texture.rotation = (layer.uvRotation * Math.PI) / 180;
    texture.offset.set(layer.uvOffsetX, layer.uvOffsetY);
    texture.needsUpdate = true;
  }

  private getGifTextures(gif: GifData): THREE.Texture[] {
    let arr = this.gifTextures.get(gif);
    if (!arr) {
      arr = gif.frames.map((f) => {
        const tex = new THREE.Texture(f.image as ImageBitmap);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        return tex;
      });
      this.gifTextures.set(gif, arr);
    }
    return arr;
  }

  private getStaticTexture(src: string): THREE.Texture | null {
    const cached = this.staticTextures.get(src);
    if (cached) return cached;
    const img = getCachedImage(src);
    if (!img) return null;
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this.staticTextures.set(src, tex);
    return tex;
  }

  /** Mirrors PixiSceneRenderer.sweepTextures: GPU memory doesn't GC itself. */
  private sweepTextures(layers: Mesh3dLayer[]) {
    const gifs = new Set<GifData>();
    const srcs = new Set<string>();
    for (const l of layers) {
      if (l.gifData) gifs.add(l.gifData);
      if (l.src) srcs.add(l.src);
    }
    for (const [gif, arr] of this.gifTextures) {
      if (!gifs.has(gif)) {
        arr.forEach((tex) => tex.dispose());
        this.gifTextures.delete(gif);
      }
    }
    for (const [src, tex] of this.staticTextures) {
      if (!srcs.has(src)) {
        tex.dispose();
        this.staticTextures.delete(src);
      }
    }
  }
}
