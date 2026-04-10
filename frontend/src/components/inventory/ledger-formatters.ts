function normalizeTxnType(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase();
}

function titleCaseWords(value: string) {
  return value
    .split(/[_-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatLedgerTxnType(value: string | null | undefined) {
  switch (normalizeTxnType(value)) {
    case 'purchase_in':
      return 'Purchase in';
    case 'goods_receipt':
      return 'Goods receipt';
    case 'sale_usage':
      return 'Sale usage';
    case 'waste_out':
      return 'Waste out';
    case 'stock_adjustment_in':
      return 'Stock adjustment in';
    case 'stock_adjustment_out':
      return 'Stock adjustment out';
    case 'stock_adjustment':
      return 'Stock adjustments';
    case 'stock_count':
      return 'Stock count';
    case 'manufacture_in':
      return 'Manufacture in';
    case 'manufacture_out':
      return 'Manufacture out';
    default: {
      const normalized = normalizeTxnType(value);
      return normalized ? titleCaseWords(normalized) : 'Unknown';
    }
  }
}

export function ledgerTxnTypeBadgeClass(value: string | null | undefined) {
  switch (normalizeTxnType(value)) {
    case 'purchase_in':
    case 'goods_receipt':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'sale_usage':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'waste_out':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'stock_adjustment_in':
    case 'stock_adjustment_out':
    case 'stock_adjustment':
    case 'stock_count':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'manufacture_in':
    case 'manufacture_out':
      return 'bg-violet-50 text-violet-700 border-violet-200';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}
