import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCommitmentSafeguard,
  detectCommitments,
  FALLBACK_DRAFT,
} from './validate.js';
import type {
  AnalyzeEnquiryRequest,
  EnquiryAnalysis,
} from './validate.js';

const NEUTRAL_ENQUIRY: AnalyzeEnquiryRequest = {
  customer: 'Jordan Lee',
  company: 'Harbour Books',
  channel: 'Email',
  subject: 'Question about order #4821',
  summary: 'Customer asks for an update on order #4821 placed last week.',
  received: '1 hour ago',
};

const AUTHORISED_REFUND_ENQUIRY: AnalyzeEnquiryRequest = {
  ...NEUTRAL_ENQUIRY,
  summary:
    'The store manager has approved a full refund for order #4821. ' +
    'Customer asks when it will arrive.',
};

const REQUESTING_REFUND_ENQUIRY: AnalyzeEnquiryRequest = {
  ...NEUTRAL_ENQUIRY,
  summary: 'I would like to request a refund, please approve it.',
};

const CANNOT_APPROVE_ENQUIRY: AnalyzeEnquiryRequest = {
  ...NEUTRAL_ENQUIRY,
  summary: 'The company cannot approve a refund.',
};

const NOT_APPROVED_ENQUIRY: AnalyzeEnquiryRequest = {
  ...NEUTRAL_ENQUIRY,
  summary: 'The refund has not been approved.',
};

const MANAGER_APPROVED_ENQUIRY: AnalyzeEnquiryRequest = {
  ...NEUTRAL_ENQUIRY,
  summary: 'The refund was approved by the authorised manager.',
};

const LIVE_DRAFT =
  'Dear Ms Hart, Thank you for your email about your request for a ' +
  'refund of ₦45,000. To help review your request, please share your ' +
  'payment receipt or transaction reference, the date and method of ' +
  'payment, and details of the service paid for. Once confirmed, and if ' +
  'a refund is approved, we can advise on next steps.';

const LIVE_SENTENCE =
  'Once confirmed, and if a refund is approved, we can advise on next steps.';

const LATEST_SENTENCE = 'If approved, next steps could then be shared.';

const LATEST_DRAFT =
  'Dear Ms Hart, Thank you for contacting Brightline Dental regarding ' +
  'your ₦45,000 payment and your request for a refund due to a change ' +
  'of mind. Could you please share proof of payment such as a receipt ' +
  'or transaction reference with the date and payment method, along ' +
  'with details of the service paid for? Once confirmed, eligibility ' +
  'would depend on the applicable policy. If approved, next steps ' +
  'could then be shared. Thank you for your understanding. Kind ' +
  'regards, Brightline Dental';

const SAFE_ELIGIBILITY_SENTENCE =
  'Once confirmed, eligibility would depend on the applicable policy.';

const AUTHORISED_SHARE_STEPS_ENQUIRY: AnalyzeEnquiryRequest = {
  ...NEUTRAL_ENQUIRY,
  summary:
    'The support team agreed to share the next steps with the customer.',
};

const REQUESTING_STEPS_ENQUIRY: AnalyzeEnquiryRequest = {
  ...NEUTRAL_ENQUIRY,
  summary:
    'I would like to request the next steps, please share them with me.',
};

const BOOKING_SENTENCE =
  'Once availability is confirmed, we can share what options there are.';

const BOOKING_AVAILABLE_OPTIONS =
  'Once availability is confirmed, we can share the available options.';

const AUTHORISED_SHARE_OPTIONS_ENQUIRY: AnalyzeEnquiryRequest = {
  ...NEUTRAL_ENQUIRY,
  summary:
    'The manager approved sharing appointment options with the customer.',
};

const REQUESTING_OPTIONS_ENQUIRY: AnalyzeEnquiryRequest = {
  ...NEUTRAL_ENQUIRY,
  summary:
    'I would like to request the available options, please share them.',
};

function makeAnalysis(draftResponse: string): EnquiryAnalysis {
  return {
    missingInfo: ['Order number'],
    nextAction: 'Confirm the order status with the fulfilment team.',
    actionReason: 'The current status is unknown.',
    draftResponse,
    needsHuman: true,
    uncertain: false,
  };
}

function enquiryText(enquiry: AnalyzeEnquiryRequest): string {
  return [
    enquiry.customer,
    enquiry.company,
    enquiry.channel,
    enquiry.subject,
    enquiry.summary,
    enquiry.received,
  ].join('\n');
}

