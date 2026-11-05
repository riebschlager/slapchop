"""
GIF Rings for TouchDesigner: a port of Slapchop's "Rings" mode.

GIFs are placed on rings of cards that fly toward the camera down an endless
corridor. This file is both the network builder and the runtime engine.

USAGE
  1. Create a Text DAT in any network, paste this file into it (or point the
     DAT's File parameter at this file).
  2. Right-click the DAT > Run Script (or Ctrl+R). A Base COMP named `gif_rings_v2`
     is built next to it (`gif_rings_v2_comp` if the DAT itself is named
     `gif_rings_v2`). Running the script again updates an existing
     `gif_rings_v2` in place and keeps your parameter values.
  3. On the `gif_rings_v2` COMP, set Rings > GIF Folder to a folder of .gif, .png
     or .jpg files. Frames load into an atlas over a few seconds; Status shows
     progress.
  4. The COMP's `out1` TOP is the result, sized by Rings > Output Width/Height
     (default 1080 x 1920, Slapchop's frame). Other aspect ratios keep the
     vertical field of view and show more or less of the corridor sideways.


V2 LIVE TEXTURES
  Sources > Source Mode selects GIF Folder (default), TOP List, or Texture COMP.
  TOP List: assign one or multiple external 2D TOP paths to Source TOPs, in order.
  Texture COMP: assign a BASE/COMP; its immediate TOP children matching TOP
  Pattern (default tex_*) are collected in natural numeric name order.
  Publish texture networks through Null TOPs such as tex_001 and tex_002.
  Pulse Refresh Sources after adding/removing/renaming published outputs.
  Source parameter changes refresh automatically. Source resolution changes
  update aspect metadata each frame. At most 256 live sources are supported.

  Each live source occupies one GPU atlas cell and repeats around its assigned
  ring. Source Alpha defaults to Premultiplied; choose Straight to premultiply
  on the GPU before packing. All sources must share the selected convention.
  Texture Antialiasing averages 4 subpixel samples by default; High uses 16
  at higher GPU cost, and Off uses one. Taps stay inside their source tile.
  This refines v1 sampling for both folder and live textures.
  Cell Size controls texture quality. Live atlases use RGBA16F and do not read
  source pixels back into Python. Source networks own playback; GIF temporal
  phase/speed controls do not time-shift live TOPs. Time still drives geometry.
  Deterministic recording requires upstream sources driven by the same time;
  cameras, feedback, and wall-clock animation cannot be scrubbed by this COMP.
  Keep source networks external and do not feed this renderer back into them.
  Use ordinary 2D color TOPs, not texture arrays, volumes, or depth textures.

  live_sources      Generated Select/Null TOPs and GPU layouts (do not edit).
  atlas_select      Select TOP referencing the file or nested live atlas.
  texture_atlas     Null TOP routing atlas_select to the material.
  V2 builds separately from V1 and preserves V1 files and components.

HOW IT MATCHES SLAPCHOP
  `resolve_rings` ports `resolveRings` from src/modes/rings/model.ts directly:
  the same projection, twist, fog, horizon fade, seeded shuffle, size sweep,
  size noise and position noise hashes. GIF frame timing uses each frame's own
  delay, as Slapchop does (a delay under 20 ms plays as 100 ms). Cards are drawn
  far to near in the same order with source-over alpha, so a frame at time t
  should match Slapchop at the same t, settings and asset order. Assets are
  sorted by file name; Slapchop uses import order.

  Master FX is not ported.

RUNTIME LAYOUT (inside gif_rings_v2)
  gif_rings_v2_engine  Text DAT: this file, used as a module.
  atlas             Script TOP: every GIF frame packed into one texture.
  instances         Script TOP: a 3-row float texture, one column per card,
                    rebuilt every frame from the parameters and Time.
  count             Pattern CHOP: its length sets the geometry's instance count.
  geo / card        Geometry COMP instancing a 1x1 Rectangle SOP.
  card_mat          GLSL MAT: positions each card in 1080x1920 screen space
                    straight from `instances` and samples `atlas`.
  render -> out1    Render TOP over the void color.

  Time defaults to `absTime.seconds`. Replace that with any expression, for
  example `me.time.seconds` to follow the timeline.
"""

import fnmatch
import math
import os
import re
import struct
import uuid

import numpy as np

ENGINE_NAME = 'gif_rings_v2_engine'
COMP_NAME = 'gif_rings_v2'
CANVAS_W, CANVAS_H = 1080, 1920
MAX_TEXTURE = 16384
CARD_KEY_STRIDE = 64
SUPPORTED_EXT = ('.gif', '.png', '.jpg', '.jpeg')

# ---------------------------------------------------------------------------
# Config: mirrors DEFAULT_RINGS and normalizeRings in src/modes/rings/model.ts
# ---------------------------------------------------------------------------

DEFAULTS = {
    'speed': 900.0, 'gifsPerRing': 12, 'ringCount': 24, 'radius': 850.0, 'spacing': 700.0,
    'gifSize': 320.0, 'twist': 8.0, 'rotationSpeed': 6.0, 'radialOrientation': False,
    'gifRotation': 0.0, 'fov': 74.0, 'cameraX': 0.0, 'cameraY': 0.0, 'cameraRoll': 0.0,
    'gifSpeed': 1.0, 'ringPhase': 0.0, 'shuffle': False, 'seed': 1, 'fog': 0.00015,
    'sizeMotion': {'sweep': False, 'min': 200.0, 'max': 520.0, 'speed': 0.25, 'ringSpread': 0.08,
                   'noise': False, 'noiseAmplitude': 80.0, 'noisePeriod': 1.5},
    'positionNoise': {'enabled': False, 'amplitude': 120.0, 'period': 900.0, 'speed': 0.4},
}

LIMITS = {
    'speed': (-2400, 2400), 'gifsPerRing': (1, 48), 'ringCount': (4, 48),
    'radius': (100, 2400), 'spacing': (100, 2400), 'gifSize': (20, 1600),
    'twist': (-180, 180), 'rotationSpeed': (-90, 90), 'gifRotation': (-180, 180), 'fov': (30, 120),
    'cameraX': (-1600, 1600), 'cameraY': (-1600, 1600), 'cameraRoll': (-180, 180),
    'gifSpeed': (0, 4), 'ringPhase': (0, 1), 'seed': (0, 100000), 'fog': (0, 0.001),
}
SIZE_MOTION_LIMITS = {'min': (20, 1600), 'max': (20, 1600), 'speed': (0, 10), 'ringSpread': (-0.5, 0.5),
                      'noiseAmplitude': (0, 800), 'noisePeriod': (0.05, 10)}
POSITION_NOISE_LIMITS = {'amplitude': (0, 1600), 'period': (50, 5000), 'speed': (0, 10)}


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _js_round(v):
    # Math.round rounds halves toward +infinity; Python's round() is banker's.
    return int(math.floor(v + 0.5))


