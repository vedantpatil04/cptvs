import { LoaderCircle, Search } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * One box for vehicle number, slot ID, session number or a scanned entry QR.
 * Hardware QR scanners type into the focused field, so scanning works here.
 */
export function VehicleSearchForm({
  onSearch,
  searching,
  initialValue = '',
  submitLabel,
}: {
  onSearch: (query: string) => void;
  searching: boolean;
  initialValue?: string;
  submitLabel?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [value, setValue] = useState(initialValue);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const query = value.trim();
    if (query) onSearch(query);
  };

  return (
    <form onSubmit={submit} className="grid gap-2" role="search">
      <Label htmlFor={id}>{t('parking.search.label')}</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={id}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t('parking.search.placeholder')}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          autoFocus
          className="font-mono sm:flex-1"
        />
        <Button type="submit" disabled={searching || !value.trim()}>
          {searching ? (
            <LoaderCircle className="animate-spin" aria-hidden />
          ) : (
            <Search aria-hidden />
          )}
          {submitLabel ?? t('parking.search.submit')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('parking.search.hint')}</p>
    </form>
  );
}
