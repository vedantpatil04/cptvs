import {
  academicProfileSchema,
  batchOf,
  parseBatchLabel,
  programsForBatch,
  PROGRAMS,
  ACADEMIC_PROGRAMS,
  type AcademicFacets,
  type AdminUserUpdate,
  type HistoryItem,
  type Page,
  type UserCounts,
  type UserDetail,
  type UserListItem,
  type VerificationDecision,
  type userListQuerySchema,
} from '@cpvts/shared';
import type { z } from 'zod';

import { isUniqueViolation } from '../../db/errors.js';
import { prisma } from '../../db/prisma.js';
import { withTransaction } from '../../db/transaction.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { badRequest, validationError } from '../../lib/errors.js';
import { academicViewOf, verificationInfoOf } from '../accounts/account-state.js';
import { accountErrors } from '../accounts/accounts.errors.js';
import { emailDomainAllowed } from '../accounts/email-domain.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import { HISTORY_INCLUDE, toHistoryItem } from '../management/history.service.js';
import { notificationService } from '../notifications/notification.service.js';
import type { OperationContext } from '../parking/operation-context.js';
import { toSessionView } from '../parking/parking.mappers.js';
import { SESSION_INCLUDE } from '../parking/parking.repository.js';
import { liveContext } from '../parking/tracking.service.js';
import { cancelOpenOffers } from '../portal/park-now.service.js';
import { ownedSessionWhere } from '../portal/portal-access.js';
import { listVehiclesOf } from '../portal/vehicle.service.js';

type ListQuery = z.output<typeof userListQuerySchema>;

const LIST_INCLUDE = {
  parkingProfile: true,
  _count: { select: { vehicles: true } },
  // The user's vehicle parked right now: sessions carry the account that owned the vehicle
  // when they began, so a vehicle sold on never shows up under its previous owner.
  ownedSessions: {
    where: { status: 'ACTIVE' },
    include: {
      vehicle: { select: { vehicleNumber: true } },
      slot: { include: { zone: { include: { block: true } } } },
    },
    orderBy: { entryAt: 'asc' },
    take: 1,
  },
} as const satisfies Prisma.UserInclude;

type ListedUser = Prisma.UserGetPayload<{ include: typeof LIST_INCLUDE }>;

const toListItem = (user: ListedUser): UserListItem => {
  const active = user.ownedSessions[0];
  const profile = user.parkingProfile;
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    parkingUser: profile
      ? {
          category: profile.category,
          institutionalId: profile.institutionalId,
          email: profile.email,
          phone: profile.phone,
          verificationStatus: profile.verificationStatus,
          academic: academicViewOf(profile),
        }
      : null,
    vehicleCount: user._count.vehicles,
    currentParking: active
      ? {
          sessionNumber: active.sessionNumber,
          vehicleNumber: active.vehicle.vehicleNumber,
          blockName: active.slot.zone.block.name,
          slotCode: active.slot.code,
          entryAt: active.entryAt.toISOString(),
        }
      : null,
  };
};

/** Student filters: a batch such as "2024–2027" means the programs of that duration admitted in 2024. */
const batchFilter = (batch: string): Prisma.ParkingUserProfileWhereInput => {
  const parsed = parseBatchLabel(batch);
  if (!parsed) return { program: { in: [] } };
  return {
    admissionYear: parsed.startYear,
    program: { in: programsForBatch(parsed.startYear, parsed.endYear) },
  };
};

const listWhere = (query: ListQuery): Prisma.UserWhereInput => {
  const profile: Prisma.ParkingUserProfileWhereInput = {
    ...(query.kind === 'STUDENT' ? { category: 'STUDENT' } : {}),
    ...(query.kind === 'STAFF' ? { category: 'STAFF' } : {}),
    ...(query.verification ? { verificationStatus: query.verification } : {}),
    ...(query.program ? { program: query.program } : {}),
    ...(query.department
      ? { department: { equals: query.department.trim(), mode: 'insensitive' } }
      : {}),
    ...(query.semester ? { currentSemester: query.semester } : {}),
    ...(query.batch ? batchFilter(query.batch) : {}),
  };
  const needsProfile = Object.keys(profile).length > 0;
  const text = query.q?.trim();
  return {
    ...(needsProfile ? { parkingProfile: { is: profile } } : {}),
    ...(query.status ? { isActive: query.status === 'ACTIVE' } : {}),
    ...(query.parking === 'PARKED'
      ? { ownedSessions: { some: { status: 'ACTIVE' } } }
      : query.parking === 'NOT_PARKED'
        ? { ownedSessions: { none: { status: 'ACTIVE' } } }
        : {}),
    ...(text
      ? {
          OR: [
            { fullName: { contains: text, mode: 'insensitive' } },
            { username: { contains: text, mode: 'insensitive' } },
            { parkingProfile: { is: { email: { contains: text, mode: 'insensitive' } } } },
            {
              parkingProfile: { is: { institutionalId: { contains: text, mode: 'insensitive' } } },
            },
          ],
        }
      : {}),
  };
};

