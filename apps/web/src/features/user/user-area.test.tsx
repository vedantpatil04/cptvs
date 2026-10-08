import type {
  HistoryItem,
  LoginResponse,
  Page,
  ParkingSessionView,
  ParkingUserProfileView,
  PortalLayoutResponse,
  PortalOverview,
  ReceiptView,
  UserCounts,
  UserDetail,
  UserListItem,
  VisitorAccessResponse,
} from '@cpvts/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import { jsonResponse, mockApi, renderAt, signInAs } from '@/test/utils';

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

const block = { code: 'BLOCK-2W', name: 'Two-Wheeler Parking Block', coordinates: null };

const activeSession: ParkingSessionView = {
  sessionNumber: 'CPVTS-P-7K4M92QX',
  status: 'ACTIVE',
  vehicleNumber: 'KA22AB1234',
  vehicleType: 'TWO_WHEELER',
  ownerCategory: 'STUDENT',
  block: { ...block, coordinates: { latitude: 15.85, longitude: 74.5 } },
  zone: { code: 'ZONE-2W', name: 'Two-Wheeler Zone' },
  slotCode: 'T-04',
  entryHour: 9,
  entryAt: '2026-10-08T03:30:00.000Z',
  entryReference: null,
  currentHour: 12,
  currentDurationHours: 3,
  estimatedFee: {
    ownerCategory: 'STUDENT',
    vehicleType: 'TWO_WHEELER',
    durationHours: 3,
    rule: { type: 'FREE_HOURS_THEN_HOURLY', freeHours: 2, hourlyRatePaise: 1000 },
    lines: [
      { kind: 'FREE', hours: 2 },
      { kind: 'CHARGED', hours: 1, ratePaise: 1000, amountPaise: 1000 },
    ],
    totalPaise: 1000,
  },
  exitHour: null,
  exitAt: null,
  durationHours: null,
  fee: null,
  receiptNumber: null,
};

const recent: HistoryItem = {
  sessionNumber: 'CPVTS-P-OLD00001',
  status: 'COMPLETED',
  vehicleNumber: 'KA22AB1234',
  vehicleType: 'TWO_WHEELER',
  ownerCategory: 'STUDENT',
  blockName: 'Two-Wheeler Parking Block',
  slotCode: 'T-02',
  entryHour: 8,
  exitHour: 12,
  durationHours: 4,
  feePaise: 2000,
  receiptNumber: 'CPVTS-R-2026-8F3K2Q9M',
  transactionId: 'TXN-8F3K2Q9MZA',
  paymentStatus: 'PAID',
  entryAt: '2026-10-07T02:30:00.000Z',
  exitAt: '2026-10-07T06:30:00.000Z',
};

const overview = (sessions: ParkingSessionView[]): PortalOverview => ({
  generatedAt: '2026-10-08T06:30:00.000Z',
  availability: [
    { vehicleType: 'TWO_WHEELER', totalSlots: 10, availableSlots: 7 },
    { vehicleType: 'FOUR_WHEELER', totalSlots: 5, availableSlots: 0 },
  ],
  activeSessions: sessions,
  recentActivity: [recent],
  vehicleCount: 1,
  vehicles: [],
  pendingCheckouts: [],
  lastCompleted: null,
});

const layout: PortalLayoutResponse = {
  generatedAt: '2026-10-08T06:30:00.000Z',
  currentHour: 12,
  mySlots: ['T-04'],
  blocks: [
    {
      ...block,
      description: null,
      zones: [
        {
          code: 'ZONE-2W',
          name: 'Two-Wheeler Zone',
          vehicleType: 'TWO_WHEELER',
          counts: { total: 3, available: 1, occupied: 2, blocked: 0, held: 0 },
          slots: [
            { code: 'T-03', status: 'OCCUPIED', blockedReason: null, occupant: null },
            {
              code: 'T-04',
              status: 'OCCUPIED',
              blockedReason: null,
              occupant: {
                sessionNumber: 'CPVTS-P-7K4M92QX',
                vehicleNumber: 'KA22AB1234',
                vehicleType: 'TWO_WHEELER',
                ownerCategory: 'STUDENT',
                entryHour: 9,
                currentDurationHours: 3,
              },
            },
            { code: 'T-05', status: 'AVAILABLE', blockedReason: null, occupant: null },
          ],
        },
      ],
    },
  ],
};

