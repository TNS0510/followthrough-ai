import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ValidationResult } from './validate.js';

// Follow-up tracking: data model, validation and JSON storage.
//
// Enquiry linkage is best-effort: enquiries currently exist only as
// frontend sample data (see the hardcoded list in src/App.tsx), so the
// backend has no enquiry registry to validate against. Each follow-up
// stores the enquiryId supplied by the client plus a denormalized
// customer/subject snapshot captured at creation.
//
// Status is only ever 'pending' or 'completed'. 'overdue' is derived at
// read time (past dueAt and not completed) and must never be stored.

export type FollowUpStatus = 'pending' | 'completed';

export interface FollowUp {
  id: string;
  enquiryId: string;
  customer: string;
  subject: string;
  reason: string;
  dueAt: string;
  status: FollowUpStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface FollowUpView extends FollowUp {
  overdue: boolean;
}

export interface NewFollowUp {
  enquiryId: string;
  customer: string;
  subject: string;
  reason: string;
  dueAt: string;
  notes: string;
}

export interface FollowUpPatch {
  reason?: string;
  dueAt?: string;
  status?: FollowUpStatus;
  notes?: string;
}

const MAX_ENQUIRY_ID = 100;
const MAX_CUSTOMER = 200;
const MAX_SUBJECT = 300;
const MAX_REASON = 2000;
const MAX_NOTES = 4000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequired(
  source: Record<string, unknown>,
  name: string,
  max: number,
): string | null {
  const raw = source[name];
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.length > max) {
    return null;
  }
  return trimmed;
}

function normalizeDueAt(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) {
    return null;
  }
  return new Date(ms).toISOString();
}

export function validateNewFollowUp(
  body: unknown,
): ValidationResult<NewFollowUp> {
  if (!isRecord(body)) {
    return { ok: false, error: 'Follow-up body must be a JSON object.' };
  }
  const enquiryId = readRequired(body, 'enquiryId', MAX_ENQUIRY_ID);
  const customer = readRequired(body, 'customer', MAX_CUSTOMER);
  const subject = readRequired(body, 'subject', MAX_SUBJECT);
  const reason = readRequired(body, 'reason', MAX_REASON);
  if (
    enquiryId === null ||
    customer === null ||
    subject === null ||
    reason === null
  ) {
    return {
      ok: false,
      error:
        'Fields enquiryId, customer, subject and reason must be non-empty ' +
        'strings within their length limits.',
    };
  }
  const dueAt = normalizeDueAt(body['dueAt']);
  if (dueAt === null) {
    return {
      ok: false,
      error: 'Field dueAt must be a valid date-time string.',
    };
  }
  const notesRaw = body['notes'];
  if (
    notesRaw !== undefined &&
    (typeof notesRaw !== 'string' || notesRaw.trim().length > MAX_NOTES)
  ) {
    return {
      ok: false,
      error: 'Field notes must be a string of 4000 characters or fewer.',
    };
  }
  return {
    ok: true,
    value: {
      enquiryId,
      customer,
      subject,
      reason,
      dueAt,
      notes: typeof notesRaw === 'string' ? notesRaw.trim() : '',
    },
  };
}

export function validateFollowUpPatch(
  body: unknown,
): ValidationResult<FollowUpPatch> {
  if (!isRecord(body)) {
    return { ok: false, error: 'Follow-up patch body must be a JSON object.' };
  }
  const patch: FollowUpPatch = {};
  if (body['reason'] !== undefined) {
    const reason = readRequired(body, 'reason', MAX_REASON);
    if (reason === null) {
      return {
        ok: false,
        error:
          'Field reason must be a non-empty string of 2000 characters or fewer.',
      };
    }
    patch.reason = reason;
  }
  if (body['dueAt'] !== undefined) {
    const dueAt = normalizeDueAt(body['dueAt']);
    if (dueAt === null) {
      return {
        ok: false,
        error: 'Field dueAt must be a valid date-time string.',
      };
    }
    patch.dueAt = dueAt;
  }
  if (body['status'] !== undefined) {
    const status = body['status'];
    if (status !== 'pending' && status !== 'completed') {
      return {
        ok: false,
        error: "Field status must be 'pending' or 'completed'.",
      };
    }
    patch.status = status;
  }
  if (body['notes'] !== undefined) {
    const raw = body['notes'];
    if (typeof raw !== 'string' || raw.trim().length > MAX_NOTES) {
      return {
        ok: false,
        error: 'Field notes must be a string of 4000 characters or fewer.',
      };
    }
    patch.notes = raw.trim();
  }
  return { ok: true, value: patch };
}

