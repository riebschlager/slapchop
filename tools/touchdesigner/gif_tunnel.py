"""
GIF Tunnel for TouchDesigner: a port of Slapchop's "GIF Tunnel" mode.

An endless polygonal tube of panes, wallpapered with GIFs and palette colors,
that the camera flies down along a bending path. This file is both the network
builder and the runtime engine.

USAGE
  1. Create a Text DAT in any network, paste this file into it (or point the
     DAT's File parameter at this file).
  2. Right-click the DAT > Run Script (or Ctrl+R). A Base COMP named
     `gif_tunnel` is built next to it (`gif_tunnel_comp` if the DAT itself is
     named `gif_tunnel`). Running the script again updates an existing
     `gif_tunnel` in place and keeps your parameter values.
  3. On the `gif_tunnel` COMP, set Tunnel > GIF Folder to a folder of .gif,
     .png or .jpg files. Frames load into an atlas over a few seconds; Status
     shows progress. Until then every pane shows the palette.
  4. The COMP's `out1` TOP is the result, sized by Tunnel > Output Width/Height
     (default 1080 x 1920, Slapchop's frame). The field of view is vertical, so
     other aspect ratios show more or less of the tunnel sideways.

HOW IT MATCHES SLAPCHOP
  `resolve_tunnel` ports `resolveTunnelScene` from src/lib/tunnel.ts directly:
  the same bending path, ring twist, pane inset, GIF Every / Ring Offset
  pattern, seeded shuffle, ring phase, UV fit, scale sweep and scale noise
  hashes, plus `applyMotion` for the five motion pulses. GIF frame timing uses
  each frame's own delay, as Slapchop does (a delay under 20 ms plays as
  100 ms).

  Shading follows Slapchop's default GPU renderer (src/renderer/tunnelRenderer.ts,
  Three.js) rather than the Canvas 2D fallback. That means exp2 fog per fragment
  on view depth, mixed in output (sRGB) space. It also means depth testing with
  an alpha test of 0.015, palette panes drawn before GIF panes, and GIF panes
  drawn in pane order (near to far), so a frame at time t should match Slapchop
  at the same t, settings and asset order. Edge filtering where a repeating
  texture wraps can differ slightly, because frames live in an atlas. Assets are
  sorted by file name; Slapchop uses import order.

  Master FX is not ported.

RUNTIME LAYOUT (inside gif_tunnel)
  gif_tunnel_engine  Text DAT: this file, used as a module.
  atlas              Script TOP: every GIF frame packed into one texture.
  panes              Script TOP: a 9-row float texture, one column per pane,
                     rebuilt every frame from the parameters and Time.
  count              Pattern CHOP: its length sets the geometry's instance count.
  geo / pane         Geometry COMP instancing a two-triangle Script SOP.
  pane_mat           GLSL MAT: places each pane corner from the precomputed
                     clip-space positions in `panes` and samples `atlas`.
  render -> out1     Render TOP over the void color.

  Time defaults to `absTime.seconds`. Replace that with any expression, for
  example `me.time.seconds` to follow the timeline.
"""

import math
import os
import struct

import numpy as np

ENGINE_NAME = 'gif_tunnel_engine'
COMP_NAME = 'gif_tunnel'
CANVAS_W, CANVAS_H = 1080, 1920
MAX_TEXTURE = 16384
PANE_KEY_STRIDE = 32
NEAR = 1.0
INSTANCE_ROWS = 9
SUPPORTED_EXT = ('.gif', '.png', '.jpg', '.jpeg')
TILING_CODES = {'clamp': 0, 'repeat': 1, 'mirror': 2, 'mirror-x': 3, 'mirror-y': 4}

# ---------------------------------------------------------------------------
# Config: mirrors DEFAULT_TUNNEL and DEFAULT_TUNNEL_SCALE_MOTION in src/types.ts
# ---------------------------------------------------------------------------

DEFAULTS = {
    'sides': 8, 'radius': 760.0, 'ringLength': 620.0, 'ringCount': 28, 'paneGap': 0.0,
    'speed': 1100.0, 'fov': 74.0, 'cameraOffsetX': 0.0, 'cameraOffsetY': 0.0, 'cameraRoll': 0.0,
    'lookAhead': 1200.0, 'bendX': 520.0, 'bendY': 300.0, 'bendWavelength': 9000.0, 'twistPerRing': 3.0,
    'textureTiling': 'clamp', 'textureScale': 1.0, 'textureOffsetX': 0.0, 'textureOffsetY': 0.0,
    'textureRotation': 0.0,
    'textureScaleMotion': {'sweep': False, 'min': 0.75, 'max': 1.5, 'speed': 0.25, 'ringSpread': 0.08,
                           'noise': False, 'noiseAmplitude': 0.25, 'noisePeriod': 1.5},
    'gifEvery': 1, 'ringPatternOffset': 0, 'ringPhase': 0.0, 'nonGifFill': 'palette',
    'palette': ['#ff3d81', '#ffb000', '#16e0bd', '#2d7dff'], 'shuffle': False, 'seed': 1,
    'voidColor': '#03040a', 'fogEnabled': True, 'fogColor': '#03040a', 'fogDensity': 0.00012,
    'motionSpeed': None, 'motionBendX': None, 'motionBendY': None, 'motionTwist': None,
    'motionCameraRoll': None,
}

