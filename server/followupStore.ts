import type postgres from 'postgres';
import { getDb } from './db.js';
import {
  FollowUpStoreError,
  createFollowUp,
  updateFollowUp,
} from './followups.js';
import type {
  FollowUp,
  FollowUpPatch,
  FollowUpStatus,
  NewFollowUp,
} from './followups.js';

// Follow-up storage interface with PostgreSQL and in-memory backends.
//
// The PostgreSQL store talks to the `follow_ups` table using parameterized
// queries only. The in-memory store mirrors its semantics for offline tests.

export interface FollowUpFilters {
  enquiryId?: string;
  status?: FollowUpStatus;
}

export interface FollowUpStore {
  list(filters?: FollowUpFilters): Promise<FollowUp[]>;
  create(input: NewFollowUp): Promise<FollowUp>;
  update(id: string, patch: FollowUpPatch): Promise<FollowUp | null>;
}

type Sql = ReturnType<typeof postgres>;

interface FollowUpRow {
  id: string;
  enquiry_id: string;
  customer: string;
  subject: string;
  reason: string;
  due_at: Date | string;
  status: string;
  notes: string;
  created_at: Date | string;
  updated_at: Date | string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asRows(result: unknown): FollowUpRow[] {
  return result as FollowUpRow[];
}

function toISOString(value: Date | string): string {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new FollowUpStoreError('Follow-up store returned an invalid record.');
  }
  return new Date(ms).toISOString();
}

function toFollowUp(row: FollowUpRow): FollowUp {
  if (row.status !== 'pending' && row.status !== 'completed') {
    throw new FollowUpStoreError('Follow-up store returned an invalid record.');
  }
  return {
    id: row.id,
    enquiryId: row.enquiry_id,
    customer: row.customer,
    subject: row.subject,
    reason: row.reason,
    dueAt: toISOString(row.due_at),
    status: row.status,
    notes: row.notes,
    createdAt: toISOString(row.created_at),
    updatedAt: toISOString(row.updated_at),
  };
}

// Follow-up records hold only strings, so a shallow copy fully isolates them.
function copyFollowUp(followUp: FollowUp): FollowUp {
  return { ...followUp };
}

export class PostgresFollowUpStore implements FollowUpStore {
  private readonly sql?: Sql;

  constructor(sql?: Sql) {
    this.sql = sql;
  }

  private db(): Sql {
    return this.sql ?? getDb();
  }

  async list(filters: FollowUpFilters = {}): Promise<FollowUp[]> {
    const { enquiryId, status } = filters;
    try {
      const db = this.db();
      if (enquiryId !== undefined && status !== undefined) {
        const rows = asRows(await db`
          select id, enquiry_id, customer, subject, reason, due_at, status,
            notes, created_at, updated_at
          from follow_ups
          where enquiry_id = ${enquiryId} and status = ${status}
          order by seq asc
        `);
        return rows.map(toFollowUp);
      }
      if (enquiryId !== undefined) {
        const rows = asRows(await db`
          select id, enquiry_id, customer, subject, reason, due_at, status,
            notes, created_at, updated_at
          from follow_ups
          where enquiry_id = ${enquiryId}
          order by seq asc
        `);
        return rows.map(toFollowUp);
      }
      if (status !== undefined) {
        const rows = asRows(await db`
          select id, enquiry_id, customer, subject, reason, due_at, status,
            notes, created_at, updated_at
          from follow_ups
          where status = ${status}
          order by seq asc
        `);
        return rows.map(toFollowUp);
      }
      const rows = asRows(await db`
        select id, enquiry_id, customer, subject, reason, due_at, status,
          notes, created_at, updated_at
        from follow_ups
        order by seq asc
      `);
      return rows.map(toFollowUp);
    } catch (error) {
      if (error instanceof FollowUpStoreError) {
        throw error;
      }
      console.error('[followupStore] postgres list failed');
      throw new FollowUpStoreError('Unable to access follow-up storage.');
    }
  }

  async create(input: NewFollowUp): Promise<FollowUp> {
    const followUp = createFollowUp(input);
    try {
      const db = this.db();
      const rows = asRows(await db`
        insert into follow_ups
          (id, enquiry_id, customer, subject, reason, due_at, status, notes,
            created_at, updated_at)
        values
          (${followUp.id}, ${followUp.enquiryId}, ${followUp.customer},
            ${followUp.subject}, ${followUp.reason}, ${followUp.dueAt},
            ${followUp.status}, ${followUp.notes}, ${followUp.createdAt},
            ${followUp.updatedAt})
        returning id, enquiry_id, customer, subject, reason, due_at, status,
          notes, created_at, updated_at
      `);
      const row = rows[0];
      if (row === undefined) {
        throw new FollowUpStoreError('Unable to access follow-up storage.');
      }
      return toFollowUp(row);
    } catch (error) {
      if (error instanceof FollowUpStoreError) {
        throw error;
      }
      console.error('[followupStore] postgres create failed');
      throw new FollowUpStoreError('Unable to access follow-up storage.');
    }
  }

  async update(id: string, patch: FollowUpPatch): Promise<FollowUp | null> {
    if (!UUID_PATTERN.test(id)) {
      return null;
    }
    try {
      const db = this.db();
      const rows = asRows(await db`
        update follow_ups
        set reason = coalesce(${patch.reason ?? null}, reason),
          due_at = coalesce(${patch.dueAt ?? null}, due_at),
          status = coalesce(${patch.status ?? null}, status),
          notes = coalesce(${patch.notes ?? null}, notes),
          updated_at = now()
        where id = ${id}
        returning id, enquiry_id, customer, subject, reason, due_at, status,
          notes, created_at, updated_at
      `);
      const row = rows[0];
      if (row === undefined) {
        return null;
      }
      return toFollowUp(row);
    } catch (error) {
      if (error instanceof FollowUpStoreError) {
        throw error;
      }
      console.error('[followupStore] postgres update failed');
      throw new FollowUpStoreError('Unable to access follow-up storage.');
    }
  }
}

export class InMemoryFollowUpStore implements FollowUpStore {
  private readonly followUps: FollowUp[];

  constructor(seed: FollowUp[] = []) {
    this.followUps = seed.map(copyFollowUp);
  }

  async list(filters: FollowUpFilters = {}): Promise<FollowUp[]> {
    const { enquiryId, status } = filters;
    return this.followUps
      .filter(
        (followUp) =>
          (enquiryId === undefined || followUp.enquiryId === enquiryId) &&
          (status === undefined || followUp.status === status),
      )
      .map(copyFollowUp);
  }

  async create(input: NewFollowUp): Promise<FollowUp> {
    const created = createFollowUp(input);
    this.followUps.push(created);
    return copyFollowUp(created);
  }

  async update(id: string, patch: FollowUpPatch): Promise<FollowUp | null> {
    const index = this.followUps.findIndex((followUp) => followUp.id === id);
    if (index === -1) {
      return null;
    }
    const updated = updateFollowUp(this.followUps[index], patch);
    this.followUps[index] = updated;
    return copyFollowUp(updated);
  }
}
