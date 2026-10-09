import type { CheckoutQuote, ExitCodeResponse, ExitRequestState } from '@cpvts/shared';

import { campusHour } from '../../lib/campus-time.js';
import { checkoutService } from '../parking/checkout.service.js';
import { exitCodeService } from '../parking/exit-code.service.js';
import { exitRequestService } from '../parking/exit-request.service.js';
import type { ActorContext, OperationContext } from '../parking/operation-context.js';
import { findOwnSession } from './portal-access.js';

/** Self-service steps run as the account holder on the SELF_SERVICE channel. */
const asOwner = (context: OperationContext): ActorContext => ({
  actor: { id: context.actor.id },
  request: context.request,
  channel: 'SELF_SERVICE',
});

/**
 * What a Student / Campus Staff member can do about leaving. Checkout is gate-controlled:
 * the owner sees what they would owe if they left now and tells the gate they are ready, but
 * the payment, the session's completion, the receipt and the slot's release all happen at
 * the exit through Security Staff (`checkoutService`). There is no way to finalize from here.
 */
export const selfCheckoutService = {
  /**
   * A read-only preview: the amount due if the vehicle left in the current campus hour,
   * priced by the same fee engine. Nothing is recorded, reserved or frozen.
   */
  async quote(sessionNumber: string, context: OperationContext): Promise<CheckoutQuote> {
    await findOwnSession(context.actor.id, sessionNumber);
    return checkoutService.quote({ sessionNumber, exitHour: campusHour() }, asOwner(context), {
      record: false,
    });
  },

  /** "I am ready to leave" — a hint to the gate; the vehicle stays parked until the checkout. */
  async requestExit(sessionNumber: string, context: OperationContext): Promise<ExitRequestState> {
    const session = await findOwnSession(context.actor.id, sessionNumber);
    return exitRequestService.request(session.id, asOwner(context));
  },

  /** A fresh 6-digit exit code for the gate when the session QR cannot be scanned. */
  async issueExitCode(sessionNumber: string, context: OperationContext): Promise<ExitCodeResponse> {
    const session = await findOwnSession(context.actor.id, sessionNumber);
    return exitCodeService.issue(session.id, asOwner(context));
  },

  async cancelExitRequest(
    sessionNumber: string,
    context: OperationContext,
  ): Promise<ExitRequestState> {
    const session = await findOwnSession(context.actor.id, sessionNumber);
    return exitRequestService.cancel(session.id, asOwner(context));
  },
};
