import {
  registerVehicleRequestSchema,
  type RegisteredVehicle,
  type RegisterVehicleRequest,
  type UpdateVehicleRequest,
  type VehicleType,
} from '@cpvts/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Bike, Car, CircleAlert, LoaderCircle, MapPinned, Pencil, Plus, Star } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { userPaths } from '@/app/paths';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { PageHeader } from '@/components/layout/PageHeader';
import { PlateBadge } from '@/components/parking/PlateBadge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ChoiceGroup } from '@/components/ui/choice-group';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useApiQuery } from '@/hooks/use-api-query';
import { errorMessage } from '@/lib/error-message';
import { formatHour } from '@/lib/format';

import { userApi } from './user-api';

const TYPE_ICON = { TWO_WHEELER: Bike, FOUR_WHEELER: Car } as const;

/** My Vehicles: register, label and choose the primary vehicle. */
export function VehiclesPage() {
  const { t } = useTranslation();
  const vehicles = useApiQuery(userApi.vehicles);
  const [dialog, setDialog] = useState<{ vehicle: RegisteredVehicle | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const makePrimary = async (vehicle: RegisteredVehicle) => {
    setBusy(vehicle.id);
    setActionError(null);
    try {
      await userApi.makePrimary(vehicle.id);
      vehicles.reload();
    } catch (error) {
      setActionError(error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title={t('user.vehicles.title')}
        description={t('user.vehicles.description')}
        actions={
          <Button onClick={() => setDialog({ vehicle: null })}>
            <Plus aria-hidden />
            {t('user.vehicles.add')}
          </Button>
        }
      />
      {actionError !== null && (
        <Alert variant="destructive" className="mb-4">
          <CircleAlert aria-hidden />
          <AlertDescription>{errorMessage(t, actionError)}</AlertDescription>
        </Alert>
      )}
      {vehicles.status === 'loading' && <LoadingState />}
      {vehicles.status === 'error' && (
        <ErrorState description={errorMessage(t, vehicles.error)} onRetry={vehicles.refetch} />
      )}
      {vehicles.status === 'success' &&
        (vehicles.data.length === 0 ? (
          <EmptyState
            icon={Car}
            title={t('user.vehicles.emptyTitle')}
            description={t('user.vehicles.emptyHint')}
            action={
              <Button onClick={() => setDialog({ vehicle: null })}>
                <Plus aria-hidden />
                {t('user.vehicles.add')}
              </Button>
            }
          />
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {vehicles.data.map((vehicle) => {
              const Icon = TYPE_ICON[vehicle.vehicleType];
              return (
                <li
                  key={vehicle.id}
                  className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <PlateBadge value={vehicle.vehicleNumber} className="text-sm" />
                        {vehicle.isPrimary && (
                          <StatusBadge tone="info">
                            <Star aria-hidden />
                            {t('user.vehicles.primary')}
                          </StatusBadge>
                        )}
                      </div>
                      <p className="truncate text-sm text-muted-foreground">
                        {t(`vehicleTypes.${vehicle.vehicleType}`)}
                        {vehicle.label && ` · ${vehicle.label}`}
                      </p>
                      {vehicle.activeSession ? (
                        <p className="flex flex-wrap items-center gap-x-2 text-sm">
                          <StatusBadge tone="success" dot>
                            {t('parking.sessionStatus.ACTIVE')}
                          </StatusBadge>
                          <span className="text-muted-foreground">
                            {vehicle.activeSession.blockName} ·{' '}
                            <span translate="no">{vehicle.activeSession.slotCode}</span> ·{' '}
                            {formatHour(vehicle.activeSession.entryHour)}
                          </span>
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {t('user.vehicles.notParked')}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {vehicle.activeSession && (
                      <Button asChild variant="outline" size="sm">
                        <Link to={userPaths.locate(vehicle.activeSession.sessionNumber)}>
                          <MapPinned aria-hidden />
                          {t('user.actions.locate')}
                        </Link>
                      </Button>
                    )}
                    {!vehicle.isPrimary && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy === vehicle.id}
                        onClick={() => void makePrimary(vehicle)}
                      >
                        {busy === vehicle.id ? (
                          <LoaderCircle className="animate-spin" aria-hidden />
                        ) : (
                          <Star aria-hidden />
                        )}
                        {t('user.vehicles.makePrimary')}
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => setDialog({ vehicle })}>
                      <Pencil aria-hidden />
                      {t('user.vehicles.edit')}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ))}

      <VehicleDialog
        state={dialog}
        onClose={() => setDialog(null)}
        onSaved={() => {
          setDialog(null);
          vehicles.reload();
        }}
      />
    </>
  );
}

function VehicleDialog({
  state,
  onClose,
  onSaved,
}: {
  state: { vehicle: RegisteredVehicle | null } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        {state && (
          <VehicleForm
            key={state.vehicle?.id ?? 'new'}
            vehicle={state.vehicle}
            onSaved={onSaved}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function VehicleForm({
  vehicle,
  onSaved,
  onCancel,
}: {
  vehicle: RegisteredVehicle | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [submitError, setSubmitError] = useState<unknown>(null);
  const editing = vehicle !== null;
  const locked = editing && !vehicle.identityEditable;

  const form = useForm<RegisterVehicleRequest>({
    resolver: zodResolver(registerVehicleRequestSchema),
    defaultValues: {
      vehicleNumber: vehicle?.vehicleNumber ?? '',
      vehicleType: vehicle?.vehicleType ?? undefined,
      label: vehicle?.label ?? '',
    },
  });

  const onSubmit = async (values: RegisterVehicleRequest) => {
    setSubmitError(null);
    try {
      if (vehicle) {
        const parsed = values as {
          vehicleNumber: string;
          vehicleType: VehicleType;
          label?: string | null;
        };
        const changes: UpdateVehicleRequest = { label: parsed.label ?? null };
        if (!locked) {
          changes.vehicleNumber = parsed.vehicleNumber;
          changes.vehicleType = parsed.vehicleType;
        }
        await userApi.updateVehicle(vehicle.id, changes);
      } else {
        await userApi.addVehicle(values);
      }
      onSaved();
    } catch (error) {
      setSubmitError(error);
    }
  };
  const submitting = form.formState.isSubmitting;

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {editing ? t('user.vehicles.editTitle') : t('user.vehicles.addTitle')}
        </DialogTitle>
        <DialogDescription>
          {locked ? t('user.vehicles.lockedHint') : t('user.vehicles.formHint')}
        </DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4" noValidate>
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
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={t('parking.entry.vehicleNumberPlaceholder')}
                    disabled={locked}
                    className="font-mono uppercase placeholder:normal-case"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="vehicleType"
            render={({ field }) => (
              <FormItem>
                <FormLabel id="vehicle-type-label">{t('parking.common.vehicleType')}</FormLabel>
                <FormControl>
                  <ChoiceGroup
                    name="vehicleType"
                    aria-labelledby="vehicle-type-label"
                    value={field.value}
                    onChange={locked ? () => {} : field.onChange}
                    className={locked ? 'pointer-events-none opacity-60' : undefined}
                    options={[
                      { value: 'TWO_WHEELER', label: t('vehicleTypes.TWO_WHEELER'), icon: Bike },
                      { value: 'FOUR_WHEELER', label: t('vehicleTypes.FOUR_WHEELER'), icon: Car },
                    ]}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="label"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('user.vehicles.label')}</FormLabel>
                <FormControl>
                  <Input
                    maxLength={40}
                    autoComplete="off"
                    placeholder={t('user.vehicles.labelPlaceholder')}
                    {...field}
                    value={field.value ?? ''}
                  />
                </FormControl>
                <FormDescription>{t('user.vehicles.labelHint')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <LoaderCircle className="animate-spin" aria-hidden />}
              {editing ? t('user.vehicles.save') : t('user.vehicles.add')}
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  );
}
