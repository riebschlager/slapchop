import { describe, expect, it } from 'vitest';
import { getExportErrorMessage, getExportFailureMessage, looksLikeMemoryFailure } from './exportErrors';

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

describe('looksLikeMemoryFailure', () => {
  it('recognizes allocation failures across error shapes', () => {
    expect(looksLikeMemoryFailure(new RangeError('nope'))).toBe(true);
    expect(looksLikeMemoryFailure(new Error('Array buffer allocation failed'))).toBe(true);
    expect(looksLikeMemoryFailure('Out of memory')).toBe(true);
    expect(looksLikeMemoryFailure({ message: 'Invalid string length' })).toBe(true);
  });

  it('leaves ordinary encoder failures alone', () => {
    expect(looksLikeMemoryFailure(new Error('Encoder was closed'))).toBe(false);
  });
});

describe('getExportFailureMessage', () => {
  it('names the format that failed and terminates the sentence', () => {
    expect(getExportFailureMessage('mp4', new Error('Encoder was closed')))
      .toBe('MP4 export failed: Encoder was closed.');
    expect(getExportFailureMessage('gif', new Error('Worker died.')))
      .toBe('Animated GIF export failed: Worker died.');
  });

  it('adds memory advice only when the failure looks like exhaustion', () => {
    const memory = getExportFailureMessage('zip', new RangeError('Invalid array length'));
    expect(memory).toContain('Frame-sequence ZIP export failed');
    expect(memory).toContain('out-of-memory');
    expect(getExportFailureMessage('zip', new Error('Worker died')))
      .not.toContain('out-of-memory');
  });

  it('falls back to a generic label for an unknown export type', () => {
    expect(getExportFailureMessage('mystery', null))
      .toBe('Export failed: The export failed for an unknown reason.');
  });
});