# TunnelInspector.tsx palette presets.
PALETTE_PRESETS = [
    ('signal', 'Signal', ['#ff3d81', '#ffb000', '#16e0bd', '#2d7dff']),
    ('acid', 'Acid', ['#d8ff00', '#00ffc8', '#ff2bd6', '#281cff']),
    ('heat', 'Heat', ['#ff2a00', '#ff7a00', '#ffd000', '#fff1cc']),
    ('deep', 'Deep', ['#071952', '#088395', '#37b7c3', '#ebf4f6']),
    ('mono', 'Mono', ['#f4f4f0', '#a5a5a0', '#4a4a48', '#111111']),
]
MAX_PALETTE = 8


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _js_round(v):
    # Math.round rounds halves toward +infinity; Python's round() is banker's.
    return int(math.floor(v + 0.5))


def _rgb(color):
    """'#rrggbb' or an (r, g, b) 0..1 tuple -> (r, g, b) floats."""
    if isinstance(color, str):
        h = color.lstrip('#')
        return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    return tuple(float(x) for x in color[:3])


def normalize(cfg):
    """Fill defaults the way project.ts merges a saved TunnelConfig.

    Values are not clamped here: resolveTunnelScene applies its own clamps,
    and `resolve_tunnel` ports those.
    """
    out = dict(DEFAULTS)
    out.update({k: v for k, v in cfg.items() if v is not None or k.startswith('motion')})
    out['textureScaleMotion'] = dict(DEFAULTS['textureScaleMotion'], **(cfg.get('textureScaleMotion') or {}))
    out['palette'] = [_rgb(c) for c in (out['palette'] or [])] or [(1.0, 1.0, 1.0)]
    out['voidColor'] = _rgb(out['voidColor'])
    out['fogColor'] = _rgb(out['fogColor'])
    return out


def apply_motion(base, motion, t):
    """applyMotion from src/lib/motion.ts."""
    if not motion or motion.get('type') not in ('sine', 'noise'):
        return base
    speed, amp, phase = motion['speed'], motion['amplitude'], motion['phase']
    if motion['type'] == 'sine':
        return base + math.sin(t * speed * math.pi * 2 + phase) * amp
    noise = (math.sin(t * speed * 1.5 + phase)
             * math.sin(t * speed * 0.8 + phase * 1.3)
             * math.cos(t * speed * 2.2 - phase))
    return base + noise * amp


# ---------------------------------------------------------------------------
# Scene: vectorized port of resolveTunnelScene. Hash constants are identical
# so seeds reproduce Slapchop.
# ---------------------------------------------------------------------------

def _fract(x):
    return np.mod(x, 1.0)


def _seeded_random(index, seed):
    return _fract(np.sin((index + 1) * 12.9898 + seed * 78.233) * 43758.5453)


def _value_noise(x, key, seed):
    cell = np.floor(x)
    f = x - cell
    eased = f * f * (3 - 2 * f)
    a = _seeded_random(cell + key * 1013, seed)
    b = _seeded_random(cell + 1 + key * 1013, seed)
    return (a + (b - a) * eased) * 2 - 1


def _normalize3(v):
    magnitude = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.where(magnitude == 0, 1, magnitude)


def _path_center(s, bend_x, bend_y, wavelength):
    angle = (s / max(800, wavelength)) * math.pi * 2
    return np.stack([np.sin(angle) * bend_x, np.cos(angle) * bend_y, -s], axis=-1)


def _path_frame(s, bend_x, bend_y, wavelength, twist):
    center = _path_center(s, bend_x, bend_y, wavelength)
    forward = _normalize3(_path_center(s + 1, bend_x, bend_y, wavelength)
                          - _path_center(s - 1, bend_x, bend_y, wavelength))
    right = _normalize3(np.cross(forward, [0.0, 1.0, 0.0]))
    up = _normalize3(np.cross(right, forward))
    cos, sin = np.cos(twist)[..., None], np.sin(twist)[..., None]
    return center, forward, _normalize3(right * cos + up * sin), _normalize3(up * cos + right * -sin)


def frame_index(asset, source_time):
    """getGifFrameIndexAtTime: frame whose [start, end) contains the looped time."""
    total = asset['total_ms']
    if asset['frames'] <= 1 or total <= 0:
        return 0
    t_ms = abs(source_time * 1000.0) % total
    idx = int(np.searchsorted(asset['ends_ms'], t_ms, side='right'))
    return min(idx, asset['frames'] - 1)


