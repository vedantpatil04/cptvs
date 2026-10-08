import { CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { errorMessage } from '@/lib/error-message';

import { ActiveVehicleCard } from './ActiveVehicleCard';
import { useVehicleSearch } from './use-vehicle-search';
import { VehicleSearchForm } from './VehicleSearchForm';

/** Vehicle Finder / Tracking Center for Security Staff and Admin. */
export function VehicleFinderPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  // Only the query present when the page opens triggers an automatic search.
  const [initial] = useState(() => params.get('q'));
  const { state, search } = useVehicleSearch(initial);

  const onSearch = (query: string) => {
    setParams({ q: query }, { replace: true });
    void search(query);
  };

  return (
    <>
      <PageHeader title={t('parking.finder.title')} description={t('parking.finder.description')} />
      <div className="space-y-6">
        <Card className="max-w-3xl">
          <CardContent>
            <VehicleSearchForm
              onSearch={onSearch}
              searching={state.status === 'searching'}
              initialValue={initial ?? ''}
            />
          </CardContent>
        </Card>
        {state.status === 'searching' && <LoadingState />}
        {state.status === 'error' && (
          <Alert variant="destructive" className="max-w-3xl">
            <CircleAlert aria-hidden />
            <AlertDescription>{errorMessage(t, state.error)}</AlertDescription>
          </Alert>
        )}
        {state.status === 'found' && <ActiveVehicleCard session={state.result.session} />}
      </div>
    </>
  );
}