const record = (
  context: OperationContext,
  action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS],
  entityType: (typeof AUDIT_ENTITY_TYPES)[keyof typeof AUDIT_ENTITY_TYPES],
  entityId: string,
  metadata: Prisma.InputJsonObject,
  tx: Prisma.TransactionClient,
) =>
  auditRepository.record(
    { action, actorId: context.actor.id, entityType, entityId, metadata, request: context.request },
    tx,
  );

const mapUniqueViolation = (error: unknown): never => {
  if (isUniqueViolation(error, 'parking_user_profiles_email_key')) {
    throw accountErrors.emailTaken();
  }
  throw error;
};

/** Merges an administrator's academic correction into a student's current details. */
const mergeAcademic = (
  current: ReturnType<typeof academicViewOf>,
  patch: NonNullable<AdminUserUpdate['academic']>,
) => {
  // A student without academic details yet needs all four at once.
  if (!current) {
    const complete = academicProfileSchema.safeParse(patch);
    if (!complete.success) {
      throw validationError(
        complete.error.issues.map((issue) => ({
          path: ['body', 'academic', ...issue.path].join('.'),
          message: issue.message,
        })),
      );
    }
    return complete.data;
  }
  const merged = academicProfileSchema.safeParse({
    program: patch.program ?? current.program,
    department: patch.department ?? current.department,
    admissionYear: patch.admissionYear ?? current.admissionYear,
    currentSemester: patch.currentSemester ?? current.currentSemester,
  });
  if (!merged.success) {
    throw validationError(
      merged.error.issues.map((issue) => ({
        path: ['body', 'academic', ...issue.path].join('.'),
        message: issue.message,
      })),
    );
  }
  return merged.data;
};

/**
 * Administrator user management. Identity documents are never part of a
 * listing or detail response: they can only be viewed or downloaded one at a time
 * through `readDocument`, which is audited. Credentials are never exposed.
 */
