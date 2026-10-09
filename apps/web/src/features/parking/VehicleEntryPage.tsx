import {
  checkInRequestSchema,
  OWNER_CATEGORIES,
  VEHICLE_TYPES,
  type CheckInResponse,
  type VehicleLookupResponse,
} from '@cpvts/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertTriangle,
  Bike,
  Car,
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';

import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ChoiceGroup, NativeSelect } from '@/components/ui/choice-group';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { campusHourAt } from '@/lib/duration';
import { errorMessage } from '@/lib/error-message';
import { formatHour, HOURS } from '@/lib/format';
import { serverNow } from '@/lib/server-clock';

import { AllocationResult } from './AllocationResult';
import { ArrivalsPanel } from './ArrivalsPanel';
import { parkingApi } from './parking-api';

type EntryForm = z.input<typeof checkInRequestSchema>;

const VEHICLE_ICONS = { TWO_WHEELER: Bike, FOUR_WHEELER: Car } as const;

/** Security Staff check-in. Authoritative account lookup determines category. */
export function VehicleEntryPage() {
  const { t } = useTranslation();
  const [result, setResult] = useState<CheckInResponse | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [lookup, setLookup] = useState<VehicleLookupResponse | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  const form = useForm<EntryForm>({
    resolver: zodResolver(checkInRequestSchema),
    defaultValues: {
      vehicleNumber: '',
      vehicleType: undefined,
      ownerCategory: undefined,
      entryHour: campusHourAt(serverNow()),
    },
  });

  const vehicleNumber = useWatch({ control: form.control, name: 'vehicleNumber' });

  // Debounce lookup when vehicle number is typed
  useEffect(() => {
    const trimmed = vehicleNumber ? vehicleNumber.trim() : '';
    if (trimmed.length < 4) {
      return;
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      setLookupLoading(true);
      parkingApi
        .lookup(trimmed, abortController.signal)
        .then((res) => {
          setLookup(res);
          if (res.accountCategory) {
            form.setValue('ownerCategory', res.accountCategory);
          }
          if (res.vehicleType && !form.getValues('vehicleType')) {
            form.setValue('vehicleType', res.vehicleType);
          }
        })
        .catch(() => {
          // Ignore abort or network errors in background lookup
        })
        .finally(() => {
          setLookupLoading(false);
        });
    }, 400);

    return () => {
      clearTimeout(timeout);
      abortController.abort();
    };
  }, [vehicleNumber, form]);

  const activeLookup = vehicleNumber && vehicleNumber.trim().length >= 4 ? lookup : null;
  const categoryLocked =
    activeLookup?.accountCategory !== undefined && activeLookup.accountCategory !== null;

  const onSubmit = async (values: EntryForm) => {
    setSubmitError(null);
    try {
      setResult(await parkingApi.checkIn(values));
    } catch (error) {
      setSubmitError(error);
    }
  };

  const reset = () => {
    setResult(null);
    setLookup(null);
    form.reset({
      vehicleNumber: '',
      vehicleType: undefined,
      ownerCategory: undefined,
      entryHour: campusHourAt(serverNow()),
    });
  };

  return (
    <>
      <PageHeader title={t('parking.entry.title')} description={t('parking.entry.description')} />
      {result ? (
        <AllocationResult result={result} onNext={reset} />
      ) : (
        <div className="max-w-3xl space-y-6">
          <ArrivalsPanel />
          <Card className="max-w-2xl">
          <CardContent className="pt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6" noValidate>
                {submitError !== null && (
                  <Alert variant="destructive">
                    <CircleAlert aria-hidden />
                    <AlertDescription>{errorMessage(t, submitError)}</AlertDescription>
                  </Alert>
                )}

                <FormField
                  control={form.control}
                  name="vehicleNumber"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel>{t('parking.common.vehicleNumber')}</FormLabel>
                        {lookupLoading && (
                          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <LoaderCircle className="size-3 animate-spin" /> Verifying plate...
                          </span>
                        )}
                      </div>
                      <FormControl>
                        <Input
                          {...field}
                          onChange={(event) => field.onChange(event.target.value.toUpperCase())}
                          placeholder={t('parking.entry.vehicleNumberPlaceholder')}
                          autoComplete="off"
                          autoCapitalize="characters"
                          spellCheck={false}
                          autoFocus
                          className="font-mono text-lg tracking-wide uppercase"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Authoritative Lookup Status Feedback */}
                {activeLookup?.known && (
                  <div className="space-y-2">
                    {activeLookup.accountCategory ? (
                      <Alert className="border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200">
                        <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
                        <AlertTitle className="text-xs font-bold">
                          Verified Campus Account Recognized
                        </AlertTitle>
                        <AlertDescription className="text-xs">
                          This vehicle is registered to a verified{' '}
                          <Badge variant="outline" className="font-semibold bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 ml-1">
                            {activeLookup.accountCategory}
                          </Badge>{' '}
                          account. Institutional fee exemption / rates apply automatically.
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <Alert className="border-info/30 bg-info/5 text-foreground">
                        <CheckCircle2 className="size-4 text-info" />
                        <AlertDescription className="text-xs">
                          Known vehicle record found. Please confirm vehicle type and category.
                        </AlertDescription>
                      </Alert>
                    )}

                    {activeLookup.hasActiveSession && (
                      <Alert variant="destructive">
                        <AlertTriangle className="size-4" />
                        <AlertTitle className="text-xs font-bold">Duplicate Active Session</AlertTitle>
                        <AlertDescription className="text-xs">
                          This vehicle already has an active parking session on campus. Please check out the existing session first.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}

                <FormField
                  control={form.control}
                  name="vehicleType"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel id="vehicle-type-label">
                        {t('parking.common.vehicleType')}
                      </FormLabel>
                      <ChoiceGroup
                        name={field.name}
                        value={field.value}
                        onChange={field.onChange}
                        aria-labelledby="vehicle-type-label"
                        aria-invalid={fieldState.invalid}
                        options={VEHICLE_TYPES.map((value) => ({
                          value,
                          label: t(`vehicleTypes.${value}`),
                          icon: VEHICLE_ICONS[value],
                        }))}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="ownerCategory"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel id="owner-category-label">
                          {t('parking.common.ownerCategory')}
                        </FormLabel>
                        {categoryLocked && (
                          <Badge variant="secondary" className="text-[10px]">
                            Locked by Server (Authoritative)
                          </Badge>
                        )}
                      </div>
                      <ChoiceGroup
                        name={field.name}
                        value={field.value}
                        onChange={(val) => {
                          if (!categoryLocked) field.onChange(val);
                        }}
                        aria-labelledby="owner-category-label"
                        aria-invalid={fieldState.invalid}
                        options={OWNER_CATEGORIES.map((value) => ({
                          value,
                          label: t(`ownerCategories.${value}`),
                        }))}
                      />
                      {categoryLocked && (
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Security staff cannot change an institutional verified account category.
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="entryHour"
                  render={({ field }) => (
                    <FormItem className="max-w-48">
                      <FormLabel>{t('parking.common.entryHour')}</FormLabel>
                      <FormControl>
                        <NativeSelect
                          name={field.name}
                          ref={field.ref}
                          onBlur={field.onBlur}
                          value={String(field.value)}
                          onChange={(event) => field.onChange(Number(event.target.value))}
                        >
                          {HOURS.map((hour) => (
                            <option key={hour} value={hour}>
                              {formatHour(hour)}
                            </option>
                          ))}
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  size="lg"
                  disabled={form.formState.isSubmitting || lookup?.hasActiveSession}
                  className="sm:w-fit"
                >
                  {form.formState.isSubmitting && (
                    <LoaderCircle className="animate-spin" aria-hidden />
                  )}
                  {form.formState.isSubmitting
                    ? t('parking.entry.submitting')
                    : t('parking.entry.submit')}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
        </div>
      )}
    </>
  );
}
