import type { RegisteredVehicle, VehicleType } from '@cpvts/shared';
import {
  Bike,
  Car,
  Compass,
  Edit2,
  LoaderCircle,
  ParkingCircle,
  Plus,
  RefreshCw,
  Star,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCurrentUser } from '@/features/auth/use-auth';
import { useApiQuery } from '@/hooks/use-api-query';
import { errorMessage } from '@/lib/error-message';

import { portalApi } from './portal-api';

export function MyVehiclesPage() {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  const [params] = useSearchParams();

  const query = useApiQuery(portalApi.vehicles);
  const vehicles = query.data?.vehicles ?? [];

  const [addDialogOpen, setAddDialogOpen] = useState(() => params.get('add') === '1');
  const [editVehicle, setEditVehicle] = useState<RegisteredVehicle | null>(null);

  const [plateNumber, setPlateNumber] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('TWO_WHEELER');
  const [label, setLabel] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isVerified = user.parkingUser?.verificationStatus === 'VERIFIED';

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await portalApi.registerVehicle({
        vehicleNumber: plateNumber.trim().toUpperCase(),
        vehicleType,
        label: label.trim() || undefined,
      });
      setAddDialogOpen(false);
      setPlateNumber('');
      setLabel('');
      query.reload();
    } catch (err) {
      setFormError(errorMessage(t, err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editVehicle) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await portalApi.updateVehicle(editVehicle.id, {
        vehicleNumber: editVehicle.identityEditable ? plateNumber.trim().toUpperCase() : undefined,
        vehicleType: editVehicle.identityEditable ? vehicleType : undefined,
        label: label.trim() || null,
      });
      setEditVehicle(null);
      query.reload();
    } catch (err) {
      setFormError(errorMessage(t, err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetPrimary = async (vehicleId: string) => {
    try {
      await portalApi.setPrimaryVehicle(vehicleId);
      query.reload();
    } catch {
      // Ignore
    }
  };

  const openEdit = (v: RegisteredVehicle) => {
    setEditVehicle(v);
    setPlateNumber(v.vehicleNumber);
    setVehicleType(v.vehicleType);
    setLabel(v.label || '');
    setFormError(null);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Vehicles"
        description="Manage your registered two-wheelers and four-wheelers (up to 5 vehicles)"
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={query.reload}
            >
              <RefreshCw className="size-4" aria-hidden />
              Refresh
            </Button>
            <Button
              size="sm"
              disabled={vehicles.length >= 5}
              onClick={() => {
                setFormError(null);
                setPlateNumber('');
                setLabel('');
                setVehicleType('TWO_WHEELER');
                setAddDialogOpen(true);
              }}
              className="gap-1.5"
            >
              <Plus className="size-4" />
              Add Vehicle
            </Button>
          </div>
        }
      />

      {query.status === 'loading' && <LoadingState />}
      {query.status === 'error' && (
        <ErrorState description={errorMessage(t, query.error)} onRetry={query.refetch} />
      )}

      {query.status === 'success' && (
        <div className="space-y-6">
          {vehicles.length === 0 ? (
            <Card className="p-12 text-center border-dashed">
              <div className="max-w-md mx-auto space-y-4">
                <div className="flex size-14 items-center justify-center rounded-full bg-muted mx-auto text-muted-foreground">
                  <Car className="size-8" />
                </div>
                <h3 className="text-xl font-bold tracking-tight">No Vehicles Registered</h3>
                <p className="text-sm text-muted-foreground">
                  Register your vehicle license plate to park easily on campus.
                </p>
                <Button onClick={() => setAddDialogOpen(true)} className="gap-2">
                  <Plus className="size-4" />
                  Add Your Vehicle
                </Button>
              </div>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {vehicles.map((v) => {
                const Icon = v.vehicleType === 'TWO_WHEELER' ? Bike : Car;
                const isParked = Boolean(v.activeSession);

                return (
                  <Card
                    key={v.id}
                    className={`flex flex-col justify-between overflow-hidden shadow-xs border-2 transition-all ${
                      v.isPrimary ? 'border-primary/50 bg-gradient-to-br from-primary/5 to-card' : 'border-border'
                    }`}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            <Icon className="size-5" />
                          </div>
                          <div>
                            <CardTitle className="font-mono text-xl font-black">
                              {v.vehicleNumber}
                            </CardTitle>
                            <CardDescription className="text-xs">
                              {v.label || t(`vehicleTypes.${v.vehicleType}`)}
                            </CardDescription>
                          </div>
                        </div>

                        {v.isPrimary ? (
                          <Badge className="bg-primary text-primary-foreground text-[10px] gap-1 font-semibold">
                            <Star className="size-3 fill-current" />
                            Primary
                          </Badge>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => handleSetPrimary(v.id)}
                            title="Set as primary vehicle"
                          >
                            Set Primary
                          </Button>
                        )}
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-4 pt-1">
                      {/* Current Status Box */}
                      <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground">
                          Current Status
                        </span>
                        {isParked ? (
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                              <span className="size-2 rounded-full bg-emerald-500 animate-ping" />
                              Parked in {v.activeSession?.blockName}
                            </span>
                            <span className="font-mono font-bold text-primary">
                              Slot {v.activeSession?.slotCode}
                            </span>
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground font-medium">
                            Not parked on campus
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {isParked ? (
                          <Button asChild size="sm" className="gap-1.5 flex-1">
                            <Link to={`/portal/locate?session=${encodeURIComponent(v.activeSession!.sessionNumber)}`}>
                              <Compass className="size-3.5" />
                              Locate
                            </Link>
                          </Button>
                        ) : (
                          <Button
                            asChild
                            size="sm"
                            disabled={!isVerified}
                            className="gap-1.5 flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                          >
                            <Link to="/portal/park-now">
                              <ParkingCircle className="size-3.5" />
                              Park Now
                            </Link>
                          </Button>
                        )}

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(v)}
                          title="Edit vehicle details"
                        >
                          <Edit2 className="size-3.5" />
                          Edit
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Add Vehicle Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent closeLabel={t('common.close')}>
          <form onSubmit={handleAddSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Register New Vehicle</DialogTitle>
              <DialogDescription>
                Add a vehicle license plate to your verified profile.
              </DialogDescription>
            </DialogHeader>

            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="add-plate">Vehicle Number (License Plate)</Label>
                <Input
                  id="add-plate"
                  value={plateNumber}
                  onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
                  placeholder="e.g. KA22AB1234"
                  required
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="add-type">Vehicle Type</Label>
                <select
                  id="add-type"
                  value={vehicleType}
                  onChange={(e) => setVehicleType(e.target.value as VehicleType)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="TWO_WHEELER">{t('vehicleTypes.TWO_WHEELER')}</option>
                  <option value="FOUR_WHEELER">{t('vehicleTypes.FOUR_WHEELER')}</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="add-label">Label / Nickname (Optional)</Label>
                <Input
                  id="add-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Blue Activa or Daily Commute"
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => setAddDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <LoaderCircle className="size-4 animate-spin mr-1.5" />}
                Register Vehicle
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Vehicle Dialog */}
      <Dialog open={editVehicle !== null} onOpenChange={(open) => !open && setEditVehicle(null)}>
        <DialogContent closeLabel={t('common.close')}>
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Edit Vehicle</DialogTitle>
              <DialogDescription>
                Update nickname or plate (plate editable only while vehicle has no history).
              </DialogDescription>
            </DialogHeader>

            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-plate">Vehicle Number</Label>
                <Input
                  id="edit-plate"
                  value={plateNumber}
                  disabled={!editVehicle?.identityEditable}
                  onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
                />
                {!editVehicle?.identityEditable && (
                  <p className="text-[11px] text-muted-foreground">
                    License plate is locked because this vehicle has parking history.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-label">Label / Nickname</Label>
                <Input
                  id="edit-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => setEditVehicle(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <LoaderCircle className="size-4 animate-spin mr-1.5" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