export const adminUserService = {
  async list(query: ListQuery): Promise<Page<UserListItem>> {
    const where = listWhere(query);
    // The verification queue is worked oldest-first.
    const orderBy: Prisma.UserOrderByWithRelationInput[] =
      query.verification === 'PENDING'
        ? [{ parkingProfile: { verificationSubmittedAt: 'asc' } }, { id: 'asc' }]
        : [{ createdAt: 'desc' }, { id: 'asc' }];
    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: users.map(toListItem), page: query.page, pageSize: query.pageSize, total };
  },

  async counts(): Promise<UserCounts> {
    const [all, students, staff, pendingVerification, visitorGroups, activeOwners, activeVisitors] =
      await Promise.all([
        prisma.user.count(),
        prisma.parkingUserProfile.count({ where: { category: 'STUDENT' } }),
        prisma.parkingUserProfile.count({ where: { category: 'STAFF' } }),
        prisma.parkingUserProfile.count({ where: { verificationStatus: 'PENDING' } }),
        prisma.parkingSession.groupBy({ by: ['vehicleId'], where: { ownerCategory: 'VISITOR' } }),
        prisma.parkingSession.groupBy({
          by: ['ownerUserId'],
          where: { status: 'ACTIVE', ownerUserId: { not: null } },
        }),
        prisma.parkingSession.count({ where: { status: 'ACTIVE', ownerCategory: 'VISITOR' } }),
      ]);
    return {
      all,
      students,
      staff,
      pendingVerification,
      visitorVehicles: visitorGroups.length,
      activeParkingUsers: activeOwners.length,
      activeVisitors,
    };
  },

  /** Values for the Admin filter dropdowns: the departments and batches that exist in the data. */
  async facets(): Promise<AcademicFacets> {
    const [departmentRows, batchRows, missing] = await Promise.all([
      prisma.parkingUserProfile.groupBy({
        by: ['department'],
        where: { department: { not: null } },
        _count: { _all: true },
      }),
      prisma.parkingUserProfile.groupBy({
        by: ['program', 'admissionYear'],
        where: { program: { not: null }, admissionYear: { not: null } },
      }),
      prisma.parkingUserProfile.count({ where: { category: 'STUDENT', program: null } }),
    ]);

    // Departments that differ only by letter case are one department; show the spelling most
    // students used (the capitalised one on a tie), so the list does not depend on row order.
    const spellings = new Map<string, { name: string; count: number }>();
    for (const row of departmentRows) {
      if (!row.department) continue;
      const key = row.department.toLowerCase();
      const best = spellings.get(key);
      const count = row._count._all;
      if (!best || count > best.count || (count === best.count && row.department < best.name)) {
        spellings.set(key, { name: row.department, count });
      }
    }
    const departments = new Map([...spellings].map(([key, value]) => [key, value.name]));
    const batches = new Map<string, number>();
    for (const row of batchRows) {
      if (row.program && row.admissionYear !== null) {
        const batch = batchOf(row.program, row.admissionYear);
        batches.set(batch.label, batch.startYear);
      }
    }
    return {
      programs: ACADEMIC_PROGRAMS.map((program) => ({
        program,
        label: PROGRAMS[program].label,
        level: PROGRAMS[program].level,
        semesters: PROGRAMS[program].semesters,
      })),
      departments: [...departments.values()].sort((a, b) => a.localeCompare(b)),
      batches: [...batches.entries()]
        .sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))
        .map(([label]) => label),
      studentsMissingAcademicProfile: missing,
    };
  },

  async detail(userId: string): Promise<UserDetail> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        ...LIST_INCLUDE,
        parkingProfile: { include: { reviewedBy: { select: { fullName: true } } } },
        // `content` is deliberately not selected: documents are fetched one at a time.
        identityDocuments: {
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            institutionalId: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!user) throw accountErrors.userNotFound();

    const [vehicles, active, live] = await Promise.all([
      listVehiclesOf(userId),
      prisma.parkingSession.findMany({
        where: { ...ownedSessionWhere(userId), status: 'ACTIVE' },
        include: SESSION_INCLUDE,
        orderBy: [{ entryAt: 'asc' }, { sessionNumber: 'asc' }],
      }),
      liveContext(),
    ]);

    const profile = user.parkingProfile;
    return {
      ...toListItem(user),
      verification: profile
        ? { ...verificationInfoOf(profile), reviewedBy: profile.reviewedBy?.fullName ?? null }
        : null,
      documents: user.identityDocuments.map((document) => ({
        id: document.id,
        fileName: document.fileName,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        institutionalId: document.institutionalId,
        uploadedAt: document.createdAt.toISOString(),
      })),
      vehicles,
      activeSessions: active.map((session) => toSessionView(session, live)),
    };
  },

  /**
   * Corrects name, e-mail, phone and a student's academic details. Role, category, ID and
   * credentials are not editable here.
   */
  async update(
    userId: string,
    patch: AdminUserUpdate,
    context: OperationContext,
  ): Promise<UserDetail> {
    try {
      await withTransaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          include: { parkingProfile: true },
        });
        if (!user) throw accountErrors.userNotFound();
        const profile = user.parkingProfile;
        if (
          !profile &&
          (patch.email !== undefined || patch.phone !== undefined || patch.academic !== undefined)
        ) {
          throw badRequest(
            'E-mail, phone and academic details apply to Student / Campus Staff accounts only.',
          );
        }
        if (patch.email !== undefined && !emailDomainAllowed(patch.email)) {
          throw accountErrors.emailDomainNotAllowed();
        }
        if (patch.academic !== undefined && profile?.category !== 'STUDENT') {
          throw badRequest('Academic details apply to students only.');
        }

        const changed: string[] = [];
        let academicChange: Prisma.InputJsonObject | undefined;
        if (patch.fullName !== undefined && patch.fullName !== user.fullName) {
          await tx.user.update({ where: { id: userId }, data: { fullName: patch.fullName } });
          changed.push('fullName');
        }
        if (profile) {
          const data: Prisma.ParkingUserProfileUpdateInput = {};
          if (patch.email !== undefined && patch.email !== profile.email) {
            data.email = patch.email;
            changed.push('email');
          }
          if (patch.phone !== undefined && patch.phone !== profile.phone) {
            data.phone = patch.phone;
            changed.push('phone');
          }
          if (patch.academic !== undefined) {
            const before = academicViewOf(profile);
            const after = mergeAcademic(before, patch.academic);
            const fields = (
              ['program', 'department', 'admissionYear', 'currentSemester'] as const
            ).filter((field) => before === null || before[field] !== after[field]);
            if (fields.length > 0) {
              data.program = after.program;
              data.department = after.department;
              data.admissionYear = after.admissionYear;
              data.currentSemester = after.currentSemester;
              changed.push(...fields.map((field) => `academic.${field}`));
              academicChange = {
                from: before
                  ? {
                      program: before.program,
                      department: before.department,
                      admissionYear: before.admissionYear,
                      currentSemester: before.currentSemester,
                    }
                  : null,
                to: { ...after },
              };
            }
          }
          if (Object.keys(data).length > 0) {
            await tx.parkingUserProfile.update({ where: { userId }, data });
          }
        }
        if (changed.length > 0) {
          await record(
            context,
            AUDIT_ACTIONS.userUpdated,
            AUDIT_ENTITY_TYPES.user,
            userId,
            { fields: changed, ...(academicChange ? { academic: academicChange } : {}) },
            tx,
          );
        }
      });
    } catch (error) {
      mapUniqueViolation(error);
    }
    return this.detail(userId);
  },

  /** Activate or deactivate. Deactivation takes effect on the very next request. */
  async setActive(
    userId: string,
    isActive: boolean,
    context: OperationContext,
  ): Promise<UserDetail> {
    if (userId === context.actor.id) throw accountErrors.cannotChangeOwnStatus();
    await withTransaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw accountErrors.userNotFound();
      if (user.isActive === isActive) return;

      await tx.user.update({
        where: { id: userId },
        data: { isActive, ...(isActive ? {} : { tokenVersion: { increment: 1 } }) },
      });
      // A deactivated user must not keep a slot reserved.
      if (!isActive) await cancelOpenOffers(userId, 'CANCELLED', tx);
      await record(
        context,
        isActive ? AUDIT_ACTIONS.userActivated : AUDIT_ACTIONS.userDeactivated,
        AUDIT_ENTITY_TYPES.user,
        userId,
        {},
        tx,
      );
    });
    return this.detail(userId);
  },

  /** Approve or reject a pending verification; the user is notified either way. */
  async decide(
    userId: string,
    decision: VerificationDecision,
    context: OperationContext,
  ): Promise<UserDetail> {
    const approve = decision.decision === 'VERIFY';
    await withTransaction(async (tx) => {
      const profile = await tx.parkingUserProfile.findUnique({ where: { userId } });
      if (!profile) throw accountErrors.userNotFound();

      // PENDING → VERIFIED / REJECTED, exactly once: a conditional update.
      const decided = await tx.parkingUserProfile.updateMany({
        where: { userId, verificationStatus: 'PENDING' },
        data: {
          verificationStatus: approve ? 'VERIFIED' : 'REJECTED',
          verificationNote: approve ? null : (decision.note ?? null),
          reviewedAt: new Date(),
          reviewedById: context.actor.id,
        },
      });
      if (decided.count !== 1) throw accountErrors.verificationNotPending();

      await record(
        context,
        approve ? AUDIT_ACTIONS.userVerified : AUDIT_ACTIONS.userVerificationRejected,
        AUDIT_ENTITY_TYPES.user,
        userId,
        { category: profile.category, ...(approve ? {} : { note: decision.note ?? '' }) },
        tx,
      );
      await notificationService.notify(
        userId,
        approve ? 'VERIFICATION_APPROVED' : 'VERIFICATION_REJECTED',
        approve ? {} : { note: decision.note ?? '' },
        tx,
      );
    });
    return this.detail(userId);
  },

  /**
   * The one place identity documents leave the system: one document at a time,
   * for an administrator, with an audit entry that says whether it was viewed or downloaded.
   */
  async readDocument(
    userId: string,
    documentId: string,
    context: OperationContext,
    { download = false }: { download?: boolean } = {},
  ) {
    const document = await prisma.identityDocument.findFirst({
      where: { id: documentId, userId },
    });
    if (!document) throw accountErrors.documentNotFound();
    await auditRepository.record({
      action: download
        ? AUDIT_ACTIONS.identityDocumentDownloaded
        : AUDIT_ACTIONS.identityDocumentViewed,
      actorId: context.actor.id,
      entityType: AUDIT_ENTITY_TYPES.identityDocument,
      entityId: document.id,
      metadata: { userId, mimeType: document.mimeType },
      request: context.request,
    });
    return {
      fileName: document.fileName,
      mimeType: document.mimeType,
      content: Buffer.from(document.content),
    };
  },

  /** A parking user's sessions (those that began while they owned the vehicle), newest first. */
  async history(userId: string, page: number, pageSize: number): Promise<Page<HistoryItem>> {
    return this.sessionsOf(userId, {}, page, pageSize);
  },

  /** A parking user's finished sessions with their receipts, newest first. */
  async receipts(userId: string, page: number, pageSize: number): Promise<Page<HistoryItem>> {
    return this.sessionsOf(
      userId,
      { status: 'COMPLETED', receipt: { isNot: null } },
      page,
      pageSize,
    );
  },

  async sessionsOf(
    userId: string,
    filters: Prisma.ParkingSessionWhereInput,
    page: number,
    pageSize: number,
  ): Promise<Page<HistoryItem>> {
    const exists = await prisma.user.count({ where: { id: userId } });
    if (!exists) throw accountErrors.userNotFound();
    const where: Prisma.ParkingSessionWhereInput = { AND: [ownedSessionWhere(userId), filters] };
    const [total, sessions] = await Promise.all([
      prisma.parkingSession.count({ where }),
      prisma.parkingSession.findMany({
        where,
        include: HISTORY_INCLUDE,
        orderBy: [{ entryAt: 'desc' }, { sessionNumber: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: sessions.map(toHistoryItem), page, pageSize, total };
  },
};
