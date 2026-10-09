import type {
  AuthUser,
  Page,
  ParkNowConfirmation,
  ParkNowOffer,
  PortalLayoutResponse,
  RegisteredVehicle,
  UserCounts,
  UserDetail,
  UserListItem,
} from '@cpvts/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import { jsonResponse, mockApi, renderAt } from '@/test/utils';

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

const studentUser = (status: 'PENDING' | 'VERIFIED' = 'PENDING'): AuthUser => ({
  id: 'u-student-1',
  username: 'student.aarav',
  fullName: 'Aarav Sharma',
  role: 'PARKING_USER',
  lastLoginAt: null,
  parkingUser: {
    category: 'STUDENT',
    verificationStatus: status,
    parkNow:
      status === 'VERIFIED'
        ? { eligible: true, blockedBy: null }
        : { eligible: false, blockedBy: 'VERIFICATION_PENDING' },
  },
});

const adminUser: AuthUser = {
  id: 'u-admin-1',
  username: 'admin',
  fullName: 'Admin Reviewer',
  role: 'ADMIN',
  lastLoginAt: null,
  parkingUser: null,
};

const registeredVehicles: RegisteredVehicle[] = [
  {
    id: 'veh-1',
    vehicleNumber: 'KA01AB1234',
    vehicleType: 'FOUR_WHEELER',
    label: 'Campus Car',
    isPrimary: true,
    activeSession: null,
    registeredAt: '2026-10-01T00:00:00.000Z',
    identityEditable: false,
  },
];

const mockLayout: PortalLayoutResponse = {
  blocks: [
    {
      code: 'BLOCK-A',
      name: 'Main Block',
      description: null,
      coordinates: null,
      isActive: true,
      zones: [
        {
          code: 'ZONE-A1',
          name: 'North Zone',
          vehicleType: 'FOUR_WHEELER',
          isActive: true,
          counts: { total: 2, available: 2, occupied: 0, blocked: 0, held: 0 },
          slots: [
            { code: 'A-01', status: 'AVAILABLE', blockedReason: null, occupant: null },
            { code: 'A-02', status: 'AVAILABLE', blockedReason: null, occupant: null },
          ],
        },
      ],
    },
  ],
  mySlots: [],
  generatedAt: new Date().toISOString(),
  currentHour: 10,
};

const mockOffer: ParkNowOffer = {
  offerId: 'off-789',
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
  vehicle: {
    id: 'veh-1',
    vehicleNumber: 'KA01AB1234',
    vehicleType: 'FOUR_WHEELER',
    label: 'Campus Car',
  },
  ownerCategory: 'STUDENT',
  block: {
    code: 'BLOCK-A',
    name: 'Main Block',
    coordinates: null,
  },
  allocation: {
    slotCode: 'A-01',
    zoneName: 'North Zone',
    blockName: 'Main Block',
    score: 10,
    factors: { priority: 1, usesToday: 0, layoutPosition: 1 },
    candidatesConsidered: 2,
    fallbacks: 0,
    checks: [],
  },
};

const mockConfirmation: ParkNowConfirmation = {
  session: {
    sessionNumber: 'CPVTS-P-98765432',
    status: 'ACTIVE',
    lifecycle: 'ACTIVE',
    exitRequestedAt: null,
    vehicleNumber: 'KA01AB1234',
    vehicleType: 'FOUR_WHEELER',
    ownerCategory: 'STUDENT',
    block: { code: 'BLOCK-A', name: 'Main Block', coordinates: null },
    zone: { code: 'ZONE-A1', name: 'North Zone' },
    slotCode: 'A-01',
    entryHour: 10,
    entryAt: new Date().toISOString(),
    entryReference: 'A'.repeat(43),
    currentHour: 10,
    currentDurationHours: 0,
    estimatedFee: null,
    exitHour: null,
    exitAt: null,
    durationHours: null,
    fee: null,
    receiptNumber: null,
  },
  allocation: {
    slotCode: 'A-01',
    zoneName: 'North Zone',
    blockName: 'Main Block',
    score: 10,
    factors: { priority: 1, usesToday: 0, layoutPosition: 1 },
    candidatesConsidered: 2,
    fallbacks: 0,
    checks: [],
  },
};

const page = <T,>(items: T[]): Page<T> => ({ items, page: 1, pageSize: 20, total: items.length });

const userCounts: UserCounts = {
  all: 1,
  students: 1,
  staff: 0,
  pendingVerification: 1,
  visitorVehicles: 0,
  activeParkingUsers: 0,
  activeVisitors: 0,
};

const userListItem: UserListItem = {
  id: 'u-student-1',
  username: 'student.aarav',
  fullName: 'Aarav Sharma',
  role: 'PARKING_USER',
  isActive: true,
  lastLoginAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  parkingUser: {
    category: 'STUDENT',
    institutionalId: '2BT22CS001',
    email: 'aarav@campus.edu',
    phone: '+919999999999',
    verificationStatus: 'PENDING',
    academic: null,
  },
  vehicleCount: 1,
  currentParking: null,
};

