import { KeyRound, LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const CODE_LENGTH = 6;

interface ExitCodeEntryProps {
  /** Receives exactly six digits. */
  onSubmit: (code: string) => void;
  busy?: boolean;
  /** Increase to move keyboard focus into the field (e.g. when the scanner hands over to it). */
  focusSignal?: number;
}

/** The gate's fallback when a QR cannot be scanned: the 6 digits shown in the driver's app. */
export function ExitCodeEntry({ onSubmit, busy = false, focusSignal = 0 }: ExitCodeEntryProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (focusSignal > 0) inputRef.current?.focus();
  }, [focusSignal]);
  const complete = code.length === CODE_LENGTH;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (complete && !busy) onSubmit(code);
  };

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <div className="grid gap-2">
        <Label htmlFor="exit-code">{t('parking.exitCode.label')}</Label>
        <Input
          id="exit-code"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          ref={inputRef}
          maxLength={CODE_LENGTH}
          placeholder="••••••"
          aria-describedby="exit-code-hint"
          className="h-14 text-center font-mono text-3xl font-bold tracking-[0.4em] tabular-nums"
        />
        <p id="exit-code-hint" className="text-xs text-muted-foreground">
          {t('parking.exitCode.hint')}
        </p>
      </div>
      <Button type="submit" size="lg" className="h-12 w-full" disabled={!complete || busy}>
        {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <KeyRound aria-hidden />}
        {t('parking.exitCode.verify')}
      </Button>
    </form>
  );
}
