import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFollowUp,
  isOverdue,
  toFollowUpView,
  updateFollowUp,
  validateFollowUpPatch,
  validateNewFollowUp,
} from './followups.js';
import type { FollowUp } from './followups.js';

function validInput() {
  return {
    enquiryId: 'enq-1',
    customer: 'Amelia Hart',
    subject: 'Quote for 6-month checkup plan',
    reason: 'Send the revised quote.',
    dueAt: '2026-11-05T10:00:00.000Z',
    notes: '',
  };
}

function storedFollowUp(overrides: Partial<FollowUp> = {}): FollowUp {
  return {
    id: 'test-id-1',
    enquiryId: 'enq-1',
    customer: 'Amelia Hart',
    subject: 'Quote for 6-month checkup plan',
    reason: 'Send the revised quote.',
    dueAt: '2026-11-05T10:00:00.000Z',
    status: 'pending',
    notes: '',
    createdAt: '2026-10-30T10:00:00.000Z',
    updatedAt: '2026-10-30T10:00:00.000Z',
    ...overrides,
  };
}

describe('follow-up model and storage', () => {
  it('creates a valid follow-up with generated identity', () => {
    const checked = validateNewFollowUp(validInput());
    if (!checked.ok) {
      assert.fail('expected valid input');
    }
    const created = createFollowUp(checked.value);
    assert.ok(created.id !== '');
    assert.equal(created.status, 'pending');
    assert.equal(created.enquiryId, 'enq-1');
    assert.equal(created.dueAt, '2026-11-05T10:00:00.000Z');
    assert.ok(created.createdAt !== '');
    assert.equal(created.updatedAt, created.createdAt);
  });

  it('rejects invalid new follow-up input', () => {
    const cases: Array<{ label: string; body: unknown }> = [
      { label: 'non-object', body: 'nope' },
      {
        label: 'missing enquiryId',
        body: { ...validInput(), enquiryId: undefined },
      },
      { label: 'empty reason', body: { ...validInput(), reason: '  ' } },
      { label: 'bad dueAt', body: { ...validInput(), dueAt: 'tomorrow' } },
      {
        label: 'over-long customer',
        body: { ...validInput(), customer: 'x'.repeat(201) },
      },
      {
        label: 'over-long notes',
        body: { ...validInput(), notes: 'x'.repeat(4001) },
      },
    ];
    for (const { label, body } of cases) {
      assert.equal(
        validateNewFollowUp(body).ok,
        false,
        `expected rejection for: ${label}`,
      );
    }
  });

  it('rejects overdue as a stored status', () => {
    const checked = validateFollowUpPatch({ status: 'overdue' });
    assert.equal(checked.ok, false);
  });

  it('accepts valid patches and normalizes rescheduled dates', () => {
    const checked = validateFollowUpPatch({
      dueAt: '2026-11-06T15:30:00+02:00',
      notes: 'Customer asked to move it.',
    });
    if (!checked.ok) {
      assert.fail('expected valid patch');
    }
    assert.equal(checked.value.dueAt, '2026-11-06T13:30:00.000Z');
    assert.equal(checked.value.notes, 'Customer asked to move it.');
    assert.equal(validateFollowUpPatch({}).ok, true);
    assert.equal(
      validateFollowUpPatch({ dueAt: 'not a date' }).ok,
      false,
    );
  });

  it('completing preserves notes and rescheduling preserves identity', () => {
    const created = storedFollowUp({ notes: 'Keep me.' });
    const completed = updateFollowUp(created, { status: 'completed' });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.notes, 'Keep me.');
    assert.equal(completed.id, created.id);
    const rescheduled = updateFollowUp(created, {
      dueAt: '2026-12-01T09:00:00.000Z',
    });
    assert.equal(rescheduled.id, created.id);
    assert.equal(rescheduled.dueAt, '2026-12-01T09:00:00.000Z');
    assert.equal(rescheduled.reason, created.reason);
    assert.equal(rescheduled.notes, created.notes);
    assert.ok(rescheduled.updatedAt >= created.updatedAt);
  });

  it('derives overdue dynamically and never stores it', () => {
    const past = '2020-01-01T00:00:00.000Z';
    const future = '2099-01-01T00:00:00.000Z';
    assert.equal(
      isOverdue(storedFollowUp({ dueAt: past, status: 'pending' })),
      true,
    );
    assert.equal(
      isOverdue(storedFollowUp({ dueAt: past, status: 'completed' })),
      false,
    );
    assert.equal(
      isOverdue(storedFollowUp({ dueAt: future, status: 'pending' })),
      false,
    );
    const view = toFollowUpView(storedFollowUp({ dueAt: past }));
    assert.equal(view.overdue, true);
    assert.ok(!('overdue' in storedFollowUp({})));
  });
});
