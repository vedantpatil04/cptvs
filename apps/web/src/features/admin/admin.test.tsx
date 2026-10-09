import type {
  AlertsResponse,
  AnalyticsResponse,
  AuditLogEntry,
  HistoryItem,
  IntegrityReport,
  ManagedLayout,
  Page,
  ParkingSessionView,
  SessionTimelineResponse,
} from '@cpvts/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import { jsonResponse, mockApi, renderAt, signInAs } from '@/test/utils';

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

/** URLs requested for a path (query strings included). */
const requestedUrls = (fetchMock: ReturnType<typeof mockApi>, path: string) =>
  fetchMock.mock.calls
    .map(([input]) => new URL(String(input)))
    .filter((url) => url.pathname === `/api/v1${path}`);

const page = <T,>(items: T[]): Page<T> => ({ items, page: 1, pageSize: 25, total: items.length });

const historyItem: HistoryItem = {
  sessionNumber: 'CPVTS-P-7K4M92QX',
  status: 'COMPLETED',
  vehicleNumber: 'KA22AB1234',
  vehicleType: 'TWO_WHEELER',
  ownerCategory: 'STUDENT',
  blockName: 'Two-Wheeler Parking Block',
  slotCode: 'T-04',
  entryHour: 9,
  exitHour: 13,
  durationHours: 4,
  feePaise: 2000,
  receiptNumber: 'CPVTS-R-2026-8F3K2Q9M',
  transactionId: 'TXN-8F3K2Q9MZA',
  paymentStatus: 'PAID',
  entryAt: '2026-10-08T03:30:00.000Z',
  exitAt: '2026-10-08T07:30:00.000Z',
};

