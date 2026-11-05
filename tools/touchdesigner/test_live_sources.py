"""Run with a Python that has NumPy: python -m unittest discover -s tools/touchdesigner.

These checks exercise source/atlas bookkeeping without emulating GPU rendering.
"""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np


ROOT = Path(__file__).parent


def load_module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MODULES = [(load_module('gif_' + mode), load_module('gif_' + mode + '_v2'))
           for mode in ('rings', 'tunnel')]


class Parameter:
    def __init__(self, value):
        self.val = value

    def eval(self):
        return self.val

    def evalOPs(self):
        return self.val


class Connector:
    def __init__(self, owner):
        self.owner = owner

    def connect(self, source):
        if self.owner.path.rsplit('/', 1)[0] != source.path.rsplit('/', 1)[0]:
            raise ValueError('TOP wires cannot cross network boundaries')
        self.source = source


class Node:
    def __init__(self, path, top=True, width=640, height=360, **parameters):
        self.path = path
        self.name = path.rsplit('/', 1)[-1]
        self.isTOP = top
        self.isCOMP = not top
        self.width, self.height = width, height
        self.children = []
        self.inputConnectors = [Connector(self)]
        self.par = SimpleNamespace(**{key: Parameter(value) for key, value in parameters.items()})
        self.destroyed = False

    def cook(self, **kwargs):
        pass

    def destroy(self):
        self.destroyed = True