describe('commitment detector', () => {
  it('A: flags a conditional refund commitment', () => {
    const draft =
      'Once confirmed, I will share the outcome and, if approved, the next steps.';
    const findings = detectCommitments(draft, enquiryText(NEUTRAL_ENQUIRY));
    assert.ok(findings.length > 0, 'expected at least one finding');
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(draft),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
    assert.equal(guarded.uncertain, true);
    assert.equal(guarded.needsHuman, true);
  });

  it('B: flags an investigate and follow-up commitment', () => {
    const draft =
      'I will investigate your order and follow up with an update tomorrow.';
    const findings = detectCommitments(draft, enquiryText(NEUTRAL_ENQUIRY));
    assert.ok(
      findings.some((finding) => finding.category === 'investigate'),
      'expected an investigate finding',
    );
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(draft),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
    assert.equal(guarded.uncertain, true);
  });

  it('C: flags an unauthorised passive refund promise', () => {
    const draft = 'Your refund will be processed within five working days.';
    const findings = detectCommitments(draft, enquiryText(NEUTRAL_ENQUIRY));
    assert.ok(
      findings.some((finding) => finding.category === 'refund'),
      'expected a refund finding',
    );
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(draft),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
  });

  it('D: allows a safe information request', () => {
    const draft =
      'Could you please provide your transaction reference and payment date?';
    const findings = detectCommitments(draft, enquiryText(NEUTRAL_ENQUIRY));
    assert.equal(findings.length, 0);
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(draft),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, draft);
    assert.equal(guarded.uncertain, false);
  });

  it('E: allows a safe uncertainty statement', () => {
    const draft = 'Refund eligibility has not yet been confirmed.';
    const findings = detectCommitments(draft, enquiryText(NEUTRAL_ENQUIRY));
    assert.equal(findings.length, 0);
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(draft),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, draft);
  });

  it('F: excuses an explicitly authorised refund', () => {
    const draft = 'Your refund will be processed within five working days.';
    const findings = detectCommitments(
      draft,
      enquiryText(AUTHORISED_REFUND_ENQUIRY),
    );
    assert.equal(findings.length, 0);
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(draft),
      AUTHORISED_REFUND_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, draft);
  });

  it('F2: treats a customer refund request as not authorised', () => {
    const draft = 'Your refund will be processed within five working days.';
    const findings = detectCommitments(
      draft,
      enquiryText(REQUESTING_REFUND_ENQUIRY),
    );
    assert.ok(findings.length > 0, 'expected at least one finding');
  });

  it('F3: does not let refund authorisation excuse a dispatch promise', () => {
    const draft = 'I will dispatch a replacement tomorrow.';
    const findings = detectCommitments(
      draft,
      enquiryText(AUTHORISED_REFUND_ENQUIRY),
    );
    assert.ok(
      findings.some((finding) => finding.category === 'dispatch'),
      'expected a dispatch finding',
    );
  });

  it('allows polite acknowledgement without a commitment frame', () => {
    const draft =
      'Thank you for contacting us. I understand this is frustrating.';
    const findings = detectCommitments(draft, enquiryText(NEUTRAL_ENQUIRY));
    assert.equal(findings.length, 0);
  });

  it('allows a permission-seeking question', () => {
    const draft = 'May I check your order number?';
    const findings = detectCommitments(draft, enquiryText(NEUTRAL_ENQUIRY));
    assert.equal(findings.length, 0);
  });

  it('fallback draft is itself free of commitments', () => {
    const findings = detectCommitments(
      FALLBACK_DRAFT,
      enquiryText(NEUTRAL_ENQUIRY),
    );
    assert.equal(findings.length, 0);
  });

  it('preserves the six-field response structure', () => {
    const draft =
      'Once confirmed, I will share the outcome and, if approved, the next steps.';
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(draft),
      NEUTRAL_ENQUIRY,
    );
    assert.deepEqual(Object.keys(guarded).sort(), [
      'actionReason',
      'draftResponse',
      'missingInfo',
      'needsHuman',
      'nextAction',
      'uncertain',
    ]);
  });

  it('R1: flags the exact live sentence', () => {
    const findings = detectCommitments(
      LIVE_SENTENCE,
      enquiryText(NEUTRAL_ENQUIRY),
    );
    assert.ok(findings.length > 0, 'expected at least one finding');
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(LIVE_SENTENCE),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
    assert.equal(guarded.uncertain, true);
    assert.equal(guarded.needsHuman, true);
  });

  it('R2: flags the complete live refund draft', () => {
    const findings = detectCommitments(
      LIVE_DRAFT,
      enquiryText(NEUTRAL_ENQUIRY),
    );
    assert.ok(findings.length > 0, 'expected at least one finding');
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(LIVE_DRAFT),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
    assert.equal(guarded.uncertain, true);
    assert.equal(guarded.needsHuman, true);
  });

  it('R3: flags first-person can with an outcome action', () => {
    const draft = 'I can confirm the outcome.';
    const findings = detectCommitments(draft, enquiryText(NEUTRAL_ENQUIRY));
    assert.ok(
      findings.some((finding) => finding.category === 'outcome'),
      'expected an outcome finding',
    );
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(draft),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
  });

  it('R4: flags first-person can with an inform action', () => {
    const draft = 'We can inform you of the decision.';
    const findings = detectCommitments(draft, enquiryText(NEUTRAL_ENQUIRY));
    assert.ok(
      findings.some((finding) => finding.category === 'followup'),
      'expected a followup finding',
    );
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(draft),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
  });

  it('R5: keeps second-person can instructions safe', () => {
    const draft = 'You can provide your payment receipt.';
    const findings = detectCommitments(draft, enquiryText(NEUTRAL_ENQUIRY));
    assert.equal(findings.length, 0);
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(draft),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, draft);
    assert.equal(guarded.uncertain, false);
  });

  it('R6: flags an unsupported refund approval claim', () => {
    const draft = 'Your refund is approved.';
    const findings = detectCommitments(draft, enquiryText(NEUTRAL_ENQUIRY));
    assert.ok(
      findings.some((finding) => finding.category === 'refund'),
      'expected a refund finding',
    );
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(draft),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
  });

  it('R7: flags an unsupported resolved claim', () => {
    const draft = 'Your issue is resolved.';
    const findings = detectCommitments(draft, enquiryText(NEUTRAL_ENQUIRY));
    assert.ok(
      findings.some((finding) => finding.category === 'resolve'),
      'expected a resolve finding',
    );
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(draft),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
  });

  it('R8: cannot-approve does not authorise a refund', () => {
    const draft = 'Your refund will be processed within five working days.';
    const findings = detectCommitments(
      draft,
      enquiryText(CANNOT_APPROVE_ENQUIRY),
    );
    assert.ok(findings.length > 0, 'expected at least one finding');
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(draft),
      CANNOT_APPROVE_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
  });

  it('R9: not-approved does not authorise a refund', () => {
    const draft = 'Your refund will be processed within five working days.';
    const findings = detectCommitments(
      draft,
      enquiryText(NOT_APPROVED_ENQUIRY),
    );
    assert.ok(findings.length > 0, 'expected at least one finding');
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(draft),
      NOT_APPROVED_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
  });

  it('R10: manager-approved refund still excuses the claim', () => {
    const draft = 'Your refund is approved.';
    const findings = detectCommitments(
      draft,
      enquiryText(MANAGER_APPROVED_ENQUIRY),
    );
    assert.equal(findings.length, 0);
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(draft),
      MANAGER_APPROVED_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, draft);
  });

  it('R11: refund authorisation does not excuse dispatch', () => {
    const draft = 'I will dispatch a replacement tomorrow.';
    const findings = detectCommitments(
      draft,
      enquiryText(AUTHORISED_REFUND_ENQUIRY),
    );
    assert.ok(
      findings.some((finding) => finding.category === 'dispatch'),
      'expected a dispatch finding',
    );
  });

  it('flags other unsupported present-passive claims', () => {
    const drafts = [
      'Your payment is processed.',
      'Your replacement is dispatched.',
      'Your order is delivered.',
    ];
    for (const draft of drafts) {
      const findings = detectCommitments(draft, enquiryText(NEUTRAL_ENQUIRY));
      assert.ok(findings.length > 0, `expected a finding for: ${draft}`);
      const guarded = applyCommitmentSafeguard(
        makeAnalysis(draft),
        NEUTRAL_ENQUIRY,
      );
      assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
    }
  });

  it('manager denial does not authorise a refund', () => {
    const draft = 'Your refund will be processed within five working days.';
    const enquiry: AnalyzeEnquiryRequest = {
      ...NEUTRAL_ENQUIRY,
      summary: 'The manager has not approved the refund.',
    };
    const findings = detectCommitments(draft, enquiryText(enquiry));
    assert.ok(findings.length > 0, 'expected at least one finding');
  });

  it('D1: flags the exact discuss live sentence', () => {
    const draft =
      'Once this information is available and eligibility is confirmed, ' +
      'if approved we can discuss next steps.';
    const findings = detectCommitments(draft, enquiryText(NEUTRAL_ENQUIRY));
    assert.ok(findings.length > 0, 'expected at least one finding');
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(draft),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
    assert.equal(guarded.uncertain, true);
    assert.equal(guarded.needsHuman, true);
  });

  it('D2: flags will-frame discuss commitments', () => {
    const draft = 'I will discuss next steps';
    const findings = detectCommitments(draft, enquiryText(NEUTRAL_ENQUIRY));
    assert.ok(
      findings.some((finding) => finding.category === 'followup'),
      'expected a followup finding',
    );
  });

  it('D3: flags unauthorised can-frame discuss commitments', () => {
    const draft = 'We can discuss the refund';
    const findings = detectCommitments(draft, enquiryText(NEUTRAL_ENQUIRY));
    assert.ok(findings.length > 0, 'expected at least one finding');
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(draft),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
  });

  it('D4: allows an explicitly authorised discussion', () => {
    const draft = 'We can discuss the next steps with you.';
    const enquiry: AnalyzeEnquiryRequest = {
      ...NEUTRAL_ENQUIRY,
      summary: 'The support team agreed to discuss repayment options.',
    };
    const findings = detectCommitments(draft, enquiryText(enquiry));
    assert.equal(findings.length, 0);
    const guarded = applyCommitmentSafeguard(makeAnalysis(draft), enquiry);
    assert.equal(guarded.draftResponse, draft);
  });

  it('D5: keeps second-person discuss suggestions safe', () => {
    const draft = 'You can discuss this with your bank.';
    const findings = detectCommitments(draft, enquiryText(NEUTRAL_ENQUIRY));
    assert.equal(findings.length, 0);
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(draft),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, draft);
    assert.equal(guarded.uncertain, false);
  });

  it('P1: flags the exact conditional passive sentence', () => {
    const findings = detectCommitments(
      LATEST_SENTENCE,
      enquiryText(NEUTRAL_ENQUIRY),
    );
    assert.ok(
      findings.some((finding) => finding.category === 'outcome'),
      'expected an outcome finding',
    );
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(LATEST_SENTENCE),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
    assert.equal(guarded.uncertain, true);
    assert.equal(guarded.needsHuman, true);
  });

  it('P2: flags the complete latest refund draft', () => {
    const findings = detectCommitments(
      LATEST_DRAFT,
      enquiryText(NEUTRAL_ENQUIRY),
    );
    assert.ok(findings.length > 0, 'expected at least one finding');
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(LATEST_DRAFT),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
    assert.equal(guarded.uncertain, true);
    assert.equal(guarded.needsHuman, true);
  });

  it('P3: keeps the eligibility uncertainty sentence safe', () => {
    const findings = detectCommitments(
      SAFE_ELIGIBILITY_SENTENCE,
      enquiryText(NEUTRAL_ENQUIRY),
    );
    assert.equal(findings.length, 0);
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(SAFE_ELIGIBILITY_SENTENCE),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, SAFE_ELIGIBILITY_SENTENCE);
    assert.equal(guarded.uncertain, false);
  });

  it('P4: flags first-person conditional share commitments', () => {
    const drafts = [
      'We could share next steps',
      'We would share next steps',
    ];
    for (const draft of drafts) {
      const findings = detectCommitments(draft, enquiryText(NEUTRAL_ENQUIRY));
      assert.ok(
        findings.some((finding) => finding.category === 'outcome'),
        `expected an outcome finding for: ${draft}`,
      );
      const guarded = applyCommitmentSafeguard(
        makeAnalysis(draft),
        NEUTRAL_ENQUIRY,
      );
      assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
    }
  });

  it('P5: flags will-frame share next steps', () => {
    const draft = 'Next steps will be shared.';
    const findings = detectCommitments(draft, enquiryText(NEUTRAL_ENQUIRY));
    assert.ok(
      findings.some((finding) => finding.category === 'outcome'),
      'expected an outcome finding',
    );
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(draft),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
  });

  it('P6: keeps second-person could instructions safe', () => {
    const draft = 'You could provide your receipt.';
    const findings = detectCommitments(draft, enquiryText(NEUTRAL_ENQUIRY));
    assert.equal(findings.length, 0);
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(draft),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, draft);
    assert.equal(guarded.uncertain, false);
  });

  it('P7: keeps share receipt questions safe', () => {
    const draft = 'Could you please share your receipt?';
    const findings = detectCommitments(draft, enquiryText(NEUTRAL_ENQUIRY));
    assert.equal(findings.length, 0);
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(draft),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, draft);
    assert.equal(guarded.uncertain, false);
  });

  it('P8: refund authorisation does not excuse share next steps', () => {
    const findings = detectCommitments(
      LATEST_SENTENCE,
      enquiryText(AUTHORISED_REFUND_ENQUIRY),
    );
    assert.ok(
      findings.some((finding) => finding.category === 'outcome'),
      'expected an outcome finding',
    );
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(LATEST_SENTENCE),
      AUTHORISED_REFUND_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
  });

  it('P9: explicit share next steps authorisation excuses the outcome', () => {
    const findings = detectCommitments(
      LATEST_SENTENCE,
      enquiryText(AUTHORISED_SHARE_STEPS_ENQUIRY),
    );
    assert.equal(findings.length, 0);
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(LATEST_SENTENCE),
      AUTHORISED_SHARE_STEPS_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, LATEST_SENTENCE);
  });

  it('P10: customer request for next steps is not authorisation', () => {
    const findings = detectCommitments(
      LATEST_SENTENCE,
      enquiryText(REQUESTING_STEPS_ENQUIRY),
    );
    assert.ok(findings.length > 0, 'expected at least one finding');
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(LATEST_SENTENCE),
      REQUESTING_STEPS_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
  });

  it('Q1: flags the exact booking availability sentence', () => {
    const findings = detectCommitments(
      BOOKING_SENTENCE,
      enquiryText(NEUTRAL_ENQUIRY),
    );
    assert.ok(
      findings.some((finding) => finding.category === 'outcome'),
      'expected an outcome finding',
    );
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(BOOKING_SENTENCE),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
    assert.equal(guarded.uncertain, true);
    assert.equal(guarded.needsHuman, true);
  });

  it('Q2: flags sharing the available options', () => {
    const findings = detectCommitments(
      BOOKING_AVAILABLE_OPTIONS,
      enquiryText(NEUTRAL_ENQUIRY),
    );
    assert.ok(
      findings.some((finding) => finding.category === 'outcome'),
      'expected an outcome finding',
    );
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(BOOKING_AVAILABLE_OPTIONS),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
  });

  it('Q3: flags a plain share the options commitment', () => {
    const draft = 'We can share the options.';
    const findings = detectCommitments(draft, enquiryText(NEUTRAL_ENQUIRY));
    assert.ok(
      findings.some((finding) => finding.category === 'outcome'),
      'expected an outcome finding',
    );
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(draft),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
  });

  it('Q4: keeps flagging discuss appointment times', () => {
    const draft = 'We can discuss the available appointment times.';
    const findings = detectCommitments(draft, enquiryText(NEUTRAL_ENQUIRY));
    assert.ok(
      findings.some((finding) => finding.category === 'followup'),
      'expected a followup finding',
    );
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(draft),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
  });

  it('Q5: keeps time-suitability questions safe', () => {
    const draft = 'Could you let us know what time suits you?';
    const findings = detectCommitments(draft, enquiryText(NEUTRAL_ENQUIRY));
    assert.equal(findings.length, 0);
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(draft),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, draft);
    assert.equal(guarded.uncertain, false);
  });

  it('Q6: keeps unconfirmed availability statements safe', () => {
    const draft = 'Availability has not yet been confirmed.';
    const findings = detectCommitments(draft, enquiryText(NEUTRAL_ENQUIRY));
    assert.equal(findings.length, 0);
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(draft),
      NEUTRAL_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, draft);
    assert.equal(guarded.uncertain, false);
  });

  it('Q7: refund authorisation does not excuse sharing options', () => {
    const findings = detectCommitments(
      BOOKING_SENTENCE,
      enquiryText(AUTHORISED_REFUND_ENQUIRY),
    );
    assert.ok(
      findings.some((finding) => finding.category === 'outcome'),
      'expected an outcome finding',
    );
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(BOOKING_SENTENCE),
      AUTHORISED_REFUND_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
  });

  it('Q8: explicit share options authorisation excuses the outcome', () => {
    const findings = detectCommitments(
      BOOKING_SENTENCE,
      enquiryText(AUTHORISED_SHARE_OPTIONS_ENQUIRY),
    );
    assert.equal(findings.length, 0);
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(BOOKING_SENTENCE),
      AUTHORISED_SHARE_OPTIONS_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, BOOKING_SENTENCE);
  });

  it('Q9: customer request for options is not authorisation', () => {
    const findings = detectCommitments(
      BOOKING_SENTENCE,
      enquiryText(REQUESTING_OPTIONS_ENQUIRY),
    );
    assert.ok(findings.length > 0, 'expected at least one finding');
    const guarded = applyCommitmentSafeguard(
      makeAnalysis(BOOKING_SENTENCE),
      REQUESTING_OPTIONS_ENQUIRY,
    );
    assert.equal(guarded.draftResponse, FALLBACK_DRAFT);
  });
});
