import type { RequestHandler } from 'express';

import { config } from '../../config/index.js';
import { unauthenticated } from '../../lib/errors.js';
import { requireAuth } from '../../lib/request-context.js';
import { shiftErrors } from './shift.errors.js';
import { shiftService } from './shift.service.js';

/**
 * Works out who is operating the gate and under which duty shift, for the gate operations
 * that follow. Use after `authenticate` and `authorize(...)`.
 *
 *  - An **administrator** acts as an override: no shift, flagged in the audit trail.
 *  - **Security Staff** act under their shift when they are on duty (checked in, started, not
 *    past the end plus the grace period); otherwise there is none.
 */
export const resolveOperator: RequestHandler = async (req, _res, next) => {
  const { user } = requireAuth(req);
  if (user.role === 'ADMIN') {
    req.operator = { override: true, shift: null, state: 'NONE' };
    next();
    return;
  }
  const { shift, state } = await shiftService.activeFor(user.id);
  req.operator = {
    override: false,
    shift: state === 'ON_DUTY' && shift ? { id: shift.id, gate: shift.gate } : null,
    state,
  };
  next();
};

/**
 * Gate operations that start something (a vehicle entry, a checkout payment) need an on-duty
 * shift for Security Staff while `SHIFT_ENFORCEMENT=required`. Administrators are always
 * allowed (emergency override), and with `optional` enforcement the guard may work without a
 * shift — what they do is still attributed to their shift when they have one.
 */
export const requireActiveShift: RequestHandler = (req, _res, next) => {
  const operator = req.operator;
  if (!operator) {
    next(unauthenticated());
    return;
  }
  if (operator.override || operator.shift || config.shifts.enforcement === 'optional') {
    next();
    return;
  }
  next(operator.state === 'ENDED' ? shiftErrors.ended() : shiftErrors.required());
};

/** `resolveOperator` then `requireActiveShift`. */
export const gateOperation: RequestHandler[] = [resolveOperator, requireActiveShift];
