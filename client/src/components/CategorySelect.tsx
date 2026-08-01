import { useListCategoriesQuery } from '@/app/api';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

export function CategorySelect({ value, onChange, allowEmpty = true, className }: { value: string | null; onChange: (id: string | null) => void; allowEmpty?: boolean; className?: string }) {
  const { data } = useListCategoriesQuery();
  const cats = data ?? [];
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className={className}>
      {allowEmpty && <option value="">Uncategorized</option>}
      {cats.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </Select>
  );
}

export function SourceBadge({ source }: { source: string }) {
  const tone = source === 'ai' ? 'warning' : source === 'rule' ? 'success' : 'muted';
  return <Badge tone={tone as any}>{source}</Badge>;
}