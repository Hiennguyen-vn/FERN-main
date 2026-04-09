import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/client';
import { decodeArray, decodeArrayFromPageOrArray, decodePaged, getErrorMessage } from '@/api/decoders';

describe('api decoders', () => {
  it('decodes arrays from array and paged payload sources', () => {
    const decodeItem = (value: unknown) => String((value as { id: unknown }).id);

    expect(decodeArray([{ id: 1 }, { id: 2 }], decodeItem)).toEqual(['1', '2']);
    expect(decodeArrayFromPageOrArray({ items: [{ id: 'a' }] }, decodeItem)).toEqual(['a']);
    expect(decodeArrayFromPageOrArray([{ id: 'b' }], decodeItem)).toEqual(['b']);
  });

  it('decodes paged payload items without masking pagination fields', () => {
    const page = decodePaged(
      { items: [{ id: 1 }], limit: 10, offset: 20, total: 25, hasMore: false },
      (value) => ({ id: String((value as { id: unknown }).id) }),
    );

    expect(page.items).toEqual([{ id: '1' }]);
    expect(page.limit).toBe(10);
    expect(page.offset).toBe(20);
    expect(page.totalCount).toBe(25);
    expect(page.hasNextPage).toBe(false);
  });

  it('prefers typed API errors and falls back cleanly for unknown errors', () => {
    expect(getErrorMessage(new ApiError('Bad request', 400), 'fallback')).toBe('Bad request');
    expect(getErrorMessage(new Error('Boom'), 'fallback')).toBe('Boom');
    expect(getErrorMessage('opaque failure', 'fallback')).toBe('fallback');
  });
});
