import {
  OPAQUE_REFERENCE_PATTERN,
  parseEntryQrPayload,
  type ScanCheckoutResponse,
} from '@cpvts/shared';

import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import { auditRejection, channelMetadata, type OperationContext } from './operation-context.js';
import { parkingErrors } from './parking.errors.js';
import { parkingRepository } from './parking.repository.js';
import { verifyActiveSession } from './session-verification.js';

/**
 * Camera checkout, server side. The Security Staff app scans the **session QR**
 * (`cpvts:session:<opaque reference>`, created with the parking session — never the receipt
 * QR, which only verifies a finished receipt) and sends the text here. The server:
 *
 *  1. extracts the opaque reference and looks it up (the QR carries no personal data and
 *     nothing in it — vehicle, slot, amount — is trusted),
 *  2. requires the session to be ACTIVE (a completed session's QR is refused),
 *  3. checks that the vehicle, the session and the slot records agree,
 *  4. returns the authoritative session for the operator to continue the checkout.
 *
 * Only an authenticated Security Staff member or administrator reaches this, and the QR alone
 * never completes anything: the payment and finalization are separate, authorized steps that
 * also accept the scanned reference as proof the right session is being checked out.
 */
export const qrCheckoutService = {
  async scan(qr: string, context: OperationContext): Promise<ScanCheckoutResponse> {
    const text = qr.trim();
    const reference =
      parseEntryQrPayload(text) ?? (OPAQUE_REFERENCE_PATTERN.test(text) ? text : null);

    // Unknown and malformed references are indistinguishable to the caller.
    const session = reference
      ? await parkingRepository.findSessionByEntryReference(reference)
      : null;
    if (!session) {
      throw await auditRejection(parkingErrors.invalidQrReference(), context, {
        metadata: { source: 'ENTRY_QR' },
      });
    }

    const verified = await verifyActiveSession(session, 'ENTRY_QR', context);

    await auditRepository.record({
      action: AUDIT_ACTIONS.checkoutQrScanned,
      actorId: context.actor.id,
      entityType: AUDIT_ENTITY_TYPES.parkingSession,
      entityId: session.sessionNumber,
      metadata: channelMetadata(context),
      request: context.request,
    });

    return verified;
  },
};
