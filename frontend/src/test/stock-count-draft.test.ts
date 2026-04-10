import { describe, expect, it } from 'vitest';
import {
  buildStockCountPayloadLines,
  createStockCountDraftLine,
} from '@/components/inventory/stock-count-draft';

describe('stock count draft helpers', () => {
  it('creates a default draft line for a new stock count row', () => {
    expect(createStockCountDraftLine()).toMatchObject({
      itemId: '',
      actualQty: '0',
      note: '',
    });
  });

  it('builds payload lines for multiple counted items in one session', () => {
    expect(buildStockCountPayloadLines([
      { key: '1', itemId: '4000', actualQty: '10.5', note: 'freezer shelf' },
      { key: '2', itemId: '4001', actualQty: '7', note: '' },
    ])).toEqual({
      lines: [
        { itemId: '4000', actualQty: 10.5, note: 'freezer shelf' },
        { itemId: '4001', actualQty: 7, note: null },
      ],
    });
  });

  it('rejects duplicate items inside one stock count session', () => {
    expect(buildStockCountPayloadLines([
      { key: '1', itemId: '4000', actualQty: '10', note: '' },
      { key: '2', itemId: '4000', actualQty: '12', note: '' },
    ])).toEqual({
      error: 'Each stock count session can only include one line per item',
    });
  });

  it('rejects negative actual quantities', () => {
    expect(buildStockCountPayloadLines([
      { key: '1', itemId: '4000', actualQty: '-1', note: '' },
    ])).toEqual({
      error: 'Actual quantity must be zero or greater for every stock count line',
    });
  });
});