export function createFollowUp(input: NewFollowUp): FollowUp {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    enquiryId: input.enquiryId,
    customer: input.customer,
    subject: input.subject,
    reason: input.reason,
    dueAt: input.dueAt,
    status: 'pending',
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateFollowUp(
  existing: FollowUp,
  patch: FollowUpPatch,
): FollowUp {
  return {
    ...existing,
    ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
    ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    updatedAt: new Date().toISOString(),
  };
}

export function isOverdue(
  followUp: Pick<FollowUp, 'dueAt' | 'status'>,
  nowMs: number = Date.now(),
): boolean {
  return (
    followUp.status !== 'completed' && Date.parse(followUp.dueAt) < nowMs
  );
}

export function toFollowUpView(
  followUp: FollowUp,
  nowMs: number = Date.now(),
): FollowUpView {
  return { ...followUp, overdue: isOverdue(followUp, nowMs) };
}

export class FollowUpStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FollowUpStoreError';
  }
}

export function defaultStorePath(): string {
  return join(process.cwd(), 'data', 'followups.json');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function storedString(
  value: Record<string, unknown>,
  field: string,
  index: number,
): string {
  const raw = value[field];
  if (typeof raw !== 'string') {
    throw new FollowUpStoreError(
      `Follow-up store is corrupted: record ${index} has an invalid '${field}'.`,
    );
  }
  return raw;
}

function assertStoredFollowUp(value: unknown, index: number): FollowUp {
  if (!isRecord(value)) {
    throw new FollowUpStoreError(
      `Follow-up store is corrupted: record ${index} is not an object.`,
    );
  }
  const status = storedString(value, 'status', index);
  if (status !== 'pending' && status !== 'completed') {
    throw new FollowUpStoreError(
      `Follow-up store is corrupted: record ${index} has an invalid status.`,
    );
  }
  const dueAt = storedString(value, 'dueAt', index);
  if (Number.isNaN(Date.parse(dueAt))) {
    throw new FollowUpStoreError(
      `Follow-up store is corrupted: record ${index} has an invalid dueAt.`,
    );
  }
  return {
    id: storedString(value, 'id', index),
    enquiryId: storedString(value, 'enquiryId', index),
    customer: storedString(value, 'customer', index),
    subject: storedString(value, 'subject', index),
    reason: storedString(value, 'reason', index),
    dueAt,
    status,
    notes: storedString(value, 'notes', index),
    createdAt: storedString(value, 'createdAt', index),
    updatedAt: storedString(value, 'updatedAt', index),
  };
}

export function loadFollowUps(storePath: string): FollowUp[] {
  let raw: string;
  try {
    raw = readFileSync(storePath, 'utf8');
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw new FollowUpStoreError(
      `Could not read follow-up store: ${errorMessage(error)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new FollowUpStoreError(
      'Follow-up store is corrupted: file does not contain valid JSON.',
    );
  }
  if (!Array.isArray(parsed)) {
    throw new FollowUpStoreError(
      'Follow-up store is corrupted: file does not contain a list.',
    );
  }
  return parsed.map((item, index) => assertStoredFollowUp(item, index));
}

export function saveFollowUps(
  storePath: string,
  followUps: FollowUp[],
): void {
  try {
    mkdirSync(dirname(storePath), { recursive: true });
    const tmpPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(followUps, null, 2), 'utf8');
    renameSync(tmpPath, storePath);
  } catch (error) {
    throw new FollowUpStoreError(
      `Could not save follow-up store: ${errorMessage(error)}`,
    );
  }
}
