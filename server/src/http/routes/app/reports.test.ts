import { eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb, testEncryptionKey } from '../../../../test/db.js';
import { reports, storageObjects } from '../../../db/schema.js';
import { DAY_MS, limaInstant, MINUTE_MS } from '../../../domain/index.js';
import { deleteExpiredReports, REPORT_RETENTION_MS } from '../../../reports/index.js';
import { PostgresBlobStorage } from '../../../storage/postgres-blob-storage.js';
import {
  addEntry,
  Browser,
  createTestApi,
  createTestUser,
  signedInBrowser,
  TEST_PIN,
  TestClock,
  TUESDAY_NIGHT,
} from './test-support.js';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function workbookTexts(buffer: ArrayBuffer): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const texts: string[] = [];
  for (const sheet of workbook.worksheets) {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        texts.push(String(cell.value));
      });
    });
  }
  return texts;
}

describe.skipIf(!hasTestDb)('web reports API (HU-14)', () => {
  const { pool, db } = createTestDb();
  afterAll(() => pool.end());

  async function setup(start: Date = TUESDAY_NIGHT) {
    const clock = new TestClock(start);
    const storage = new PostgresBlobStorage(db, testEncryptionKey());
    const app = createTestApi(db, clock, { reportStorage: storage });
    const user = await createTestUser(db);
    const phone = await signedInBrowser(app, db, user.id, clock.now());
    return { clock, app, user, phone, storage };
  }

  async function reportRows(userId: string) {
    return db.select().from(reports).where(eq(reports.userId, userId));
  }

  it('4 weeks and the right PIN: a PDF and an Excel with clients as initials (PR04)', async () => {
    const { clock, user, phone } = await setup();
    await addEntry(db, user.id, { counterparty: 'Ana Torres', amountCents: 1250 });
    await addEntry(db, user.id, {
      counterparty: 'Rosa María Quispe',
      amountCents: 3000,
      paymentMethod: 'plin',
      operationAt: null,
    });

    // The PIN typed at sign-in is older than 10 minutes: she is asked again (PR11).
    clock.advance(11 * MINUTE_MS);
    const asked = await phone.post('/api/reports', { period: '4_weeks' });
    expect(asked.status).toBe(403);
    expect((await asked.json()).error).toBe('pin_required');
    expect(await reportRows(user.id)).toHaveLength(0);

    expect((await phone.post('/api/auth/pin/verify', { pin: TEST_PIN })).status).toBe(200);
    const created = await phone.post('/api/reports', { period: '4_weeks' });
    expect(created.status).toBe(201);
    expect(created.headers.get('cache-control')).toBe('no-store');
    const report = await created.json();
    expect(report).toMatchObject({
      period: '4_weeks',
      pdfUrl: `/api/reports/${report.id}/pdf`,
      xlsxUrl: `/api/reports/${report.id}/xlsx`,
    });
    expect(report.pdfSizeBytes).toBeGreaterThan(0);
    expect(report.xlsxSizeBytes).toBeGreaterThan(0);

    const [row] = await reportRows(user.id);
    expect(row).toMatchObject({
      id: report.id,
      period: '4_weeks',
      pdfStorageKey: `reports/${user.id}/${report.id}.pdf`,
      xlsxStorageKey: `reports/${user.id}/${report.id}.xlsx`,
    });
    // Stored encrypted: the bytes in the table are not the file.
    const [stored] = await db
      .select()
      .from(storageObjects)
      .where(eq(storageObjects.key, row?.pdfStorageKey ?? ''));
    expect(stored?.ciphertext.subarray(0, 5).toString('latin1')).not.toBe('%PDF-');

    const pdf = await phone.get(report.pdfUrl);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.headers.get('content-disposition')).toBe(
      'attachment; filename="alza-historial-4-semanas.pdf"',
    );
    expect(pdf.headers.get('cache-control')).toBe('no-store');
    const pdfBytes = Buffer.from(await pdf.arrayBuffer());
    expect(pdfBytes.byteLength).toBe(report.pdfSizeBytes);
    expect(pdfBytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const xlsx = await phone.get(report.xlsxUrl);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get('content-type')).toBe(XLSX_TYPE);
    expect(xlsx.headers.get('content-disposition')).toBe(
      'attachment; filename="alza-historial-4-semanas.xlsx"',
    );
    const texts = await workbookTexts(await xlsx.arrayBuffer());
    expect(texts).toContain('A. T.');
    expect(texts).toContain('R. M.');
    expect(texts.join('\n')).not.toMatch(/Ana Torres|Torres|Rosa|Quispe/);
    // Labels and the traceability annex are there (RF-RP-02, RF-RP-03).
    expect(texts.join('\n')).toMatch(/Con captura/);
  });

  it('12 weeks and «todo» get their own file names', async () => {
    const { phone } = await setup();
    const twelve = await (await phone.post('/api/reports', { period: '12_weeks' })).json();
    const all = await (await phone.post('/api/reports', { period: 'all' })).json();
    expect((await phone.get(twelve.xlsxUrl)).headers.get('content-disposition')).toBe(
      'attachment; filename="alza-historial-12-semanas.xlsx"',
    );
    expect((await phone.get(all.pdfUrl)).headers.get('content-disposition')).toBe(
      'attachment; filename="alza-historial-todo.pdf"',
    );
  });

  it('rejects a period that does not exist, and non-JSON bodies', async () => {
    const { user, phone } = await setup();
    for (const body of [{ period: '3_weeks' }, { period: '4 semanas' }, {}, { period: 4 }]) {
      const res = await phone.post('/api/reports', body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid_request', fields: ['period'] });
    }
    const form = await phone.request('POST', '/api/reports');
    expect(form.status).toBe(415);
    expect(await reportRows(user.id)).toHaveLength(0);
  });

  it('only she can download her files: another user gets 404, no session gets 401', async () => {
    const { app, clock, phone } = await setup();
    const report = await (await phone.post('/api/reports', { period: '4_weeks' })).json();

    const other = await createTestUser(db, { businessName: 'Otra bodega' });
    const otherPhone = await signedInBrowser(app, db, other.id, clock.now());
    for (const url of [report.pdfUrl, report.xlsxUrl]) {
      const res = await otherPhone.get(url);
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('not_found');
    }
    expect((await new Browser(app).get(report.pdfUrl)).status).toBe(401);
    expect((await phone.get('/api/reports/not-a-uuid/pdf')).status).toBe(404);
    expect((await phone.get(`/api/reports/${crypto.randomUUID()}/xlsx`)).status).toBe(404);
  });

  it('limits generation per user (14.5)', async () => {
    const { clock, user, phone } = await setup();
    await db.insert(reports).values(
      Array.from({ length: 5 }, (_, i) => ({
        userId: user.id,
        period: '4_weeks',
        createdAt: new Date(clock.now().getTime() - (50 - i) * MINUTE_MS),
      })),
    );
    const limited = await phone.post('/api/reports', { period: '4_weeks' });
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toBe('rate_limited');
    // The oldest of the five leaves the hour in 10 minutes.
    expect(limited.headers.get('retry-after')).toBe(String(10 * 60));

    clock.advance(10 * MINUTE_MS);
    expect((await phone.post('/api/reports', { period: '4_weeks' })).status).toBe(201);
  });

  it('files expire after 7 days; the 03:00 cleanup deletes them and keeps the row', async () => {
    // A clock in 2020, so the cleanup never touches the reports of other test files.
    const { clock, user, phone, storage } = await setup(limaInstant('2020-01-07', 22, 0));
    const report = await (await phone.post('/api/reports', { period: '4_weeks' })).json();
    const [row] = await reportRows(user.id);

    clock.advance(6 * DAY_MS);
    expect((await phone.get(report.pdfUrl)).status).toBe(200);
    expect(await deleteExpiredReports(db, storage, clock.now())).toBe(0);

    clock.advance(DAY_MS);
    const expired = await phone.get(report.pdfUrl);
    expect(expired.status).toBe(410);
    expect((await expired.json()).error).toBe('report_expired');

    expect(await deleteExpiredReports(db, storage, clock.now())).toBeGreaterThanOrEqual(1);
    const [after] = await reportRows(user.id);
    expect(after).toMatchObject({ id: report.id, pdfStorageKey: null, xlsxStorageKey: null });
    expect(await storage.get(row?.pdfStorageKey ?? '')).toBeNull();
    expect(await storage.get(row?.xlsxStorageKey ?? '')).toBeNull();
    expect((await phone.get(report.xlsxUrl)).status).toBe(410);
    expect(REPORT_RETENTION_MS).toBe(7 * DAY_MS);
  });
});
