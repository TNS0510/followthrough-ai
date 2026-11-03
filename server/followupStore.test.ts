import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type postgres from 'postgres';
import { getDb } from './db.js';
import { FollowUpStoreError } from './followups.js';
import { PostgresFollowUpStore } from './followupStore.js';

type Sql = ReturnType<typeof postgres>;

// Minimal stand-in for the postgres.js tagged-template client. The store only
// ever calls it as a tag and awaits rows, so this shape fully exercises the
// store's query building, parameter passing, and row mapping offline.
type FakeSql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Record<string, unknown>[]>;

function asSql(fake: FakeSql): Sql {
  return fake as unknown as Sql;
}

interface CapturedCall {
  text: string;
  values: unknown[];
}

function joinSql(strings: TemplateStringsArray): string {
  return strings.join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function recording(
  rows: Record<string, unknown>[],
): { fake: FakeSql; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fake: FakeSql = async (strings, ...values) => {
    calls.push({ text: joinSql(strings), values });
    return rows;
  };
  return { fake, calls };
}

const SECRET = 'SECRET-should-never-leak';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Representative database row, including the `seq` ordering column that the
// mapper ignores. Timestamps accept both driver Date objects and ISO strings.
function dbRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    seq: 7,
    id: '123e4567-e89b-12d3-a456-426614174000',
    enquiry_id: 'enq-1',
    customer: 'Amelia Hart',
    subject: 'Quote for 6-month checkup plan',
    reason: 'Send the revised quote.',
    due_at: '2026-11-05T10:00:00.000Z',
    status: 'pending',
    notes: '',
    created_at: '2026-10-30T10:00:00.000Z',
    updated_at: '2026-10-30T10:00:00.000Z',
    ...overrides,
  };
}

function newInput(overrides: Record<string, unknown> = {}) {
  return {
    enquiryId: 'enq-9',
    customer: 'Jordan Lee',
    subject: 'Harbour Books order',
    reason: 'Confirm the delivery date.',
    dueAt: '2026-12-01T09:00:00.000Z',
    notes: 'Call in the morning.',
    ...overrides,
  };
}

