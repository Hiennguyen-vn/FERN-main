import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEFAULT_LIST_LIMIT_OPTIONS, toPage } from '@/lib/list-query';

interface ListPaginationControlsProps {
  total: number;
  limit: number;
  offset: number;
  hasMore?: boolean;
  disabled?: boolean;
  className?: string;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
  limitOptions?: readonly number[];
}

export function ListPaginationControls({
  total,
  limit,
  offset,
  hasMore = false,
  disabled,
  className,
  onPageChange,
  onLimitChange,
  limitOptions = DEFAULT_LIST_LIMIT_OPTIONS,
}: ListPaginationControlsProps) {
  const safeLimit = Math.max(1, Number(limit) || 1);
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeTotal = Math.max(0, Number(total) || 0);

  const currentPage = toPage(safeOffset, safeLimit);
  const inferredHasMore = safeTotal > 0 ? safeOffset + safeLimit < safeTotal : hasMore;
  const totalPages = safeTotal > 0 ? Math.max(1, Math.ceil(safeTotal / safeLimit)) : undefined;

  const prevDisabled = disabled || currentPage <= 1;
  const nextDisabled = disabled || !inferredHasMore;

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-2 pt-2', className)}>
      <div className="text-[11px] text-muted-foreground">
        Total: <span className="font-medium text-foreground">{safeTotal}</span>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-[11px] text-muted-foreground">Page size</label>
        <select
          value={safeLimit}
          disabled={disabled}
          onChange={(event) => onLimitChange(Number(event.target.value))}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs disabled:opacity-60"
        >
          {limitOptions.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">
          Page <span className="font-medium text-foreground">{currentPage}</span>
          {totalPages ? (
            <>
              {' '}/ <span className="font-medium text-foreground">{totalPages}</span>
            </>
          ) : null}
        </span>

        <button
          disabled={prevDisabled}
          onClick={() => onPageChange(currentPage - 1)}
          className="h-8 px-2.5 rounded border text-[11px] inline-flex items-center gap-1 hover:bg-accent disabled:opacity-50"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Prev
        </button>

        <button
          disabled={nextDisabled}
          onClick={() => onPageChange(currentPage + 1)}
          className="h-8 px-2.5 rounded border text-[11px] inline-flex items-center gap-1 hover:bg-accent disabled:opacity-50"
        >
          Next <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
