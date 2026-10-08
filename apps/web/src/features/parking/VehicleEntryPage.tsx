import {
  checkInRequestSchema,
  OWNER_CATEGORIES,
  VEHICLE_TYPES,
  type CheckInResponse,
} from '@cpvts/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Bike, Car, CircleAlert, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';

import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { errorMessage } from '@/lib/error-message';
import { formatHour, HOURS } from '@/lib/format';

import { AllocationResult } from './AllocationResult';
import { parkingApi } from './parking-api';

type EntryForm = z.input<typeof checkInRequestSchema>;

const VEHICLE_ICONS = { TWO_WHEELER: Bike, FOUR_WHEELER: Car } as const;

/** Security Staff check-in. Validation is repeated and enforced on the server. */
export function VehicleEntryPage() {
  const { t } = useTranslation();
  const [result, setResult] = useState<CheckInResponse | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);

  const form = useForm<EntryForm>({
    resolver: zodResolver(checkInRequestSchema),
    defaultValues: {
      vehicleNumber: '',
      vehicleType: undefined,
      ownerCategory: undefined,
      entryHour: new Date().getHours(),
    },
  });

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
    form.reset({
      vehicleNumber: '',
      vehicleType: undefined,
      ownerCategory: undefined,
      entryHour: new Date().getHours(),
    });
  };

  return (
    <>
      <PageHeader title={t('parking.entry.title')} description={t('parking.entry.description')} />
      {result ? (
        <AllocationResult result={result} onNext={reset} />
      ) : (
        <Card className="max-w-2xl">
          <CardContent>
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
                      <FormLabel>{t('parking.common.vehicleNumber')}</FormLabel>
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
                      <FormLabel id="owner-category-label">
                        {t('parking.common.ownerCategory')}
                      </FormLabel>
                      <ChoiceGroup
                        name={field.name}
                        value={field.value}
                        onChange={field.onChange}
                        aria-labelledby="owner-category-label"
                        aria-invalid={fieldState.invalid}
                        options={OWNER_CATEGORIES.map((value) => ({
                          value,
                          label: t(`ownerCategories.${value}`),
                        }))}
                      />
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
                  disabled={form.formState.isSubmitting}
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
      )}
    </>
  );
}
