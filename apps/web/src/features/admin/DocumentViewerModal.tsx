import {
  Download,
  ExternalLink,
  Eye,
  FileText,
  Loader2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorState } from '@/components/feedback/ErrorState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';
import { downloadBlob } from '@/lib/receipt-image';

import { adminApi } from './admin-api';

export interface DocumentViewerDoc {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  institutionalId?: string;
}

export interface DocumentViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  userName?: string;
  document: DocumentViewerDoc | null;
}

export function DocumentViewerModal({
  isOpen,
  onClose,
  userId,
  userName,
  document: doc,
}: DocumentViewerModalProps) {
  const { t } = useTranslation();
  const format = useFormatters();

  const [docData, setDocData] = useState<{
    docId: string;
    blobUrl: string;
    blob: Blob;
  } | null>(null);
  const [fetchError, setFetchError] = useState<{ docId: string; error: string } | null>(null);
  const [zoom, setZoom] = useState(1);

  const isPdf = doc?.mimeType === 'application/pdf';
  const isImage = Boolean(doc?.mimeType.startsWith('image/'));

  const loading = Boolean(isOpen && doc && (!docData || docData.docId !== doc.id) && (!fetchError || fetchError.docId !== doc.id));
  const error = (fetchError && doc && fetchError.docId === doc.id) ? fetchError.error : null;
  const blobUrl = (docData && doc && docData.docId === doc.id) ? docData.blobUrl : null;

  useEffect(() => {
    if (!isOpen || !doc) {
      return;
    }

    let active = true;
    let createdUrl: string | null = null;

    adminApi
      .downloadDocument(userId, doc.id)
      .then(({ blob }) => {
        if (!active) return;
        createdUrl = URL.createObjectURL(blob);
        setDocData({ docId: doc.id, blobUrl: createdUrl, blob });
      })
      .catch((err) => {
        if (!active) return;
        setFetchError({ docId: doc.id, error: errorMessage(t, err) });
      });

    return () => {
      active = false;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [isOpen, userId, doc, t]);

  const handleClose = () => {
    if (docData?.blobUrl) {
      URL.revokeObjectURL(docData.blobUrl);
    }
    setDocData(null);
    setFetchError(null);
    setZoom(1);
    onClose();
  };

  const handleDownload = () => {
    if (docData?.blob && doc) {
      downloadBlob(docData.blob, doc.fileName);
    } else if (doc) {
      adminApi.downloadDocument(userId, doc.id).then(({ blob }) => {
        downloadBlob(blob, doc.fileName);
      });
    }
  };

  const handleZoomIn = () => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)));
  const handleZoomOut = () => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)));
  const handleResetZoom = () => setZoom(1);

  if (!doc) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        className="max-w-4xl w-[95vw] max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden"
        closeLabel={t('common.close')}
      >
        <DialogHeader className="p-4 sm:p-5 border-b shrink-0 bg-card">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pr-6">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2">
                <DialogTitle className="text-base sm:text-lg font-bold truncate">
                  {doc.fileName}
                </DialogTitle>
                <Badge variant="outline" className="font-mono text-xs uppercase shrink-0">
                  {isPdf ? 'PDF' : isImage ? (doc.mimeType.includes('png') ? 'PNG' : 'JPEG') : 'DOC'}
                </Badge>
              </div>
              <DialogDescription className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
                {userName && <span>Account: <strong className="text-foreground">{userName}</strong></span>}
                {doc.institutionalId && <span>ID: <strong className="font-mono text-foreground">{doc.institutionalId}</strong></span>}
                <span>Size: {(doc.sizeBytes / 1024).toFixed(1)} KB</span>
                <span>Uploaded: {format.dateTime(doc.uploadedAt)}</span>
              </DialogDescription>
            </div>

            {/* Viewer actions */}
            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
              {isImage && blobUrl && !loading && (
                <div className="flex items-center border rounded-lg bg-muted/40 p-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={handleZoomOut}
                    disabled={zoom <= 0.5}
                    title="Zoom Out"
                    aria-label="Zoom Out"
                  >
                    <ZoomOut className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs font-mono font-medium"
                    onClick={handleResetZoom}
                    title="Reset Zoom"
                    aria-label="Reset Zoom"
                  >
                    {Math.round(zoom * 100)}%
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={handleZoomIn}
                    disabled={zoom >= 3}
                    title="Zoom In"
                    aria-label="Zoom In"
                  >
                    <ZoomIn className="size-3.5" />
                  </Button>
                </div>
              )}

              {isPdf && blobUrl && !loading && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(blobUrl, '_blank')}
                  className="gap-1.5 h-8 text-xs"
                >
                  <ExternalLink className="size-3.5" />
                  Open in New Tab
                </Button>
              )}

              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={handleDownload}
                className="gap-1.5 h-8 text-xs"
              >
                <Download className="size-3.5" />
                Download
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Viewer Content Body */}
        <div className="flex-1 min-h-[360px] max-h-[74vh] overflow-auto bg-muted/20 flex items-center justify-center p-3 sm:p-5 relative">
          {loading && (
            <div className="flex flex-col items-center gap-2 text-muted-foreground p-8">
              <Loader2 className="size-8 animate-spin text-primary" />
              <p className="text-xs">Loading secure document preview...</p>
            </div>
          )}

          {error && (
            <div className="max-w-md w-full p-4">
              <ErrorState description={error} />
            </div>
          )}

          {!loading && !error && blobUrl && (
            <>
              {isImage && (
                <div className="w-full h-full flex items-center justify-center overflow-auto min-h-[320px]">
                  <img
                    src={blobUrl}
                    alt={doc.fileName}
                    style={{
                      transform: `scale(${zoom})`,
                      transformOrigin: 'center center',
                    }}
                    className="max-h-[68vh] max-w-full object-contain rounded-md shadow-md select-none transition-transform duration-100 ease-out"
                  />
                </div>
              )}

              {isPdf && (
                <iframe
                  src={blobUrl}
                  title={doc.fileName}
                  className="w-full h-[70vh] rounded-lg border bg-white shadow-inner"
                />
              )}

              {!isImage && !isPdf && (
                <div className="text-center p-8 space-y-3">
                  <FileText className="size-12 mx-auto text-muted-foreground" />
                  <p className="text-sm font-semibold">{doc.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    Preview is not available for MIME type: {doc.mimeType}
                  </p>
                  <Button size="sm" onClick={handleDownload} className="gap-1.5">
                    <Download className="size-4" />
                    Download to View
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t bg-card text-[11px] text-muted-foreground flex items-center justify-between shrink-0">
          <span className="flex items-center gap-1.5">
            <Eye className="size-3.5 text-primary" />
            Audited Document Review · Access is logged for compliance
          </span>
          <Button variant="ghost" size="sm" onClick={handleClose} className="h-7 text-xs">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
