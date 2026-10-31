export interface AnalyzeEnquiryRequest {
  customer: string;
  company: string;
  channel: string;
  subject: string;
  summary: string;
  received: string;
}

export interface EnquiryAnalysis {
  missingInfo: string[];
  nextAction: string;
  actionReason: string;
  draftResponse: string;
  needsHuman: boolean;
  uncertain: boolean;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const MAX_SHORT_FIELD = 200;
const MAX_SUBJECT = 300;
const MAX_SUMMARY = 4000;
const MAX_MISSING_ITEMS = 20;
const MAX_MISSING_ITEM = 300;
const MAX_ANALYSIS_TEXT = 4000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringField(
  source: Record<string, unknown>,
  name: string,
): string | null {
  const raw = source[name];
  if (typeof raw !== 'string') {
    return null;
  }
  return raw.trim();
}

export function validateAnalyzeRequest(
  body: unknown,
): ValidationResult<AnalyzeEnquiryRequest> {
  if (!isRecord(body)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const customer = readStringField(body, 'customer');
  const company = readStringField(body, 'company');
  const channel = readStringField(body, 'channel');
  const subject = readStringField(body, 'subject');
  const summary = readStringField(body, 'summary');
  const received = readStringField(body, 'received');
  if (
    customer === null ||
    company === null ||
    channel === null ||
    subject === null ||
    summary === null ||
    received === null
  ) {
    return {
      ok: false,
      error:
        'Fields customer, company, channel, subject, summary and received must all be strings.',
    };
  }
  if (customer === '' || subject === '' || summary === '') {
    return {
      ok: false,
      error: 'Fields customer, subject and summary must not be empty.',
    };
  }
  if (
    customer.length > MAX_SHORT_FIELD ||
    company.length > MAX_SHORT_FIELD ||
    channel.length > MAX_SHORT_FIELD ||
    received.length > MAX_SHORT_FIELD
  ) {
    return {
      ok: false,
      error:
        'Customer, company, channel and received must each be 200 characters or fewer.',
    };
  }
  if (subject.length > MAX_SUBJECT) {
    return {
      ok: false,
      error: 'Subject must be 300 characters or fewer.',
    };
  }
  if (summary.length > MAX_SUMMARY) {
    return {
      ok: false,
      error: 'Summary must be 4000 characters or fewer.',
    };
  }
  return {
    ok: true,
    value: { customer, company, channel, subject, summary, received },
  };
}

function readNonEmptyString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > max) {
    return null;
  }
  return trimmed;
}

export function validateAnalysis(
  data: unknown,
): ValidationResult<EnquiryAnalysis> {
  if (!isRecord(data)) {
    return { ok: false, error: 'Model output must be a JSON object.' };
  }
  const missingInfoRaw = data['missingInfo'];
  if (!Array.isArray(missingInfoRaw) || missingInfoRaw.length > MAX_MISSING_ITEMS) {
    return {
      ok: false,
      error: 'Model output field missingInfo must be an array of at most 20 strings.',
    };
  }
  const missingInfo: string[] = [];
  for (const item of missingInfoRaw) {
    const text = readNonEmptyString(item, MAX_MISSING_ITEM);
    if (text === null) {
      return {
        ok: false,
        error:
          'Model output field missingInfo must contain only non-empty strings.',
      };
    }
    missingInfo.push(text);
  }
  const nextAction = readNonEmptyString(data['nextAction'], MAX_ANALYSIS_TEXT);
  const actionReason = readNonEmptyString(data['actionReason'], MAX_ANALYSIS_TEXT);
  const draftResponse = readNonEmptyString(
    data['draftResponse'],
    MAX_ANALYSIS_TEXT,
  );
  if (nextAction === null || actionReason === null || draftResponse === null) {
    return {
      ok: false,
      error:
        'Model output fields nextAction, actionReason and draftResponse must be non-empty strings.',
    };
  }
  const needsHuman = data['needsHuman'];
  const uncertain = data['uncertain'];
  if (typeof needsHuman !== 'boolean' || typeof uncertain !== 'boolean') {
    return {
      ok: false,
      error:
        'Model output fields needsHuman and uncertain must be booleans.',
    };
  }
  return {
    ok: true,
    value: {
      missingInfo,
      nextAction,
      actionReason,
      draftResponse,
      needsHuman: true,
      uncertain,
    },
  };
}

export type CommitCategory =
  | 'contact'
  | 'investigate'
  | 'followup'
  | 'refund'
  | 'dispatch'
  | 'resolve'
  | 'outcome';

export interface CommitFinding {
  category: CommitCategory;
  sentence: string;
}

const COMMIT_CATEGORIES: CommitCategory[] = [
  'contact',
  'investigate',
  'followup',
  'refund',
  'dispatch',
  'resolve',
  'outcome',
];

