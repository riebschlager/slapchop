import { TextureTiling } from '../../types';
import Select from './Select';

const OPTIONS: { value: TextureTiling; label: string }[] = [
  { value: 'repeat', label: 'Repeat' },
  { value: 'mirror', label: 'Mirror' },
  { value: 'mirror-x', label: 'Mirror X' },
  { value: 'mirror-y', label: 'Mirror Y' },
];

export default function TextureTilingControl({ value = 'repeat', onChange, allowClamp = false }: {
  value?: TextureTiling;
  onChange: (value: TextureTiling) => void;
  allowClamp?: boolean;
}) {
  return <Select label="Texture Tiling" value={value} onChange={onChange} options={allowClamp ? [...OPTIONS, { value: 'clamp', label: 'Clamp to Edge' }] : OPTIONS} />;
}
