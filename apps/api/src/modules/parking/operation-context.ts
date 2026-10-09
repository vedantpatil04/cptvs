import type { Prisma } from '../../generated/prisma/client.js';
import type { AppError } from '../../lib/errors.js';
import { AUDIT_ACTIONS, type AuditEntityType } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import type { AuthenticatedUser, RequestMeta } from '../auth/auth.types.js';

/** How an operation reached the system. Security-desk operations are the default and are not annotated. */
export type OperationChannel = 'SELF_SERVICE' | 'VISITOR';

/**
 * Who is performing an operation, for the audit log. `actor` is null for a
 * visitor, who has no account; `channel` then says how the step happened.
 */
export interface ActorContext {
  actor: { id: string } | null;
  request: RequestMeta;
  channel?: OperationChannel;
  /** The duty shift of the Security Staff member acting (null for administrators and when none). */
  shiftId?: string | null;
  /** An administrator acting outside any shift (emergency / management override). */
  override?: boolean;
}

/** Who is performing a parking operation, for authorisation context and the audit log. */
export interface OperationContext extends ActorContext {
  actor: AuthenticatedUser;
}

/**
 * Audit metadata that records how a step happened: the channel of a self-service or
 * visitor step, the duty shift of a gate operation and an administrator's override.
 */
export const channelMetadata = (context: ActorContext): Prisma.InputJsonObject => ({
  ...(context.channel ? { via: context.channel } : {}),
  ...(context.shiftId ? { shiftId: context.shiftId } : {}),
  ...(context.override ? { override: true } : {}),
});

/**
 * Records a refused operation (duplicate entry, mismatch, repeated checkout …)
 * in the audit log and returns the error for the caller to throw.
 */
export const auditRejection = async (
  error: AppError,
  context: ActorContext,
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
    metadata: { code: error.code, ...subject.metadata, ...channelMetadata(context) },
    request: context.request,
  });
  return error;
};
