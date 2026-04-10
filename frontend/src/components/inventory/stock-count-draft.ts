export type StockCountDraftLine = {
  key: string;
  itemId: string;
  actualQty: string;
  note: string;
};

let stockCountDraftCounter = 0;

export function createStockCountDraftLine(): StockCountDraftLine {
  stockCountDraftCounter += 1;
  return {
    key: `count-line-${Date.now()}-${stockCountDraftCounter}`,
    itemId: '',
    actualQty: '0',
    note: '',
  };
}

export function buildStockCountPayloadLines(lines: StockCountDraftLine[]) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { error: 'Add at least one item to the stock count session' } as const;
  }

  const seenItemIds = new Set<string>();
  const payloadLines = [];

  for (const line of lines) {
    const itemId = String(line.itemId ?? '').trim();
    if (!itemId) {
      return { error: 'Select an item for every stock count line' } as const;
    }

    if (seenItemIds.has(itemId)) {
      return { error: 'Each stock count session can only include one line per item' } as const;
    }
    seenItemIds.add(itemId);

    const actualQty = Number(line.actualQty);
    if (!Number.isFinite(actualQty) || actualQty < 0) {
      return { error: 'Actual quantity must be zero or greater for every stock count line' } as const;
    }

    payloadLines.push({
      itemId,
      actualQty,
      note: String(line.note ?? '').trim() || null,
    });
  }

  return { lines: payloadLines } as const;
}