describe('admin navigation', () => {
  it('lists the management pages for administrators only', async () => {
    mockApi({ ...signInAs('ADMIN'), 'GET /admin/history': page([]) });
    renderAt('/admin/history');
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    for (const label of [
      'Slot management',
      'History',
      'Analytics',
      'Reports',
      'Integrity',
      'Audit logs',
    ]) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('denies security staff the management pages', async () => {
    mockApi(signInAs('SECURITY_STAFF'));
    renderAt('/admin/audit-logs');
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
  });
});

describe('parking history', () => {
  it('shows sessions with their authoritative fee and applies filters through the URL', async () => {
    const fetchMock = mockApi({ ...signInAs('ADMIN'), 'GET /admin/history': page([historyItem]) });
    const router = renderAt('/admin/history');

    const row = (await screen.findByText('KA22AB1234')).closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('₹20')).toBeInTheDocument();
    expect(within(row!).getByRole('link', { name: 'CPVTS-R-2026-8F3K2Q9M' })).toHaveAttribute(
      'href',
      '/admin/receipts/CPVTS-R-2026-8F3K2Q9M',
    );
    expect(screen.getByText('Showing 1–1 of 1')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Vehicle number'), 'ka22');
    await userEvent.selectOptions(screen.getByLabelText('Owner category'), 'STUDENT');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() =>
      expect(router.state.location.search).toBe('?vehicleNumber=ka22&ownerCategory=STUDENT'),
    );
    await waitFor(() => {
      const last = requestedUrls(fetchMock, '/admin/history').at(-1)!;
      expect(last.searchParams.get('vehicleNumber')).toBe('ka22');
      expect(last.searchParams.get('ownerCategory')).toBe('STUDENT');
      expect(last.searchParams.get('page')).toBe('1');
    });
  });

  it('rejects a reversed date range before asking the server', async () => {
    const fetchMock = mockApi({ ...signInAs('ADMIN'), 'GET /admin/history': page([]) });
    renderAt('/admin/history');
    expect(await screen.findByText('No parking sessions match these filters.')).toBeVisible();

    await userEvent.type(screen.getByLabelText('From date'), '2026-10-08');
    await userEvent.type(screen.getByLabelText('To date'), '2026-10-01');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    expect(
      await screen.findByText('The end date must be on or after the start date.'),
    ).toBeInTheDocument();
    expect(requestedUrls(fetchMock, '/admin/history')).toHaveLength(1);
  });
});

describe('slot management', () => {
  const slotDefaults = {
    blockedReason: null,
    isEnabled: true,
    archivedAt: null,
    sortOrder: 0,
    holdExpiresAt: null,
    hasHistory: false,
    occupant: null,
  } as const;
  const layout: ManagedLayout = {
    blocks: [
      {
        code: 'BLOCK-2W',
        name: 'Two-Wheeler Parking Block',
        description: 'Near the main gate',
        coordinates: null,
        isActive: true,
        sortOrder: 0,
        zones: [
          {
            code: 'ZONE-2W',
            name: 'Two-Wheeler Zone',
            vehicleType: 'TWO_WHEELER',
            isActive: true,
            sortOrder: 0,
            counts: { total: 3, available: 1, occupied: 1, blocked: 1, held: 0 },
            disabledSlots: 0,
            slots: [
              { ...slotDefaults, code: 'T-01', status: 'AVAILABLE', priority: 0 },
              { ...slotDefaults, code: 'T-02', status: 'OCCUPIED', priority: 0 },
              {
                ...slotDefaults,
                code: 'T-03',
                status: 'BLOCKED',
                priority: 5,
                blockedReason: 'Repair',
              },
            ],
          },
        ],
      },
    ],
  };

  it('blocks an available slot only with a reason and confirms the change', async () => {
    const block = vi.fn((_body: unknown) => ({
      code: 'T-01',
      status: 'BLOCKED',
      priority: 0,
      blockedReason: 'Surface repair',
    }));
    const fetchMock = mockApi({
      ...signInAs('ADMIN'),
      'GET /admin/layout': layout,
      'POST /admin/slots/T-01/block': block,
    });
    renderAt('/admin/slots');

    const occupiedRow = await screen.findByRole('row', { name: /T-02/ });
    expect(within(occupiedRow).getByRole('button', { name: 'Block' })).toBeDisabled();
    expect(
      within(screen.getByRole('row', { name: /T-03/ })).getByRole('button', { name: 'Unblock' }),
    ).toBeEnabled();

    await userEvent.click(
      within(screen.getByRole('row', { name: /T-01/ })).getByRole('button', { name: 'Block' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Block slot T-01' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Block slot' }));
    expect(await within(dialog).findByText('This field is required.')).toBeInTheDocument();
    expect(block).not.toHaveBeenCalled();

    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Surface repair');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Block slot' }));

    expect(await screen.findByText('Slot T-01 is now blocked.')).toBeInTheDocument();
    expect(block).toHaveBeenCalledWith({ reason: 'Surface repair' });
    await waitFor(() => expect(requestedUrls(fetchMock, '/admin/layout')).toHaveLength(2));
  });

  it('shows the translated server rejection', async () => {
    mockApi({
      ...signInAs('ADMIN'),
      'GET /admin/layout': layout,
      'POST /admin/slots/T-03/unblock': jsonResponse(409, {
        error: { code: 'SLOT_NOT_BLOCKED', message: 'not blocked', requestId: 'r1' },
      }),
    });
    renderAt('/admin/slots');
    await userEvent.click(
      within(await screen.findByRole('row', { name: /T-03/ })).getByRole('button', {
        name: 'Unblock',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Unblock slot' }));
    expect(await within(dialog).findByText(i18n.t('errors.SLOT_NOT_BLOCKED'))).toBeInTheDocument();
  });

  it('requires both coordinates for a block location', async () => {
    const save = vi.fn();
    mockApi({
      ...signInAs('ADMIN'),
      'GET /admin/layout': layout,
      'PATCH /admin/blocks/BLOCK-2W/location': save,
    });
    renderAt('/admin/slots');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit location' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Latitude'), '15.85');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save location' }));
    expect(
      await within(dialog).findByText('Enter both latitude and longitude, or clear both.'),
    ).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });
});