def resolve_tunnel(assets, cfg, t):
    """Returns the camera and per-pane arrays shaped (rings, sides, ...).

    Rows are rings from just behind the camera outward, columns are sides, in
    the same order resolveTunnelScene emits panes. `kind` is 0 for a hidden
    pane, 1 for a palette color and 2 for an asset; `ring_asset` is the asset
    index per ring (-1 with no assets).
    """
    c = normalize(cfg)
    sides = _clamp(_js_round(c['sides']), 3, 24)
    ring_count = _clamp(_js_round(c['ringCount']), 4, 64)
    radius = max(120, c['radius'])
    ring_length = max(80, c['ringLength'])
    wavelength = c['bendWavelength']
    speed = apply_motion(c['speed'], c['motionSpeed'], t)
    bend_x = apply_motion(c['bendX'], c['motionBendX'], t)
    bend_y = apply_motion(c['bendY'], c['motionBendY'], t)
    twist_per_ring = apply_motion(c['twistPerRing'], c['motionTwist'], t)
    camera_roll = apply_motion(c['cameraRoll'], c['motionCameraRoll'], t)
    seed = c['seed']

    camera_s = speed * t
    first_ring = math.floor(camera_s / ring_length) - 1
    cam_center, _, cam_right, cam_up = (v[0] for v in _path_frame(
        np.array([camera_s]), bend_x, bend_y, wavelength, np.zeros(1)))
    eye = cam_center + cam_right * c['cameraOffsetX'] + cam_up * c['cameraOffsetY']
    target = _path_center(np.array([camera_s + max(100, c['lookAhead'])]), bend_x, bend_y, wavelength)[0]
    roll = camera_roll * math.pi / 180
    up = _normalize3(cam_up * math.cos(roll) + cam_right * -math.sin(roll))

    # Ring r spans boundaries r and r + 1, so ring_count + 1 rings share
    # ring_count + 2 boundary rings of vertices.
    boundary = first_ring + np.arange(ring_count + 2, dtype=np.float64)
    center, _, right, ring_up = _path_frame(boundary * ring_length, bend_x, bend_y, wavelength,
                                            boundary * twist_per_ring * math.pi / 180)
    side = np.arange(sides)
    # Half a side of rotation keeps a vertex off twelve o'clock, as in Slapchop.
    angle = ((side + 0.5) / sides) * math.pi * 2
    verts = center[:, None] + (right[:, None] * (np.cos(angle) * radius)[None, :, None]
                               + ring_up[:, None] * (np.sin(angle) * radius)[None, :, None])
    nxt = (side + 1) % sides
    a, b = verts[:-1], verts[:-1][:, nxt]
    cc, d = verts[1:][:, nxt], verts[1:]

    inset = _clamp(c['paneGap'], 0, 0.42) / 2
    if inset != 0:
        def sample(u, v):
            top = a + (b - a) * u
            bottom = d + (cc - d) * u
            return top + (bottom - top) * v
        a, b, cc, d = sample(inset, inset), sample(1 - inset, inset), sample(1 - inset, 1 - inset), sample(inset, 1 - inset)
    corners = np.stack([a, b, cc, d], axis=2)  # (rings, sides, 4, 3)

    ring_index = first_ring + np.arange(ring_count + 1, dtype=np.float64)
    n = len(assets)
    if n:
        if c['shuffle']:
            ring_asset = np.floor(_seeded_random(ring_index, seed) * n).astype(np.int64)
        else:
            ring_asset = np.mod(ring_index, n).astype(np.int64)
    else:
        ring_asset = np.full(ring_index.shape, -1, dtype=np.int64)

    gif_every = _clamp(_js_round(c['gifEvery']), 1, sides)
    pattern_offset = _js_round(c['ringPatternOffset']) % sides
    shifted = side[None, :] + ring_index[:, None] * pattern_offset
    has_asset = (np.mod(shifted, gif_every) == 0) & (ring_asset >= 0)[:, None]
    palette = c['palette']
    color_index = np.mod(ring_index[:, None] + side[None, :], len(palette)).astype(np.int64)
    fill = 1 if c['nonGifFill'] != 'transparent' else 0
    kind = np.where(has_asset, 2, fill)

    def edge(p, q):
        return np.linalg.norm(corners[:, :, q] - corners[:, :, p], axis=-1)
    pane_w = (edge(0, 1) + edge(3, 2)) / 2
    pane_h = (edge(0, 3) + edge(1, 2)) / 2

    width = np.array([assets[i]['width'] if i >= 0 else 1 for i in ring_asset], dtype=np.float64)
    height = np.array([assets[i]['height'] if i >= 0 else 1 for i in ring_asset], dtype=np.float64)
    totals = np.array([assets[i]['total_ms'] if i >= 0 else 0 for i in ring_asset], dtype=np.float64)
    source_aspect = np.broadcast_to((width / np.maximum(1, height))[:, None], kind.shape)
    pane_aspect = pane_w / np.maximum(1, pane_h)

    # tunnelPaneScale only applies to asset panes; others keep textureScale.
    sm = c['textureScaleMotion']
    ri = ring_index[:, None]
    scale = np.full(kind.shape, float(c['textureScale']))
    if sm['sweep']:
        wave = np.sin((t * sm['speed'] - ri * sm['ringSpread']) * math.pi * 2)
        scale = np.broadcast_to(sm['min'] + (sm['max'] - sm['min']) * (wave * 0.5 + 0.5), kind.shape)
    if sm['noise'] and sm['noiseAmplitude'] != 0:
        key = ri * PANE_KEY_STRIDE + side[None, :]
        scale = scale + _value_noise(t / max(0.05, sm['noisePeriod']), key, seed) * sm['noiseAmplitude']
    scale = np.where(has_asset, scale, c['textureScale'])

    tiling = c['textureTiling'] or 'clamp'
    uv = tunnel_uv_rect(source_aspect, pane_aspect, scale, c['textureOffsetX'], c['textureOffsetY'], tiling)

    return {
        'eye': eye, 'target': target, 'up': up, 'fov': c['fov'],
        'far': max(30000, c['ringLength'] * (c['ringCount'] + 4) * 2),
        'fog_color': c['fogColor'], 'fog_density': max(0, c['fogDensity']) if c['fogEnabled'] else 0,
        'void_color': c['voidColor'], 'tiling': tiling, 'texture_rotation': c['textureRotation'] or 0,
        'sides': sides, 'ring_count': ring_count, 'ring_index': ring_index,
        'corners': corners, 'kind': kind, 'color': np.array(palette)[color_index], 'uv': uv,
        'ring_asset': ring_asset, 'source_time': t + _fract(ring_index * c['ringPhase']) * totals / 1000.0,
    }