const userDetailPending: UserDetail = {
  ...userListItem,
  verification: {
    status: 'PENDING',
    note: null,
    submittedAt: '2026-10-02T10:00:00.000Z',
    reviewedAt: null,
    reviewedBy: null,
  },
  documents: [
    {
      id: 'doc-img',
      fileName: 'student_id_card.png',
      mimeType: 'image/png',
      sizeBytes: 45000,
      institutionalId: '2BT22CS001',
      uploadedAt: '2026-10-02T10:00:00.000Z',
    },
    {
      id: 'doc-pdf',
      fileName: 'enrollment_cert.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 120000,
      institutionalId: '2BT22CS001',
      uploadedAt: '2026-10-02T10:05:00.000Z',
    },
  ],
  vehicles: registeredVehicles,
  activeSessions: [],
};

describe('Student Verification & Park Now flow', () => {
  it('shows verification requirement when Student is UNVERIFIED and blocks parking allocation', async () => {
    localStorage.setItem(
      'cpvts.session',
      JSON.stringify({ accessToken: 'tok', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
    );
    mockApi({
      'GET /auth/me': { user: studentUser('PENDING') },
      'GET /portal/vehicles': { vehicles: registeredVehicles },
      'GET /portal/layout': mockLayout,
      'GET /portal/park-now/offer': jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'No offer' } }),
    });

    renderAt('/portal/park-now');

    // Scenario 1: Unverified Student sees verification requirement with neutral wording
    expect(await screen.findByText('Verification Required')).toBeInTheDocument();
    expect(
      screen.getByText('Institutional identity verification is required before you can park.'),
    ).toBeInTheDocument();

    // Verify vehicle selection and allocation are NOT shown while unverified
    expect(screen.queryByText('1. Select Your Vehicle')).not.toBeInTheDocument();
    expect(screen.queryByText('Allocate Best Slot Now')).not.toBeInTheDocument();
  });

  it('allows verified Student to select vehicle, allocate slot, and confirm active parking', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'cpvts.session',
      JSON.stringify({ accessToken: 'tok', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
    );
    mockApi({
      'GET /auth/me': { user: studentUser('VERIFIED') },
      'GET /portal/vehicles': { vehicles: registeredVehicles },
      'GET /portal/layout': mockLayout,
      'GET /portal/park-now/offer': jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'No offer' } }),
      'POST /portal/park-now/offers': mockOffer,
      'POST /portal/park-now/confirm': mockConfirmation,
    });

    renderAt('/portal/park-now');

    // Scenario 4 & 5: Student sees verified state and Park Now becomes available
    expect(await screen.findByText('✓ Institutional identity verified')).toBeInTheDocument();
    expect(await screen.findByText('1. Select Your Vehicle')).toBeInTheDocument();

    // Scenario 6: Verified Student sees registered vehicle
    expect(screen.getByText('KA01AB1234')).toBeInTheDocument();
    expect(screen.getByText('Campus Car')).toBeInTheDocument();

    // Start Allocation
    const allocateBtn = screen.getByRole('button', { name: /Allocate Best Slot Now/i });
    expect(allocateBtn).toBeEnabled();
    await user.click(allocateBtn);

    // Shows allocated slot code and reason
    expect(await screen.findByText('YOUR PARKING SPACE')).toBeInTheDocument();
    expect(screen.getByText('WHY A-01?')).toBeInTheDocument();

    // Confirm parking
    const confirmBtn = screen.getByRole('button', { name: /Confirm & Check In/i });
    await user.click(confirmBtn);

    // Active Parking confirmation
    expect(await screen.findByText('Parking Confirmed')).toBeInTheDocument();
    expect(screen.getAllByText('CPVTS-P-98765432').length).toBeGreaterThanOrEqual(1);
  });

  it('immediately enables Park Now after user verification state transitions from PENDING to VERIFIED', async () => {
    localStorage.setItem(
      'cpvts.session',
      JSON.stringify({ accessToken: 'tok', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
    );

    let currentStatus: 'PENDING' | 'VERIFIED' = 'PENDING';
    mockApi({
      'GET /auth/me': () => ({ user: studentUser(currentStatus) }),
      'GET /portal/vehicles': { vehicles: registeredVehicles },
      'GET /portal/layout': mockLayout,
      'GET /portal/park-now/offer': jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'No offer' } }),
    });

    renderAt('/portal/park-now');

    // Initially unverified
    expect(await screen.findByText('Verification Required')).toBeInTheDocument();

    // Scenario 2, 3, 4: Admin approves student, state updates to VERIFIED
    currentStatus = 'VERIFIED';
    window.dispatchEvent(new Event('focus'));

    // Student now sees verified state and Park Now flow becomes active
    await waitFor(() => {
      expect(screen.getByText('✓ Institutional identity verified')).toBeInTheDocument();
    });
    expect(await screen.findByText('1. Select Your Vehicle')).toBeInTheDocument();
  });
});