def normalize(cfg):
    out = dict(DEFAULTS)
    for key, (lo, hi) in LIMITS.items():
        v = cfg.get(key)
        if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
            out[key] = _clamp(float(v), lo, hi)
    for key in ('gifsPerRing', 'ringCount', 'seed'):
        out[key] = _js_round(out[key])
    for key in ('shuffle', 'radialOrientation'):
        if isinstance(cfg.get(key), bool):
            out[key] = cfg[key]
    for group, limits in (('sizeMotion', SIZE_MOTION_LIMITS), ('positionNoise', POSITION_NOISE_LIMITS)):
        src = cfg.get(group) or {}
        merged = dict(DEFAULTS[group])
        for key, (lo, hi) in limits.items():
            v = src.get(key)
            if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
                merged[key] = _clamp(float(v), lo, hi)
        for key in ('sweep', 'noise', 'enabled'):
            if key in merged and isinstance(src.get(key), bool):
                merged[key] = src[key]
        out[group] = merged
    return out


# ---------------------------------------------------------------------------
# Noise and projection: vectorized ports of ringCardSize, ringCardOffset and
# resolveRings. Hash constants are identical so seeds reproduce Slapchop.
# ---------------------------------------------------------------------------

def _fract(x):
    return np.mod(x, 1.0)


def _value_noise(x, key, seed):
    cell = np.floor(x)
    f = x - cell
    eased = f * f * (3 - 2 * f)

    def h(n):
        return _fract(np.sin((n + key * 1013 + 1) * 12.9898 + seed * 78.233) * 43758.5453)
    a = h(cell)
    return (a + (h(cell + 1) - a) * eased) * 2 - 1


def _value_noise3(x, y, z, key, seed):
    ix, iy, iz = np.floor(x), np.floor(y), np.floor(z)

    def ease(f):
        return f * f * (3 - 2 * f)
    fx, fy, fz = ease(x - ix), ease(y - iy), ease(z - iz)

    def h(a, b, d):
        return _fract(np.sin(a * 127.1 + b * 311.7 + d * 74.7 + key * 1013 + seed * 78.233) * 43758.5453)

    def lerp(a, b, f):
        return a + (b - a) * f

    def plane(d):
        return lerp(lerp(h(ix, iy, d), h(ix + 1, iy, d), fx),
                    lerp(h(ix, iy + 1, d), h(ix + 1, iy + 1, d), fx), fy)
    return lerp(plane(iz), plane(iz + 1), fz) * 2 - 1


def frame_index(asset, source_time):
    """getGifFrameIndexAtTime: frame whose [start, end) contains the looped time."""
    total = asset['total_ms']
    if asset['frames'] <= 1 or total <= 0:
        return 0
    t_ms = abs(source_time * 1000.0) % total
    idx = int(np.searchsorted(asset['ends_ms'], t_ms, side='right'))
    return min(idx, asset['frames'] - 1)


def resolve_rings(assets, cfg, t):
    """Returns a dict of per-card arrays in draw order (far ring first).

    x, y are pixels from the canvas center (y down), width/height in pixels,
    rotation in radians (clockwise on screen), plus alpha, asset index, ring
    index and the asset's source time. Rings at depth < 1 are omitted.
    """
    if not assets:
        return None
    c = normalize(cfg)
    rad = math.radians
    g = c['gifsPerRing']
    travel = c['speed'] * t
    first = math.floor(travel / c['spacing']) + 1
    focal = 960 / math.tan(rad(c['fov']) / 2)
    roll = rad(c['cameraRoll'])
    seed = c['seed']

    ring_index = first + np.arange(c['ringCount'] - 1, -1, -1, dtype=np.float64)
    depth = ring_index * c['spacing'] - travel
    keep = depth >= 1
    ring_index, depth = ring_index[keep], depth[keep]
    if ring_index.size == 0:
        return None

    n = len(assets)
    if c['shuffle']:
        rnd = np.sin(ring_index * 12.9898 + seed * 78.233) * 43758.5453
        asset_idx = np.floor(_fract(rnd) * n).astype(np.int64)
    else:
        asset_idx = np.mod(ring_index - 1, n).astype(np.int64)
    aspects = np.array([a['aspect'] for a in assets])[asset_idx]
    totals = np.array([a['total_ms'] for a in assets])[asset_idx]

    scale = focal / depth
    horizon = np.clip((c['ringCount'] * c['spacing'] - depth) / c['spacing'], 0, 1)
    alpha = np.exp(-np.power(depth * c['fog'], 2)) * horizon
    source_time = t * c['gifSpeed'] + _fract(ring_index * c['ringPhase']) * totals / 1000.0

    ri = ring_index[:, None]
    card = np.arange(g, dtype=np.float64)[None, :]
    home = card * math.pi * 2 / g + np.radians(ri * c['twist'])
    angle = home + rad(t * c['rotationSpeed'])

    pn = c['positionNoise']
    if pn['enabled'] and pn['amplitude'] != 0:
        px = np.cos(home) * c['radius'] / pn['period']
        py = np.sin(home) * c['radius'] / pn['period']
        pz = ri * c['spacing'] / pn['period'] + t * pn['speed'] + 0 * card
        off_x = _value_noise3(px, py, pz, 1, seed) * pn['amplitude']
        off_y = _value_noise3(px, py, pz, 2, seed) * pn['amplitude']
    else:
        off_x = off_y = 0.0

    sm = c['sizeMotion']
    size = np.full(home.shape, c['gifSize'])
    if sm['sweep']:
        wave = np.sin((t * sm['speed'] - ri * sm['ringSpread']) * math.pi * 2)
        size = sm['min'] + (sm['max'] - sm['min']) * (wave * 0.5 + 0.5) + 0 * card
    if sm['noise'] and sm['noiseAmplitude'] != 0:
        size = size + _value_noise(t / sm['noisePeriod'], ri * CARD_KEY_STRIDE + card, seed) * sm['noiseAmplitude']
    size = np.maximum(1, size) * scale[:, None]

    x = (np.cos(angle) * c['radius'] + off_x - c['cameraX']) * scale[:, None]
    y = (np.sin(angle) * c['radius'] + off_y - c['cameraY']) * scale[:, None]
    asp = aspects[:, None]
    width = size * np.minimum(1, asp)
    height = size * np.minimum(1, 1 / asp)
    rotation = (angle + math.pi / 2 if c['radialOrientation'] else 0 * angle) + rad(c['gifRotation']) + roll

    def per_card(v):
        return np.broadcast_to(np.asarray(v)[:, None], home.shape).ravel()
    return {
        'x': (x * math.cos(roll) - y * math.sin(roll)).ravel(),
        'y': (x * math.sin(roll) + y * math.cos(roll)).ravel(),
        'width': width.ravel(), 'height': height.ravel(), 'rotation': rotation.ravel(),
        'alpha': per_card(alpha), 'asset': per_card(asset_idx), 'ring': per_card(ring_index),
        'source_time': per_card(source_time),
    }


