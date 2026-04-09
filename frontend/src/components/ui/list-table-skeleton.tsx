import { Skeleton } from '@/components/ui/skeleton';

interface ListTableSkeletonProps {
  columns: number;
  rows?: number;
}

const WIDTHS = ['w-20', 'w-28', 'w-36', 'w-44', 'w-52', 'w-64'];

export function ListTableSkeleton({ columns, rows = 6 }: ListTableSkeletonProps) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <tr key={rowIndex} className="border-b last:border-0">
          {Array.from({ length: columns }).map((__, colIndex) => (
            <td key={colIndex} className="px-4 py-2.5">
              <Skeleton className={`h-3.5 ${WIDTHS[(rowIndex + colIndex) % WIDTHS.length]}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