describe('analytics', () => {
  it('summarises the day and offers every chart as a table', async () => {
    const hours = Array.from({ length: 24 }, (_, hour) => hour);
    const analytics: AnalyticsResponse = {
      date: '2026-10-08',
      generatedAt: new Date().toISOString(),
      occupancyByHour: hours.map((hour) => ({
        hour,
        TWO_WHEELER: hour >= 9 && hour < 13 ? 1 : 0,
        FOUR_WHEELER: hour >= 10 && hour < 12 ? 1 : 0,
      })),
      entriesByHour: hours.map((hour) => ({ hour, count: hour === 9 || hour === 10 ? 1 : 0 })),
      peakEntryHour: 9,
      sessions: { entered: 2, completed: 2, averageDurationHours: 3 },
      revenue: {
        totalPaise: 10000,
        transactions: 2,
        byVehicleType: { TWO_WHEELER: 2000, FOUR_WHEELER: 8000 },
        byOwnerCategory: { STAFF: 0, STUDENT: 2000, VISITOR: 8000 },
      },
      zones: [
        {
          code: 'ZONE-2W',
          name: 'Two-Wheeler Zone',
          vehicleType: 'TWO_WHEELER',
          totalSlots: 10,
          usableSlots: 10,
          sessions: 1,
          peakOccupied: 1,
          peakOccupancyPercent: 10,
          currentOccupied: 0,
          currentOccupancyPercent: 0,
        },
      ],
      topSlots: [{ slotCode: 'T-01', zoneName: 'Two-Wheeler Zone', sessions: 1 }],
    };
    const fetchMock = mockApi({ ...signInAs('ADMIN'), 'GET /admin/analytics': analytics });
    renderAt('/admin/analytics?date=2026-10-08');

    const summary = await screen.findByRole('region', { name: 'Summary for the day' });
    expect(within(summary).getByText('₹100')).toBeInTheDocument();
    expect(within(summary).getByText('2 finalized transactions')).toBeInTheDocument();
    expect(within(summary).getByText('09:00')).toBeInTheDocument();
    expect(requestedUrls(fetchMock, '/admin/analytics')[0]!.searchParams.get('date')).toBe(
      '2026-10-08',
    );

    const chart = screen.getByRole('img', { name: 'Occupancy by hour' });
    expect(chart).toBeInTheDocument();
    // Table view of the stacked chart: 11:00 has one vehicle of each type.
    const tables = screen.getAllByRole('table');
    const occupancyRow = within(tables[0]!).getByText('11:00').closest('tr')!;
    expect(
      within(occupancyRow)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['11:00', '1', '1', '2']);
  });
});

describe('reports', () => {
  it('downloads a CSV with the signed-in credentials', async () => {
    const createObjectURL = vi.fn(() => 'blob:report');
    // jsdom has no object URLs; provide them for this test only.
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const fetchMock = mockApi({
      ...signInAs('ADMIN'),
      'GET /admin/reports/revenue': new Response('﻿Date,Transactions\r\n', {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition':
            'attachment; filename="cpvts-revenue-2026-10-01_to_2026-10-08.csv"',
        },
      }),
    });
    renderAt('/admin/reports');

    await userEvent.type(await screen.findByLabelText('From date'), '2026-10-01');
    await userEvent.type(screen.getByLabelText('To date'), '2026-10-08');
    const card = screen.getByText('Daily revenue').closest('[data-slot="card"]') as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: 'Download CSV' }));

    expect(
      await screen.findByText('Downloaded cpvts-revenue-2026-10-01_to_2026-10-08.csv.'),
    ).toBeInTheDocument();
    const [request] = requestedUrls(fetchMock, '/admin/reports/revenue');
    expect(request!.searchParams.get('from')).toBe('2026-10-01');
    const init = fetchMock.mock.calls.find(([input]) => String(input).includes('/reports/'))![1];
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token');
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  });
});

describe('integrity and audit logs', () => {
  it('reports failed checks with their findings', async () => {
    const report: IntegrityReport = {
      checkedAt: new Date().toISOString(),
      healthy: false,
      checks: [
        { code: 'OCCUPIED_SLOT_HAS_ACTIVE_SESSION', passed: true, findings: [] },
        {
          code: 'COMPLETED_SESSION_HAS_RECEIPT',
          passed: false,
          findings: ['CPVTS-P-7K4M92QX has no receipt'],
        },
      ],
      recentRejections: [
        {
          at: new Date().toISOString(),
          code: 'SESSION_SLOT_MISMATCH',
          actor: 'guard1',
          entityType: 'PARKING_SESSION',
          entityId: 'CPVTS-P-7K4M92QX',
        },
      ],
    };
    mockApi({ ...signInAs('ADMIN'), 'GET /admin/integrity': report });
    renderAt('/admin/integrity');

    expect(await screen.findByText('Some integrity checks failed')).toBeInTheDocument();
    const failed = screen.getByText('Every completed session has a receipt').closest('li')!;
    expect(within(failed).getByText('Failed')).toBeInTheDocument();
    expect(within(failed).getByText('CPVTS-P-7K4M92QX has no receipt')).toBeInTheDocument();
    expect(screen.getByText('guard1')).toBeInTheDocument();
  });

  it('lists audit entries with translated actions', async () => {
    const entry: AuditLogEntry = {
      id: 'a1',
      at: new Date().toISOString(),
      action: 'SLOT_BLOCKED',
      actor: { username: 'admin', fullName: 'Campus Admin', role: 'ADMIN' },
      entityType: 'PARKING_SLOT',
      entityId: 'T-07',
      metadata: { reason: 'Repair' },
      ipAddress: '127.0.0.1',
    };
    mockApi({ ...signInAs('ADMIN'), 'GET /admin/audit-logs': page([entry]) });
    renderAt('/admin/audit-logs');

    const row = (await screen.findByText('Campus Admin')).closest('tr')!;
    expect(within(row).getByText('Slot blocked')).toBeInTheDocument();
    expect(within(row).getByText('T-07')).toBeInTheDocument();
  });
});