describe('postgres follow-up store', () => {
  it('lists follow-ups without filters and maps database rows', async () => {
    const rows = [
      dbRow({
        id: 'aaaaaaaa-aaaa-4aaa-8000-aaaaaaaaaaaa',
        due_at: new Date('2026-11-05T10:00:00.000Z'),
        created_at: new Date('2026-10-30T10:00:00.000Z'),
        updated_at: new Date('2026-10-30T10:00:00.000Z'),
      }),
      dbRow({
        id: 'bbbbbbbb-bbbb-4bbb-8000-bbbbbbbbbbbb',
        enquiry_id: 'enq-2',
        status: 'completed',
        notes: 'Done.',
      }),
    ];
    const { fake, calls } = recording(rows);
    const store = new PostgresFollowUpStore(asSql(fake));

    const result = await store.list();

    assert.equal(result.length, 2);
    assert.equal(result[0].id, 'aaaaaaaa-aaaa-4aaa-8000-aaaaaaaaaaaa');
    assert.equal(result[0].enquiryId, 'enq-1');
    assert.equal(result[0].customer, 'Amelia Hart');
    assert.equal(result[0].dueAt, '2026-11-05T10:00:00.000Z');
    assert.equal(result[0].status, 'pending');
    assert.equal(result[0].createdAt, '2026-10-30T10:00:00.000Z');
    assert.equal(result[1].enquiryId, 'enq-2');
    assert.equal(result[1].status, 'completed');
    assert.equal(result[1].notes, 'Done.');
    assert.equal(calls.length, 1);
    assert.ok(calls[0].text.includes('from follow_ups'));
    assert.ok(!calls[0].text.includes('where'));
  });

  it('filters the list by enquiry id with a parameterized query', async () => {
    const { fake, calls } = recording([dbRow({ enquiry_id: 'enq-filter-target' })]);
    const store = new PostgresFollowUpStore(asSql(fake));

    const result = await store.list({ enquiryId: 'enq-filter-target' });

    assert.equal(result.length, 1);
    assert.equal(result[0].enquiryId, 'enq-filter-target');
    assert.deepEqual(calls[0].values, ['enq-filter-target']);
    assert.ok(calls[0].text.includes('where enquiry_id ='));
    assert.ok(!calls[0].text.includes('enq-filter-target'));
  });

  it('filters the list by status with a parameterized query', async () => {
    const { fake, calls } = recording([dbRow({ status: 'completed' })]);
    const store = new PostgresFollowUpStore(asSql(fake));

    const result = await store.list({ status: 'completed' });

    assert.equal(result.length, 1);
    assert.equal(result[0].status, 'completed');
    assert.deepEqual(calls[0].values, ['completed']);
    assert.ok(calls[0].text.includes('where status ='));
  });

  it('filters the list by enquiry id and status together', async () => {
    const { fake, calls } = recording([
      dbRow({ enquiry_id: 'enq-both', status: 'completed' }),
    ]);
    const store = new PostgresFollowUpStore(asSql(fake));

    const result = await store.list({ enquiryId: 'enq-both', status: 'completed' });

    assert.equal(result.length, 1);
    assert.deepEqual(calls[0].values, ['enq-both', 'completed']);
    assert.ok(calls[0].text.includes('where enquiry_id ='));
    assert.ok(calls[0].text.includes('and status ='));
    assert.ok(!calls[0].text.includes('enq-both'));
  });

  it('orders every list variant by seq ascending', async () => {
    const variants: Array<Record<string, string>> = [
      {},
      { enquiryId: 'enq-1' },
      { status: 'pending' },
      { enquiryId: 'enq-1', status: 'pending' },
    ];
    for (const filters of variants) {
      const { fake, calls } = recording([]);
      const store = new PostgresFollowUpStore(asSql(fake));
      await store.list(filters);
      assert.equal(calls.length, 1);
      assert.ok(
        calls[0].text.includes('order by seq asc'),
        `missing ORDER BY seq ASC for filters ${JSON.stringify(filters)}`,
      );
    }
  });

  it('creates with parameterized values and maps the returned row', async () => {
    const calls: CapturedCall[] = [];
    const fake: FakeSql = async (strings, ...values) => {
      calls.push({ text: joinSql(strings), values });
      return [
        dbRow({
          id: values[0],
          enquiry_id: values[1],
          customer: values[2],
          subject: values[3],
          reason: values[4],
          due_at: values[5],
          status: values[6],
          notes: values[7],
          created_at: values[8],
          updated_at: '2027-01-01T00:00:00.000Z',
        }),
      ];
    };
    const store = new PostgresFollowUpStore(asSql(fake));
    const input = newInput();

    const result = await store.create(input);

    assert.equal(calls.length, 1);
    const values = calls[0].values as unknown[];
    assert.equal(values.length, 10);
    assert.ok(UUID_PATTERN.test(String(values[0])));
    assert.equal(values[1], input.enquiryId);
    assert.equal(values[2], input.customer);
    assert.equal(values[3], input.subject);
    assert.equal(values[4], input.reason);
    assert.equal(values[5], input.dueAt);
    assert.equal(values[6], 'pending');
    assert.equal(values[7], input.notes);
    assert.ok(calls[0].text.includes('insert into follow_ups'));
    assert.ok(calls[0].text.includes('returning'));
    assert.ok(!calls[0].text.includes('jordan lee'));
    assert.equal(result.id, values[0]);
    assert.equal(result.enquiryId, input.enquiryId);
    assert.equal(result.status, 'pending');
    assert.equal(result.updatedAt, '2027-01-01T00:00:00.000Z');
  });

  it('updates with parameterized patch values and maps the returned row', async () => {
    const id = 'c0ffee00-c0ff-4e00-8000-000000000000';
    const { fake, calls } = recording([
      dbRow({
        id,
        status: 'completed',
        updated_at: '2027-02-01T00:00:00.000Z',
      }),
    ]);
    const store = new PostgresFollowUpStore(asSql(fake));

    const result = await store.update(id, {
      reason: 'Updated reason.',
      status: 'completed',
    });

    assert.notEqual(result, null);
    assert.deepEqual(calls[0].values, [
      'Updated reason.',
      null,
      'completed',
      null,
      id,
    ]);
    assert.ok(calls[0].text.includes('update follow_ups'));
    assert.ok(calls[0].text.includes('coalesce'));
    assert.ok(calls[0].text.includes('updated_at = now()'));
    assert.ok(!calls[0].text.includes('updated reason.'));
    assert.equal(result?.id, id);
    assert.equal(result?.status, 'completed');
    assert.equal(result?.updatedAt, '2027-02-01T00:00:00.000Z');
  });

  it('returns null for an invalid id without querying the database', async () => {
    const fake: FakeSql = async () => {
      throw new Error('fake sql must not be called');
    };
    const store = new PostgresFollowUpStore(asSql(fake));

    for (const id of ['does-not-exist', '', '12345']) {
      assert.equal(await store.update(id, { status: 'completed' }), null);
    }
  });

  it('queries the database for a valid uuid id', async () => {
    const id = 'C0FFEE00-C0FF-4E00-8000-000000000000';
    const { fake, calls } = recording([dbRow({ id })]);
    const store = new PostgresFollowUpStore(asSql(fake));

    const result = await store.update(id, { status: 'completed' });

    assert.equal(calls.length, 1);
    assert.equal(result?.id, id);
  });

  it('returns null when the update matches no row', async () => {
    const { fake } = recording([]);
    const store = new PostgresFollowUpStore(asSql(fake));

    const result = await store.update(
      '123e4567-e89b-12d3-a456-426614174000',
      { status: 'completed' },
    );

    assert.equal(result, null);
  });

  it('maps database failures to a generic error without leaking details', async () => {
    const logged: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]): void => {
      logged.push(args.map((part) => String(part)).join(' '));
    };
    try {
      const failing: FakeSql = async () => {
        throw new Error(`connection exploded (${SECRET})`);
      };
      const store = new PostgresFollowUpStore(asSql(failing));
      const operations = [
        () => store.list(),
        () => store.create(newInput()),
        () =>
          store.update('123e4567-e89b-12d3-a456-426614174000', {
            status: 'completed',
          }),
      ];
      for (const run of operations) {
        await assert.rejects(run(), (error: unknown) => {
          assert.ok(error instanceof FollowUpStoreError);
          assert.equal(
            (error as Error).message,
            'Unable to access follow-up storage.',
          );
          assert.ok(!(error as Error).message.includes(SECRET));
          return true;
        });
      }
      assert.ok(!logged.some((line) => line.includes(SECRET)));
    } finally {
      console.error = originalError;
    }
  });

  it('maps invalid rows to a generic error without exposing content', async () => {
    const badRows = [
      dbRow({ status: 'overdue', reason: `tampered (${SECRET})` }),
      dbRow({ due_at: 'not-a-date', notes: SECRET }),
    ];
    for (const row of badRows) {
      const { fake } = recording([row]);
      const store = new PostgresFollowUpStore(asSql(fake));
      await assert.rejects(store.list(), (error: unknown) => {
        assert.ok(error instanceof FollowUpStoreError);
        assert.equal(
          (error as Error).message,
          'Follow-up store returned an invalid record.',
        );
        assert.ok(!(error as Error).message.includes(SECRET));
        return true;
      });
    }
  });

  it('constructing the store does not connect to the database', () => {
    const savedDb = process.env.DATABASE_URL;
    const savedTestDb = process.env.TEST_DATABASE_URL;
    delete process.env.DATABASE_URL;
    delete process.env.TEST_DATABASE_URL;
    try {
      assert.throws(
        () => getDb(),
        /DATABASE_URL environment variable is required\./,
      );
      assert.doesNotThrow(() => new PostgresFollowUpStore());
    } finally {
      if (savedDb !== undefined) {
        process.env.DATABASE_URL = savedDb;
      }
      if (savedTestDb !== undefined) {
        process.env.TEST_DATABASE_URL = savedTestDb;
      }
    }
  });
});
