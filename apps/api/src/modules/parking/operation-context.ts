import type { Prisma } from '../../generated/prisma/client.js';
import type { AppError } from '../../lib/errors.js';
import { AUDIT_ACTIONS, type AuditEntityType } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import type { AuthenticatedUser, RequestMeta } from '../auth/auth.types.js';

/** Who is performing a parking operation, for authorisation context and the audit log. */
export interface OperationContext {
  actor: AuthenticatedUser;
  request: RequestMeta;
}

/**
 * The context of a checkout step. Operators and parking users act as
 * themselves; a visitor completing their own checkout has no account, so the
 * actor is null and the audit trail records a system action.
 */
export interface CheckoutContext {
  actor: { id: string } | null;
  request: RequestMeta;
}

/**
 * Records a refused operation (duplicate entry, mismatch, repeated checkout …)
 * in the audit log and returns the error for the caller to throw.
 */
export const auditRejection = async (
  error: AppError,
  context: CheckoutContext,
  subject: {
    entityType?: AuditEntityType;
    entityId?: string;
    metadata?: Prisma.InputJsonObject;
  } = {},
): Promise<AppError> => {
  await auditRepository.record({
    action: AUDIT_ACTIONS.integrityRejected,
    actorId: context.actor?.id ?? null,
    entityType: subject.entityType,
    entityId: subject.entityId,
    metadata: { code: error.code, ...subject.metadata },
    request: context.request,
  });
  return error;
};