describe('Admin User Management & Document Viewer', () => {
  it('displays user verification details and opens image document viewer with zoom controls', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'cpvts.session',
      JSON.stringify({ accessToken: 'admin-tok', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
    );

    mockApi({
      'GET /auth/me': { user: adminUser },
      'GET /admin/users/counts': userCounts,
      'GET /admin/users': page([userListItem]),
      'GET /admin/users/u-student-1': userDetailPending,
      'GET /admin/users/u-student-1/documents/doc-img': new Response('fake-image-bytes', {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Content-Disposition': 'inline; filename="student_id_card.png"',
        },
      }),
    });

    renderAt('/admin/users');

    // User list loads
    expect(await screen.findByText('Aarav Sharma')).toBeInTheDocument();
    expect(screen.getByText('2BT22CS001')).toBeInTheDocument();

    // Click Manage button to view user details sheet
    const detailsBtn = screen.getByRole('button', { name: /Manage/i });
    await user.click(detailsBtn);

    // Admin reviewer clearly sees Student name, USN, status, document info
    expect(await screen.findByText('Student ID / USN')).toBeInTheDocument();
    expect(screen.getByText('student_id_card.png')).toBeInTheDocument();
    expect(screen.getByText('PNG Image')).toBeInTheDocument();

    // Separate VIEW DOCUMENT and DOWNLOAD actions are present
    const viewButtons = screen.getAllByRole('button', { name: /VIEW DOCUMENT/i });
    expect(viewButtons.length).toBeGreaterThanOrEqual(1);
    const downloadButtons = screen.getAllByRole('button', { name: /DOWNLOAD/i });
    expect(downloadButtons.length).toBeGreaterThanOrEqual(1);

    // Scenario 7: Click VIEW DOCUMENT on image document
    await user.click(viewButtons[0]!);

    // Document Viewer modal opens
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'student_id_card.png' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Zoom In/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Zoom Out/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reset Zoom/i })).toBeInTheDocument();
    expect(screen.getByAltText('student_id_card.png')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Download$/i })).toBeInTheDocument();
  });

  it('opens PDF document viewer and allows separate download action', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'cpvts.session',
      JSON.stringify({ accessToken: 'admin-tok', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
    );

    mockApi({
      'GET /auth/me': { user: adminUser },
      'GET /admin/users/counts': userCounts,
      'GET /admin/users': page([userListItem]),
      'GET /admin/users/u-student-1': userDetailPending,
      'GET /admin/users/u-student-1/documents/doc-pdf': new Response('%PDF-1.4 fake pdf', {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline; filename="enrollment_cert.pdf"',
        },
      }),
    });

    renderAt('/admin/users');

    expect(await screen.findByText('Aarav Sharma')).toBeInTheDocument();
    const detailsBtn = screen.getByRole('button', { name: /Manage/i });
    await user.click(detailsBtn);

    // Check PDF document item
    expect(await screen.findByText('enrollment_cert.pdf')).toBeInTheDocument();
    expect(screen.getByText('PDF Document')).toBeInTheDocument();

    // Scenario 8: View PDF document
    const viewButtons = screen.getAllByRole('button', { name: /VIEW DOCUMENT/i });
    // Click the second view button (corresponding to the PDF document)
    await user.click(viewButtons[1]!);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'enrollment_cert.pdf' })).toBeInTheDocument();
    expect(screen.getByTitle('enrollment_cert.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open in New Tab/i })).toBeInTheDocument();

    // Scenario 9: Separate Download action
    const modalDownloadBtn = screen.getByRole('button', { name: /^Download$/i });
    expect(modalDownloadBtn).toBeInTheDocument();
  });

  it('shows verified status badge and does not require redundant verification when already verified', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'cpvts.session',
      JSON.stringify({ accessToken: 'admin-tok', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
    );

    const verifiedUserDetail: UserDetail = {
      ...userDetailPending,
      parkingUser: {
        ...userDetailPending.parkingUser!,
        verificationStatus: 'VERIFIED',
      },
      verification: {
        status: 'VERIFIED',
        note: null,
        submittedAt: '2026-10-02T10:00:00.000Z',
        reviewedAt: '2026-10-03T10:00:00.000Z',
        reviewedBy: 'Admin Reviewer',
      },
    };

    mockApi({
      'GET /auth/me': { user: adminUser },
      'GET /admin/users/counts': userCounts,
      'GET /admin/users': page([{ ...userListItem, parkingUser: { ...userListItem.parkingUser!, verificationStatus: 'VERIFIED' } }]),
      'GET /admin/users/u-student-1': verifiedUserDetail,
    });

    renderAt('/admin/users');

    expect(await screen.findByText('Aarav Sharma')).toBeInTheDocument();
    const detailsBtn = screen.getByRole('button', { name: /Manage/i });
    await user.click(detailsBtn);

    // Already verified state in review area
    expect((await screen.findAllByText('✓ VERIFIED')).length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText(/✓ Institutional identity verified and active. No further verification action required./i),
    ).toBeInTheDocument();

    // Should NOT show Approve or Reject buttons
    expect(screen.queryByRole('button', { name: /^Approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Reject$/i })).not.toBeInTheDocument();
  });
});
