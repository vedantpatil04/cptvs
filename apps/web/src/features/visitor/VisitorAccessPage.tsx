import {
  ArrowLeft,
  LoaderCircle,
  Ticket,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/error-message';

import { visitorApi } from './visitor-api';
import { visitorSessionStore } from './visitor-session';

export function VisitorAccessPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [vehicleNumber, setVehicleNumber] = useState('');
  const [sessionNumber, setSessionNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await visitorApi.access({
        vehicleNumber: vehicleNumber.trim().toUpperCase(),
        sessionNumber: sessionNumber.trim().toUpperCase(),
      });
      visitorSessionStore.set(res.accessToken);
      navigate('/visitor/parking');
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 bg-muted/20">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="size-3.5" />
          Back to Login
        </Link>
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mx-auto mb-3">
          <Ticket className="size-6" />
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground text-center">
          Visitor Parking Access
        </h1>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Enter your vehicle number and session number printed on your gate parking slip
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
        <Card className="shadow-lg border-border">
          <CardContent className="p-6 sm:p-8">
            {error && (
              <Alert variant="destructive" className="mb-6">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="vis-veh">Vehicle Number</Label>
                <Input
                  id="vis-veh"
                  value={vehicleNumber}
                  onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                  placeholder="e.g. KA22AB1234"
                  required
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="vis-ses">Session Number (from Slip)</Label>
                <Input
                  id="vis-ses"
                  value={sessionNumber}
                  onChange={(e) => setSessionNumber(e.target.value.toUpperCase())}
                  placeholder="e.g. CPVTS-P-XXXXXXXX"
                  required
                />
                <p className="text-[11px] text-muted-foreground">
                  Format: CPVTS-P- followed by 8 characters
                </p>
              </div>

              <Button type="submit" disabled={loading} className="w-full gap-2 mt-4">
                {loading ? <LoaderCircle className="size-4 animate-spin" /> : <Ticket className="size-4" />}
                Access Parking Slip
              </Button>
            </form>

            <div className="mt-6 pt-4 border-t text-center text-xs text-muted-foreground">
              Visitors do not require permanent account registration. Your temporary token is valid
              only for this active stay.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
