import 'dotenv/config';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { PostgresFollowUpStore } from './followupStore.js';
import type { NewFollowUp } from './followups.js';

// Live PostgreSQL integration suite. Explicit opt-in only:
//
//   npm run test:integration
//
// Never add this file to `npm test`: the default suite must stay offline.
// The suite connects with TEST_DATABASE_URL only and never getDb(), so a
// DATABASE_URL fallback is structurally impossible. Before the first live
// run, independently confirm (via the Supabase dashboard, out of band) that
// TEST_DATABASE_URL belongs to the separately provisioned test project —
// URL comparison alone cannot establish database separation, and this file
// must never print URLs, hosts, credentials, or row contents.

// ---- Safety gates: evaluated before any connection is constructed. ----

const rawTestUrl = process.env.TEST_DATABASE_URL;
if (rawTestUrl === undefined || rawTestUrl.trim() === '') {
  console.error(
    '[integration] TEST_DATABASE_URL is required to run integration tests.',
  );
  throw new Error('TEST_DATABASE_URL is required to run integration tests.');
}
const testUrl = rawTestUrl.trim();

const rawProdUrl = process.env.DATABASE_URL;
if (
  rawProdUrl !== undefined &&
  (rawProdUrl === rawTestUrl || rawProdUrl.trim() === testUrl)
) {
  console.error(
    '[integration] TEST_DATABASE_URL must not equal DATABASE_URL.',
  );
  throw new Error('TEST_DATABASE_URL must not equal DATABASE_URL.');
}

if (!/^postgres(ql)?:\/\//.test(testUrl)) {
  console.error(
    '[integration] TEST_DATABASE_URL must be a PostgreSQL URL.',
  );
  throw new Error('TEST_DATABASE_URL must be a PostgreSQL URL.');
}

const rawTestSsl = process.env.TEST_DATABASE_SSL;
let testSsl: 'require' | false = 'require';
if (rawTestSsl !== undefined) {
  if (rawTestSsl !== 'disable') {
    console.error(
      '[integration] TEST_DATABASE_SSL must be unset or "disable".',
    );
    throw new Error('TEST_DATABASE_SSL must be unset or "disable".');
  }
  const hostname = new URL(testUrl).hostname;
  const normalizedHost =
    hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;
  if (
    normalizedHost !== '127.0.0.1' &&
    normalizedHost !== 'localhost' &&
    normalizedHost !== '::1'
  ) {
    console.error(
      '[integration] TEST_DATABASE_SSL=disable is allowed for loopback test databases only.',
    );
    throw new Error(
      'TEST_DATABASE_SSL=disable is allowed for loopback test databases only.',
    );
  }
  testSsl = false;
}

type Sql = ReturnType<typeof postgres>;

let sql: Sql;
let store: PostgresFollowUpStore;

// UUIDs created by this run. Cleanup deletes exactly these rows and nothing
// else: never truncate, never delete by broad predicates.
const createdIds: string[] = [];
const runTag = `itest-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

function inputFor(index: number, overrides: Partial<NewFollowUp> = {}): NewFollowUp {
  return {
    enquiryId: `${runTag}-enq-${index}`,
    customer: `Integration Customer ${index}`,
    subject: `Integration subject ${index}`,
    reason: `Integration reason ${index}.`,
    dueAt: '2026-12-01T09:00:00.000Z',
    notes: '',
    ...overrides,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function cleanup(): Promise<void> {
  if (createdIds.length === 0) {
    return;
  }
  const ids = [...createdIds];
  const deleted = await sql`delete from follow_ups where id = any(${ids})`;
  assert.equal(
    deleted.count,
    ids.length,
    'cleanup must delete exactly the tracked records',
  );
  const remaining = await sql`select id from follow_ups where id = any(${ids})`;
  assert.equal(
    remaining.length,
    0,
    'no tracked records may remain after cleanup',
  );
  createdIds.length = 0;
}

describe('postgres follow-up integration', () => {
  before(() => {
    sql = postgres(testUrl, {
      max: 2,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: testSsl,
      prepare: true,
      connection: {
        application_name: 'followthrough-ai-integration',
      },
    });
    store = new PostgresFollowUpStore(sql);
  });

  // Registered before any test can create records. node:test runs after()
  // hooks even when tests fail, so tracked rows are always cleaned up.
  after(async () => {
    try {
      await cleanup();
    } finally {
      if (sql !== undefined) {
        await sql.end();
      }
    }
  });

  it('connects to the test database', async () => {
    const rows = await store.list({ enquiryId: `${runTag}-absent` });
    assert.deepEqual(rows, []);
  });

  it('creates a follow-up', async () => {
    const created = await store.create(inputFor(1));
    createdIds.push(created.id);
    assert.ok(created.id !== '');
    assert.equal(created.enquiryId, `${runTag}-enq-1`);
    assert.equal(created.status, 'pending');
    assert.equal(created.dueAt, '2026-12-01T09:00:00.000Z');
  });

  it('lists records in insertion order', async () => {
    for (const index of [2, 3]) {
      const created = await store.create(inputFor(index));
      createdIds.push(created.id);
    }
    const listed = await store.list();
    const runIds = new Set(createdIds);
    const ordered = listed
      .filter((followUp) => runIds.has(followUp.id))
      .map((followUp) => followUp.id);
    assert.deepEqual(ordered, [...createdIds]);
  });

  it('filters by enquiry id', async () => {
    const listed = await store.list({ enquiryId: `${runTag}-enq-2` });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].enquiryId, `${runTag}-enq-2`);
  });

  it('filters by status', async () => {
    const target = await store.create(inputFor(4));
    createdIds.push(target.id);
    const updated = await store.update(target.id, { status: 'completed' });
    assert.equal(updated?.status, 'completed');
    const runIds = new Set(createdIds);
    const completed = (await store.list({ status: 'completed' })).filter(
      (followUp) => runIds.has(followUp.id),
    );
    const pending = (await store.list({ status: 'pending' })).filter(
      (followUp) => runIds.has(followUp.id),
    );
    assert.ok(completed.some((followUp) => followUp.id === target.id));
    assert.ok(!pending.some((followUp) => followUp.id === target.id));
  });

  it('updates a follow-up', async () => {
    const target = await store.create(inputFor(5));
    createdIds.push(target.id);
    const updated = await store.update(target.id, {
      reason: 'Updated integration reason.',
      dueAt: '2027-01-15T10:00:00.000Z',
      status: 'completed',
      notes: 'Updated integration notes.',
    });
    assert.equal(updated?.id, target.id);
    assert.equal(updated?.reason, 'Updated integration reason.');
    assert.equal(updated?.dueAt, '2027-01-15T10:00:00.000Z');
    assert.equal(updated?.status, 'completed');
    assert.equal(updated?.notes, 'Updated integration notes.');
  });

  it('advances updated_at on update', async () => {
    const created = await store.create(inputFor(6));
    createdIds.push(created.id);
    await sleep(50);
    const updated = await store.update(created.id, { notes: 'Bump.' });
    assert.ok(
      Date.parse(updated?.updatedAt ?? '') > Date.parse(created.updatedAt),
    );
  });

  it('returns null for a missing uuid', async () => {
    const result = await store.update(randomUUID(), { status: 'completed' });
    assert.equal(result, null);
  });

  it('cleans up only the tracked records', async () => {
    assert.ok(createdIds.length > 0);
    await cleanup();
    assert.equal(createdIds.length, 0);
  });
});
