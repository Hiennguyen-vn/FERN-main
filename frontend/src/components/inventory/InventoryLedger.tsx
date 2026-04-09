import { useState, useMemo } from 'react';
import {
  Search, ScrollText, X as XIcon, ArrowUpRight, ArrowDownRight,
  FileText, ChevronRight,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { LedgerEntry, LedgerTransactionType } from '@/types/inventory';
import { mockLedgerEntries, TRANSACTION_TYPE_LABELS } from '@/data/mock-inventory';

const TXN_FILTER_TYPES: (LedgerTransactionType | 'all')[] = ['all', 'goods_receipt', 'sale_reservation', 'stock_count', 'adjustment', 'waste'];

export function InventoryLedger() {
  const [search, setSearch] = useState('');
  const [txnType, setTxnType] = useState<LedgerTransactionType | 'all'>('all');
  const [selectedEntry, setSelectedEntry] = useState<LedgerEntry | null>(null);

  const filtered = useMemo(() => {
    return mockLedgerEntries.filter(e => {
      if (txnType !== 'all' && e.transactionType !== txnType) return false;
      if (search && !e.ingredientName.toLowerCase().includes(search.toLowerCase()) && !e.sourceDocument.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [search, txnType]);

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <ScrollText className="h-5 w-5 text-muted-foreground" /> Inventory Ledger
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">Append-only transaction history — every stock movement is recorded</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search ingredient or document…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-8 text-sm" />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {TXN_FILTER_TYPES.map(t => (
            <button key={t} onClick={() => setTxnType(t)}
              className={cn('text-[11px] px-2.5 py-1.5 rounded-md border whitespace-nowrap transition-colors capitalize',
                txnType === t ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-foreground hover:bg-accent border-border'
              )}>{t === 'all' ? 'All Types' : TRANSACTION_TYPE_LABELS[t] || t}</button>
          ))}
        </div>
      </div>

      {/* Ledger table */}
      <div className="surface-elevated overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              {['Date/Time', 'Type', 'Ingredient', 'Delta', 'Balance', 'UoM', 'Source', 'Actor', ''].map(h => (
                <th key={h} className="text-left text-[11px] font-medium text-muted-foreground px-4 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-muted-foreground">No ledger entries found</td></tr>
            ) : (
              filtered.map(entry => (
                <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => setSelectedEntry(entry)}>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(entry.datetime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap',
                      entry.transactionType === 'goods_receipt' ? 'bg-success/10 text-success' :
                      entry.transactionType === 'sale_reservation' ? 'bg-primary/10 text-primary' :
                      entry.transactionType === 'waste' ? 'bg-destructive/10 text-destructive' :
                      entry.transactionType === 'adjustment' ? 'bg-info/10 text-info' :
                      'bg-muted text-muted-foreground'
                    )}>{TRANSACTION_TYPE_LABELS[entry.transactionType] || entry.transactionType}</span>
                  </td>
                  <td className="px-4 py-2.5 text-sm font-medium text-foreground">{entry.ingredientName}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn('text-sm font-semibold flex items-center gap-0.5',
                      entry.quantityDelta > 0 ? 'text-success' : 'text-destructive'
                    )}>
                      {entry.quantityDelta > 0 ? <ArrowDownRight className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                      {entry.quantityDelta > 0 ? '+' : ''}{entry.quantityDelta}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-sm text-foreground">{entry.resultingBalance}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{entry.uom}</td>
                  <td className="px-4 py-2.5 text-xs text-primary font-medium">{entry.sourceDocument}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{entry.actor}</td>
                  <td className="px-4 py-2.5"><ChevronRight className="h-3 w-3 text-muted-foreground" /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Detail drawer */}
      {selectedEntry && (
        <LedgerDetailDrawer entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
      )}
    </div>
  );
}

function LedgerDetailDrawer({ entry, onClose }: { entry: LedgerEntry; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-background/50 backdrop-blur-sm" />
      <div className="relative w-full max-w-md bg-card border-l shadow-xl animate-slide-in-right flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Ledger Entry</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors"><XIcon className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {[
            { label: 'Timestamp', value: new Date(entry.datetime).toLocaleString() },
            { label: 'Transaction Type', value: TRANSACTION_TYPE_LABELS[entry.transactionType] || entry.transactionType },
            { label: 'Ingredient', value: entry.ingredientName },
            { label: 'Quantity Delta', value: `${entry.quantityDelta > 0 ? '+' : ''}${entry.quantityDelta} ${entry.uom}` },
            { label: 'Resulting Balance', value: `${entry.resultingBalance} ${entry.uom}` },
            { label: 'Source Document', value: entry.sourceDocument },
            { label: 'Source Type', value: entry.sourceType },
            { label: 'Actor', value: entry.actor },
            { label: 'Outlet', value: entry.outletId },
          ].map(field => (
            <div key={field.label}>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">{field.label}</p>
              <p className="text-sm text-foreground">{field.value}</p>
            </div>
          ))}
          {entry.notes && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Notes</p>
              <p className="text-sm text-foreground">{entry.notes}</p>
            </div>
          )}

          <div className="pt-4 border-t">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Traceability</p>
            <div className="p-3 rounded-lg bg-muted/30 border">
              <p className="text-xs text-foreground font-medium">{entry.sourceType}: {entry.sourceDocument}</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                This entry was created by {entry.actor} via {entry.sourceType.toLowerCase()} processing.
                Ledger entries are immutable and append-only.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
