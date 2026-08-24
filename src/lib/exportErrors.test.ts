import { describe, expect, it } from 'vitest';
import { getExportErrorMessage } from './exportErrors';

describe('getExportErrorMessage', () => {
  it('preserves JavaScript error messages', () => {
    expect(getExportErrorMessage(new Error('Encoder failed'))).toBe('Encoder failed');
  });

  it('preserves string and object errors returned by Tauri invokes', () => {
    expect(getExportErrorMessage('shell.stdin_write not allowed')).toBe('shell.stdin_write not allowed');
    expect(getExportErrorMessage({ message: 'Filesystem denied the write' }))
      .toBe('Filesystem denied the write');
  });

  it('provides a fallback for an empty error value', () => {
    expect(getExportErrorMessage(null)).toBe('The export failed for an unknown reason.');
  });
});