def tunnel_uv_rect(source_aspect, pane_aspect, scale, offset_x, offset_y, tiling='clamp'):
    """tunnelUvRect, vectorized: returns (..., 4) as u0, v0, u1, v1."""
    sa = np.maximum(0.001, source_aspect)
    pa = np.maximum(0.001, pane_aspect)
    wider = sa > pa
    zoom = np.maximum(0.05, scale)
    w = np.where(wider, pa / sa, 1.0) / zoom
    h = np.where(wider, 1.0, sa / pa) / zoom
    clamp = (tiling == 'clamp') & (np.asarray(scale) >= 1)
    cx = np.where(clamp, np.maximum(w / 2, np.minimum(1 - w / 2, 0.5 + offset_x)), 0.5 + offset_x)
    cy = np.where(clamp, np.maximum(h / 2, np.minimum(1 - h / 2, 0.5 + offset_y)), 0.5 + offset_y)
    return np.stack([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], axis=-1)


def instance_count(cfg):
    c = normalize(cfg)
    return _clamp(_js_round(c['sides']), 3, 24) * (_clamp(_js_round(c['ringCount']), 4, 64) + 1)


def instance_texture(assets, tile_uv, cfg, t, aspect=CANVAS_W / CANVAS_H):
    """Pack resolve_tunnel into a (9, N, 4) float32 array for the GLSL MAT.

    Rows 0-3: clip-space position of corners 0-3
    Row 4: texture UV rect u0, v0, u1, v1 (before rotation)
    Row 5: atlas tile u0, v0, du, dv
    Row 6: r, g, b, kind (0 hidden, 1 palette color, 2 asset)
    Row 7: texture rotation (radians), tiling code, fog density
    Row 8: fog r, g, b
    Columns are drawn in order: palette panes, then asset panes in Slapchop's
    pane order, then unused zero columns. Projection happens here in float64
    because world z grows with travel and would lose precision in float32.
    """
    n = instance_count(cfg)
    data = np.zeros((INSTANCE_ROWS, n, 4), dtype=np.float32)
    s = resolve_tunnel(assets, cfg, t)

    # PerspectiveCamera.lookAt: z points from target to eye.
    z = _normalize3(s['eye'] - s['target'])
    x = np.cross(s['up'], z)
    if np.linalg.norm(x) < 1e-9:  # Three nudges z when up is parallel to it
        x = np.cross(s['up'], z + [0.0001, 0, 0])
    x = _normalize3(x)
    y = np.cross(z, x)
    rel = s['corners'] - s['eye']
    depth = -(rel @ z)
    focal = 1 / math.tan(math.radians(s['fov']) / 2)
    far = s['far']
    # Depth maps near..far to 0..1 so it stays inside the clip volume under
    # both OpenGL (-w..w) and Vulkan (0..w) depth conventions.
    clip = np.stack([(rel @ x) * focal / aspect, (rel @ y) * focal,
                     far * (depth - NEAR) / (far - NEAR), depth], axis=-1)

    kind = s['kind'].ravel()
    order = np.concatenate([np.flatnonzero(kind == 1), np.flatnonzero(kind == 2)])
    count = order.size
    clip = clip.reshape(-1, 4, 4)[order]
    for corner in range(4):
        data[corner, :count] = clip[:, corner]
    data[4, :count] = s['uv'].reshape(-1, 4)[order]
    data[6, :count, :3] = s['color'].reshape(-1, 3)[order]
    data[6, :count, 3] = kind[order]
    data[7, :, 0] = math.radians(s['texture_rotation'])
    data[7, :, 1] = TILING_CODES.get(s['tiling'], 0)
    data[7, :, 2] = s['fog_density']
    data[8, :, :3] = s['fog_color']

    # The source time is constant within a ring, so look frames up per ring.
    ring_tile = np.zeros(s['ring_asset'].shape, dtype=np.int64)
    for r, asset_index in enumerate(s['ring_asset']):
        if asset_index >= 0:
            asset = assets[asset_index]
            ring_tile[r] = asset['tile0'] + frame_index(asset, float(s['source_time'][r]))
    tiles = np.broadcast_to(ring_tile[:, None], s['kind'].shape).ravel()[order]
    data[5, :count] = np.where((kind[order] == 2)[:, None], tile_uv[tiles], 0)
    return data


# ---------------------------------------------------------------------------
# File metadata: frame delays straight from the GIF blocks, so timing matches
# Slapchop regardless of how TouchDesigner's decoder reports frame rate.
# (Shared with gif_rings.py; duplicated so each file runs standalone.)
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
        'width': w, 'height': h,
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

