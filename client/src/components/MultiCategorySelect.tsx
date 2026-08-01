import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useListCategoriesQuery } from '@/app/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CategoryDto } from '@homefinance/shared';

/**
 * Multi-category checkbox dropdown. Groups categories by `type`
 * (expense / income / transfer). Value is `string[]` to match the
 * `TransactionFilter.categoryId` shape. Empty array = "all categories".
 */
export function MultiCategorySelect({
  value,
  onChange,
  className,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  className?: string;
}) {
  const { data } = useListCategoriesQuery();
  const cats = data ?? [];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const selected = useMemo(() => new Set(value), [value]);
  const label = value.length === 0 ? 'All categories' : `${value.length} selected`;

  const grouped = useMemo(() => {
    const order: Record<string, CategoryDto[]> = { expense: [], income: [], transfer: [], other: [] };
    for (const c of cats) (order[c.type ?? 'other'] ?? (order.other = [])).push(c);
    return order;
  }, [cats]);

  function toggle(id: string) {
    onChange(selected.has(id) ? value.filter((v) => v !== id) : [...value, id]);
  }
  function setAll() {
    onChange(cats.map((c) => c.id));
  }
  function setNone() {
    onChange([]);
  }

  return (
    <div ref={ref} className={cn('relative', className)}>
      <Button type="button" variant="outline" size="sm" className="w-44 justify-between" onClick={() => setOpen((o) => !o)}>
        <span className="truncate">{label}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-70" />
      </Button>
      {open && (
        <div className="absolute z-50 mt-1 max-h-80 w-64 overflow-y-auto rounded-md border border-border bg-card p-2 shadow-lg">
          <div className="mb-2 flex gap-2">
            <Button type="button" variant="outline" size="sm" className="h-7 flex-1" onClick={setAll}>All</Button>
            <Button type="button" variant="outline" size="sm" className="h-7 flex-1" onClick={setNone}>None</Button>
          </div>
          {(['expense', 'income', 'transfer', 'other'] as const).map((group) =>
            grouped[group] && grouped[group].length > 0 ? (
              <div key={group} className="mb-2">
                <div className="px-1 pb-1 text-xs font-medium uppercase text-muted-foreground">{group}</div>
                {grouped[group].map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                    <span className="truncate">{c.name}</span>
                  </label>
                ))}
              </div>
            ) : null,
          )}
          {cats.length === 0 && <div className="py-2 text-center text-sm text-muted-foreground">No categories</div>}
        </div>
      )}
    </div>
  );
}