import type {
  LoginResponse,
  ParkingUserCategory,
  RegistrationInput,
  VerificationResubmission,
} from '@cpvts/shared';

import { config } from '../../config/index.js';
import type { DbClient } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { withTransaction } from '../../db/transaction.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import { authService } from '../auth/auth.service.js';
import type { RequestMeta } from '../auth/auth.types.js';
import { hashPassword } from '../auth/password.js';
import type { OperationContext } from '../parking/operation-context.js';
import { accountErrors } from './accounts.errors.js';
import { decodeIdentityDocument, type DecodedDocument } from './identity-document.js';

const emailDomainAllowed = (email: string): boolean => {
  const domains = config.accounts.emailDomains;
  if (domains.length === 0) return true;
  const domain = email.split('@')[1] ?? '';
  return domains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
};

/** Internal username for a parking user; they sign in with their e-mail address. */
const usernameFor = (category: ParkingUserCategory, institutionalId: string): string =>
  `${category.toLowerCase()}:${institutionalId.toLowerCase()}`.slice(0, 64);

const storeDocument = (
  userId: string,
  institutionalId: string,
  document: DecodedDocument,
  db: DbClient,
) =>
  db.identityDocument.create({
    data: {
      userId,
      institutionalId,
      fileName: document.fileName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      sha256: document.sha256,
      content: document.content,
    },
    select: { id: true },
  });

/** Maps unique-index races to the same errors as the explicit checks. */
const mapUniqueViolation = (error: unknown): never => {
  if (isUniqueViolation(error, 'parking_user_profiles_email_key')) {
    throw accountErrors.emailTaken();
  }
  if (
    isUniqueViolation(error, 'parking_user_profiles_category_institutional_id_key') ||
    isUniqueViolation(error, 'users_username_key')
  ) {
    throw accountErrors.institutionalIdTaken();
  }
  throw error;
};

export const registrationService = {
  /**
   * Creates a Student or Campus Staff account with its identity document.
   * The account starts PENDING: it can sign in and see its verification
   * status, but parking features wait for an administrator's approval.
   */
  async register(
    category: ParkingUserCategory,
    input: RegistrationInput,
    request: RequestMeta,
  ): Promise<LoginResponse> {
    if (!emailDomainAllowed(input.email)) throw accountErrors.emailDomainNotAllowed();
    const document = decodeIdentityDocument(input.document);
    const passwordHash = await hashPassword(input.password);

    try {
      return await withTransaction(async (tx) => {
        if (await tx.parkingUserProfile.findUnique({ where: { email: input.email } })) {
          throw accountErrors.emailTaken();
        }
        const existingId = await tx.parkingUserProfile.findUnique({
          where: {
            category_institutionalId: { category, institutionalId: input.institutionalId },
          },
        });
        if (existingId) throw accountErrors.institutionalIdTaken();

        const user = await tx.user.create({
          data: {
            username: usernameFor(category, input.institutionalId),
            fullName: input.fullName,
            passwordHash,
            role: 'PARKING_USER',
            parkingProfile: {
              create: {
                category,
                institutionalId: input.institutionalId,
                email: input.email,
                phone: input.phone,
                verificationSubmittedAt: new Date(),
              },
            },
          },
          select: { id: true },
        });
        const stored = await storeDocument(user.id, input.institutionalId, document, tx);

        await auditRepository.record(
          {
            action: AUDIT_ACTIONS.userRegistered,
            actorId: user.id,
            entityType: AUDIT_ENTITY_TYPES.user,
            entityId: user.id,
            metadata: { category, institutionalId: input.institutionalId },
            request,
          },
          tx,
        );
        await auditRepository.record(
          {
            action: AUDIT_ACTIONS.identitySubmitted,
            actorId: user.id,
            entityType: AUDIT_ENTITY_TYPES.identityDocument,
            entityId: stored.id,
            metadata: { mimeType: document.mimeType, sizeBytes: document.sizeBytes },
            request,
          },
          tx,
        );
        return authService.startSession(user.id, request, tx);
      });
    } catch (error) {
      return mapUniqueViolation(error);
    }
  },

  /** After a rejection: a new document (and possibly corrected ID) puts the account back to PENDING. */
  async resubmit(input: VerificationResubmission, context: OperationContext): Promise<void> {
    const userId = context.actor.id;
    const document = decodeIdentityDocument(input.document);
    const institutionalId = input.institutionalId.trim().toUpperCase();

    try {
      await withTransaction(async (tx) => {
        const profile = await tx.parkingUserProfile.findUnique({ where: { userId } });
        if (!profile) throw accountErrors.userNotFound();
        if (profile.verificationStatus !== 'REJECTED')
          throw accountErrors.verificationNotRejected();

        const updated = await tx.parkingUserProfile.updateMany({
          where: { userId, verificationStatus: 'REJECTED' },
          data: {
            institutionalId,
            verificationStatus: 'PENDING',
            verificationNote: null,
            verificationSubmittedAt: new Date(),
            reviewedAt: null,
            reviewedById: null,
          },
        });
        if (updated.count === 0) throw accountErrors.verificationNotRejected();

        const stored = await storeDocument(userId, institutionalId, document, tx);
        await auditRepository.record(
          {
            action: AUDIT_ACTIONS.identitySubmitted,
            actorId: userId,
            entityType: AUDIT_ENTITY_TYPES.identityDocument,
            entityId: stored.id,
            metadata: {
              resubmission: true,
              institutionalId,
              mimeType: document.mimeType,
              sizeBytes: document.sizeBytes,
            },
            request: context.request,
          },
          tx,
        );
      });
    } catch (error) {
      mapUniqueViolation(error);
    }
  },
};