MOTIONS = [
    # (config key, parameter prefix, label, max amplitude, amplitude step) from TunnelInspector.tsx
    ('motionSpeed', 'Pulse', 'Velocity Pulse', 1400, 20),
    ('motionBendX', 'Writhex', 'Horizontal Writhe', 1200, 20),
    ('motionBendY', 'Writhey', 'Vertical Writhe', 1200, 20),
    ('motionTwist', 'Twistpulse', 'Twist Pulse', 30, 0.5),
    ('motionCameraRoll', 'Rolldrift', 'Roll Drift', 180, 1),
]


def _state(comp):
    return _STATE.setdefault(comp.path, {'generation': 0, 'assets': [], 'atlas': None,
                                         'tile_uv': np.zeros((1, 4), np.float32), 'loading': False,
                                         'attempted': False})


def _set_status(comp, text):
    comp.par.Status = text
    print('[gif_tunnel] ' + text)


def _par_rgb(p, name):
    return tuple(getattr(p, name + ch).eval() for ch in 'rgb')


def read_config(comp):
    p = comp.par
    cfg = {
        'sides': p.Sides.eval(), 'radius': p.Radius.eval(), 'ringLength': p.Ringlength.eval(),
        'ringCount': p.Ringcount.eval(), 'paneGap': p.Panegap.eval(), 'speed': p.Speed.eval(),
        'fov': p.Fov.eval(), 'cameraOffsetX': p.Camerax.eval(), 'cameraOffsetY': p.Cameray.eval(),
        'cameraRoll': p.Cameraroll.eval(), 'lookAhead': p.Lookahead.eval(), 'bendX': p.Bendx.eval(),
        'bendY': p.Bendy.eval(), 'bendWavelength': p.Bendwavelength.eval(), 'twistPerRing': p.Twist.eval(),
        'textureTiling': p.Tiling.eval(), 'textureScale': p.Uvscale.eval(),
        'textureOffsetX': p.Uvoffsetx.eval(), 'textureOffsetY': p.Uvoffsety.eval(),
        'textureRotation': p.Texrotation.eval(),
        'textureScaleMotion': {
            'sweep': bool(p.Scalesweep.eval()), 'min': p.Sweepfrom.eval(), 'max': p.Sweepto.eval(),
            'speed': p.Sweepspeed.eval(), 'ringSpread': p.Sweepspread.eval(),
            'noise': bool(p.Scalenoise.eval()), 'noiseAmplitude': p.Scalenoiseamp.eval(),
            'noisePeriod': p.Scalenoiseperiod.eval(),
        },
        'gifEvery': p.Gifevery.eval(), 'ringPatternOffset': p.Ringoffset.eval(),
        'ringPhase': p.Ringphase.eval(), 'nonGifFill': p.Unfilled.eval(),
        'palette': [_par_rgb(p, 'Color{}'.format(i + 1))
                    for i in range(_clamp(int(p.Palettecount.eval()), 1, MAX_PALETTE))],
        'shuffle': bool(p.Shuffle.eval()), 'seed': p.Seed.eval(),
        'voidColor': _par_rgb(p, 'Voidcolor'), 'fogEnabled': bool(p.Fogenabled.eval()),
        'fogColor': _par_rgb(p, 'Fogcolor'), 'fogDensity': p.Fogdensity.eval(),
    }
    for key, prefix, _, _, _ in MOTIONS:
        cfg[key] = {'type': getattr(p, prefix + 'type').eval(), 'speed': getattr(p, prefix + 'rate').eval(),
                    'amplitude': getattr(p, prefix + 'amp').eval(), 'phase': getattr(p, prefix + 'phase').eval()}
    return cfg


def apply_palette_preset(comp):
    preset = next((colors for name, _, colors in PALETTE_PRESETS if name == comp.par.Palettepreset.eval()), None)
    if preset is None:
        return
    comp.par.Palettecount = len(preset)
    for i, color in enumerate(preset):
        for ch, v in zip('rgb', _rgb(color)):
            setattr(comp.par, 'Color{}{}'.format(i + 1, ch), v)


def frame_start(comp):
    """Execute DAT onFrameStart: size the instance count, then rebuild the pane table."""
    st = _state(comp)
    if not st['attempted'] and comp.par.Folder.eval():
        load_assets(comp)  # module was recompiled, so its in-memory atlas is gone
    n = instance_count(read_config(comp))
    count = comp.op('count')
    if int(count.par.length.eval()) != n:
        count.par.length = n
    panes = comp.op('panes')
    if int(panes.par.resolutionw.eval()) != n:
        panes.par.resolutionw = n
    panes.cook(force=True)


def cook_panes(script_op):
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
    st['generation'] += 1
    st.update(assets=[], atlas=None, loading=False, attempted=True)
    loaders = comp.op('loaders')
    for child in list(loaders.children):
        child.destroy()
    comp.op('atlas').cook(force=True)

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
            print('[gif_tunnel] skipping {}: {}'.format(name, err))
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