def instance_texture(assets, tile_uv, cfg, t, aspect=CANVAS_W / CANVAS_H):
    """Pack resolve_rings into a (3, N, 4) float32 array for the GLSL MAT.

    Row 0: x, y, width, height
    Row 1: rotation, alpha, visible half-width in canvas units
    Row 2: atlas u0, v0, du, dv
    N is the maximum card count; unused columns have zero size and alpha.
    `aspect` is output width / height. The canvas stays 1920 units tall, so
    vertical FOV is preserved and other aspects reveal more or less of it
    horizontally; 9:16 is exactly Slapchop's frame.
    """
    c = normalize(cfg)
    n = max(1, c['ringCount'] * c['gifsPerRing'])
    data = np.zeros((3, n, 4), dtype=np.float32)
    data[1, :, 2] = CANVAS_H * aspect / 2
    sprites = resolve_rings(assets, c, t)
    if sprites is None:
        return data
    count = sprites['x'].size
    data[0, :count, 0] = sprites['x']
    data[0, :count, 1] = sprites['y']
    data[0, :count, 2] = sprites['width']
    data[0, :count, 3] = sprites['height']
    data[1, :count, 0] = sprites['rotation']
    data[1, :count, 1] = sprites['alpha']
    # The source time is constant within a ring, so look frames up per ring.
    g = c['gifsPerRing']
    tiles = np.empty(count, dtype=np.int64)
    for start in range(0, count, g):
        asset = assets[int(sprites['asset'][start])]
        tiles[start:start + g] = asset['tile0'] + frame_index(asset, float(sprites['source_time'][start]))
    data[2, :count] = tile_uv[tiles]
    return data


# ---------------------------------------------------------------------------
# File metadata: frame delays straight from the GIF blocks, so timing matches
# Slapchop regardless of how TouchDesigner's decoder reports frame rate.
# ---------------------------------------------------------------------------

def _skip_sub_blocks(data, pos):
    while pos < len(data):
        size = data[pos]
        pos += 1
        if size == 0:
            break
        pos += size
    return pos


def parse_gif(data):
    if data[:6] not in (b'GIF87a', b'GIF89a'):
        raise ValueError('not a GIF')
    width, height = struct.unpack('<HH', data[6:10])
    flags = data[10]
    pos = 13
    if flags & 0x80:
        pos += 3 * (2 ** ((flags & 7) + 1))
    delays, pending = [], None
    while pos < len(data):
        block = data[pos]
        pos += 1
        if block == 0x21:
            label = data[pos]
            pos += 1
            if label == 0xF9 and pos + 4 <= len(data) and data[pos] >= 4:
                pending = struct.unpack('<H', data[pos + 2:pos + 4])[0]
            pos = _skip_sub_blocks(data, pos)
        elif block == 0x2C:
            img_flags = data[pos + 8]
            pos += 9
            if img_flags & 0x80:
                pos += 3 * (2 ** ((img_flags & 7) + 1))
            pos = _skip_sub_blocks(data, pos + 1)
            delays.append(pending or 0)
            pending = None
        else:
            break  # 0x3B trailer, or truncated data: keep the frames found so far
    if not delays:
        raise ValueError('GIF has no frames')
    # gifUtils.ts: centiseconds -> ms, and anything under 20 ms plays as 100 ms.
    ms = [d * 10 if d * 10 >= 20 else 100 for d in delays]
    return width, height, ms


def image_size(data):
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return struct.unpack('>II', data[16:24])
    if data[:2] == b'\xff\xd8':
        pos = 2
        while pos + 9 < len(data):
            if data[pos] != 0xFF:
                pos += 1
                continue
            marker = data[pos + 1]
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                pos += 2
                continue
            length = struct.unpack('>H', data[pos + 2:pos + 4])[0]
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                h, w = struct.unpack('>HH', data[pos + 5:pos + 9])
                return w, h
            pos += 2 + length
    raise ValueError('unrecognized image header')


def read_asset_meta(path):
    with open(path, 'rb') as f:
        data = f.read()
    if path.lower().endswith('.gif'):
        w, h, delays = parse_gif(data)
    else:
        (w, h), delays = image_size(data), [0]
    ends = np.cumsum(delays).astype(np.float64)
    return {
        'name': os.path.basename(path), 'path': path, 'frames': len(delays),
        'width': w, 'height': h, 'aspect': max(1, w) / max(1, h),
        'ends_ms': ends, 'total_ms': float(ends[-1]) if len(delays) > 1 else 0.0,
    }