// A keyword alone never flags. A clause flags only when a commitment frame
// (first-person future, passive future, or asserted status) appears together
// with an action keyword. Conditional wording ("once confirmed", "if
// approved") does not excuse a commitment. Bare "can" counts only with a
// first-person subject ("I can", "we can"); second-person "you can" stays safe.
const COMMITMENT_FRAMES: RegExp[] = [
  /\b(i|we)\s+(will|shall)\b/i,
  /\b(i|we)\s+can\b/i,
  /\b(i|we)\s+(could|would)\b/i,
  /\b(i|we)'ll\b/i,
  /\bi\s*(am|'m)\s+going\s+to\b/i,
  /\bwe\s*(are|'re)\s+going\s+to\b/i,
  /\b(i|we)\s+(promise|promises|guarantee|guarantees|assure|assures)\b/i,
  /\bwill\s+be\b/i,
  /\bshall\s+be\b/i,
  /\b(could|would)\s+(then\s+)?be\b/i,
  /\bgoing\s+to\s+be\b/i,
  /\bcan\s+be\s+(processed|issued|dispatched|delivered|shipped|sent|refunded|resolved|arranged)\b/i,
  /\b(have|has)\s+been\s+(processed|issued|dispatched|delivered|shipped|sent|shared|confirmed|approved|resolved|settled|refunded|completed)\b/i,
  /\b(is|are)\s+being\s+(processed|issued|dispatched|delivered|shipped|investigated|reviewed|resolved|handled|prepared)\b/i,
  /\b(is|are)\s+(approved|confirmed|resolved|processed|dispatched|delivered|refunded|issued|completed|settled|shipped|sent)\b/i,
];

const COMMIT_KEYWORDS: Record<CommitCategory, RegExp[]> = {
  contact: [
    /\bcall\b/i,
    /\bcontact\w*\b/i,
    /\bphone\b/i,
    /\bin\s+touch\b/i,
    /\breach\s+out\b/i,
  ],
  investigate: [
    /\binvestigat\w*\b/i,
    /\blook\s+into\b/i,
    /\blook\s+at\b/i,
    /\bcheck\b/i,
  ],
  followup: [
    /\bfollow[\s-]*up\b/i,
    /\bupdate\b/i,
    /\bkeep\s+you\s+(posted|informed|updated)\b/i,
    /\bget\s+back\s+to\s+you\b/i,
    /\blet\s+you\s+know\b/i,
    /\bnotif\w*\b/i,
    /\badvis(e|es|ed|ing)\b/i,
    /\binform(s|ed|ing)?\b/i,
    /\bdiscuss\w*\b/i,
  ],
  refund: [
    /\brefund\w*\b/i,
    /\breimburs\w*\b/i,
    /\bmoney\s+back\b/i,
    /\bprocess\w*\b/i,
  ],
  dispatch: [
    /\bdispatch\w*\b/i,
    /\bdeliver\w*\b/i,
    /\bship\w*\b/i,
    /\bsend\b[^,;.]{0,30}\b(order|item|replacement|parcel|package|goods)\b/i,
    /\bcourier\b/i,
  ],
  resolve: [
    /\bresolv\w*\b/i,
    /\bfix\b/i,
    /\bsort\w*\s+out\b/i,
    /\bsettl\w*\b/i,
    /\bput\b.{0,15}\bright\b/i,
    /\bmake\s+(this|it|things)\s+right\b/i,
    /\brectif\w*\b/i,
  ],
  outcome: [
    /\bshar\w*\b.{0,40}\b(outcome|result|decision|finding|conclusion|next\s+steps?|options?)\b/i,
    /\b(outcome|result|decision|finding|conclusion|next\s+steps?|options?)\b.{0,40}\bshar\w*\b/i,
    /\bconfirm\w*\b.{0,40}\b(outcome|decision|result|approval|resolution)\b/i,
  ],
};

const NEGATED_CLAUSE =
  /\b(will\s+not|won't|shall\s+not|shan't|will\s+never|cannot|can\s+not|can't|could\s+not|couldn't|unable\s+to)\b/i;

// Authorisation must be explicit and business-side: a business actor plus a
// decided approval verb plus the authorised action, all in one enquiry
// sentence. Customer requests never count.
const BUSINESS_ACTORS =
  /\b(manager|supervisor|team\s+lead|head\s+office|support\s+team|customer\s+service(\s+team)?|service\s+team|our\s+team|the\s+team|business|company|store|branch|department|management|director)\b/i;

const APPROVAL_VERBS =
  /\b(approv\w+|authori[sz]\w+|sanction\w+|signed\s+off|agreed|confirm\w+)\b/i;

const UNDECIDED_MARKERS =
  /\b(will|shall|may|might|can|could|should|would|plan\s+to|going\s+to|need\s+to|needs\s+to|want\s+to|wants\s+to|ask\w*|request\w*|seek\w*)\b/i;

const DENIAL_MARKERS = /\b(not|never|n't|without|no|cannot)\b/i;

const AUTH_KEYWORDS: Record<CommitCategory, RegExp> = {
  contact: /\b(call|contact|phone)\b/i,
  investigate: /\b(investigat\w+|check|look into|review)\b/i,
  followup: /\b(follow[\s-]*up|update|inform|notify|get back|discuss)\b/i,
  refund: /\b(refund|reimburs\w+|money back)\b/i,
  dispatch: /\b(dispatch|deliver\w+|ship\w+|send|courier|replacement)\b/i,
  resolve: /\b(resolv\w+|fix|settl\w+|sort out|put right|rectif\w+)\b/i,
  outcome: /\b(outcome|decision|result|approval|next\s+steps?|options?)\b/i,
};

export const FALLBACK_DRAFT =
  'Thank you for contacting us. Your enquiry has been received and is ' +
  'awaiting review. No decision has been made yet. If you have a reference ' +
  'number or any supporting details, please reply with them so the ' +
  'reviewing team has the full picture.';

const REPLACEMENT_NOTE =
  ' Note: the AI draft may have contained an unauthorised commitment, so ' +
  'it was replaced with a safe fallback. Please review before replying.';

function splitSentences(text: string): string[] {
  return text
    .replace(/[‘’]/g, "'")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '');
}

function splitClauses(sentence: string): string[] {
  return sentence
    .split(/[,;:—–]\s*|\s+but\s+/i)
    .map((clause) => clause.trim())
    .filter((clause) => clause !== '');
}

function findAuthorisedCategories(enquiryText: string): Set<CommitCategory> {
  const authorised = new Set<CommitCategory>();
  for (const sentence of splitSentences(enquiryText)) {
    if (sentence.includes('?')) {
      continue;
    }
    if (/\bplease\b/i.test(sentence)) {
      continue;
    }
    if (!BUSINESS_ACTORS.test(sentence)) {
      continue;
    }
    const approval = APPROVAL_VERBS.exec(sentence);
    if (approval === null) {
      continue;
    }
    const beforeVerb = sentence.slice(
      Math.max(0, approval.index - 25),
      approval.index,
    );
    if (UNDECIDED_MARKERS.test(beforeVerb)) {
      continue;
    }
    const denialWindow = sentence.slice(
      Math.max(0, approval.index - 15),
      approval.index,
    );
    if (DENIAL_MARKERS.test(denialWindow)) {
      continue;
    }
    if (approval[0].toLowerCase().startsWith('confirm')) {
      const afterVerb = sentence.slice(
        approval.index,
        approval.index + 40,
      );
      if (/\brecei(pt|ved|ving)\b/i.test(afterVerb)) {
        continue;
      }
    }
    const windowText = sentence.slice(
      Math.max(0, approval.index - 40),
      approval.index + approval[0].length + 40,
    );
    for (const category of COMMIT_CATEGORIES) {
      if (AUTH_KEYWORDS[category].test(windowText)) {
        authorised.add(category);
      }
    }
  }
  return authorised;
}

export function detectCommitments(
  draft: string,
  enquiryText: string,
): CommitFinding[] {
  const authorised = findAuthorisedCategories(enquiryText);
  const findings: CommitFinding[] = [];
  for (const sentence of splitSentences(draft)) {
    if (sentence.includes('?')) {
      continue;
    }
    for (const clause of splitClauses(sentence)) {
      if (NEGATED_CLAUSE.test(clause)) {
        continue;
      }
      const hasFrame = COMMITMENT_FRAMES.some((frame) => frame.test(clause));
      if (!hasFrame) {
        continue;
      }
      for (const category of COMMIT_CATEGORIES) {
        if (authorised.has(category)) {
          continue;
        }
        const matched = COMMIT_KEYWORDS[category].some((pattern) =>
          pattern.test(clause),
        );
        if (matched) {
          findings.push({ category, sentence });
          break;
        }
      }
    }
  }
  return findings;
}

export function applyCommitmentSafeguard(
  analysis: EnquiryAnalysis,
  enquiry: AnalyzeEnquiryRequest,
): EnquiryAnalysis {
  const enquiryText = [
    enquiry.customer,
    enquiry.company,
    enquiry.channel,
    enquiry.subject,
    enquiry.summary,
    enquiry.received,
  ].join('\n');
  const findings = detectCommitments(analysis.draftResponse, enquiryText);
  if (findings.length === 0) {
    return analysis;
  }
  return {
    ...analysis,
    draftResponse: FALLBACK_DRAFT,
    actionReason: `${analysis.actionReason}${REPLACEMENT_NOTE}`,
    needsHuman: true,
    uncertain: true,
  };
}