VERTEX_SHADER = '''// Panes are already projected by the engine, so this reads clip space
// directly and ignores the camera. P.x is the pane corner index 0-3; the SOP's
// two triangles are (0, 1, 2) and (0, 2, 3), matching Slapchop's index buffer.
uniform sampler2D sPanes;

out vec2 vUV;
out float vFogDepth;
flat out vec4 vTile;
flat out vec4 vColor;
flat out vec4 vLook;
flat out vec3 vFogColor;

void main()
{
    int id = TDInstanceID();
    int corner = int(P.x + 0.5);
    vec4 clip = texelFetch(sPanes, ivec2(id, corner), 0);
    vec4 rect = texelFetch(sPanes, ivec2(id, 4), 0);
    vTile = texelFetch(sPanes, ivec2(id, 5), 0);
    vColor = texelFetch(sPanes, ivec2(id, 6), 0);
    vLook = texelFetch(sPanes, ivec2(id, 7), 0);
    vFogColor = texelFetch(sPanes, ivec2(id, 8), 0).rgb;
    // Corners 0-3 take (u0,v0) (u1,v0) (u1,v1) (u0,v1), then rotate about the
    // texture center (rotateTextureUv), exactly as Slapchop writes its UVs.
    vec2 uv = vec2(corner == 1 || corner == 2 ? rect.z : rect.x, corner >= 2 ? rect.w : rect.y) - 0.5;
    float c = cos(vLook.x), s = sin(vLook.x);
    vUV = 0.5 + vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);
    vFogDepth = clip.w;
    gl_Position = clip;
}
'''

PIXEL_SHADER = '''uniform sampler2D sAtlas;

in vec2 vUV;
in float vFogDepth;
flat in vec4 vTile;
flat in vec4 vColor;
flat in vec4 vLook;
flat in vec3 vFogColor;

layout(location = 0) out vec4 fragColor;

// 0 clamp-to-edge, 1 repeat, 2 mirrored repeat.
float wrapAxis(float x, int mode)
{
    if (mode == 1) return fract(x);
    if (mode == 2) return 1.0 - abs(mod(x, 2.0) - 1.0);
    return clamp(x, 0.0, 1.0);
}

void main()
{
    vec4 color;
    if (vColor.a > 1.5) {
        int tiling = int(vLook.y + 0.5);
        int modeX = tiling == 0 ? 0 : (tiling == 2 || tiling == 3) ? 2 : 1;
        int modeY = tiling == 0 ? 0 : (tiling == 2 || tiling == 4) ? 2 : 1;
        vec2 local = vec2(wrapAxis(vUV.x, modeX), wrapAxis(vUV.y, modeY));
        // Stay half a texel inside the cell so filtering never reads a neighbor.
        // Level 0 only: Slapchop's textures have no mipmaps, and wrapped UVs
        // would otherwise pick a tiny mip at every seam.
        vec2 texel = 1.0 / vec2(textureSize(sAtlas, 0));
        vec2 uv = vTile.xy + clamp(local * vTile.zw, texel * 0.5, vTile.zw - texel * 0.5);
        vec4 t = textureLod(sAtlas, uv, 0.0);
        // MeshBasicMaterial alphaTest: 0.015.
        if (t.a < 0.015) discard;
        color = vec4(t.rgb / t.a, t.a);
    } else if (vColor.a > 0.5) {
        color = vec4(vColor.rgb, 1.0);
    } else {
        discard;
    }
    // Three.js FogExp2 on view depth, applied after the sRGB output encode.
    float fogFactor = 1.0 - exp(-vLook.z * vLook.z * vFogDepth * vFogDepth);
    color.rgb = mix(color.rgb, vFogColor, fogFactor);
    fragColor = TDOutputSwizzle(color);
}
'''

PANES_CALLBACKS = '''def onSetupParameters(scriptOp):
    return

def onCook(scriptOp):
    op('{engine}').module.cook_panes(scriptOp)
'''.format(engine=ENGINE_NAME)

ATLAS_CALLBACKS = '''def onSetupParameters(scriptOp):
    return

def onCook(scriptOp):
    op('{engine}').module.cook_atlas(scriptOp)
'''.format(engine=ENGINE_NAME)

# Two triangles whose P.x is the pane corner index. The vertex shader looks up
# the real position, so the SOP only fixes the triangulation.
PANE_SOP_CALLBACKS = '''def onSetupParameters(scriptOp):
    return

def onCook(scriptOp):
    scriptOp.clear()
    for tri in ((0, 1, 2), (0, 2, 3)):
        poly = scriptOp.appendPoly(3, closed=True, addPoints=True)
        for i, corner in enumerate(tri):
            poly[i].point.x = corner
            poly[i].point.y = 0
            poly[i].point.z = 0
'''

FRAME_EXEC = '''def onStart():
    op('{engine}').module.load_assets(parent())

def onFrameStart(frame):
    op('{engine}').module.frame_start(parent())
'''.format(engine=ENGINE_NAME)

PAR_EXEC = '''def onValueChange(par, prev):
    if par.name in ('Folder', 'Cellsize'):
        op('{engine}').module.load_assets(parent())
    elif par.name == 'Palettepreset':
        op('{engine}').module.apply_palette_preset(parent())

def onPulse(par):
    if par.name == 'Reload':
        op('{engine}').module.load_assets(parent())
    elif par.name == 'Reseed':
        parent().par.Seed = (int(parent().par.Seed.eval()) + 1) % 100000
'''.format(engine=ENGINE_NAME)