def atlas_layout(total_tiles, cell):
    cols = max(1, math.ceil(math.sqrt(total_tiles)))
    rows = max(1, math.ceil(total_tiles / cols))
    cell = int(max(16, min(cell, MAX_TEXTURE // cols, MAX_TEXTURE // rows)))
    w, h = cols * cell, rows * cell
    k = np.arange(total_tiles)
    # numpy row 0 is the bottom of a TouchDesigner texture; tiles fill upward.
    tile_uv = np.stack([(k % cols) * cell / w, (k // cols) * cell / h,
                        np.full(total_tiles, cell / w), np.full(total_tiles, cell / h)], axis=1)
    return cols, rows, cell, tile_uv.astype(np.float32)


# ---------------------------------------------------------------------------
# TouchDesigner runtime. Everything below touches TD globals and only runs
# inside TouchDesigner.
# ---------------------------------------------------------------------------

_STATE = {}


def _state(comp):
    return _STATE.setdefault(comp.path, {'generation': 0, 'assets': [], 'atlas': None,
                                         'tile_uv': np.zeros((1, 4), np.float32), 'loading': False,
                                         'attempted': False})


# Live sources use one tile per TOP. Pixels stay on the GPU; only dimensions
# and stable tile indices enter the existing scene calculations.
MAX_LIVE_SOURCES = 256


def natural_key(name):
    return tuple((1, int(part)) if part.isdigit() else (0, part.casefold())
                 for part in re.split(r'(\d+)', name))


def live_asset(path, width, height, index):
    if width < 1 or height < 1:
        raise ValueError('{} has no usable image ({}x{})'.format(path, width, height))
    return {'path': path, 'width': width, 'height': height, 'aspect': width / height,
            'frames': 1, 'total_ms': 0, 'ends_ms': np.array([0]), 'tile0': index}


def validate_sources(comp, sources):
    if not sources:
        raise ValueError('No source TOPs found; assign TOPs or publish matching TOPs in Texture COMP')
    if len(sources) > MAX_LIVE_SOURCES:
        raise ValueError('At most {} live TOPs are supported'.format(MAX_LIVE_SOURCES))
    seen = set()
    for source in sources:
        if not source.isTOP:
            raise ValueError('{} is not a TOP'.format(source.path))
        if source.path.startswith(comp.path + '/'):
            raise ValueError('Source {} is inside this renderer; use an external texture network'.format(source.path))
        if source.path in seen:
            raise ValueError('Duplicate source TOP: ' + source.path)
        seen.add(source.path)
    return sources


def resolve_sources(comp):
    if comp.par.Sourcemode.eval() == 'tops':
        # Typed TOP parameters evaluate directly to an OP (or an OP list).
        # Prefer that result: evalOPs() can resolve differently for a typed
        # reference even when the parameter already holds a valid single TOP.
        value = comp.par.Sourcetops.eval()
        if getattr(value, 'isTOP', False):
            sources = [value]
        elif isinstance(value, (list, tuple)):
            sources = list(value)
        else:
            sources = list(comp.par.Sourcetops.evalOPs())
        if not sources:
            raise ValueError('TOP List resolved no sources; assign existing TOP paths to Source TOPs '
                             '(for example /project1/textures/tex_001), or select Texture COMP mode')
    else:
        collection = comp.par.Texturecomp.eval()
        if collection is None or not getattr(collection, 'isCOMP', False):
            raise ValueError('Assign a BASE or other COMP to Texture COMP')
        pattern = comp.par.Toppattern.eval().strip()
        if not pattern:
            raise ValueError('TOP Pattern is empty; use tex_* or another child-name pattern')
        children = sorted((child for child in collection.children if child.isTOP),
                          key=lambda child: (natural_key(child.name), child.name))
        sources = [child for child in children if fnmatch.fnmatchcase(child.name, pattern)]
        if not sources:
            available = ', '.join(child.name for child in children[:8]) or '(none)'
            raise ValueError('{}: no immediate child TOPs match {!r}; available TOPs: {}. '
                             'Change TOP Pattern or publish matching Null TOPs directly inside this COMP'.format(
                                 collection.path, pattern, available))
    return validate_sources(comp, sources)


def _required(target, name, value):
    # A missing atlas parameter must fail visibly, rather than silently alter UV packing.
    par = getattr(target.par, name, None)
    if par is None:
        raise RuntimeError('{} lacks required parameter {}'.format(target.path, name))
    par.val = value


def _layout(parent_comp, name, align, width, height, x, y):
    top = _ensure(parent_comp, layoutTOP, name, x, y)
    for param, value in [('align', align), ('fit', 'fill'), ('scaleres', False),
                         ('outputresolution', 'custom'), ('outputaspect', 'resolution'), ('resolutionw', width),
                         ('resolutionh', height), ('resmult', False),
                         ('format', 'rgba16float'), ('inputfiltertype', 'linear'), ('compover', False)]:
        _required(top, param, value)
    return top


# Premultiply before atlas resampling, so transparent edges filter correctly.
LIVE_ALPHA_SHADER = '''layout(location = 0) out vec4 fragColor;
void main()
{
    vec4 c = texture(sTD2DInputs[0], vUV.st);
    fragColor = TDOutputSwizzle(vec4(c.rgb * c.a, c.a));
}
'''


def clear_live_sources(comp):
    # Switch the cross-network reference before destroying the generated TOPs.
    _required(comp.op('atlas_select'), 'top', 'atlas')
    for child in list(comp.op('live_sources').children):
        child.destroy()


def load_live_sources(comp):
    st = _state(comp)
    try:
        sources = resolve_sources(comp)
        assets = [live_asset(s.path, s.width, s.height, i) for i, s in enumerate(sources)]
        cols, rows, cell, tile_uv = atlas_layout(len(sources), int(comp.par.Cellsize.eval()))
        network = comp.op('live_sources')
        alpha_shader = _text_dat(network, 'premultiply_pixel', LIVE_ALPHA_SHADER, -400, 200)
        blank = _ensure(network, constantTOP, 'blank', -200, 200)
        for param, value in [('colorr', 0), ('colorg', 0), ('colorb', 0), ('alpha', 0),
                             ('outputresolution', 'custom'), ('resolutionw', cell), ('resolutionh', cell),
                             ('resmult', False), ('format', 'rgba16float')]:
            _required(blank, param, value)
        tiles = []
        for i, source in enumerate(sources):
            selected = _ensure(network, selectTOP, 'source{}'.format(i), -600, -i * 130)
            _required(selected, 'top', source.path)
            _required(selected, 'resmult', False)
            selected_out = _ensure(network, nullTOP, 'source_out{}'.format(i), -400, -i * 130)
            _required(selected_out, 'resmult', False)
            selected_out.inputConnectors[0].connect(selected)
            if comp.par.Sourcealpha.eval() == 'straight':
                normalized = _ensure(network, glslTOP, 'premultiply{}'.format(i), -200, -i * 130)
                _required(normalized, 'pixeldat', alpha_shader.name)
                _required(normalized, 'format', 'rgba16float')
                _required(normalized, 'resmult', False)
                normalized.inputConnectors[0].connect(selected_out)
                tiles.append(normalized)
            else:
                tiles.append(selected_out)
        tiles.extend([blank] * (rows * cols - len(tiles)))
        row_tops = []
        for r in range(rows):
            row = _layout(network, 'row{}'.format(r), 'horizlr', cols * cell, cell, 200, -r * 150)
            _required(row, 'top', tiles[r * cols:(r + 1) * cols])
            row_tops.append(row)
        # Match atlas_layout: source zero occupies the bottom-left cell.
        atlas = _layout(network, 'live_atlas', 'vertbt', cols * cell, rows * cell, 400, 100)
        _required(atlas, 'top', row_tops)
        # Wires cannot cross a BASE boundary. Reference the nested atlas through
        # the parent-level Select TOP, which stays wired to texture_atlas.
        _required(comp.op('atlas_select'), 'top', 'live_sources/live_atlas')
        st.update(assets=assets, tile_uv=tile_uv, source_paths=[s.path for s in sources])
        _set_status(comp, 'Live: {} TOPs, {}x{} atlas, {}px cells; playback owned upstream'.format(
            len(sources), cols * cell, rows * cell, cell))
    except (ValueError, RuntimeError) as err:
        # Clear a partially built graph and keep the renderer on its empty file atlas.
        clear_live_sources(comp)
        st.update(assets=[], source_paths=[])
        _set_status(comp, 'Live source error: ' + str(err))


def update_live_metadata(comp):
    st = _state(comp)
    for i, path in enumerate(st.get('source_paths', [])):
        source = comp.op(path)
        if source is None:
            clear_live_sources(comp)
            st.update(assets=[], source_paths=[])
            _set_status(comp, 'Source removed: {}; pulse Refresh Sources'.format(path))
            return
        # A source can change resolution without changing the collection or atlas.
        try:
            asset = st['assets'][i]
            if (source.width, source.height) != (asset['width'], asset['height']):
                st['assets'][i] = live_asset(path, source.width, source.height, i)
        except ValueError as err:
            clear_live_sources(comp)
            st.update(assets=[], source_paths=[])
            _set_status(comp, '{}; pulse Refresh Sources'.format(err))
            return


def _set_status(comp, text):
    comp.par.Status = text
    print('[gif_rings_v2] ' + text)


def read_config(comp):
    p = comp.par
    return {
        'speed': p.Speed.eval(), 'gifsPerRing': p.Gifsperring.eval(), 'ringCount': p.Ringcount.eval(),
        'radius': p.Radius.eval(), 'spacing': p.Spacing.eval(), 'gifSize': p.Gifsize.eval(),
        'twist': p.Twist.eval(), 'rotationSpeed': p.Rotationspeed.eval(),
        'radialOrientation': bool(p.Radialorientation.eval()), 'gifRotation': p.Gifrotation.eval(),
        'fov': p.Fov.eval(), 'cameraX': p.Camerax.eval(), 'cameraY': p.Cameray.eval(),
        'cameraRoll': p.Cameraroll.eval(), 'gifSpeed': p.Gifspeed.eval(), 'ringPhase': p.Ringphase.eval(),
        'shuffle': bool(p.Shuffle.eval()), 'seed': p.Seed.eval(), 'fog': p.Fog.eval(),
        'sizeMotion': {
            'sweep': bool(p.Sizesweep.eval()), 'min': p.Sweepfrom.eval(), 'max': p.Sweepto.eval(),
            'speed': p.Sweepspeed.eval(), 'ringSpread': p.Sweepspread.eval(),
            'noise': bool(p.Sizenoise.eval()), 'noiseAmplitude': p.Sizenoiseamp.eval(),
            'noisePeriod': p.Sizenoiseperiod.eval(),
        },
        'positionNoise': {
            'enabled': bool(p.Posnoise.eval()), 'amplitude': p.Posnoiseamp.eval(),
            'period': p.Posnoiseperiod.eval(), 'speed': p.Posnoisespeed.eval(),
        },
    }


def frame_start(comp):
    """Execute DAT onFrameStart: size the instance count, then rebuild the card table."""
    st = _state(comp)
    if not st['attempted']:
        load_assets(comp)  # Module reloads rebuild the selected source pipeline.
    if comp.par.Sourcemode.eval() != 'folder':
        update_live_metadata(comp)
    cfg = normalize(read_config(comp))
    n = max(1, cfg['ringCount'] * cfg['gifsPerRing'])
    count = comp.op('count')
    if int(count.par.length.eval()) != n:
        count.par.length = n
    inst = comp.op('instances')
    if int(inst.par.resolutionw.eval()) != n:
        inst.par.resolutionw = n
    inst.cook(force=True)


def cook_instances(script_op):
    comp = script_op.parent()
    st = _state(comp)
    aspect = max(1, comp.par.Outputw.eval()) / max(1, comp.par.Outputh.eval())
    data = instance_texture(st['assets'], st['tile_uv'], read_config(comp), float(comp.par.Time.eval()), aspect)
    script_op.copyNumpyArray(np.ascontiguousarray(data))


def cook_atlas(script_op):
    atlas = _state(script_op.parent())['atlas']
    if atlas is None:
        atlas = np.zeros((1, 1, 4), dtype=np.uint8)
    script_op.copyNumpyArray(atlas)


def load_assets(comp):
    """Read every frame through Movie File In TOPs into one atlas, a few frames at a time.

    Movie File In decodes asynchronously, so each index is read Load Delay frames
    after it is requested rather than in the same frame.
    """
    st = _state(comp)
    st['generation'] = uuid.uuid4().hex
    st.update(assets=[], atlas=None, loading=False, attempted=True, job=None, source_paths=[])
    loaders = comp.op('loaders')
    for child in list(loaders.children):
        child.destroy()
    comp.op('atlas').cook(force=True)
    clear_live_sources(comp)
    if comp.par.Sourcemode.eval() != 'folder':
        load_live_sources(comp)
        return

    folder = comp.par.Folder.eval()
    if not folder or not os.path.isdir(folder):
        _set_status(comp, 'Set GIF Folder to a folder of GIFs or images')
        return
    files = sorted(f for f in os.listdir(folder) if f.lower().endswith(SUPPORTED_EXT) and not f.startswith('.'))
    metas = []
    for name in files:
        try:
            metas.append(read_asset_meta(os.path.join(folder, name)))
        except (OSError, ValueError, struct.error) as err:
            print('[gif_rings_v2] skipping {}: {}'.format(name, err))
    if not metas:
        _set_status(comp, 'No readable .gif/.png/.jpg files in ' + folder)
        return

    total = sum(m['frames'] for m in metas)
    cols, rows, cell, tile_uv = atlas_layout(total, int(comp.par.Cellsize.eval()))
    tile0 = 0
    for k, meta in enumerate(metas):
        meta['tile0'] = tile0
        meta['next'] = 0
        tile0 += meta['frames']
        loader = loaders.create(moviefileinTOP, 'load{}'.format(k))
        loader.par.file = meta['path']
        loader.par.playmode = 'specify'
        loader.par.indexunit = 'indices'
        loader.par.index = 0
        loader.par.outputresolution = 'custom'
        loader.par.resolutionw = cell
        loader.par.resolutionh = cell
        loader.nodeX = 0
        loader.nodeY = -120 * k
    st.update(loading=True, job={'metas': metas, 'cols': cols, 'cell': cell, 'tile_uv': tile_uv,
                                 'atlas': np.zeros((rows * cell, cols * cell, 4), dtype=np.uint8),
                                 'done': 0, 'total': total})
    _set_status(comp, 'Loading {} files, {} frames...'.format(len(metas), total))
    run('args[0].module._load_step(args[1], args[2])', me, comp, st['generation'],
        delayFrames=max(10, int(comp.par.Loaddelay.eval()) * 3))


def _load_step(comp, generation):
    st = _STATE.get(comp.path)
    if not st or st['generation'] != generation or not st.get('loading'):
        return  # superseded by a newer load
    job = st['job']
    cell, cols = job['cell'], job['cols']
    loaders = comp.op('loaders')
    for k, meta in enumerate(job['metas']):
        if meta['next'] >= meta['frames']:
            continue
        loader = loaders.op('load{}'.format(k))
        loader.cook(force=True)
        frame = loader.numpyArray(delayed=False)
        if frame is None:
            continue  # not decoded yet; retry next step
        frame = frame[..., :4] if frame.shape[2] >= 4 else np.dstack(
            [frame[..., :3], np.ones(frame.shape[:2], frame.dtype)])
        if frame.shape[:2] != (cell, cell):
            ys = (np.arange(cell) * frame.shape[0] // cell)
            xs = (np.arange(cell) * frame.shape[1] // cell)
            frame = frame[ys][:, xs]
        frame = np.clip(frame, 0, 1)
        # The shader expects premultiplied texels; premultiply if the decoder didn't.
        if np.any(frame[..., :3] > frame[..., 3:4] + 1.0 / 255):
            frame = frame.copy()
            frame[..., :3] *= frame[..., 3:4]
        tile = meta['tile0'] + meta['next']
        r, col = tile // cols, tile % cols
        job['atlas'][r * cell:(r + 1) * cell, col * cell:(col + 1) * cell] = (frame * 255 + 0.5).astype(np.uint8)
        meta['next'] += 1
        job['done'] += 1
        if meta['next'] < meta['frames']:
            loader.par.index = meta['next']

    if job['done'] < job['total']:
        comp.par.Status = 'Loading frames {}/{}'.format(job['done'], job['total'])
        run('args[0].module._load_step(args[1], args[2])', me, comp, generation,
            delayFrames=max(1, int(comp.par.Loaddelay.eval())))
        return

    atlas_top = comp.op('atlas')
    atlas_top.par.resolutionw = job['atlas'].shape[1]
    atlas_top.par.resolutionh = job['atlas'].shape[0]
    st.update(atlas=job['atlas'], tile_uv=job['tile_uv'], assets=job['metas'], loading=False, job=None)
    atlas_top.cook(force=True)
    for child in list(loaders.children):
        child.destroy()
    _set_status(comp, 'Loaded {} files, {} frames (atlas {}x{}, {}px cells)'.format(
        len(st['assets']), job['total'], st['atlas'].shape[1], st['atlas'].shape[0], cell))


# ---------------------------------------------------------------------------
# Network builder
# ---------------------------------------------------------------------------

VERTEX_SHADER = '''// Cards are already projected by the engine, so this writes clip space directly
// from canvas units (center origin, y down, 1920 tall) and ignores the camera.
// look.z is the visible half-width: 540 for Slapchop's 9:16 frame.
uniform sampler2D sInstances;

out vec2 vUV;
flat out vec4 vTile;
flat out float vAlpha;

void main()
{
    int id = TDInstanceID();
    vec4 geom = texelFetch(sInstances, ivec2(id, 0), 0);
    vec4 look = texelFetch(sInstances, ivec2(id, 1), 0);
    vTile = texelFetch(sInstances, ivec2(id, 2), 0);
    vAlpha = look.y;
    vUV = P.xy + 0.5;
    // Canvas y runs down, so the image top (P.y = +0.5) sits at negative y.
    vec2 local = vec2(P.x, -P.y) * geom.zw;
    float c = cos(look.x), s = sin(look.x);
    vec2 p = vec2(local.x * c - local.y * s, local.x * s + local.y * c) + geom.xy;
    gl_Position = vec4(p.x / look.z, -p.y / 960.0, 0.0, 1.0);
}
'''

PIXEL_SHADER = '''uniform sampler2D sAtlas;
uniform float uTextureAA;

in vec2 vUV;
flat in vec4 vTile;
flat in float vAlpha;

layout(location = 0) out vec4 fragColor;

// Supersample the pixel footprint, averaging premultiplied RGBA before
// unpremultiplication. Clamp every tap to this tile; atlas mipmaps would mix
// adjacent sources at coarse levels.
vec4 sampleAtlas(vec2 center, vec2 dx, vec2 dy)
{
    int side = clamp(int(uTextureAA + 0.5), 1, 4);
    vec2 texel = 1.0 / vec2(textureSize(sAtlas, 0));
    vec4 sum = vec4(0.0);
    for (int y = 0; y < side; ++y) {
        for (int x = 0; x < side; ++x) {
            vec2 offset = (vec2(x, y) + 0.5) / float(side) - 0.5;
            vec2 local = center + dx * offset.x + dy * offset.y;
            vec2 uv = vTile.xy + clamp(local * vTile.zw, texel * 0.5, vTile.zw - texel * 0.5);
            sum += textureLod(sAtlas, uv, 0.0);
        }
    }
    return sum / float(side * side);
}

void main()
{
    vec4 c = sampleAtlas(vUV, dFdx(vUV), dFdy(vUV));
    if (c.a <= 0.0 || vAlpha <= 0.0) discard;
    // Straight alpha out, so the MAT's default source-alpha blend matches
    // canvas source-over with globalAlpha.
    fragColor = TDOutputSwizzle(vec4(c.rgb / c.a, c.a * vAlpha));
}
'''

INSTANCES_CALLBACKS = '''def onSetupParameters(scriptOp):
    return

def onCook(scriptOp):
    op('{engine}').module.cook_instances(scriptOp)
'''.format(engine=ENGINE_NAME)

ATLAS_CALLBACKS = '''def onSetupParameters(scriptOp):
    return

def onCook(scriptOp):
    op('{engine}').module.cook_atlas(scriptOp)
'''.format(engine=ENGINE_NAME)

FRAME_EXEC = '''def onStart():
    op('{engine}').module.load_assets(parent())

def onFrameStart(frame):
    op('{engine}').module.frame_start(parent())
'''.format(engine=ENGINE_NAME)

PAR_EXEC = '''def onValueChange(par, prev):
    if par.name in ('Folder', 'Cellsize', 'Sourcemode', 'Sourcetops', 'Texturecomp', 'Toppattern', 'Sourcealpha'):
        op('{engine}').module.load_assets(parent())

def onPulse(par):
    if par.name in ('Reload', 'Refreshsources'):
        op('{engine}').module.load_assets(parent())
    elif par.name == 'Reseed':
        parent().par.Seed = (int(parent().par.Seed.eval()) + 1) % 100000
'''.format(engine=ENGINE_NAME)

MENUS = {}

# (page, kind, name, label, default, min, max)
PARAMS = [
    ('Sources', 'menu', 'Sourcemode', 'Source Mode', 'folder', None, None),
    ('Sources', 'top', 'Sourcetops', 'Source TOPs', '', None, None),
    ('Sources', 'comp', 'Texturecomp', 'Texture COMP', '', None, None),
    ('Sources', 'text', 'Toppattern', 'TOP Pattern', 'tex_*', None, None),
    ('Sources', 'menu', 'Sourcealpha', 'Source Alpha', 'premultiplied', None, None),
    ('Sources', 'menu', 'Textureaa', 'Texture Antialiasing', 'smooth', None, None),
    ('Sources', 'pulse', 'Refreshsources', 'Refresh Sources', None, None, None),
    ('Rings', 'folder', 'Folder', 'GIF Folder', '', None, None),
    ('Rings', 'pulse', 'Reload', 'Reload GIFs', None, None, None),
    ('Rings', 'str', 'Status', 'Status', '', None, None),
    ('Rings', 'float', 'Time', 'Time (s)', 0.0, 0, 60),
    ('Rings', 'int', 'Outputw', 'Output Width', 1080, 16, 8192),
    ('Rings', 'int', 'Outputh', 'Output Height', 1920, 16, 8192),
    ('Rings', 'int', 'Cellsize', 'Atlas Cell Size', 256, 16, 1024),
    ('Rings', 'int', 'Loaddelay', 'Load Delay (frames)', 3, 1, 30),
    ('Geometry', 'int', 'Gifsperring', 'GIFs per Ring', 12, 1, 48),
    ('Geometry', 'int', 'Ringcount', 'Visible Rings', 24, 4, 48),
    ('Geometry', 'float', 'Radius', 'Ring Radius', 850.0, 100, 2400),
    ('Geometry', 'float', 'Spacing', 'Ring Spacing', 700.0, 100, 2400),
    ('Geometry', 'float', 'Gifsize', 'GIF Size', 320.0, 20, 1600),
    ('Geometry', 'float', 'Speed', 'Travel Speed', 900.0, -2400, 2400),
    ('Geometry', 'float', 'Twist', 'Twist per Ring', 8.0, -180, 180),
    ('Geometry', 'float', 'Rotationspeed', 'Ring Rotation deg/s', 6.0, -90, 90),
    ('Camera', 'float', 'Fov', 'Field of View', 74.0, 30, 120),
    ('Camera', 'float', 'Camerax', 'Offset X', 0.0, -1600, 1600),
    ('Camera', 'float', 'Cameray', 'Offset Y', 0.0, -1600, 1600),
    ('Camera', 'float', 'Cameraroll', 'Camera Roll', 0.0, -180, 180),
    ('Camera', 'float', 'Gifspeed', 'GIF Playback Speed', 1.0, 0, 4),
    ('Camera', 'float', 'Ringphase', 'GIF Phase per Ring', 0.0, 0, 1),
    ('Motion', 'toggle', 'Sizesweep', 'Size Sweep', False, None, None),
    ('Motion', 'float', 'Sweepfrom', 'Sweep From', 200.0, 20, 1600),
    ('Motion', 'float', 'Sweepto', 'Sweep To', 520.0, 20, 1600),
    ('Motion', 'float', 'Sweepspeed', 'Sweep Speed', 0.25, 0, 10),
    ('Motion', 'float', 'Sweepspread', 'Sweep Ring Spread', 0.08, -0.5, 0.5),
    ('Motion', 'toggle', 'Sizenoise', 'Size Noise', False, None, None),
    ('Motion', 'float', 'Sizenoiseamp', 'Size Noise Amplitude', 80.0, 0, 800),
    ('Motion', 'float', 'Sizenoiseperiod', 'Size Noise Period (s)', 1.5, 0.05, 10),
    ('Motion', 'toggle', 'Posnoise', 'Position Noise', False, None, None),
    ('Motion', 'float', 'Posnoiseamp', 'Position Noise Amplitude', 120.0, 0, 1600),
    ('Motion', 'float', 'Posnoiseperiod', 'Position Noise Period', 900.0, 50, 5000),
    ('Motion', 'float', 'Posnoisespeed', 'Position Noise Speed', 0.4, 0, 10),
    ('Look', 'toggle', 'Radialorientation', 'Radial GIF Orientation', False, None, None),
    ('Look', 'float', 'Gifrotation', 'GIF Rotation', 0.0, -180, 180),
    ('Look', 'toggle', 'Shuffle', 'Seeded Shuffle', False, None, None),
    ('Look', 'int', 'Seed', 'Seed', 1, 0, 100000),
    ('Look', 'pulse', 'Reseed', 'Reseed', None, None, None),
    ('Look', 'float', 'Fog', 'Depth Fog', 0.00015, 0, 0.001),
    ('Look', 'rgb', 'Voidcolor', 'Void Color', (3 / 255, 4 / 255, 10 / 255), None, None),
]

MENUS.update({
    'Sourcemode': (['folder', 'tops', 'comp'], ['GIF Folder', 'TOP List', 'Texture COMP']),
    'Sourcealpha': (['premultiplied', 'straight'], ['Premultiplied', 'Straight']),
    'Textureaa': (['off', 'smooth', 'high'], ['Off (1 sample)', 'Smooth (4 samples)', 'High (16 samples)']),
})

_build_warnings = []


def _set(target, name, value):
    """Set a built-in parameter, collecting a warning instead of failing on version differences."""
    par = getattr(target.par, name, None)
    if par is None:
        _build_warnings.append('{}: no parameter "{}"'.format(target.path, name))
        return
    try:
        par.val = value
    except Exception as err:  # menu entries differ between TD builds; report and continue
        _build_warnings.append('{}.{} = {!r}: {}'.format(target.path, name, value, err))


def _ensure(parent_comp, op_type, name, x, y):
    found = parent_comp.op(name)
    if found is None:
        found = parent_comp.create(op_type, name)
    found.viewer = True
    found.nodeX, found.nodeY = x, y
    return found


def _add_params(comp):
    pages = {}
    for page_name, kind, name, label, default, lo, hi in PARAMS:
        if kind != 'rgb' and getattr(comp.par, name, None) is not None:
            continue
        if kind == 'rgb' and getattr(comp.par, name + 'r', None) is not None:
            continue
        page = pages.get(page_name)
        if page is None:
            page = next((p for p in comp.customPages if p.name == page_name), None) or comp.appendCustomPage(page_name)
            pages[page_name] = page
        if kind == 'folder':
            page.appendFolder(name, label=label)
        elif kind in ('top', 'comp'):
            (page.appendTOP if kind == 'top' else page.appendCOMP)(name, label=label)
        elif kind == 'text':
            par = page.appendStr(name, label=label)[0]
            par.default = default
            par.val = default
        elif kind == 'pulse':
            page.appendPulse(name, label=label)
        elif kind == 'str':
            par = page.appendStr(name, label=label)[0]
            par.readOnly = True
        elif kind == 'menu':
            par = page.appendMenu(name, label=label)[0]
            par.menuNames, par.menuLabels = MENUS[name]
            par.default = default
            par.val = default
        elif kind == 'toggle':
            par = page.appendToggle(name, label=label)[0]
            par.default = default
            par.val = default
        elif kind == 'rgb':
            for par, v in zip(page.appendRGB(name, label=label), default):
                par.default = v
                par.val = v
        else:
            par = (page.appendInt if kind == 'int' else page.appendFloat)(name, label=label)[0]
            par.normMin, par.normMax = lo, hi
            if name != 'Time':
                par.min, par.max = lo, hi
                par.clampMin = par.clampMax = True
            par.default = default
            par.val = default
    if comp.par.Time.mode != ParMode.EXPRESSION and not comp.par.Time.expr:
        comp.par.Time.expr = 'absTime.seconds'
        comp.par.Time.mode = ParMode.EXPRESSION


def _text_dat(comp, name, text, x, y):
    dat = _ensure(comp, textDAT, name, x, y)
    dat.text = text
    return dat


def build(host=None):
    del _build_warnings[:]
    host = host or me.parent()
    # The builder DAT itself is often named gif_rings_v2; never mistake it (or any
    # other non-COMP) for the network to build into.
    name = COMP_NAME
    existing = host.op(name)
    if existing is not None and not existing.isCOMP:
        name = COMP_NAME + '_comp'
        existing = host.op(name)
        if existing is not None and not existing.isCOMP:
            raise RuntimeError('{} is taken by a non-COMP; rename it and run again'.format(existing.path))
    comp = existing or host.create(baseCOMP, name)
    comp.nodeX, comp.nodeY = me.nodeX + 200, me.nodeY
    _add_params(comp)

    _text_dat(comp, ENGINE_NAME, me.text, -400, 300)
    _text_dat(comp, 'card_vert', VERTEX_SHADER, -400, -100)
    _text_dat(comp, 'card_frag', PIXEL_SHADER, -400, -250)
    _text_dat(comp, 'instances_callbacks', INSTANCES_CALLBACKS, -400, 150)
    _text_dat(comp, 'atlas_callbacks', ATLAS_CALLBACKS, -400, 0)

    frame_exec = _ensure(comp, executeDAT, 'frame_exec', -600, 300)
    frame_exec.text = FRAME_EXEC
    _set(frame_exec, 'start', True)
    _set(frame_exec, 'framestart', True)
    _set(frame_exec, 'active', True)

    par_exec = _ensure(comp, parameterexecuteDAT, 'par_exec', -600, 150)
    par_exec.text = PAR_EXEC
    _set(par_exec, 'op', '..')
    _set(par_exec, 'pars', 'Sourcemode Sourcetops Texturecomp Toppattern Sourcealpha Refreshsources Folder Cellsize Reload Reseed')
    _set(par_exec, 'valuechange', True)
    _set(par_exec, 'onpulse', True)
    _set(par_exec, 'active', True)

    _ensure(comp, baseCOMP, 'loaders', -600, -100)
    _ensure(comp, baseCOMP, 'live_sources', -600, -300)

    instances = _ensure(comp, scriptTOP, 'instances', -200, 150)
    _set(instances, 'callbacks', 'instances_callbacks')
    _set(instances, 'outputresolution', 'custom')
    _set(instances, 'resolutionw', 288)
    _set(instances, 'resolutionh', 3)
    _set(instances, 'format', 'rgba32float')

    atlas = _ensure(comp, scriptTOP, 'atlas', -200, 0)
    _set(atlas, 'callbacks', 'atlas_callbacks')
    _set(atlas, 'outputresolution', 'custom')
    _set(atlas, 'format', 'rgba8fixed')

    atlas_select = _ensure(comp, selectTOP, 'atlas_select', -200, -150)
    _required(atlas_select, 'top', 'atlas')
    _required(atlas_select, 'resmult', False)
    texture_atlas = _ensure(comp, nullTOP, 'texture_atlas', -50, 0)
    _required(texture_atlas, 'resmult', False)
    texture_atlas.inputConnectors[0].connect(atlas_select)

    count = _ensure(comp, patternCHOP, 'count', -200, 300)
    _set(count, 'length', 288)

    mat = _ensure(comp, glslMAT, 'card_mat', 0, -100)
    _set(mat, 'vdat', 'card_vert')
    _set(mat, 'pdat', 'card_frag')
    _set(mat, 'sampler0name', 'sInstances')
    _set(mat, 'sampler0top', 'instances')
    _set(mat, 'sampler1name', 'sAtlas')
    _set(mat, 'sampler1top', 'texture_atlas')
    _required(mat, 'sampler1filter', 'linear')
    _required(mat, 'vec0name', 'uTextureAA')
    mat.par.vec0valuex.expr = '(1, 2, 4)[parent().par.Textureaa.menuIndex]'
    mat.par.vec0valuex.mode = ParMode.EXPRESSION
    _set(mat, 'blending', True)
    _set(mat, 'depthtest', False)
    _set(mat, 'depthwriting', False)
    _set(mat, 'cullface', 'neither')

    geo = _ensure(comp, geometryCOMP, 'geo', 0, 150)
    for child in list(geo.children):
        if child.name != 'card':
            child.destroy()
    card = geo.op('card') or geo.create(rectangleSOP, 'card')
    _set(card, 'sizex', 1)
    _set(card, 'sizey', 1)
    card.display = card.render = True
    # Absolute paths: a COMP's own OP parameters resolve from its parent network,
    # which is easy to get wrong with relative paths.
    _set(geo, 'material', mat.path)
    _set(geo, 'instancing', True)
    _set(geo, 'instanceop', count.path)
    _set(geo, 'instancetx', 'chan1')

    cam = _ensure(comp, cameraCOMP, 'cam', 0, 300)

    render = _ensure(comp, renderTOP, 'render', 200, 150)
    _set(render, 'camera', cam.name)
    _set(render, 'geometry', geo.name)
    _set(render, 'outputresolution', 'custom')
    _set(render, 'antialias', 'aa4')
    for axis, source in (('w', 'Outputw'), ('h', 'Outputh')):
        par = getattr(render.par, 'resolution' + axis, None)
        if par is None:
            _build_warnings.append('render: no parameter resolution' + axis)
        else:
            par.expr = 'parent().par.' + source
            par.mode = ParMode.EXPRESSION
    for channel in 'rgb':
        par = getattr(render.par, 'bgcolor' + channel, None)
        if par is None:
            _build_warnings.append('render: no parameter bgcolor' + channel)
        else:
            par.expr = 'parent().par.Voidcolor' + channel
            par.mode = ParMode.EXPRESSION
    _set(render, 'bgcolora', 1)

    out = _ensure(comp, outTOP, 'out1', 400, 150)
    out.inputConnectors[0].connect(render)

    print('[gif_rings_v2] built {}'.format(comp.path))
    for warning in _build_warnings:
        print('[gif_rings_v2] WARNING ' + warning)
    # Run through the embedded module so delayed loads capture the engine DAT,
    # rather than importing the builder DAT and inadvertently building again.
    comp.op(ENGINE_NAME).module.load_assets(comp)
    return comp


# Run Script on the pasted DAT builds the network; importing the copy inside
# the COMP as a module must not.
try:
    me  # noqa: B018 - only defined inside TouchDesigner
    _in_td = True
except NameError:
    _in_td = False

if _in_td and me.name != ENGINE_NAME:
    build()
