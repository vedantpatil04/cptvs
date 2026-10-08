import {
  academicProfileSchema,
  ACADEMIC_PROGRAMS,
  batchOf,
  maxSemesterOf,
  parseBatchLabel,
  programsForBatch,
  type AcademicFacets,
  type ApiErrorBody,
  type LoginResponse,
  type Page,
  type ParkingUserProfileView,
  type UserDetail,
  type UserListItem,
} from '@cpvts/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { disconnectDatabase, prisma } from '../src/db/prisma.js';
import { resetDatabase } from './helpers.js';
import { parkingApi, seedFees, seedLayout, signIn } from './parking-helpers.js';
import {
  academicDetails,
  adminAccount,
  client,
  createParkingUser,
  createParkingUserWithVehicle,
  errorCode,
  identityDocument,
  PNG_BYTES,
  registrationBody,
} from './user-helpers.js';

const app = createApp(config);
let admin: ReturnType<typeof client>;
let guard: ReturnType<typeof parkingApi>;

beforeEach(async () => {
  await resetDatabase();
  await seedLayout();
  await seedFees();
  admin = client(app, (await adminAccount()).token);
  guard = parkingApi(app, (await signIn('SECURITY_STAFF', 'guard')).token);
});

afterAll(disconnectDatabase);