MENUS = {
    'Tiling': (['clamp', 'repeat', 'mirror', 'mirror-x', 'mirror-y'],
               ['Clamp', 'Repeat', 'Mirror', 'Mirror X', 'Mirror Y']),
    'Unfilled': (['palette', 'transparent'], ['Cycle palette colors', 'Leave panes transparent']),
    'Palettepreset': ([name for name, _, _ in PALETTE_PRESETS] + ['custom'],
                      [label for _, label, _ in PALETTE_PRESETS] + ['Custom']),
}
for _, _prefix, _, _, _ in MOTIONS:
    MENUS[_prefix + 'type'] = (['none', 'sine', 'noise'], ['None', 'Sine', 'Noise'])


def _motion_params(page, prefix, label, max_amp, step_amp):
    # MotionControl.tsx ranges; amplitude defaults to the value it picks when enabled.
    return [
        (page, 'menu', prefix + 'type', label, 'none', None, None),
        (page, 'float', prefix + 'rate', label + ' Speed', 1.0, 0, 10),
        (page, 'float', prefix + 'amp', label + ' Amplitude', max_amp / 10, step_amp, max_amp),
        (page, 'float', prefix + 'phase', label + ' Phase', 0.0, 0, math.pi * 2),
    ]


def _palette_params():
    colors = PALETTE_PRESETS[0][2] + ['#ffffff'] * (MAX_PALETTE - len(PALETTE_PRESETS[0][2]))
    return [('Palette', 'rgb', 'Color{}'.format(i + 1), 'Color {}'.format(i + 1), _rgb(c), None, None)
            for i, c in enumerate(colors)]


