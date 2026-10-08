import { CircleAlert, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/choice-group';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface FilterField {
  name: string;
  label: string;
  type: 'text' | 'date' | 'select';
  /** Select options; an "All" option is added automatically. */
  options?: { value: string; label: string }[];
  placeholder?: string;
}

interface FilterBarProps {
  fields: FilterField[];
  /** Same schema the API enforces; checked before applying. */
  schema: z.ZodType;
  values: Record<string, string>;
  onApply: (values: Record<string, string>) => void;
  onReset: () => void;
}

/** One row of filters above the content they scope. Values live in the URL. */
export function FilterBar({ fields, schema, values, onApply, onReset }: FilterBarProps) {
  const { t } = useTranslation();
  const id = useId();
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const entries = [...new FormData(event.currentTarget).entries()]
      .map(([key, value]) => [key, String(value).trim()] as const)
      .filter(([, value]) => value !== '');
    const next = Object.fromEntries(entries);
    const parsed = schema.safeParse(next);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'validation.required');
      return;
    }
    setError(null);
    onApply(next);
  };

  return (
    <form
      // Remount when the URL changes so the inputs show the applied values.
      key={JSON.stringify(values)}
      onSubmit={submit}
      onReset={(event) => {
        event.preventDefault();
        setError(null);
        onReset();
      }}
      className="space-y-3"
      aria-label={t('filters.title')}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {fields.map((field) => (
          <div key={field.name} className="space-y-1.5">
            <Label htmlFor={`${id}-${field.name}`}>{field.label}</Label>
            {field.type === 'select' ? (
              <NativeSelect
                id={`${id}-${field.name}`}
                name={field.name}
                defaultValue={values[field.name] ?? ''}
              >
                <option value="">{t('filters.all')}</option>
                {field.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <Input
                id={`${id}-${field.name}`}
                name={field.name}
                type={field.type}
                defaultValue={values[field.name] ?? ''}
                placeholder={field.placeholder}
                autoComplete="off"
              />
            )}
          </div>
        ))}
      </div>
      {error && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{t(error as never)}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit">
          <SlidersHorizontal aria-hidden />
          {t('filters.apply')}
        </Button>
        <Button type="reset" variant="outline">
          <RotateCcw aria-hidden />
          {t('filters.reset')}
        </Button>
      </div>
    </form>
  );
}