const profile = (
  status: ParkingUserProfileView['verification']['status'],
): ParkingUserProfileView => ({
  id: 'u1',
  fullName: 'Asha Patil',
  email: 'asha@college.edu.in',
  phone: '9876543210',
  category: 'STUDENT',
  institutionalId: '2BT22CS001',
  verification: {
    status,
    note: status === 'REJECTED' ? 'ID photo is blurred' : null,
    submittedAt: '2026-10-07T04:00:00.000Z',
    reviewedAt: null,
  },
  preferredLocale: null,
  vehicleCount: 1,
  memberSince: '2026-10-01T00:00:00.000Z',
  pricing: null,
});

const verifiedStudent = () =>
  signInAs('PARKING_USER', { category: 'STUDENT', verificationStatus: 'VERIFIED' });

const urlsFor = (fetchMock: ReturnType<typeof mockApi>, path: string) =>
  fetchMock.mock.calls
    .filter(([input]) => new URL(String(input)).pathname === `/api/v1${path}`)
    .map(([input, init]) => ({
      url: new URL(String(input)),
      init: init as RequestInit | undefined,
    }));

describe('Student / Campus Staff area', () => {
  it('shows verification status instead of parking pages until the account is verified', async () => {
    const fetchMock = mockApi({
      ...signInAs('PARKING_USER', { category: 'STUDENT', verificationStatus: 'PENDING' }),
      'GET /portal/profile': profile('PENDING'),
    });
    renderAt('/user');

    expect(
      await screen.findByRole('heading', { name: 'Identity verification' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Pending review')).toBeInTheDocument();
    expect(screen.getByText(/administrator is reviewing/i)).toBeInTheDocument();
    expect(urlsFor(fetchMock, '/portal/overview')).toHaveLength(0);
  });

  it('lets a rejected user see the reason and resubmit', async () => {
    mockApi({
      ...signInAs('PARKING_USER', { category: 'STUDENT', verificationStatus: 'REJECTED' }),
      'GET /portal/profile': profile('REJECTED'),
    });
    renderAt('/user');
    expect(await screen.findByText(/ID photo is blurred/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeInTheDocument();
  });

  it('opens on the current parking with locate, fee, availability and recent activity', async () => {
    mockApi({
      ...verifiedStudent(),
      'GET /portal/overview': overview([activeSession]),
      'GET /portal/profile': profile('VERIFIED'),
    });
    renderAt('/user');

    expect(await screen.findByRole('heading', { name: 'Demo' })).toBeInTheDocument();
    const current = await screen.findByRole('region', { name: 'Current parking' });
    expect(within(current).getByText('T-04')).toBeInTheDocument();
    expect(within(current).getByText('Two-Wheeler Parking Block')).toBeInTheDocument();
    // The fee shown is the backend's estimate (₹10), never recalculated here.
    expect(within(current).getByText('₹10')).toBeInTheDocument();
    expect(within(current).getByRole('link', { name: /Locate my vehicle/ })).toHaveAttribute(
      'href',
      '/user/locate?session=CPVTS-P-7K4M92QX',
    );
    expect(screen.getByText('Live parking availability')).toBeInTheDocument();
    expect(screen.getByText('Recent parking activity')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /KA22AB1234/ })).toHaveAttribute(
      'href',
      '/user/sessions/CPVTS-P-OLD00001',
    );
  });

  it('shows an empty state with availability when nothing is parked', async () => {
    mockApi({ ...verifiedStudent(), 'GET /portal/overview': overview([]) });
    renderAt('/user/my-parking');
    expect(await screen.findByText('Your vehicle is not parked right now')).toBeInTheDocument();
    expect(screen.getByText('Live parking availability')).toBeInTheDocument();
  });

  it('uses a bottom tab bar on phones with Home, Parking, History, Receipts and More', async () => {
    mockApi({ ...verifiedStudent(), 'GET /portal/overview': overview([]) });
    renderAt('/user');
    await screen.findByText('Your vehicle is not parked right now');
    const bars = screen.getAllByRole('navigation', { name: 'Main navigation' });
    const bottom = bars[bars.length - 1]!;
    expect(
      within(bottom)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Home', 'Parking', 'History', 'Receipts', 'More']);
    // The desktop bar lists the full set and no operational sidebar items.
    const top = bars[0]!;
    for (const label of [
      'Home',
      'My Parking',
      'My Vehicles',
      'Parking',
      'History',
      'Receipts',
      'Profile',
    ]) {
      expect(within(top).getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByText('Slot management')).not.toBeInTheDocument();
  });

  it('locates the vehicle: found panel, highlighted slot and a Google Maps link', async () => {
    mockApi({
      ...verifiedStudent(),
      'GET /portal/sessions/current': [activeSession],
      'GET /portal/layout': layout,
    });
    renderAt('/user/locate');

    expect(await screen.findByText('Vehicle found')).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'T-04, Occupied, Your vehicle' }),
    ).toHaveAttribute('aria-current', 'location');
    // Another user's slot is just "Occupied": no vehicle number anywhere else.
    expect(screen.getByRole('button', { name: 'T-03, Occupied' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open parking block in Google Maps/ })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=15.85%2C74.5',
    );
  });

  it('keeps Students and Staff out of operational pages and Admins out of the user area', async () => {
    mockApi({ ...verifiedStudent() });
    const router = renderAt('/admin');
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin');
  });

  it('denies an administrator the parking-user area', async () => {
    mockApi({ ...signInAs('ADMIN') });
    renderAt('/user');
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
  });

  it('shows the user area in Kannada', async () => {
    await i18n.changeLanguage('kn');
    mockApi({ ...verifiedStudent(), 'GET /portal/overview': overview([activeSession]) });
    renderAt('/user');
    expect(await screen.findByText('ನನ್ನ ಪ್ರಸ್ತುತ ಪಾರ್ಕಿಂಗ್')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ನನ್ನ ವಾಹನ ಹುಡುಕಿ/ })).toBeInTheDocument();
  });

  it('lists receipts with view, print and download actions', async () => {
    const receipt: ReceiptView = {
      receiptNumber: 'CPVTS-R-2026-8F3K2Q9M',
      verificationReference: 'a'.repeat(43),
      issuedAt: '2026-10-07T06:30:00.000Z',
      sessionNumber: 'CPVTS-P-OLD00001',
      vehicleNumber: 'KA22AB1234',
      vehicleType: 'TWO_WHEELER',
      ownerCategory: 'STUDENT',
      block,
      slotCode: 'T-02',
      entryHour: 8,
      exitHour: 12,
      durationHours: 4,
      fee: {
        ownerCategory: 'STUDENT',
        vehicleType: 'TWO_WHEELER',
        durationHours: 4,
        rule: { type: 'FREE_HOURS_THEN_HOURLY', freeHours: 2, hourlyRatePaise: 1000 },
        lines: [
          { kind: 'FREE', hours: 2 },
          { kind: 'CHARGED', hours: 2, ratePaise: 1000, amountPaise: 2000 },
        ],
        totalPaise: 2000,
      },
      totalPaise: 2000,
      payment: {
        status: 'PAID',
        method: 'UPI',
        transactionId: 'TXN-8F3K2Q9MZA',
        isSimulated: true,
        paidAt: '2026-10-07T06:30:00.000Z',
      },
    };
    mockApi({
      ...verifiedStudent(),
      'GET /portal/receipts': {
        items: [receipt],
        page: 1,
        pageSize: 8,
        total: 1,
      } satisfies Page<ReceiptView>,
    });
    renderAt('/user/receipts');
    expect(await screen.findByText('CPVTS-R-2026-8F3K2Q9M')).toBeInTheDocument();
    expect(screen.getByText('TXN-8F3K2Q9MZA')).toBeInTheDocument();
    expect(screen.getByText('₹20')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute(
      'href',
      '/user/receipts/CPVTS-R-2026-8F3K2Q9M',
    );
    expect(screen.getByRole('link', { name: 'Print' })).toHaveAttribute(
      'href',
      '/user/receipts/CPVTS-R-2026-8F3K2Q9M?print=1',
    );
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });
});

describe('registration', () => {
  it('validates step one, then submits the document with the category taken from the route', async () => {
    const response: LoginResponse = {
      accessToken: 'token',
      tokenType: 'Bearer',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      user: {
        id: 'u1',
        username: 'student:2bt22cs001',
        fullName: 'Asha Patil',
        role: 'PARKING_USER',
        lastLoginAt: null,
        parkingUser: { category: 'STUDENT', verificationStatus: 'PENDING' },
      },
    };
    const sent = vi.fn((_body: unknown) => response);
    mockApi({
      'POST /auth/register/student': sent,
      'GET /portal/profile': profile('PENDING'),
      'GET /auth/me': { user: response.user },
    });
    const router = renderAt('/register/student');

    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect((await screen.findAllByText('This field is required.')).length).toBeGreaterThan(1);

    await userEvent.type(screen.getByLabelText('Full name'), 'Asha Patil');
    await userEvent.type(screen.getByLabelText('Student ID (USN)'), '2bt22cs001');
    await userEvent.type(screen.getByLabelText('E-mail address'), 'asha@college.edu.in');
    await userEvent.type(screen.getByLabelText('Phone number'), '98765 43210');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'different-password');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('The passwords do not match.')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Confirm password'));
    await userEvent.type(screen.getByLabelText('Confirm password'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // Step two: a wrong file type is refused on the device, before any upload.
    const upload = await screen.findByLabelText('ID document');
    await userEvent.upload(upload, new File(['hello'], 'notes.txt', { type: 'text/plain' }), {
      applyAccept: false,
    });
    expect(await screen.findByText('Use a JPEG, PNG or PDF file.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Confirm Student ID (USN)'), '2BT22CS001');
    await userEvent.upload(
      upload,
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'id.png', { type: 'image/png' }),
    );
    expect(await screen.findByText('id.png')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
    const body = sent.mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toMatchObject({
      fullName: 'Asha Patil',
      institutionalId: '2BT22CS001',
      confirmInstitutionalId: '2BT22CS001',
      email: 'asha@college.edu.in',
      phone: '9876543210',
      document: { fileName: 'id.png', mimeType: 'image/png' },
    });
    expect(body).not.toHaveProperty('category');
    expect(body).not.toHaveProperty('confirmPassword');
    // The new account lands on its pending-verification screen.
    await screen.findByRole('heading', { name: 'Identity verification' });
    expect(router.state.location.pathname).toBe('/user');
  });
});

describe('visitor access', () => {
  const access: VisitorAccessResponse = {
    accessToken: 'visitor-token',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    session: { ...activeSession, ownerCategory: 'VISITOR', estimatedFee: null },
  };

  it('opens one session with the slip details and uses its own token only for visitor routes', async () => {
    const fetchMock = mockApi({
      'POST /visitor/access': access,
      'GET /visitor/session': { ...access.session, estimatedFee: activeSession.estimatedFee },
      'GET /visitor/layout': layout,
    });
    const router = renderAt('/visitor');

    await userEvent.type(await screen.findByLabelText('Vehicle number'), 'ka 22 ab 1234');
    await userEvent.type(screen.getByLabelText('Session number'), 'cpvts-p-7k4m92qx');
    await userEvent.click(screen.getByRole('button', { name: 'View my parking' }));

    expect(await screen.findByText('Vehicle found')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/visitor/parking');
    expect(
      await screen.findByRole('button', { name: 'T-04, Occupied, Your vehicle' }),
    ).toBeInTheDocument();

    const [call] = urlsFor(fetchMock, '/visitor/session');
    expect(new Headers(call!.init!.headers).get('Authorization')).toBe('Bearer visitor-token');
    // The visitor session is not an account session: nothing asked /auth/me.
    expect(urlsFor(fetchMock, '/auth/me')).toHaveLength(0);
    expect(localStorage.getItem('cpvts.session')).toBeNull();
  });

  it('shows the generic message for a wrong slip', async () => {
    mockApi({
      'POST /visitor/access': jsonResponse(404, {
        error: { code: 'VISITOR_ACCESS_DENIED', message: 'x' },
      }),
    });
    renderAt('/visitor');
    await userEvent.type(await screen.findByLabelText('Vehicle number'), 'KA22AB1234');
    await userEvent.type(screen.getByLabelText('Session number'), 'CPVTS-P-00000000');
    await userEvent.click(screen.getByRole('button', { name: 'View my parking' }));
    expect(
      await screen.findByText('No visitor parking matches this vehicle number and session number.'),
    ).toBeInTheDocument();
  });

  it('asks for a receipt only after the visit is paid', async () => {
    sessionStorage.setItem(
      'cpvts.visitor',
      JSON.stringify({ accessToken: 'visitor-token', expiresAt: access.expiresAt }),
    );
    mockApi({
      'GET /visitor/receipt': jsonResponse(404, {
        error: { code: 'RECEIPT_NOT_FOUND', message: 'x' },
      }),
    });
    renderAt('/visitor/receipt');
    expect(await screen.findByText('No receipt yet')).toBeInTheDocument();
  });
});

describe('Admin user management', () => {
  const counts: UserCounts = {
    all: 4,
    students: 2,
    staff: 1,
    pendingVerification: 1,
    visitorVehicles: 3,
    activeParkingUsers: 1,
  };
  const pendingUser: UserListItem = {
    id: '11111111-1111-4111-8111-111111111111',
    username: 'student:2bt22cs001',
    fullName: 'Asha Patil',
    role: 'PARKING_USER',
    isActive: true,
    lastLoginAt: null,
    createdAt: '2026-10-07T04:00:00.000Z',
    parkingUser: {
      category: 'STUDENT',
      institutionalId: '2BT22CS001',
      email: 'asha@college.edu.in',
      phone: '9876543210',
      verificationStatus: 'PENDING',
    },
    vehicleCount: 0,
    currentParking: null,
  };
  const detail: UserDetail = {
    ...pendingUser,
    verification: {
      status: 'PENDING',
      note: null,
      submittedAt: '2026-10-07T04:00:00.000Z',
      reviewedAt: null,
      reviewedBy: null,
    },
    documents: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        fileName: 'college-id.png',
        mimeType: 'image/png',
        sizeBytes: 2048,
        institutionalId: '2BT22CS001',
        uploadedAt: '2026-10-07T04:00:00.000Z',
      },
    ],
    vehicles: [],
  };

  it('shows counts, the student list and a Review link for pending verifications', async () => {
    const fetchMock = mockApi({
      ...signInAs('ADMIN'),
      'GET /admin/users/counts': counts,
      'GET /admin/users': { items: [pendingUser], page: 1, pageSize: 20, total: 1 },
    });
    renderAt('/admin/users?tab=STUDENT');

    expect(await screen.findByRole('heading', { name: 'User management' })).toBeInTheDocument();
    for (const label of [
      'Total students',
      'Total staff',
      'Total visitors',
      'Pending verifications',
      'Active parking users',
    ]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
    expect(await screen.findByText('2BT22CS001')).toBeInTheDocument();
    expect(screen.getAllByText('Pending review').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Review/ })).toHaveAttribute(
      'href',
      `/admin/users/${pendingUser.id}`,
    );
    const [request] = urlsFor(fetchMock, '/admin/users');
    expect(request!.url.searchParams.get('kind')).toBe('STUDENT');
  });

  it('approves a verification and rejects with a mandatory reason', async () => {
    const decisions: unknown[] = [];
    mockApi({
      ...signInAs('ADMIN'),
      [`GET /admin/users/${pendingUser.id}`]: detail,
      [`POST /admin/users/${pendingUser.id}/verification`]: (body: unknown) => {
        decisions.push(body);
        return { ...detail, verification: { ...detail.verification!, status: 'VERIFIED' } };
      },
      [`GET /admin/users/${pendingUser.id}/history`]: { items: [], page: 1, pageSize: 5, total: 0 },
      [`GET /admin/users/${pendingUser.id}/receipts`]: {
        items: [],
        page: 1,
        pageSize: 5,
        total: 0,
      },
    });
    renderAt(`/admin/users/${pendingUser.id}`);

    expect(await screen.findByRole('heading', { name: 'Asha Patil' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(await within(dialog).findByText('Write the reason for rejecting.')).toBeInTheDocument();
    expect(decisions).toHaveLength(0);
    await userEvent.type(within(dialog).getByLabelText('Reason for rejection'), 'Blurred');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(decisions).toEqual([{ decision: 'REJECT', note: 'Blurred' }]));
  });

  it('fetches the identity document with the administrator token, never from a public URL', async () => {
    const createObjectURL = vi.fn(() => 'blob:document');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const fetchMock = mockApi({
      ...signInAs('ADMIN'),
      [`GET /admin/users/${pendingUser.id}`]: detail,
      [`GET /admin/users/${pendingUser.id}/documents/${detail.documents[0]!.id}`]: new Response(
        'x',
        { status: 200, headers: { 'Content-Type': 'image/png' } },
      ),
      [`GET /admin/users/${pendingUser.id}/history`]: { items: [], page: 1, pageSize: 5, total: 0 },
      [`GET /admin/users/${pendingUser.id}/receipts`]: {
        items: [],
        page: 1,
        pageSize: 5,
        total: 0,
      },
    });
    renderAt(`/admin/users/${pendingUser.id}`);

    await userEvent.click(await screen.findByRole('button', { name: 'View document' }));
    expect(await screen.findByRole('img', { name: 'Identity document' })).toHaveAttribute(
      'src',
      'blob:document',
    );
    const [call] = urlsFor(
      fetchMock,
      `/admin/users/${pendingUser.id}/documents/${detail.documents[0]!.id}`,
    );
    expect(new Headers(call!.init!.headers).get('Authorization')).toBe('Bearer token');
  });

  it('keeps Security Staff out of user management', async () => {
    mockApi({ ...signInAs('SECURITY_STAFF') });
    renderAt('/admin/users');
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
  });

  it('lists visitors from their parking sessions', async () => {
    mockApi({
      ...signInAs('ADMIN'),
      'GET /admin/users/counts': counts,
      'GET /admin/visitors': {
        items: [
          {
            sessionNumber: 'CPVTS-P-7K4M92QX',
            vehicleNumber: 'KA22AB1234',
            vehicleType: 'TWO_WHEELER',
            status: 'ACTIVE',
            blockName: 'Two-Wheeler Parking Block',
            slotCode: 'T-04',
            entryAt: '2026-10-08T03:30:00.000Z',
            exitAt: null,
            feePaise: null,
            receiptNumber: null,
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
      },
    });
    renderAt('/admin/users?tab=VISITORS');
    expect(await screen.findByText('KA22AB1234')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CPVTS-P-7K4M92QX' })).toHaveAttribute(
      'href',
      '/admin/sessions/CPVTS-P-7K4M92QX',
    );
  });
});
