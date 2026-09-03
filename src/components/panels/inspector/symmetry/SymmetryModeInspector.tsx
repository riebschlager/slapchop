import { useState } from 'react';
import { useStore } from '../../../../store';
import Segmented, { SegmentedOption } from '../../../controls/Segmented';
import SceneTab from '../SceneTab';
import SubjectHeader from '../SubjectHeader';
import TransformTab from '../TransformTab';
import LayerMotionTab from './LayerMotionTab';
import LayerStyleTab from './LayerStyleTab';
import LayerSymmetryTab from './LayerSymmetryTab';

type SymmetryInspectorTab = 'transform' | 'style' | 'symmetry' | 'motion';

const TAB_OPTIONS: SegmentedOption<SymmetryInspectorTab>[] = [
  { value: 'transform', label: 'Transform' },
  { value: 'style', label: 'Style' },
  { value: 'symmetry', label: 'Symmetry' },
  { value: 'motion', label: 'Motion' }
];

export default function SymmetryModeInspector() {
  const selectedLayer = useStore(s => s.layers.find(layer => layer.id === s.selectedLayerId));
  const updateLayer = useStore(s => s.updateLayer);
  const deleteLayer = useStore(s => s.deleteLayer);
  const duplicateLayer = useStore(s => s.duplicateLayer);
  const moveLayerUp = useStore(s => s.moveLayerUp);
  const moveLayerDown = useStore(s => s.moveLayerDown);
  const [tab, setTab] = useState<SymmetryInspectorTab>('transform');

  if (!selectedLayer) return <SceneTab />;

  const onChange = (updates: Parameters<typeof updateLayer>[1]) => updateLayer(selectedLayer.id, updates);

  return (
    <div className="p-3 flex flex-col">
      <SubjectHeader
        name={selectedLayer.name}
        hidden={selectedLayer.hidden}
        onRename={(name) => onChange({ name })}
        onToggleHidden={() => onChange({ hidden: !selectedLayer.hidden })}
        onDuplicate={() => duplicateLayer(selectedLayer.id)}
        onMoveUp={() => moveLayerUp(selectedLayer.id)}
        onMoveDown={() => moveLayerDown(selectedLayer.id)}
        onDelete={() => deleteLayer(selectedLayer.id)}
      />
      <Segmented
        label="Layer properties"
        className="mb-3 border-b border-ui-border pb-2"
        value={tab}
        onChange={setTab}
        options={TAB_OPTIONS}
      />
      <div>
        {tab === 'transform' && <TransformTab layer={selectedLayer} onChange={onChange} />}
        {tab === 'style' && <LayerStyleTab layer={selectedLayer} onChange={onChange} />}
        {tab === 'symmetry' && <LayerSymmetryTab layer={selectedLayer} onChange={onChange} />}
        {tab === 'motion' && <LayerMotionTab layer={selectedLayer} onChange={onChange} />}
      </div>
    </div>
  );
}
