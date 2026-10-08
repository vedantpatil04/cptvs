import type {
  AdminUserUpdate,
  DashboardUsers,
  Page,
  UserCounts,
  UserDetail,
  UserListItem,
  UserListQuery,
  VerificationDecision,
  VisitorListItem,
  VisitorListQuery,
} from '@cpvts/shared';

import { isUniqueViolation } from '../../db/errors.js';
import { prisma } from '../../db/prisma.js';
import { withTransaction } from '../../db/transaction.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { badRequest } from '../../lib/errors.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import { notificationService } from '../notifications/notification.service.js';
import type { OperationContext } from '../parking/operation-context.js';
import { portalRepository } from '../portal/portal.repository.js';
import { toRegisteredVehicle } from '../portal/vehicle.service.js';
import { accountErrors } from './accounts.errors.js';

const LIST_SELECT = {
  id: true,
  username: true,
  fullName: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  parkingProfile: {
    select: {
      category: true,
      institutionalId: true,
      email: true,
      phone: true,
      verificationStatus: true,
    },
  },
  _count: { select: { vehicles: true } },
  vehicles: {
    select: {
      sessions: {
        where: { status: 'ACTIVE' },
        take: 1,
        select: {
          sessionNumber: true,
          slot: { select: { code: true, zone: { select: { block: { select: { name: true } } } } } },
        },
      },
    },
  },
} as const satisfies Prisma.UserSelect;

type ListRow = Prisma.UserGetPayload<{ select: typeof LIST_SELECT }>;

const toListItem = (user: ListRow): UserListItem => {
  const parked = user.vehicles.flatMap((vehicle) => vehicle.sessions)[0];
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    parkingUser: user.parkingProfile
      ? {
          category: user.parkingProfile.category,
          institutionalId: user.parkingProfile.institutionalId,
          email: user.parkingProfile.email,
          phone: user.parkingProfile.phone,
          verificationStatus: user.parkingProfile.verificationStatus,
        }
      : null,
    vehicleCount: user._count.vehicles,
    currentParking: parked
      ? {
          sessionNumber: parked.sessionNumber,
          slotCode: parked.slot.code,
          blockName: parked.slot.zone.block.name,
        }
      : null,
  };
};