# (page, kind, name, label, default, min, max). Ranges are TunnelInspector.tsx's sliders.
PARAMS = [
    ('Tunnel', 'folder', 'Folder', 'GIF Folder', '', None, None),
    ('Tunnel', 'pulse', 'Reload', 'Reload GIFs', None, None, None),
    ('Tunnel', 'str', 'Status', 'Status', '', None, None),
    ('Tunnel', 'float', 'Time', 'Time (s)', 0.0, 0, 60),
    ('Tunnel', 'int', 'Outputw', 'Output Width', 1080, 16, 8192),
    ('Tunnel', 'int', 'Outputh', 'Output Height', 1920, 16, 8192),
    ('Tunnel', 'int', 'Cellsize', 'Atlas Cell Size', 512, 16, 2048),
    ('Tunnel', 'int', 'Loaddelay', 'Load Delay (frames)', 3, 1, 30),
    ('Geometry', 'int', 'Sides', 'Sides', 8, 3, 24),
    ('Geometry', 'int', 'Ringcount', 'Visible Rings', 28, 6, 48),
    ('Geometry', 'float', 'Radius', 'Radius', 760.0, 240, 1800),
    ('Geometry', 'float', 'Ringlength', 'Ring Length', 620.0, 120, 1400),
    ('Geometry', 'float', 'Panegap', 'Pane Gap', 0.0, 0, 0.35),
    ('Path', 'float', 'Speed', 'Travel Speed', 1100.0, -2400, 2400),
    ('Path', 'float', 'Bendx', 'Horizontal Bend', 520.0, 0, 2600),
    ('Path', 'float', 'Bendy', 'Vertical Bend', 300.0, 0, 2600),
    ('Path', 'float', 'Bendwavelength', 'Bend Wavelength', 9000.0, 2000, 30000),
    ('Path', 'float', 'Twist', 'Twist per Ring', 3.0, -30, 30),
] + [p for key, prefix, label, amp, step in MOTIONS[:4] for p in _motion_params('Path', prefix, label, amp, step)] + [
    ('Camera', 'float', 'Fov', 'Field of View', 74.0, 30, 120),
    ('Camera', 'float', 'Lookahead', 'Look Ahead', 1200.0, 200, 4000),
    ('Camera', 'float', 'Camerax', 'Offset X', 0.0, -900, 900),
    ('Camera', 'float', 'Cameray', 'Offset Y', 0.0, -900, 900),
    ('Camera', 'float', 'Cameraroll', 'Camera Roll', 0.0, -180, 180),
] + _motion_params('Camera', *MOTIONS[4][1:]) + [
    ('Wallpaper', 'int', 'Gifevery', 'GIF Every (panes)', 1, 1, 24),
    ('Wallpaper', 'int', 'Ringoffset', 'Ring Offset', 0, 0, 23),
    ('Wallpaper', 'float', 'Ringphase', 'Ring Phase', 0.0, 0, 1),
    ('Wallpaper', 'menu', 'Tiling', 'Texture Tiling', 'clamp', None, None),
    ('Wallpaper', 'float', 'Texrotation', 'Texture Rotation', 0.0, -180, 180),
    ('Wallpaper', 'float', 'Uvscale', 'UV Scale', 1.0, 0.25, 4),
    ('Wallpaper', 'toggle', 'Scalesweep', 'Scale Sweep', False, None, None),
    ('Wallpaper', 'float', 'Sweepfrom', 'Sweep From', 0.75, 0.25, 4),
    ('Wallpaper', 'float', 'Sweepto', 'Sweep To', 1.5, 0.25, 4),
    ('Wallpaper', 'float', 'Sweepspeed', 'Sweep Speed', 0.25, 0, 10),
    ('Wallpaper', 'float', 'Sweepspread', 'Sweep Ring Spread', 0.08, -0.5, 0.5),
    ('Wallpaper', 'toggle', 'Scalenoise', 'Scale Noise', False, None, None),
    ('Wallpaper', 'float', 'Scalenoiseamp', 'Scale Noise Amplitude', 0.25, 0, 2),
    ('Wallpaper', 'float', 'Scalenoiseperiod', 'Scale Noise Period (s)', 1.5, 0.05, 10),
    ('Wallpaper', 'float', 'Uvoffsetx', 'UV Offset X', 0.0, -0.5, 0.5),
    ('Wallpaper', 'float', 'Uvoffsety', 'UV Offset Y', 0.0, -0.5, 0.5),
    ('Wallpaper', 'menu', 'Unfilled', 'Unfilled Panes', 'palette', None, None),
    ('Wallpaper', 'toggle', 'Shuffle', 'Seeded Shuffle', False, None, None),
    ('Wallpaper', 'int', 'Seed', 'Seed', 1, 0, 100000),
    ('Wallpaper', 'pulse', 'Reseed', 'Reseed', None, None, None),
    ('Palette', 'menu', 'Palettepreset', 'Preset', 'signal', None, None),
    ('Palette', 'int', 'Palettecount', 'Colors Used', 4, 2, MAX_PALETTE),
] + _palette_params() + [
    ('Fog', 'rgb', 'Voidcolor', 'Void Color', _rgb(DEFAULTS['voidColor']), None, None),
    ('Fog', 'toggle', 'Fogenabled', 'Depth Fog', True, None, None),
    ('Fog', 'rgb', 'Fogcolor', 'Fog Color', _rgb(DEFAULTS['fogColor']), None, None),
    ('Fog', 'float', 'Fogdensity', 'Fog Density', 0.00012, 0, 0.0006),
]

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
    # The builder DAT itself is often named gif_tunnel; never mistake it (or
    # any other non-COMP) for the network to build into.
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
    _text_dat(comp, 'pane_vert', VERTEX_SHADER, -400, -100)
    _text_dat(comp, 'pane_frag', PIXEL_SHADER, -400, -250)
    _text_dat(comp, 'panes_callbacks', PANES_CALLBACKS, -400, 150)
    _text_dat(comp, 'atlas_callbacks', ATLAS_CALLBACKS, -400, 0)
    pane_sop_callbacks = _text_dat(comp, 'pane_sop_callbacks', PANE_SOP_CALLBACKS, -400, -400)

    frame_exec = _ensure(comp, executeDAT, 'frame_exec', -600, 300)
    frame_exec.text = FRAME_EXEC
    _set(frame_exec, 'start', True)
    _set(frame_exec, 'framestart', True)
    _set(frame_exec, 'active', True)

    par_exec = _ensure(comp, parameterexecuteDAT, 'par_exec', -600, 150)
    par_exec.text = PAR_EXEC
    _set(par_exec, 'op', '..')
    _set(par_exec, 'pars', 'Folder Cellsize Palettepreset Reload Reseed')
    _set(par_exec, 'valuechange', True)
    _set(par_exec, 'onpulse', True)
    _set(par_exec, 'active', True)

    _ensure(comp, baseCOMP, 'loaders', -600, -100)

    default_n = instance_count({})
    panes = _ensure(comp, scriptTOP, 'panes', -200, 150)
    _set(panes, 'callbacks', 'panes_callbacks')
    _set(panes, 'outputresolution', 'custom')
    _set(panes, 'resolutionw', default_n)
    _set(panes, 'resolutionh', INSTANCE_ROWS)
    _set(panes, 'format', 'rgba32float')

    atlas = _ensure(comp, scriptTOP, 'atlas', -200, 0)
    _set(atlas, 'callbacks', 'atlas_callbacks')
    _set(atlas, 'outputresolution', 'custom')
    _set(atlas, 'format', 'rgba8fixed')

    count = _ensure(comp, patternCHOP, 'count', -200, 300)
    _set(count, 'length', default_n)

    mat = _ensure(comp, glslMAT, 'pane_mat', 0, -100)
    _set(mat, 'vdat', 'pane_vert')
    _set(mat, 'pdat', 'pane_frag')
    _set(mat, 'sampler0name', 'sPanes')
    _set(mat, 'sampler0top', 'panes')
    _set(mat, 'sampler1name', 'sAtlas')
    _set(mat, 'sampler1top', 'atlas')
    _set(mat, 'blending', True)
    _set(mat, 'depthtest', True)
    _set(mat, 'depthwriting', True)
    _set(mat, 'cullface', 'neither')

    geo = _ensure(comp, geometryCOMP, 'geo', 0, 150)
    for child in list(geo.children):
        if child.name != 'pane':
            child.destroy()
    pane = geo.op('pane') or geo.create(scriptSOP, 'pane')
    _set(pane, 'callbacks', pane_sop_callbacks.path)
    pane.display = pane.render = True
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
    _set(render, 'antialias', 'aa4')  # Slapchop renders with WebGL antialiasing on
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

    print('[gif_tunnel] built {}'.format(comp.path))
    for warning in _build_warnings:
        print('[gif_tunnel] WARNING ' + warning)
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