class LiveSourcesTest(unittest.TestCase):
    def setUp(self):
        for _, module in MODULES:
            module._STATE.clear()

    def fixture(self, module, sources, mode='tops', alpha='premultiplied'):
        comp = Node('/project1/' + module.COMP_NAME, top=False,
                    Sourcemode=mode, Sourcetops=sources, Texturecomp=None,
                    Toppattern='tex_*', Sourcealpha=alpha, Cellsize=128)
        nodes = {name: Node(comp.path + '/' + name, top=name not in ('loaders', 'live_sources'))
                 for name in ('loaders', 'live_sources', 'atlas', 'texture_atlas')}
        nodes['atlas_select'] = Node(comp.path + '/atlas_select')
        nodes['atlas_select'].par = SimpleNamespace(top=Parameter('atlas'))
        nodes['texture_atlas'].inputConnectors[0].connect(nodes['atlas_select'])
        nodes.update({source.path: source for source in sources})
        comp.op = nodes.get
        return comp, nodes

    def test_folder_scene_matches_v1(self):
        assets = [dict(path='a.gif', aspect=2, width=200, height=100, frames=3,
                       total_ms=350, ends_ms=np.array([100, 150, 350]), tile0=0),
                  dict(path='b.png', aspect=0.5, width=100, height=200, frames=1,
                       total_ms=0, ends_ms=np.array([0]), tile0=3)]
        for original, v2 in MODULES:
            uv = original.atlas_layout(4, 128)[3]
            for cfg in ({}, {'shuffle': True, 'seed': 19, 'ringPhase': 0.37, 'speed': -300}):
                for t in (0, 0.1, 3.7, 100):
                    with self.subTest(mode=v2.COMP_NAME, cfg=cfg, t=t):
                        np.testing.assert_array_equal(original.instance_texture(assets, uv, cfg, t),
                                                      v2.instance_texture(assets, uv, cfg, t))

    def test_live_frame_selection_ignores_source_time(self):
        for _, module in MODULES:
            asset = module.live_asset('/textures/tex_1', 1920, 1080, 0)
            self.assertAlmostEqual(asset['aspect'], 16 / 9)
            for t in (-100, 0, 0.5, 9000):
                self.assertEqual(module.frame_index(asset, t), 0)
            uv = module.atlas_layout(1, 128)[3]
            row = 2 if module.COMP_NAME == 'gif_rings_v2' else 5
            for t in (0, 12.5):
                data = module.instance_texture([asset], uv, {'ringPhase': 0.9}, t)
                tiles = data[row]
                used = tiles[np.any(tiles != 0, axis=1)]
                self.assertGreater(len(used), 0)
                np.testing.assert_array_equal(used, np.tile(uv[0], (len(used), 1)))

    def test_collection_is_shallow_filtered_and_naturally_ordered(self):
        for _, module in MODULES:
            comp, _ = self.fixture(module, [], mode='comp')
            collection = Node('/textures', top=False)
            collection.children = [Node('/textures/' + name) for name in ('tex_10', 'noise1', 'tex_2', 'tex_1')]
            nested = Node('/textures/subnetwork', top=False)
            nested.children = [Node('/textures/subnetwork/tex_0')]
            collection.children.append(nested)
            comp.par.Texturecomp.val = collection
            self.assertEqual([s.name for s in module.resolve_sources(comp)], ['tex_1', 'tex_2', 'tex_10'])
            comp.par.Toppattern.val = ''
            with self.assertRaisesRegex(ValueError, 'empty'):
                module.resolve_sources(comp)

    def test_single_typed_top_reference_does_not_depend_on_evalops(self):
        for _, module in MODULES:
            movie = Node('/project1/exclaim_alpha')
            comp, _ = self.fixture(module, [])
            comp.par.Sourcetops = SimpleNamespace(eval=lambda: movie, evalOPs=lambda: [])
            self.assertEqual(module.resolve_sources(comp), [movie])
            # Typed multi-OP references retain their explicit order as well.
            other = Node('/project1/other_movie')
            comp.par.Sourcetops = SimpleNamespace(eval=lambda: [other, movie], evalOPs=lambda: [])
            self.assertEqual(module.resolve_sources(comp), [other, movie])

    def test_empty_source_errors_identify_mode_and_pattern(self):
        for _, module in MODULES:
            comp, _ = self.fixture(module, [])
            with self.assertRaisesRegex(ValueError, 'TOP List resolved no sources'):
                module.resolve_sources(comp)
            comp.par.Sourcemode.val = 'comp'
            collection = Node('/textures', top=False)
            collection.children = [Node('/textures/null1'), Node('/textures/noise1')]
            comp.par.Texturecomp.val = collection
            with self.assertRaisesRegex(ValueError, r"/textures: no immediate child TOPs match 'tex_\*'; available TOPs: noise1, null1"):
                module.resolve_sources(comp)
            comp.par.Toppattern.val = '*'
            self.assertEqual([s.name for s in module.resolve_sources(comp)], ['noise1', 'null1'])

    def test_direct_list_preserves_order_and_validates(self):
        for _, module in MODULES:
            sources = [Node('/textures/tex_10'), Node('/textures/tex_2')]
            comp, _ = self.fixture(module, sources)
            self.assertEqual(module.resolve_sources(comp), sources)
            for invalid in ([], [sources[0], sources[0]], [Node('/not_a_top', top=False)],
                            [Node(comp.path + '/out1')], [Node('/tex' + str(i)) for i in range(257)]):
                with self.subTest(mode=module.COMP_NAME, sources=len(invalid)):
                    with self.assertRaises(ValueError):
                        module.validate_sources(comp, invalid)
            with self.assertRaises(ValueError):
                module.live_asset('/bad', 0, 100, 0)

    def test_gpu_atlas_matches_uvs_and_pads_last_row(self):
        for _, module in MODULES:
            for alpha in ('premultiplied', 'straight'):
                sources = [Node('/textures/tex_' + str(i)) for i in range(5)]
                comp, nodes = self.fixture(module, sources, alpha=alpha)
                network = nodes['live_sources']
                created = {}

                def ensure(parent, kind, name, x, y):
                    params = {p: None for p in ('top', 'align', 'fit', 'scaleres', 'outputresolution',
                              'resolutionw', 'resolutionh', 'outputaspect', 'resmult', 'format', 'compover', 'inputfiltertype', 'pixeldat')}
                    if kind == 'constantTOP':
                        # Constant TOP uses a separate Alpha parameter, not RGBA color.
                        params = {p: None for p in ('colorr', 'colorg', 'colorb', 'alpha',
                                  'outputresolution', 'resolutionw', 'resolutionh', 'resmult', 'format')}
                    node = Node(parent.path + '/' + name)
                    node.par = SimpleNamespace(**{key: Parameter(value) for key, value in params.items()})
                    created[name] = node
                    network.children.append(node)
                    return node

                op_types = {kind: kind for kind in ('layoutTOP', 'constantTOP', 'selectTOP', 'nullTOP', 'glslTOP')}
                with patch.multiple(module, create=True, **op_types), patch.object(module, '_ensure', ensure), \
                        patch.object(module, '_text_dat', lambda *args: Node('/premultiply_pixel')):
                    module.load_assets(comp)
                state = module._state(comp)
                self.assertEqual(len(state['assets']), 5)
                self.assertIs(nodes['texture_atlas'].inputConnectors[0].source, nodes['atlas_select'])
                self.assertEqual(nodes['atlas_select'].par.top.val, 'live_sources/live_atlas')
                self.assertEqual(created['live_atlas'].par.align.val, 'vertbt')
                self.assertEqual(created['live_atlas'].par.resolutionw.val, 384)
                self.assertEqual(created['live_atlas'].par.resolutionh.val, 256)
                self.assertIs(created['row1'].par.top.val[-1], created['blank'])
                for channel in ('colorr', 'colorg', 'colorb', 'alpha'):
                    self.assertEqual(getattr(created['blank'].par, channel).val, 0)
                np.testing.assert_allclose(state['tile_uv'][3], [0, 0.5, 1/3, 0.5])
                self.assertEqual(created['row0'].par.align.val, 'horizlr')
                self.assertFalse(created['row0'].par.compover.val)
                self.assertEqual(created['row0'].par.inputfiltertype.val, 'linear')
                self.assertEqual(created['live_atlas'].par.inputfiltertype.val, 'linear')
                if alpha == 'straight':
                    self.assertIs(created['row0'].par.top.val[0], created['premultiply0'])
                    self.assertIs(created['premultiply0'].inputConnectors[0].source, created['source_out0'])
                else:
                    self.assertIs(created['row0'].par.top.val[0], created['source_out0'])

    def test_switch_invalidates_load_jobs_and_cleans_generated_graph(self):
        for _, module in MODULES:
            comp, nodes = self.fixture(module, [])
            old = Node('/old')
            nodes['loaders'].children = [old]
            generated = Node('/generated')
            nodes['live_sources'].children = [generated]
            state = module._state(comp)
            state.update(generation='old-generation', loading=True, job={'large_buffer': True})
            module.load_assets(comp)
            self.assertTrue(old.destroyed)
            self.assertTrue(generated.destroyed)
            self.assertNotEqual(state['generation'], 'old-generation')
            self.assertIsNone(state['job'])
            self.assertFalse(state['loading'])
            self.assertEqual(state['assets'], [])
            self.assertIn('Live source error', comp.par.Status)
            self.assertEqual(nodes['atlas_select'].par.top.val, 'atlas')
            self.assertIs(nodes['texture_atlas'].inputConnectors[0].source, nodes['atlas_select'])
            # A delayed folder callback cannot replace the newly selected live source pipeline.
            module._load_step(comp, 'old-generation')
            self.assertEqual(state['assets'], [])

    def test_live_resolution_change_and_deletion(self):
        for _, module in MODULES:
            source = Node('/textures/tex_1')
            comp, nodes = self.fixture(module, [source])
            state = module._state(comp)
            state.update(source_paths=[source.path], assets=[module.live_asset(source.path, 640, 360, 0)])
            source.width, source.height = 100, 200
            module.update_live_metadata(comp)
            self.assertEqual(state['assets'][0]['aspect'], 0.5)
            del nodes[source.path]
            module.update_live_metadata(comp)
            self.assertEqual(state['assets'], [])
            self.assertEqual(state['source_paths'], [])
            self.assertIn('Source removed', comp.par.Status)


if __name__ == '__main__':
    unittest.main()
