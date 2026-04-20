import { Coffee, LayoutGrid, Package2 } from 'lucide-react';
import type { PosMenuCategory } from '../hooks/use-pos-menu';

interface Props {
  active: string;
  categories: PosMenuCategory[];
  totalCount: number;
  onChange: (code: string) => void;
  outletName?: string;
}

export function CategorySidebar({ active, categories, totalCount, onChange, outletName }: Props) {
  return (
    <aside className="w-24 shrink-0 bg-white border-r flex flex-col items-center py-4 gap-1">
      <div className="w-14 h-14 rounded-2xl pos-accent-bg flex items-center justify-center mb-3 shadow-md">
        <Coffee className="w-7 h-7" />
      </div>
      <div className="text-[11px] font-semibold tracking-wide">BEAN</div>
      <div className="text-[10px] text-muted-foreground mb-3 px-1 text-center truncate w-full">{outletName ?? ''}</div>

      <SidebarBtn
        icon={<LayoutGrid className="w-5 h-5" />}
        label="Tất cả"
        count={totalCount}
        active={active === 'all'}
        onClick={() => onChange('all')}
      />
      {categories.map((c) => (
        <SidebarBtn
          key={c.code}
          icon={<Package2 className="w-5 h-5" />}
          label={c.name}
          count={c.count}
          active={active === c.code}
          onClick={() => onChange(c.code)}
        />
      ))}
    </aside>
  );
}

function SidebarBtn({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pos-sidebar-btn relative w-20 h-16 rounded-xl flex flex-col items-center justify-center gap-1 transition ${
        active ? 'active' : 'hover:bg-[hsl(var(--pos-accent-soft))]'
      }`}
    >
      {icon}
      <span className="text-[11px] font-medium line-clamp-1 px-1 text-center">{label}</span>
      <span className={`absolute top-1 right-2 text-[10px] rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center font-semibold ${
        active ? 'bg-white/25 text-white' : 'pos-accent-bg'
      }`}>
        {count}
      </span>
    </button>
  );
}