describe('alerts and session timeline', () => {
  it('shows rule-based alerts on the staff dashboard', async () => {
    const alerts: AlertsResponse = {
      generatedAt: new Date().toISOString(),
      thresholds: { nearlyFullPercent: 90, longDurationHours: 8 },
      alerts: [
        {
          kind: 'ZONE_FULL',
          severity: 'critical',
          zone: {
            code: 'ZONE-4W',
            name: 'Four-Wheeler Zone',
            vehicleType: 'FOUR_WHEELER',
            occupied: 5,
            usable: 5,
            percent: 100,
            availableSlots: [],
          },
        },
        {
          kind: 'LONG_DURATION',
          severity: 'warning',
          session: {
            sessionNumber: 'CPVTS-P-7K4M92QX',
            vehicleNumber: 'KA22AB1234',
            slotCode: 'T-04',
            durationHours: 9,
          },
        },
      ],
    };
    mockApi({ ...signInAs('SECURITY_STAFF'), 'GET /parking/alerts': alerts });
    renderAt('/staff');

    expect(
      await screen.findByText('Four-Wheeler Zone is FULL (5 of 5 usable slots).'),
    ).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
    const long = screen.getByText(/KA22AB1234 in slot T-04 has been parked for 9 hours/);
    expect(within(long.closest('li')!).getByRole('link', { name: 'View session' })).toHaveAttribute(
      'href',
      '/staff/sessions/CPVTS-P-7K4M92QX',
    );
  });

  it('replays the session timeline from the audit log', async () => {
    const session: ParkingSessionView = {
      sessionNumber: 'CPVTS-P-7K4M92QX',
      status: 'COMPLETED',
      lifecycle: 'COMPLETED',
      exitRequestedAt: null,
      vehicleNumber: 'KA22AB1234',
      vehicleType: 'TWO_WHEELER',
      ownerCategory: 'STUDENT',
      block: { code: 'BLOCK-2W', name: 'Two-Wheeler Parking Block', coordinates: null },
      zone: { code: 'ZONE-2W', name: 'Two-Wheeler Zone' },
      slotCode: 'T-04',
      entryHour: 9,
      entryAt: new Date().toISOString(),
      entryReference: null,
      currentHour: null,
      currentDurationHours: null,
      estimatedFee: null,
      exitHour: 13,
      exitAt: new Date().toISOString(),
      durationHours: 4,
      fee: null,
      exitCapturedAt: null,
      timeAdjusted: false,
      receiptNumber: 'CPVTS-R-2026-8F3K2Q9M',
    };
    const timeline: SessionTimelineResponse = {
      sessionNumber: session.sessionNumber,
      events: [
        {
          at: new Date().toISOString(),
          action: 'SLOT_ASSIGNED',
          actor: { fullName: 'Gate Guard', role: 'SECURITY_STAFF' },
          channel: 'SECURITY',
          details: { slotCode: 'T-04', score: -3 },
        },
        {
          at: new Date().toISOString(),
          action: 'PAYMENT_SUCCEEDED',
          actor: { fullName: 'Gate Guard', role: 'SECURITY_STAFF' },
          channel: 'SECURITY',
          details: { amountPaise: 2000, method: 'UPI', transactionId: 'TXN-8F3K2Q9MZA' },
        },
      ],
    };
    mockApi({
      ...signInAs('ADMIN'),
      [`GET /parking/sessions/${session.sessionNumber}`]: session,
      [`GET /parking/sessions/${session.sessionNumber}/timeline`]: timeline,
    });
    renderAt(`/admin/sessions/${session.sessionNumber}`);

    expect(await screen.findByText('Session timeline')).toBeInTheDocument();
    expect(await screen.findByText('Slot assigned')).toBeInTheDocument();
    expect(screen.getByText('Slot T-04 · score -3')).toBeInTheDocument();
    expect(screen.getByText('₹20 · UPI · TXN-8F3K2Q9MZA')).toBeInTheDocument();
  });
});