describe('program rules and the derived batch', () => {
  it('derives the batch from the admission year and the program duration', () => {
    expect(batchOf('BCA', 2024).label).toBe('2024–2027');
    expect(batchOf('BCOM', 2024).label).toBe('2024–2027');
    expect(batchOf('BBA', 2024).label).toBe('2024–2027');
    expect(batchOf('MCA', 2024).label).toBe('2024–2026');
    expect(batchOf('MBA', 2024).label).toBe('2024–2026');
    expect(batchOf('MBA', 2024)).toMatchObject({ startYear: 2024, endYear: 2026 });
  });

  it('allows 6 semesters for UG programs and 4 for PG programs', () => {
    for (const program of ['BCA', 'BCOM', 'BBA'] as const) expect(maxSemesterOf(program)).toBe(6);
    for (const program of ['MCA', 'MBA'] as const) expect(maxSemesterOf(program)).toBe(4);
    expect(ACADEMIC_PROGRAMS).toEqual(['BCA', 'BCOM', 'BBA', 'MCA', 'MBA']);
  });

  it('reads a batch label with either dash and maps it to the programs of that length', () => {
    expect(parseBatchLabel('2024–2027')).toEqual({ startYear: 2024, endYear: 2027 });
    expect(parseBatchLabel('2024-2026')).toEqual({ startYear: 2024, endYear: 2026 });
    expect(parseBatchLabel(' 2024 - 2027 ')).toEqual({ startYear: 2024, endYear: 2027 });
    for (const bad of ['2024', '2027-2024', 'abc', '2024–', '24-27']) {
      expect(parseBatchLabel(bad), bad).toBeNull();
    }
    expect(programsForBatch(2024, 2027)).toEqual(['BCA', 'BCOM', 'BBA']);
    expect(programsForBatch(2024, 2026)).toEqual(['MCA', 'MBA']);
    expect(programsForBatch(2024, 2025)).toEqual([]);
  });

  it('validates the whole profile together', () => {
    const ok = academicProfileSchema.safeParse({
      program: 'MBA',
      department: '  Management   Studies ',
      admissionYear: '2024', // a form may send strings
      currentSemester: '4',
    });
    expect(ok.success).toBe(true);
    expect(ok.data).toEqual({
      program: 'MBA',
      department: 'Management Studies',
      admissionYear: 2024,
      currentSemester: 4,
    });

    const year = new Date().getFullYear();
    for (const bad of [
      { program: 'MBA', currentSemester: 5 }, // PG has 4 semesters
      { program: 'MCA', currentSemester: 5 },
      { program: 'BCA', currentSemester: 7 }, // UG has 6
      { program: 'BBA', currentSemester: 0 },
      { program: 'BCOM', currentSemester: 2.5 },
      { program: 'LLB' }, // not offered
      { admissionYear: 1999 },
      { admissionYear: year + 1 }, // not admitted yet
      { department: ' ' },
    ]) {
      expect(
        academicProfileSchema.safeParse({ ...academicDetails(), ...bad }).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });
});

describe('student registration collects the academic identity', () => {
  const registerStudent = (body: object) => client(app).post('/auth/register/student', body);

  it.each([
    ['BCA', 2024, '2024–2027', 6],
    ['BCOM', 2023, '2023–2026', 5],
    ['BBA', 2022, '2022–2025', 1],
    ['MCA', 2024, '2024–2026', 4],
    ['MBA', 2025, '2025–2027', 2],
  ] as const)(
    '%s admitted %i is batch %s, and the profile shows it to the student and to Admin',
    async (program, admissionYear, batch, currentSemester) => {
      const academic = academicDetails({ program, admissionYear, currentSemester });
      const res = await registerStudent(registrationBody({ academic }));
      expect(res.status).toBe(201);
      const login = res.body as LoginResponse;

      const stored = await prisma.parkingUserProfile.findUniqueOrThrow({
        where: { userId: login.user.id },
      });
      // The authoritative values are stored; the batch is derived, never stored as text.
      expect(stored).toMatchObject({
        program,
        department: 'Computer Applications',
        admissionYear,
        currentSemester,
      });

      const mine = (await client(app, login.accessToken).get('/portal/profile'))
        .body as ParkingUserProfileView;
      expect(mine.academic).toMatchObject({
        program,
        batch,
        batchStartYear: admissionYear,
        currentSemester,
        maxSemester: maxSemesterOf(program),
      });
      const seen = (await admin.get(`/admin/users/${login.user.id}`)).body as UserDetail;
      expect(seen.parkingUser?.academic).toMatchObject({ program, batch, currentSemester });
    },
  );

  it('shows the program label as Admin knows it (B.Com)', async () => {
    const login = (
      await registerStudent(registrationBody({ academic: academicDetails({ program: 'BCOM' }) }))
    ).body as LoginResponse;
    const detail = (await admin.get(`/admin/users/${login.user.id}`)).body as UserDetail;
    expect(detail.parkingUser?.academic).toMatchObject({
      program: 'BCOM',
      programLabel: 'B.Com',
      level: 'UG',
    });
  });

  it('requires every academic field', async () => {
    const { academic: _omitted, ...withoutAcademic } = registrationBody();
    void _omitted;
    const missing = await registerStudent(withoutAcademic);
    expect(missing.status).toBe(400);
    expect((missing.body as ApiErrorBody).error.details?.map((d) => d.path)).toContain(
      'body.academic',
    );

    for (const field of ['program', 'department', 'admissionYear', 'currentSemester'] as const) {
      const academic: Record<string, unknown> = { ...academicDetails() };
      delete academic[field];
      const res = await registerStudent(registrationBody({ academic }));
      expect(res.status, field).toBe(400);
      expect((res.body as ApiErrorBody).error.details?.map((d) => d.path)).toContain(
        `body.academic.${field}`,
      );
    }
    expect(await prisma.user.count({ where: { role: 'PARKING_USER' } })).toBe(0);
  });

  it.each([
    [{ program: 'MBA', currentSemester: 5 }, 'body.academic.currentSemester'],
    [{ program: 'MCA', currentSemester: 5 }, 'body.academic.currentSemester'],
    [{ program: 'BCA', currentSemester: 7 }, 'body.academic.currentSemester'],
    [{ currentSemester: 0 }, 'body.academic.currentSemester'],
    [{ program: 'LLB' }, 'body.academic.program'],
    [{ admissionYear: 1999 }, 'body.academic.admissionYear'],
    [{ admissionYear: 2999 }, 'body.academic.admissionYear'],
    [{ department: '' }, 'body.academic.department'],
  ])('rejects an invalid academic profile %j', async (bad, path) => {
    const res = await registerStudent(
      registrationBody({ academic: { ...academicDetails(), ...bad } }),
    );
    expect(res.status).toBe(400);
    expect((res.body as ApiErrorBody).error.details?.map((d) => d.path)).toContain(path);
  });

  it('refuses a duplicate Student ID / USN, however it is written', async () => {
    expect((await registerStudent(registrationBody())).status).toBe(201);
    const duplicate = await registerStudent(
      registrationBody({
        institutionalId: '2bt22cs001',
        confirmInstitutionalId: '2bt22cs001',
        email: 'someone.else@college.edu.in',
      }),
    );
    expect(duplicate.status).toBe(409);
    expect(errorCode(duplicate)).toBe('INSTITUTIONAL_ID_TAKEN');
    expect(await prisma.parkingUserProfile.count()).toBe(1);
  });

  it('gives Campus Staff no academic profile, whatever the request carries', async () => {
    const res = await client(app).post(
      '/auth/register/staff',
      registrationBody({ institutionalId: 'EMP-1042', confirmInstitutionalId: 'EMP-1042' }),
    );
    expect(res.status).toBe(201);
    const stored = await prisma.parkingUserProfile.findFirstOrThrow({
      where: { category: 'STAFF' },
    });
    expect(stored).toMatchObject({
      program: null,
      department: null,
      admissionYear: null,
      currentSemester: null,
    });
    const profile = (
      await client(app, (res.body as LoginResponse).accessToken).get('/portal/profile')
    ).body as ParkingUserProfileView;
    expect(profile.academic).toBeNull();
  });
});

describe('students cannot change their verified academic identity', () => {
  it.each([
    { academic: { currentSemester: 4 } },
    { currentSemester: 4 },
    { program: 'MCA' },
    { department: 'Commerce' },
    { admissionYear: 2020 },
    { batch: '2020–2023' },
  ])('refuses %j on the profile', async (body) => {
    const { token, user } = await createParkingUser();
    const res = await client(app, token).patch('/portal/profile', body);
    expect(res.status).toBe(400);
    const stored = await prisma.parkingUserProfile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(stored).toMatchObject(academicDetails());
  });

  it('lets a rejected student correct the details together with the new document', async () => {
    const { token, user } = await createParkingUser({ verification: 'REJECTED' });
    const portal = client(app, token);
    const corrected = academicDetails({ program: 'MCA', admissionYear: 2025, currentSemester: 2 });

    const invalid = await portal.post('/portal/verification/resubmit', {
      institutionalId: '2BT22CS001',
      confirmInstitutionalId: '2BT22CS001',
      document: identityDocument(Buffer.concat([PNG_BYTES, Buffer.from([7])])),
      academic: { ...corrected, currentSemester: 5 },
    });
    expect(invalid.status).toBe(400);

    const ok = await portal.post('/portal/verification/resubmit', {
      institutionalId: '2BT22CS001',
      confirmInstitutionalId: '2BT22CS001',
      document: identityDocument(Buffer.concat([PNG_BYTES, Buffer.from([8])])),
      academic: corrected,
    });
    expect(ok.status).toBe(200);
    expect((ok.body as ParkingUserProfileView).academic).toMatchObject({
      program: 'MCA',
      batch: '2025–2027',
      currentSemester: 2,
    });
    expect((ok.body as ParkingUserProfileView).verification.status).toBe('PENDING');
    expect(
      (await prisma.parkingUserProfile.findUniqueOrThrow({ where: { userId: user.id } })).program,
    ).toBe('MCA');
  });
});

describe('Admin keeps the academic identity up to date', () => {
  it('promotes a semester, validates the combination and audits the change', async () => {
    const { user } = await createParkingUser({ academic: { currentSemester: 3 } });

    const promoted = await admin.patch(`/admin/users/${user.id}`, {
      academic: { currentSemester: 4 },
    });
    expect(promoted.status).toBe(200);
    expect((promoted.body as UserDetail).parkingUser?.academic).toMatchObject({
      currentSemester: 4,
      batch: '2024–2027',
    });

    // The merged result must still be a real combination: BCA → MCA with semester 5 is not.
    const bad = await admin.patch(`/admin/users/${user.id}`, {
      academic: { program: 'MCA', currentSemester: 5 },
    });
    expect(bad.status).toBe(400);
    expect((bad.body as ApiErrorBody).error.details?.map((d) => d.path)).toContain(
      'body.academic.currentSemester',
    );
    // …but a consistent change of program is fine, and the batch follows the duration.
    const moved = await admin.patch(`/admin/users/${user.id}`, {
      academic: { program: 'MCA', currentSemester: 2 },
    });
    expect((moved.body as UserDetail).parkingUser?.academic).toMatchObject({
      program: 'MCA',
      batch: '2024–2026',
      currentSemester: 2,
    });

    const audit = await prisma.auditLog.findMany({
      where: { action: 'USER_UPDATED', entityId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit).toHaveLength(2);
    expect(audit[0]?.metadata).toMatchObject({
      fields: ['academic.currentSemester'],
      academic: {
        from: { currentSemester: 3 },
        to: { currentSemester: 4 },
      },
    });
  });

  it('needs all four fields for a student who has none yet, and never applies to Campus Staff', async () => {
    const legacy = await createParkingUser({ academic: null });
    const partial = await admin.patch(`/admin/users/${legacy.user.id}`, {
      academic: { currentSemester: 3 },
    });
    expect(partial.status).toBe(400);

    const complete = await admin.patch(`/admin/users/${legacy.user.id}`, {
      academic: academicDetails({ program: 'BBA', currentSemester: 3 }),
    });
    expect(complete.status).toBe(200);
    expect((complete.body as UserDetail).parkingUser?.academic).toMatchObject({ program: 'BBA' });

    const staff = await createParkingUser({ category: 'STAFF' });
    const refused = await admin.patch(`/admin/users/${staff.user.id}`, {
      academic: academicDetails(),
    });
    expect(refused.status).toBe(400);
  });

  it('accepts no other field in the academic block, and only administrators may edit', async () => {
    const { user, token } = await createParkingUser();
    expect(
      (await admin.patch(`/admin/users/${user.id}`, { academic: { category: 'STAFF' } })).status,
    ).toBe(400);
    expect(
      (await admin.patch(`/admin/users/${user.id}`, { academic: { batch: '2020–2023' } })).status,
    ).toBe(400);
    expect(
      (
        await client(app, token).patch(`/admin/users/${user.id}`, {
          academic: { currentSemester: 5 },
        })
      ).status,
    ).toBe(403);
  });
});

describe('Admin finds students by their academic profile', () => {
  const ids: Record<string, string> = {};

  beforeEach(async () => {
    const make = async (
      key: string,
      options: Parameters<typeof createParkingUser>[0],
    ): Promise<string> => {
      const { user } = await createParkingUser(options);
      ids[key] = user.id;
      return user.id;
    };
    await make('bca', {
      institutionalId: '2BT24CA001',
      fullName: 'Anil BCA',
      academic: {
        program: 'BCA',
        department: 'Computer Applications',
        admissionYear: 2024,
        currentSemester: 3,
      },
    });
    await make('bcom', {
      institutionalId: '2BT24CM001',
      fullName: 'Bhavya BCom',
      verification: 'PENDING',
      academic: {
        program: 'BCOM',
        department: 'Commerce',
        admissionYear: 2024,
        currentSemester: 5,
      },
    });
    await make('mca', {
      institutionalId: '2BT24MC001',
      fullName: 'Chetan MCA',
      academic: {
        program: 'MCA',
        department: 'computer applications',
        admissionYear: 2024,
        currentSemester: 1,
      },
    });
    await make('mba', {
      institutionalId: '2BT23MB001',
      fullName: 'Divya MBA',
      verification: 'REJECTED',
      academic: {
        program: 'MBA',
        department: 'Management Studies',
        admissionYear: 2023,
        currentSemester: 3,
      },
    });
    await make('bba', {
      institutionalId: '2BT22BA001',
      fullName: 'Esha BBA',
      isActive: false,
      academic: {
        program: 'BBA',
        department: 'Management Studies',
        admissionYear: 2022,
        currentSemester: 6,
      },
    });
    await make('legacy', {
      institutionalId: '2BT20OLD01',
      fullName: 'Farhan Legacy',
      academic: null,
    });
    await make('staff', { category: 'STAFF', institutionalId: 'EMP-1042', fullName: 'Gita Staff' });
  });

  const list = async (query: Record<string, string | number>) =>
    (
      (await admin.get('/admin/users', { pageSize: 50, ...query })).body as Page<UserListItem>
    ).items.map((item) => item.fullName);

  it('filters by program, department, batch and semester', async () => {
    expect(await list({ program: 'BCA' })).toEqual(['Anil BCA']);
    expect((await list({ program: 'MBA' })).sort()).toEqual(['Divya MBA']);
    // Departments that differ only by letter case are one department.
    expect((await list({ department: 'COMPUTER applications' })).sort()).toEqual([
      'Anil BCA',
      'Chetan MCA',
    ]);
    // A batch is the admission year plus the program duration, written with either dash.
    expect((await list({ batch: '2024–2027' })).sort()).toEqual(['Anil BCA', 'Bhavya BCom']);
    expect(await list({ batch: '2024-2026' })).toEqual(['Chetan MCA']);
    expect(await list({ batch: '2023–2025' })).toEqual(['Divya MBA']);
    expect(await list({ batch: '2022–2025' })).toEqual(['Esha BBA']);
    expect(await list({ batch: '2024–2025' })).toEqual([]);
    expect((await list({ semester: 3 })).sort()).toEqual(['Anil BCA', 'Divya MBA']);
    expect(await list({ program: 'BCA', semester: 3, batch: '2024–2027' })).toEqual(['Anil BCA']);
    expect(await list({ program: 'BCA', semester: 4 })).toEqual([]);
  });

  it('filters by verification, account status and parking status', async () => {
    expect(await list({ kind: 'STUDENT', verification: 'PENDING' })).toEqual(['Bhavya BCom']);
    expect(await list({ verification: 'REJECTED' })).toEqual(['Divya MBA']);
    expect(await list({ kind: 'STUDENT', status: 'INACTIVE' })).toEqual(['Esha BBA']);

    // Parking status: a student whose vehicle is parked right now.
    const parked = await createParkingUserWithVehicle(app, {
      institutionalId: '2BT24PK001',
      fullName: 'Hari Parked',
      vehicleNumber: 'KA05MN1111',
    });
    await guard.checkInOk(parked.vehicle.vehicleNumber, 'TWO_WHEELER', 'STUDENT', 9);
    expect(await list({ kind: 'STUDENT', parking: 'PARKED' })).toEqual(['Hari Parked']);
    expect(await list({ kind: 'STUDENT', parking: 'NOT_PARKED' })).not.toContain('Hari Parked');
    expect(await list({ kind: 'STUDENT', parking: 'NOT_PARKED', program: 'BCA' })).toEqual([
      'Anil BCA',
    ]);
  });

  it('filters Campus Staff by ID, verification, status and parking status', async () => {
    expect(await list({ kind: 'STAFF' })).toEqual(['Gita Staff']);
    expect(await list({ kind: 'STAFF', q: 'emp-10' })).toEqual(['Gita Staff']);
    expect(await list({ kind: 'STAFF', verification: 'VERIFIED', status: 'ACTIVE' })).toEqual([
      'Gita Staff',
    ]);
    expect(await list({ kind: 'STAFF', parking: 'PARKED' })).toEqual([]);
    // Academic filters mean students, so they never match Campus Staff.
    expect(await list({ kind: 'STAFF', program: 'BCA' })).toEqual([]);
  });

  it('searches students by USN and name', async () => {
    expect(await list({ q: '2bt24ca' })).toEqual(['Anil BCA']);
    expect(await list({ q: 'esha' })).toEqual(['Esha BBA']);
  });

  it('validates the filters', async () => {
    const invalid: Record<string, string | number>[] = [
      { batch: 'nonsense' },
      { batch: '2027-2024' },
      { semester: 9 },
      { program: 'LLB' },
    ];
    for (const query of invalid) {
      expect((await admin.get('/admin/users', query)).status, JSON.stringify(query)).toBe(400);
    }
  });

  it('offers the filter values that exist, and counts students without academic details', async () => {
    const facets = (await admin.get('/admin/users/facets')).body as AcademicFacets;
    expect(facets.programs.map((p) => p.program)).toEqual(['BCA', 'BCOM', 'BBA', 'MCA', 'MBA']);
    expect(facets.programs.find((p) => p.program === 'BCOM')).toMatchObject({
      label: 'B.Com',
      semesters: 6,
    });
    expect(facets.departments).toEqual(['Commerce', 'Computer Applications', 'Management Studies']);
    expect(facets.batches).toEqual(['2024–2027', '2024–2026', '2023–2025', '2022–2025']);
    expect(facets.studentsMissingAcademicProfile).toBe(1);
    expect(
      (await client(app, (await signIn('SECURITY_STAFF', 'g2')).token).get('/admin/users/facets'))
        .status,
    ).toBe(403);
  });
});
