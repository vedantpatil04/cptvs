import type { LoginResponse, UserDetail, VisitorAccessResponse } from '@cpvts/shared';
import { createHash } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { disconnectDatabase, prisma } from '../src/db/prisma.js';
import { resetDatabase } from './helpers.js';
import { parkingApi, seedFees, seedLayout, signIn } from './parking-helpers.js';
import {
  adminAccount,
  client,
  createParkingUser,
  errorCode,
  PNG_BYTES,
  registrationBody,
} from './user-helpers.js';

/** Identity documents: administrators can view and download them, nobody else can reach them. */

const app = createApp(config);
let admin: ReturnType<typeof client>;

const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<<>>\n%%EOF\n',
);

interface Owner {
  userId: string;
  documentId: string;
  token: string;
}

/** A student who registered through the API with a PNG ID card. */
const studentWithImage = async (): Promise<Owner> => {
  const res = await client(app).post('/auth/register/student', registrationBody());
  const login = res.body as LoginResponse;
  const detail = (await admin.get(`/admin/users/${login.user.id}`)).body as UserDetail;
  return { userId: login.user.id, documentId: detail.documents[0]!.id, token: login.accessToken };
};

/** A staff member whose ID document is a PDF. */
const staffWithPdf = async (): Promise<Owner> => {
  const { user, token } = await createParkingUser({
    category: 'STAFF',
    institutionalId: 'EMP-1042',
  });
  await prisma.identityDocument.deleteMany({ where: { userId: user.id } });
  const document = await prisma.identityDocument.create({
    data: {
      userId: user.id,
      institutionalId: 'EMP-1042',
      fileName: 'staff id card.pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF_BYTES.length,
      sha256: createHash('sha256').update(PDF_BYTES).digest('hex'),
      content: new Uint8Array(PDF_BYTES),
    },
  });
  return { userId: user.id, documentId: document.id, token };
};

const documentPath = (owner: Owner, query = '') =>
  `/admin/users/${owner.userId}/documents/${owner.documentId}${query}`;

const fetchDocument = (token: string | undefined, path: string) =>
  client(app, token).get(path).responseType('blob');

beforeEach(async () => {
  await resetDatabase();
  await seedLayout();
  await seedFees();
  admin = client(app, (await adminAccount()).token);
});

afterAll(disconnectDatabase);

describe('an administrator can view and download an identity document', () => {
  it('shows an image inline with safe headers, and audits the view', async () => {
    const owner = await studentWithImage();
    const res = await fetchDocument((await adminAccount('boss2')).token, documentPath(owner));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-disposition']).toBe(
      `inline; filename="college-id.png"; filename*=UTF-8''college-id.png`,
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(Buffer.from(res.body as Buffer).equals(PNG_BYTES)).toBe(true);
    expect(Number(res.headers['content-length'])).toBe(PNG_BYTES.length);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'IDENTITY_DOCUMENT_VIEWED' },
    });
    expect(audit).toMatchObject({ entityId: owner.documentId });
    expect(audit.metadata).toMatchObject({ userId: owner.userId, mimeType: 'image/png' });
  });

  it('shows a PDF inline for the browser’s viewer, and keeps the download fully sandboxed', async () => {
    const owner = await staffWithPdf();
    const inline = await fetchDocument((await adminAccount('boss2')).token, documentPath(owner));
    expect(inline.status).toBe(200);
    expect(inline.headers['content-type']).toBe('application/pdf');
    expect(inline.headers['content-disposition']).toMatch(/^inline; filename="staff id card\.pdf"/);
    // A sandboxed response would stop the browser from drawing the PDF.
    expect(inline.headers['content-security-policy']).toBe("default-src 'none'");
    expect(Buffer.from(inline.body as Buffer).equals(PDF_BYTES)).toBe(true);

    const download = await fetchDocument(
      (await adminAccount('boss3')).token,
      documentPath(owner, '?download=1'),
    );
    expect(download.status).toBe(200);
    expect(download.headers['content-disposition']).toMatch(
      /^attachment; filename="staff id card\.pdf"/,
    );
    expect(download.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(Buffer.from(download.body as Buffer).equals(PDF_BYTES)).toBe(true);
  });

  it('records a download differently from a view', async () => {
    const owner = await studentWithImage();
    await fetchDocument((await adminAccount('boss2')).token, documentPath(owner, '?download=true'));
    await fetchDocument((await adminAccount('boss3')).token, documentPath(owner));
    const actions = (
      await prisma.auditLog.findMany({
        where: {
          entityId: owner.documentId,
          action: { in: ['IDENTITY_DOCUMENT_VIEWED', 'IDENTITY_DOCUMENT_DOWNLOADED'] },
        },
        orderBy: { createdAt: 'asc' },
      })
    ).map((entry) => entry.action);
    expect(actions).toEqual(['IDENTITY_DOCUMENT_DOWNLOADED', 'IDENTITY_DOCUMENT_VIEWED']);
  });

  it('lists a document’s details but never its content, anywhere', async () => {
    const owner = await studentWithImage();
    const detail = await admin.get(`/admin/users/${owner.userId}`);
    expect((detail.body as UserDetail).documents[0]).toEqual({
      id: owner.documentId,
      fileName: 'college-id.png',
      mimeType: 'image/png',
      sizeBytes: PNG_BYTES.length,
      institutionalId: '2BT22CS001',
      uploadedAt: expect.any(String),
    });
    const everywhere = [
      JSON.stringify(detail.body),
      JSON.stringify((await admin.get('/admin/users')).body),
      JSON.stringify((await client(app, owner.token).get('/portal/profile')).body),
      JSON.stringify((await client(app, owner.token).get('/auth/me')).body),
    ].join('\n');
    expect(everywhere).not.toContain(PNG_BYTES.toString('base64'));
    expect(everywhere).not.toMatch(/contentBase64|sha256|"content"/);
  });
});

