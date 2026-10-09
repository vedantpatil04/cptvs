import type { ReceiptView } from '@cpvts/shared';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { Button } from '@/components/ui/button';
import { ReceiptActions, ReceiptDocument } from '@/features/parking/ReceiptPage';
import { errorMessage } from '@/lib/error-message';

import { visitorApi } from './visitor-api';
import { visitorSessionStore } from './visitor-session';

export function VisitorReceiptPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const token = visitorSessionStore.get();

  const [receipt, setReceipt] = useState<ReceiptView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      navigate('/visitor');
      return;
    }

    visitorApi
      .receipt(token)
      .then(setReceipt)
      .catch((err) => setError(errorMessage(t, err)))
      .finally(() => setLoading(false));
  }, [token, navigate, t]);

  if (!token) return null;

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6 space-y-6">
      <div className="print:hidden flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            visitorSessionStore.clear();
            navigate('/');
          }}
          className="gap-1.5 text-xs"
        >
          <ArrowLeft className="size-3.5" />
          Exit Slip / Return Home
        </Button>

        {receipt && <ReceiptActions receipt={receipt} />}
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState description={error} onRetry={() => window.location.reload()} />}

      {receipt && !loading && (
        <div className="space-y-6">
          <ReceiptDocument receipt={receipt} />
        </div>
      )}
    </div>
  );
}
