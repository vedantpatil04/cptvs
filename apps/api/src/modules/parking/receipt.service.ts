import {
  maskVehicleNumber,
  type ReceiptVerificationResponse,
  type ReceiptView,
} from '@cpvts/shared';

import { logger } from '../../lib/logger.js';
import { parkingErrors } from './parking.errors.js';
import { toReceiptView } from './parking.mappers.js';
import { parkingRepository, type ReceiptWithRelations } from './parking.repository.js';

/**
 * Cross-checks a receipt against its payment and session. A receipt is valid
 * only if every record of the finalized transaction agrees.
 */
export const isReceiptConsistent = (receipt: ReceiptWithRelations): boolean => {
  const { payment, session } = receipt;
  return (
    payment.status === 'PAID' &&
    payment.sessionId === receipt.sessionId &&
    payment.amountPaise === receipt.amountPaise &&
    session.status === 'COMPLETED' &&
    session.feeAmountPaise === receipt.amountPaise &&
    session.exitHour === payment.exitHour
  );
};

export const receiptService = {
  /** Full receipt for authenticated staff (view, print, download). */
  async getByNumber(receiptNumber: string): Promise<ReceiptView> {
    const receipt = await parkingRepository.findReceiptByNumber(receiptNumber);
    if (!receipt) throw parkingErrors.receiptNotFound();
    return toReceiptView(receipt);
  },

  /**
   * Public QR verification. The QR carries only an opaque reference; every
   * displayed value comes from the authoritative database records.
   */
  async verify(reference: string): Promise<ReceiptVerificationResponse> {
    const receipt = await parkingRepository.findReceiptByVerificationReference(reference);
    if (!receipt) throw parkingErrors.receiptNotFound();

    const valid = isReceiptConsistent(receipt);
    if (!valid) {
      logger.warn('receipt failed consistency verification', {
        receiptNumber: receipt.receiptNumber,
      });
    }
    return {
      status: valid ? 'VALID' : 'INVALID',
      receipt: {
        receiptNumber: receipt.receiptNumber,
        issuedAt: receipt.issuedAt.toISOString(),
        // The public check is a capability link, not a login: never show a full plate.
        vehicleNumber: maskVehicleNumber(receipt.session.vehicle.vehicleNumber),
        blockName: receipt.session.slot.zone.block.name,
        slotCode: receipt.session.slot.code,
        durationHours: receipt.session.durationHours ?? 0,
        amountPaise: receipt.amountPaise,
        paymentStatus: receipt.payment.status,
        isSimulated: receipt.payment.isSimulated,
      },
    };
  },
};