const listWhere = (query: {
  kind: 'ALL' | 'STUDENT' | 'STAFF';
  q?: string;
  verification?: 'PENDING' | 'VERIFIED' | 'REJECTED';
  status?: 'ACTIVE' | 'INACTIVE';
}): Prisma.UserWhereInput => {
  const profile: Prisma.ParkingUserProfileWhereInput = {
    ...(query.kind !== 'ALL' ? { category: query.kind } : {}),
    ...(query.verification ? { verificationStatus: query.verification } : {}),
  };
  const text = query.q?.trim();
  return {
    ...(Object.keys(profile).length > 0 ? { parkingProfile: { is: profile } } : {}),
    ...(query.status ? { isActive: query.status === 'ACTIVE' } : {}),
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

/** Students and Campus Staff with a vehicle parked right now. */
const countActiveParkingUsers = async (): Promise<number> => {
  const owners = await prisma.vehicle.findMany({
    where: { ownerUserId: { not: null }, sessions: { some: { status: 'ACTIVE' } } },
    select: { ownerUserId: true },
    distinct: ['ownerUserId'],
  });
  return owners.length;
};

export const userAdminService = {
  async counts(): Promise<UserCounts> {
    const [all, students, staff, pendingVerification, visitorVehicles, activeParkingUsers] =
      await Promise.all([
        prisma.user.count(),
        prisma.parkingUserProfile.count({ where: { category: 'STUDENT' } }),
        prisma.parkingUserProfile.count({ where: { category: 'STAFF' } }),
        prisma.parkingUserProfile.count({ where: { verificationStatus: 'PENDING' } }),
        prisma.parkingSession.groupBy({ by: ['vehicleId'], where: { ownerCategory: 'VISITOR' } }),
        countActiveParkingUsers(),
      ]);
    return {
      all,
      students,
      staff,
      pendingVerification,
      visitorVehicles: visitorVehicles.length,
      activeParkingUsers,
    };
  },

  /** The user-related figures on the administrator's dashboard. */
  async dashboardFigures(): Promise<DashboardUsers> {
    const [pendingStudentVerifications, pendingStaffVerifications, activeParkingUsers] =
      await Promise.all([
        prisma.parkingUserProfile.count({
          where: { category: 'STUDENT', verificationStatus: 'PENDING' },
        }),
        prisma.parkingUserProfile.count({
          where: { category: 'STAFF', verificationStatus: 'PENDING' },
        }),
        countActiveParkingUsers(),
      ]);
    return { pendingStudentVerifications, pendingStaffVerifications, activeParkingUsers };
  },

  async list(query: UserListQuery, page: number, pageSize: number): Promise<Page<UserListItem>> {
    const where = listWhere(query as Parameters<typeof listWhere>[0]);
    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: LIST_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: users.map(toListItem), page, pageSize, total };
  },

  async detail(userId: string): Promise<UserDetail> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...LIST_SELECT,
        parkingProfile: {
          select: {
            ...LIST_SELECT.parkingProfile.select,
            verificationNote: true,
            verificationSubmittedAt: true,
            reviewedAt: true,
            reviewedBy: { select: { fullName: true } },
          },
        },
        identityDocuments: {
          orderBy: { createdAt: 'desc' },
          // The file content is deliberately not selected here.
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            institutionalId: true,
            createdAt: true,
          },
        },
      },
    });
    if (!user) throw accountErrors.userNotFound();

    const profile = user.parkingProfile;
    const vehicles = await portalRepository.listVehicles(userId);
    return {
      ...toListItem(user),
      verification: profile
        ? {
            status: profile.verificationStatus,
            note: profile.verificationNote,
            submittedAt: profile.verificationSubmittedAt.toISOString(),
            reviewedAt: profile.reviewedAt?.toISOString() ?? null,
            reviewedBy: profile.reviewedBy?.fullName ?? null,
          }
        : null,
      documents: user.identityDocuments.map((document) => ({
        id: document.id,
        fileName: document.fileName,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        institutionalId: document.institutionalId,
        uploadedAt: document.createdAt.toISOString(),
      })),
      vehicles: vehicles.map(toRegisteredVehicle),
    };
  },

  /** Name for everyone; e-mail and phone for parking users. Role, category and credentials stay fixed. */
  async update(
    userId: string,
    input: AdminUserUpdate,
    context: OperationContext,
  ): Promise<UserDetail> {
    const changes = input as { fullName?: string; email?: string; phone?: string };
    try {
      await withTransaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, parkingProfile: { select: { userId: true } } },
        });
        if (!user) throw accountErrors.userNotFound();
        if ((changes.email !== undefined || changes.phone !== undefined) && !user.parkingProfile) {
          throw badRequest('Only Student and Campus Staff accounts have contact details.');
        }

        if (changes.fullName !== undefined) {
          await tx.user.update({ where: { id: userId }, data: { fullName: changes.fullName } });
        }
        if (changes.email !== undefined || changes.phone !== undefined) {
          await tx.parkingUserProfile.update({
            where: { userId },
            data: {
              ...(changes.email !== undefined ? { email: changes.email } : {}),
              ...(changes.phone !== undefined ? { phone: changes.phone } : {}),
            },
          });
        }
        await auditRepository.record(
          {
            action: AUDIT_ACTIONS.userUpdated,
            actorId: context.actor.id,
            entityType: AUDIT_ENTITY_TYPES.user,
            entityId: userId,
            metadata: { fields: Object.keys(changes) },
            request: context.request,
          },
          tx,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, 'parking_user_profiles_email_key')) {
        throw accountErrors.emailTaken();
      }
      throw error;
    }
    return this.detail(userId);
  },

  /** Activating or deactivating revokes the user's tokens, so it applies immediately. */
  async setActive(
    userId: string,
    isActive: boolean,
    context: OperationContext,
  ): Promise<UserDetail> {
    if (userId === context.actor.id) throw accountErrors.cannotChangeOwnStatus();
    await withTransaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) throw accountErrors.userNotFound();
      await tx.user.update({
        where: { id: userId },
        data: { isActive, tokenVersion: { increment: 1 } },
      });
      await auditRepository.record(
        {
          action: isActive ? AUDIT_ACTIONS.userActivated : AUDIT_ACTIONS.userDeactivated,
          actorId: context.actor.id,
          entityType: AUDIT_ENTITY_TYPES.user,
          entityId: userId,
          request: context.request,
        },
        tx,
      );
    });
    return this.detail(userId);
  },

  /** Approves or rejects a pending verification. Only the server sets verification status. */
  async decideVerification(
    userId: string,
    input: VerificationDecision,
    context: OperationContext,
  ): Promise<UserDetail> {
    const { decision, note } = input as { decision: 'VERIFY' | 'REJECT'; note?: string };
    await withTransaction(async (tx) => {
      const profile = await tx.parkingUserProfile.findUnique({ where: { userId } });
      if (!profile) throw accountErrors.userNotFound();

      const verified = decision === 'VERIFY';
      const updated = await tx.parkingUserProfile.updateMany({
        where: { userId, verificationStatus: 'PENDING' },
        data: {
          verificationStatus: verified ? 'VERIFIED' : 'REJECTED',
          verificationNote: note ?? null,
          reviewedAt: new Date(),
          reviewedById: context.actor.id,
        },
      });
      if (updated.count === 0) throw accountErrors.verificationNotPending();

      await notificationService.notify(
        tx,
        userId,
        verified ? 'VERIFICATION_APPROVED' : 'VERIFICATION_REJECTED',
        note ? { note } : {},
      );
      await auditRepository.record(
        {
          action: verified ? AUDIT_ACTIONS.userVerified : AUDIT_ACTIONS.userVerificationRejected,
          actorId: context.actor.id,
          entityType: AUDIT_ENTITY_TYPES.user,
          entityId: userId,
          metadata: { category: profile.category, ...(note ? { note } : {}) },
          request: context.request,
        },
        tx,
      );
    });
    return this.detail(userId);
  },

  /** Returns the stored identity document. Every access is audited. */
  async readDocument(userId: string, documentId: string, context: OperationContext) {
    const document = await prisma.identityDocument.findFirst({
      where: { id: documentId, userId },
    });
    if (!document) throw accountErrors.documentNotFound();
    await auditRepository.record({
      action: AUDIT_ACTIONS.identityDocumentViewed,
      actorId: context.actor.id,
      entityType: AUDIT_ENTITY_TYPES.identityDocument,
      entityId: document.id,
      metadata: { userId },
      request: context.request,
    });
    return {
      fileName: document.fileName,
      mimeType: document.mimeType,
      content: Buffer.from(document.content),
    };
  },

  async assertExists(userId: string): Promise<void> {
    if (!(await prisma.user.count({ where: { id: userId } }))) throw accountErrors.userNotFound();
  },

  /** Visitors are not accounts: they are listed from visitor parking sessions. */
  async listVisitors(
    query: VisitorListQuery,
    page: number,
    pageSize: number,
  ): Promise<Page<VisitorListItem>> {
    const { q, status } = query as { q?: string; status?: 'ACTIVE' | 'COMPLETED' };
    const text = q?.trim();
    const where: Prisma.ParkingSessionWhereInput = {
      ownerCategory: 'VISITOR',
      ...(status ? { status } : {}),
      ...(text
        ? {
            OR: [
              {
                vehicle: {
                  vehicleNumber: { contains: text.toUpperCase().replace(/[\s.\-_/]/g, '') },
                },
              },
              { sessionNumber: { contains: text.toUpperCase() } },
            ],
          }
        : {}),
    };
    const [total, sessions] = await Promise.all([
      prisma.parkingSession.count({ where }),
      prisma.parkingSession.findMany({
        where,
        include: {
          vehicle: true,
          slot: { include: { zone: { include: { block: true } } } },
          receipt: { select: { receiptNumber: true } },
        },
        orderBy: [{ entryAt: 'desc' }, { sessionNumber: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: sessions.map((session) => ({
        sessionNumber: session.sessionNumber,
        vehicleNumber: session.vehicle.vehicleNumber,
        vehicleType: session.vehicleType,
        status: session.status,
        blockName: session.slot.zone.block.name,
        slotCode: session.slot.code,
        entryAt: session.entryAt.toISOString(),
        exitAt: session.exitAt?.toISOString() ?? null,
        feePaise: session.feeAmountPaise,
        receiptNumber: session.receipt?.receiptNumber ?? null,
      })),
      page,
      pageSize,
      total,
    };
  },
};
