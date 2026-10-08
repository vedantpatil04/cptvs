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
 * Records a refused operation (duplicate entry, mismatch, repeated checkout …)
 * in the audit log and returns the error for the caller to throw.
 */
export const auditRejection = async (
  error: AppError,
  context: OperationContext,
  subject: {
    entityType?: AuditEntityType;
    entityId?: string;
    metadata?: Prisma.InputJsonObject;
  } = {},
): Promise<AppError> => {
  await auditRepository.record({
    action: AUDIT_ACTIONS.integrityRejected,
    actorId: context.actor.id,
    entityType: subject.entityType,
    entityId: subject.entityId,
    metadata: { code: error.code, ...subject.metadata },
    request: context.request,
  });
  return error;
};