describe('nobody else can reach an identity document', () => {
  it('refuses the student themselves, other students, Security Staff, visitors and anonymous callers', async () => {
    const owner = await studentWithImage();
    const other = await createParkingUser({ institutionalId: '2BT22CS777' });
    const guard = await signIn('SECURITY_STAFF', 'guard');
    const entry = await parkingApi(app, guard.token).checkInOk(
      'MH12CD5678',
      'FOUR_WHEELER',
      'VISITOR',
      9,
    );
    const visitor = (
      await client(app).post('/visitor/access', {
        vehicleNumber: 'MH12CD5678',
        sessionNumber: entry.session.sessionNumber,
      })
    ).body as VisitorAccessResponse;

    const path = documentPath(owner);
    expect((await fetchDocument(owner.token, path)).status).toBe(403); // their own file, too
    expect((await fetchDocument(other.token, path)).status).toBe(403);
    expect((await fetchDocument(guard.token, path)).status).toBe(403);
    expect((await fetchDocument(visitor.accessToken, path)).status).toBe(401);
    expect((await request(app).get(`/api/v1${path}`)).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'IDENTITY_DOCUMENT_VIEWED' } })).toBe(0);
  });

  it('answers with the same not-found for a mismatched or unknown document', async () => {
    const a = await studentWithImage();
    const b = await staffWithPdf();
    expect(errorCode(await admin.get(`/admin/users/${b.userId}/documents/${a.documentId}`))).toBe(
      'DOCUMENT_NOT_FOUND',
    );
    expect(
      errorCode(
        await admin.get(`/admin/users/${a.userId}/documents/00000000-0000-4000-8000-000000000000`),
      ),
    ).toBe('DOCUMENT_NOT_FOUND');
    expect((await admin.get(`/admin/users/${a.userId}/documents/not-a-uuid`)).status).toBe(400);
    expect(await prisma.auditLog.count({ where: { action: 'IDENTITY_DOCUMENT_VIEWED' } })).toBe(0);
  });

  it('is not a public or static file anywhere', async () => {
    const owner = await studentWithImage();
    for (const path of [
      `/uploads/${owner.documentId}`,
      `/documents/${owner.documentId}`,
      `/static/${owner.documentId}`,
      `/api/v1/documents/${owner.documentId}`,
      `/api/v1/identity-documents/${owner.documentId}`,
      `/api/v1/public/documents/${owner.documentId}`,
    ]) {
      expect((await request(app).get(path)).status, path).toBe(404);
    }
  });
});
