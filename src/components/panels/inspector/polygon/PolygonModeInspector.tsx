import { useState } from 'react';
import { useStore } from '../../../../store';
import Segmented, { SegmentedOption } from '../../../controls/Segmented';
import SceneTab from '../SceneTab';
import SubjectHeader from '../SubjectHeader';
import TextureTab from '../TextureTab';
import PolygonMotionTab from './PolygonMotionTab';
import PolygonPatternTab from './PolygonPatternTab';
import PolygonStyleTab from './PolygonStyleTab';

type PolygonInspectorTab = 'texture' | 'style' | 'pattern' | 'motion';

const TAB_OPTIONS: SegmentedOption<PolygonInspectorTab>[] = [
  { value: 'texture', label: 'Texture' },
  { value: 'style', label: 'Style' },
  { value: 'pattern', label: 'Pattern' },
  { value: 'motion', label: 'Motion' }
];

export default function PolygonModeInspector() {
  const selectedPolygon = useStore(s => s.polygonLayers.find(polygon => polygon.id === s.selectedPolygonId));
  const updatePolygon = useStore(s => s.updatePolygon);
  const deletePolygon = useStore(s => s.deletePolygon);
  const duplicatePolygon = useStore(s => s.duplicatePolygon);
  const movePolygonUp = useStore(s => s.movePolygonUp);
  const movePolygonDown = useStore(s => s.movePolygonDown);
  const [tab, setTab] = useState<PolygonInspectorTab>('texture');

  if (!selectedPolygon) return <SceneTab />;

  const onChange = (updates: Parameters<typeof updatePolygon>[1]) => updatePolygon(selectedPolygon.id, updates);

  return (
    <div className="p-3 flex flex-col">
      <SubjectHeader
        name={selectedPolygon.name}
        hidden={selectedPolygon.hidden}
        onRename={(name) => onChange({ name })}
        onToggleHidden={() => onChange({ hidden: !selectedPolygon.hidden })}
        onDuplicate={() => duplicatePolygon(selectedPolygon.id)}
        onMoveUp={() => movePolygonUp(selectedPolygon.id)}
        onMoveDown={() => movePolygonDown(selectedPolygon.id)}
        onDelete={() => deletePolygon(selectedPolygon.id)}
      />
      <Segmented
        label="Polygon properties"
        className="mb-3 border-b border-ui-border pb-2"
        value={tab}
        onChange={setTab}
        options={TAB_OPTIONS}
      />
      <div>
        {tab === 'texture' && <TextureTab polygon={selectedPolygon} onChange={onChange} />}
        {tab === 'style' && <PolygonStyleTab polygon={selectedPolygon} onChange={onChange} />}
        {tab === 'pattern' && <PolygonPatternTab polygon={selectedPolygon} onChange={onChange} />}
        {tab === 'motion' && <PolygonMotionTab polygon={selectedPolygon} onChange={onChange} />}
      </div>
    </div>
  );
}
