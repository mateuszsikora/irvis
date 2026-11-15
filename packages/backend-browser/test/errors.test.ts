import { expect, it } from 'vitest';
import { errorMessage } from '../src/errors.ts';
it('keeps browser error names and constraints without generic Error prefixes', () => {
  expect(errorMessage(new Error('failed'))).toBe('failed');
  expect(errorMessage(new DOMException('denied', 'NotAllowedError'))).toBe(
    'NotAllowedError: denied',
  );
  expect(errorMessage({ name: 'OverconstrainedError', message: '', constraint: 'width' })).toBe(
    'OverconstrainedError (constraint: width)',
  );
});
