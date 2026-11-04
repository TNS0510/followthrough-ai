import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type EnquiryStatus = 'New' | 'Awaiting reply' | 'Overdue'
type EnquiryPriority = 'High' | 'Medium' | 'Low'
type Page = 'dashboard' | 'enquiries' | 'drafts' | 'analyze'
type StatusFilter = 'All' | EnquiryStatus
type PriorityFilter = 'All' | EnquiryPriority
type ReviewFilter = 'All' | 'Awaiting review' | 'Reviewed'

interface Enquiry {
  id: string
  customer: string
  company: string
  channel: string
  subject: string
  summary: string
  received: string
  status: EnquiryStatus
  priority: EnquiryPriority
  nextAction: string
  draft: string
}

// Fictional sample data, ordered most urgent first. Frontend only.
const enquiries: Enquiry[] = [
  {
    id: 'enq-1',
    customer: 'Amelia Hart',
    company: 'Brightline Dental',
    channel: 'Email',
    subject: 'Quote for 6-month checkup plan',
    summary: 'Asked for a revised quote covering two surgeries. Waiting 2 days.',
    received: '2 days ago',
    status: 'Overdue',
    priority: 'High',
    nextAction: 'Send the revised quote today.',
    draft:
      'Hi Amelia, thanks for your patience. The revised quote covering both surgeries for the 6-month plan comes to $1,450. Let me know if you would like to go ahead and I will reserve the slots.',
  },
  {
    id: 'enq-2',
    customer: 'Daniel Okafor',
    company: 'Northwind Traders',
    channel: 'Phone',
    subject: 'Delivery arrived with damaged items',
    summary: 'Two of twelve cartons arrived crushed. Photos received.',
    received: '5 hours ago',
    status: 'Awaiting reply',
    priority: 'High',
    nextAction: 'Confirm the replacement shipment.',
    draft:
      'Hi Daniel, I am sorry about the damaged cartons. I have arranged replacements for the two affected items at no charge, arriving Thursday. Please keep the photos in case the courier follows up.',
  },
  {
    id: 'enq-3',
    customer: 'Sofia Marchetti',
    company: 'Bloom & Bean Cafe',
    channel: 'Web form',
    subject: 'Catering enquiry for team event',
    summary: 'Team lunch for 25 people next month. Asked about set menus.',
    received: '1 hour ago',
    status: 'New',
    priority: 'Medium',
    nextAction: 'Reply with the catering menu.',
    draft:
      'Hi Sofia, thank you for thinking of us for your team lunch. Our set menus for groups of 20+ start at $18 per person. Tell me the date and any dietary needs and I will prepare options.',
  },
  {
    id: 'enq-4',
    customer: 'Priya Nair',
    company: 'Lumen Fitness',
    channel: 'Email',
    subject: 'Membership pause request',
    summary: 'Travelling for 6 weeks. Wants to pause, not cancel.',
    received: 'Yesterday',
    status: 'Awaiting reply',
    priority: 'Medium',
    nextAction: 'Confirm the pause dates.',
    draft:
      'Hi Priya, happy to pause your membership while you travel. Reply with your start date and I will freeze billing for 6 weeks. Your classes and rate stay exactly as they are.',
  },
  {
    id: 'enq-5',
    customer: 'Liam Walker',
    company: 'Walker Plumbing',
    channel: 'WhatsApp',
    subject: 'Invoice question',
    summary: 'Unsure what the call-out line covers on invoice #1042.',
    received: '20 minutes ago',
    status: 'New',
    priority: 'Low',
    nextAction: 'Share an itemised copy of the invoice.',
    draft:
      'Hi Liam, good question. The call-out line covers travel and the first 30 minutes on site. I will send an itemised copy of invoice #1042 so you can see the full breakdown.',
  },
]

const soonItems = ['Follow-ups']
const statusOptions: StatusFilter[] = ['All', 'New', 'Awaiting reply', 'Overdue']
const priorityOptions: PriorityFilter[] = ['All', 'High', 'Medium', 'Low']
const reviewOptions: ReviewFilter[] = ['All', 'Awaiting review', 'Reviewed']

function statusClass(status: EnquiryStatus): string {
  if (status === 'Overdue') return 'status-overdue'
  if (status === 'Awaiting reply') return 'status-awaiting'
  return 'status-new'
}

function priorityClass(priority: EnquiryPriority): string {
  return `priority-${priority.toLowerCase()}`
}

interface SidebarProps {
  page: Page
  onNavigate: (page: Page) => void
}

function Sidebar({ page, onNavigate }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          F
        </span>
        FollowThrough AI
      </div>
      <nav aria-label="Primary">
        <ul>
          <li>
            <button
              type="button"
              className={page === 'dashboard' ? 'nav-item active' : 'nav-item'}
              aria-current={page === 'dashboard' ? 'page' : undefined}
              onClick={() => onNavigate('dashboard')}
            >
              Dashboard
            </button>
          </li>
          <li>
            <button
              type="button"
              className={page === 'enquiries' ? 'nav-item active' : 'nav-item'}
              aria-current={page === 'enquiries' ? 'page' : undefined}
              onClick={() => onNavigate('enquiries')}
            >
              Enquiries
            </button>
          </li>
          <li>
            <button
              type="button"
              className={page === 'drafts' ? 'nav-item active' : 'nav-item'}
              aria-current={page === 'drafts' ? 'page' : undefined}
              onClick={() => onNavigate('drafts')}
            >
              Drafts
            </button>
          </li>
          <li>
            <button
              type="button"
              className={page === 'analyze' ? 'nav-item active' : 'nav-item'}
              aria-current={page === 'analyze' ? 'page' : undefined}
              onClick={() => onNavigate('analyze')}
            >
              Analyze enquiry
            </button>
          </li>
          {soonItems.map((item) => (
            <li key={item}>
              <span className="nav-item" aria-disabled="true" title="Coming soon">
                {item} <em className="soon">Soon</em>
              </span>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}

interface TopbarProps {
  title: string
}

function Topbar({ title }: TopbarProps) {
  return (
    <header className="topbar">
      <h1>{title}</h1>
      <div className="topbar-right">
        <span className="sample-badge">Sample data</span>
        <span className="user-chip" title="Fictional user">
          FT
        </span>
      </div>
    </header>
  )
}

interface StatCardProps {
  label: string
  value: number
  accent: 'indigo' | 'blue' | 'purple'
}

function StatCard({ label, value, accent }: StatCardProps) {
  return (
    <div className={`stat-card accent-${accent}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

interface EnquiryCardProps {
  enquiry: Enquiry
  reviewed: boolean
  onReview: () => void
  onAnalyze: () => void
}

function EnquiryCard({ enquiry, reviewed, onReview, onAnalyze }: EnquiryCardProps) {
  const overdue = enquiry.status === 'Overdue'
  return (
    <article className={overdue ? 'enquiry enquiry-overdue' : 'enquiry'}>
      <div className="enquiry-head">
        <h3>{enquiry.subject}</h3>
        <span className="received">{enquiry.received}</span>
      </div>
      <p className="enquiry-meta">
        {enquiry.customer} &middot; {enquiry.company} &middot; {enquiry.channel}
      </p>
      <p className="enquiry-summary">{enquiry.summary}</p>
      <div className="label-row">
        <span className={`label ${statusClass(enquiry.status)}`}>
          {enquiry.status}
        </span>
        <span className={`label ${priorityClass(enquiry.priority)}`}>
          {enquiry.priority} priority
        </span>
        {reviewed && <span className="label reviewed">Draft reviewed</span>}
      </div>
      <p className="next-action">
        <strong>Next action:</strong> {enquiry.nextAction}
      </p>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <button type="button" className="review-button" onClick={onReview}>
          Review draft
        </button>
        <button type="button" className="review-button" onClick={onAnalyze}>
          Analyse
        </button>
      </div>
    </article>
  )
}

interface EnquiriesPageProps {
  reviewedIds: string[]
  onReview: (id: string) => void
  onAnalyze: (id: string) => void
}

function EnquiriesPage({ reviewedIds, onReview, onAnalyze }: EnquiriesPageProps) {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All')
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('All')

  const needle = query.trim().toLowerCase()
  const visible = enquiries.filter((enquiry) => {
    const matchesQuery =
      needle === '' ||
      enquiry.subject.toLowerCase().includes(needle) ||
      enquiry.customer.toLowerCase().includes(needle)
    const matchesStatus =
      statusFilter === 'All' || enquiry.status === statusFilter
    const matchesPriority =
      priorityFilter === 'All' || enquiry.priority === priorityFilter
    return matchesQuery && matchesStatus && matchesPriority
  })

  return (
    <section aria-label="All enquiries">
      <div className="filters">
        <input
          type="search"
          className="search-input"
          placeholder="Search by title or contact name"
          aria-label="Search enquiries by title or contact name"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="filter-select"
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value as StatusFilter)
          }
        >
          {statusOptions.map((option) => (
            <option key={option} value={option}>
              {option === 'All' ? 'All statuses' : option}
            </option>
          ))}
        </select>
        <select
          className="filter-select"
          aria-label="Filter by priority"
          value={priorityFilter}
          onChange={(event) =>
            setPriorityFilter(event.target.value as PriorityFilter)
          }
        >
          {priorityOptions.map((option) => (
            <option key={option} value={option}>
              {option === 'All' ? 'All priorities' : option}
            </option>
          ))}
        </select>
      </div>
      <p className="result-count">
        Showing {visible.length} of {enquiries.length} enquiries
      </p>
      {visible.length === 0 ? (
        <p className="empty-state">No enquiries match these filters.</p>
      ) : (
        <div className="enquiry-list">
          {visible.map((enquiry) => (
            <EnquiryCard
              key={enquiry.id}
              enquiry={enquiry}
              reviewed={reviewedIds.includes(enquiry.id)}
              onReview={() => onReview(enquiry.id)}
              onAnalyze={() => onAnalyze(enquiry.id)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

interface DraftCardProps {
  enquiry: Enquiry
  reviewed: boolean
  onReview: () => void
}

function DraftCard({ enquiry, reviewed, onReview }: DraftCardProps) {
  const excerpt =
    enquiry.draft.length > 140
      ? `${enquiry.draft.slice(0, 140).trimEnd()}…`
      : enquiry.draft
  return (
    <article className="enquiry">
      <div className="enquiry-head">
        <h3>{enquiry.subject}</h3>
        <span className="received">{enquiry.received}</span>
      </div>
      <p className="enquiry-meta">
        {enquiry.customer} &middot; {enquiry.company} &middot; {enquiry.channel}
      </p>
      <p className="enquiry-summary">{excerpt}</p>
      <div className="label-row">
        {reviewed ? (
          <span className="label reviewed">Draft reviewed</span>
        ) : (
          <span className="label status-awaiting">Awaiting review</span>
        )}
      </div>
      <button type="button" className="review-button" onClick={onReview}>
        Review draft
      </button>
    </article>
  )
}

interface SavedDraftCardProps {
  draft: SavedDraft
  onReview: () => void
}

function SavedDraftCard({ draft, onReview }: SavedDraftCardProps) {
  const excerpt =
    draft.body.length > 140
      ? `${draft.body.slice(0, 140).trimEnd()}…`
      : draft.body
  const contact = [draft.customer, draft.company, draft.channel]
    .filter((part) => part !== '')
    .join(' · ')
  return (
    <article className="enquiry">
      <div className="enquiry-head">
        <h3>{draft.subject}</h3>
        <span className="received">{formatSavedAt(draft.savedAt)}</span>
      </div>
      <p className="enquiry-meta">{contact}</p>
      <p className="enquiry-summary">{excerpt}</p>
      <div className="label-row">
        <span className="label status-new">AI-generated</span>
        {draft.reviewed ? (
          <span className="label reviewed">Draft reviewed</span>
        ) : (
          <span className="label status-awaiting">Awaiting review</span>
        )}
      </div>
      <button type="button" className="review-button" onClick={onReview}>
        Review draft
      </button>
    </article>
  )
}

interface DraftsPageProps {
  reviewedIds: string[]
  savedDrafts: SavedDraft[]
  onReview: (id: string) => void
}

function DraftsPage({ reviewedIds, savedDrafts, onReview }: DraftsPageProps) {
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('All')

  const visibleSaved = savedDrafts.filter((draft) => {
    if (reviewFilter === 'Reviewed') return draft.reviewed
    if (reviewFilter === 'Awaiting review') return !draft.reviewed
    return true
  })
  const visibleSamples = enquiries.filter((enquiry) => {
    const isReviewed = reviewedIds.includes(enquiry.id)
    if (reviewFilter === 'Reviewed') return isReviewed
    if (reviewFilter === 'Awaiting review') return !isReviewed
    return true
  })
  const shown = visibleSaved.length + visibleSamples.length
  const total = savedDrafts.length + enquiries.length

  return (
    <section aria-label="All drafts">
      <div className="filters">
        <select
          className="filter-select"
          aria-label="Filter by review status"
          value={reviewFilter}
          onChange={(event) =>
            setReviewFilter(event.target.value as ReviewFilter)
          }
        >
          {reviewOptions.map((option) => (
            <option key={option} value={option}>
              {option === 'All' ? 'All drafts' : option}
            </option>
          ))}
        </select>
      </div>
      <p className="result-count">
        Showing {shown} of {total} drafts
      </p>
      {shown === 0 ? (
        <p className="empty-state">No drafts match this filter.</p>
      ) : (
        <>
          {visibleSaved.length > 0 && (
            <section
              aria-label="AI-generated drafts"
              style={{ marginBottom: '32px' }}
            >
              <h3>Saved from AI analysis</h3>
              <p className="draft-note">
                AI-generated drafts are stored only in this browser. This is a
                fictional demonstration feature, not secure multi-user storage.
              </p>
              <div className="enquiry-list">
                {visibleSaved.map((draft) => (
                  <SavedDraftCard
                    key={draft.id}
                    draft={draft}
                    onReview={() => onReview(draft.id)}
                  />
                ))}
              </div>
            </section>
          )}
          {visibleSamples.length > 0 && (
            <>
              {savedDrafts.length > 0 && <h3>Sample drafts</h3>}
              <div className="enquiry-list">
                {visibleSamples.map((enquiry) => (
                  <DraftCard
                    key={enquiry.id}
                    enquiry={enquiry}
                    reviewed={reviewedIds.includes(enquiry.id)}
                    onReview={() => onReview(enquiry.id)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}

type DraftModalSource =
  | { kind: 'sample'; enquiry: Enquiry }
  | { kind: 'saved'; draft: SavedDraft }

interface DraftModalProps {
  source: DraftModalSource
  reviewed: boolean
  onMarkReviewed: () => void
  onSaveEdit: ((body: string) => void) | null
  onClose: () => void
}

type CopyState = 'idle' | 'copied' | 'failed'

function DraftModal({
  source,
  reviewed,
  onMarkReviewed,
  onSaveEdit,
  onClose,
}: DraftModalProps) {
  const body =
    source.kind === 'saved' ? source.draft.body : source.enquiry.draft
  const contact =
    source.kind === 'saved'
      ? [source.draft.customer, source.draft.company, source.draft.channel]
          .filter((part) => part !== '')
          .join(' · ')
      : ''
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(body)
  const [copyState, setCopyState] = useState<CopyState>('idle')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const canEdit = source.kind === 'saved' && onSaveEdit !== null
  const trimmedEdit = editText.trim()
  const canSaveEdit =
    trimmedEdit !== '' &&
    trimmedEdit.length <= MAX_DRAFT_BODY &&
    trimmedEdit !== body

  const startEdit = () => {
    setEditText(body)
    setCopyState('idle')
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditText(body)
    setCopyState('idle')
    setEditing(false)
  }

  const saveEdit = () => {
    if (!canSaveEdit || onSaveEdit === null) {
      return
    }
    onSaveEdit(trimmedEdit)
    setCopyState('idle')
    setEditing(false)
  }

  const copyBody = async () => {
    setCopyState((await copyToClipboard(body)) ? 'copied' : 'failed')
  }

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="draft-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="draft-title">Draft response</h2>
        {source.kind === 'saved' ? (
          <>
            <p className="enquiry-meta">To: {contact}</p>
            <p className="enquiry-meta">
              AI-generated &middot; {formatSavedAt(source.draft.savedAt)}
            </p>
          </>
        ) : (
          <p className="enquiry-meta">
            To: {source.enquiry.customer} &middot; {source.enquiry.company}{' '}
            &middot; {source.enquiry.channel}
          </p>
        )}
        {editing ? (
          <>
            <div className="field">
              <label htmlFor="draft-edit">Draft text</label>
              <textarea
                id="draft-edit"
                value={editText}
                maxLength={MAX_DRAFT_BODY}
                rows={8}
                onChange={(event) => setEditText(event.target.value)}
              />
            </div>
            <p className="draft-note">
              {trimmedEdit.length} / {MAX_DRAFT_BODY} characters
            </p>
          </>
        ) : (
          <>
            <p className="draft-text">{body}</p>
            <p className="draft-note">
              Preview only. Nothing is sent from this screen.
            </p>
          </>
        )}
        {editing ? (
          <div className="modal-actions">
            <button
              type="button"
              className="button-primary"
              onClick={saveEdit}
              disabled={!canSaveEdit}
            >
              Save changes
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={cancelEdit}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="modal-actions">
            <button
              type="button"
              className="button-primary"
              onClick={onMarkReviewed}
              disabled={reviewed}
            >
              {reviewed ? 'Reviewed' : 'Mark reviewed'}
            </button>
            {canEdit && (
              <button
                type="button"
                className="button-secondary"
                onClick={startEdit}
              >
                Edit
              </button>
            )}
            <button
              type="button"
              className="button-secondary"
              onClick={copyBody}
            >
              {copyState === 'copied'
                ? 'Copied'
                : copyState === 'failed'
                  ? 'Copy failed'
                  : 'Copy'}
            </button>
            <button type="button" className="button-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

interface SavedDraft {
  id: string
  customer: string
  company: string
  channel: string
  subject: string
  body: string
  savedAt: string
  reviewed: boolean
}

interface NewSavedDraft {
  customer: string
  company: string
  channel: string
  subject: string
  body: string
}

const SAVED_DRAFTS_KEY = 'followthrough.savedDrafts.v1'
const MAX_DRAFT_BODY = 4000
const MAX_SAVED_DRAFTS = 50

function isSavedDraft(value: unknown): value is SavedDraft {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    record.id.startsWith('draft-') &&
    typeof record.customer === 'string' &&
    record.customer !== '' &&
    typeof record.company === 'string' &&
    typeof record.channel === 'string' &&
    typeof record.subject === 'string' &&
    record.subject !== '' &&
    typeof record.body === 'string' &&
    record.body !== '' &&
    record.body.length <= MAX_DRAFT_BODY &&
    typeof record.savedAt === 'string' &&
    record.savedAt !== '' &&
    typeof record.reviewed === 'boolean'
  )
}

function loadSavedDrafts(): SavedDraft[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return []
    }
    const raw = window.localStorage.getItem(SAVED_DRAFTS_KEY)
    if (raw === null || raw === '') {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter(isSavedDraft).slice(0, MAX_SAVED_DRAFTS)
  } catch {
    return []
  }
}

function createDraftId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `draft-${crypto.randomUUID()}`
  }
  return `draft-${Date.now()}-${Math.floor(Math.random() * 1000000)}`
}

function formatSavedAt(savedAt: string): string {
  const time = new Date(savedAt).getTime()
  if (Number.isNaN(time)) {
    return 'Saved draft'
  }
  return `Saved ${new Date(time).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.clipboard !== 'undefined'
    ) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.readOnly = true
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(area)
    return copied
  } catch {
    return false
  }
}

interface AnalysisResult {
  missingInfo: string[]
  nextAction: string
  actionReason: string
  draftResponse: string
  needsHuman: boolean
  uncertain: boolean
}

type AnalyzeStatus = 'idle' | 'loading' | 'success' | 'error'

function isAnalysisResult(value: unknown): value is AnalysisResult {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    Array.isArray(record.missingInfo) &&
    record.missingInfo.every(
      (item: unknown): item is string => typeof item === 'string',
    ) &&
    typeof record.nextAction === 'string' &&
    typeof record.actionReason === 'string' &&
    typeof record.draftResponse === 'string' &&
    typeof record.needsHuman === 'boolean' &&
    typeof record.uncertain === 'boolean'
  )
}

function readErrorMessage(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null
  }
  const record = payload as Record<string, unknown>
  return typeof record.error === 'string' ? record.error : null
}

interface AnalyzePageProps {
  initial: Enquiry | null
  onSaveDraft: (draft: NewSavedDraft) => boolean
}

type SaveStatus = 'idle' | 'stored' | 'memory-only'

function AnalyzePage({ initial, onSaveDraft }: AnalyzePageProps) {
  const [customer, setCustomer] = useState(initial?.customer ?? '')
  const [company, setCompany] = useState(initial?.company ?? '')
  const [channel, setChannel] = useState(initial?.channel ?? '')
  const [subject, setSubject] = useState(initial?.subject ?? '')
  const [summary, setSummary] = useState(initial?.summary ?? '')
  const [received, setReceived] = useState(initial?.received ?? '')
  const [status, setStatus] = useState<AnalyzeStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const saveGuard = useRef(false)

  const loading = status === 'loading'

  const fillSample = () => {
    const sample = enquiries[0]
    setCustomer(sample.customer)
    setCompany(sample.company)
    setChannel(sample.channel)
    setSubject(sample.subject)
    setSummary(sample.summary)
    setReceived(sample.received)
  }

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault()
    if (loading) {
      return
    }
    setStatus('loading')
    setError(null)
    setResult(null)
    setSaveStatus('idle')
    saveGuard.current = false
    try {
      const response = await fetch('/api/analyze-enquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer,
          company,
          channel,
          subject,
          summary,
          received,
        }),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        setError(
          readErrorMessage(payload) ??
            `Request failed (HTTP ${response.status}).`,
        )
        setStatus('error')
        return
      }
      if (!isAnalysisResult(payload)) {
        setError('The server returned an unexpected response.')
        setStatus('error')
        return
      }
      setResult(payload)
      setStatus('success')
    } catch {
      setError(
        'Could not reach the server. Make sure the backend is running with npm run server, then try again.',
      )
      setStatus('error')
    }
  }

  const saveToDrafts = () => {
    if (saveGuard.current || result === null) {
      return
    }
    saveGuard.current = true
    const stored = onSaveDraft({
      customer,
      company,
      channel,
      subject,
      body: result.draftResponse,
    })
    setSaveStatus(stored ? 'stored' : 'memory-only')
  }

  return (
    <section aria-label="Analyze enquiry">
      <h2>Analyze enquiry</h2>
      <p className="analyze-intro">
        Send an enquiry to your own backend for AI follow-up analysis.
        Nothing is sent to the customer from this screen.
      </p>
      <form className="enquiry analyze-form" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="analyze-customer">Customer</label>
          <input
            id="analyze-customer"
            type="text"
            value={customer}
            maxLength={200}
            required
            autoComplete="off"
            onChange={(event) => setCustomer(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="analyze-company">Company</label>
          <input
            id="analyze-company"
            type="text"
            value={company}
            maxLength={200}
            autoComplete="off"
            onChange={(event) => setCompany(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="analyze-channel">Channel</label>
          <input
            id="analyze-channel"
            type="text"
            value={channel}
            maxLength={200}
            placeholder="Email, phone, web form…"
            autoComplete="off"
            onChange={(event) => setChannel(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="analyze-subject">Subject</label>
          <input
            id="analyze-subject"
            type="text"
            value={subject}
            maxLength={300}
            required
            autoComplete="off"
            onChange={(event) => setSubject(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="analyze-summary">Summary</label>
          <textarea
            id="analyze-summary"
            value={summary}
            maxLength={4000}
            required
            rows={4}
            onChange={(event) => setSummary(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="analyze-received">Received</label>
          <input
            id="analyze-received"
            type="text"
            value={received}
            maxLength={200}
            placeholder="2 days ago"
            autoComplete="off"
            onChange={(event) => setReceived(event.target.value)}
          />
        </div>
        <div className="form-actions">
          <button
            type="submit"
            className="button-primary"
            disabled={loading}
          >
            {loading ? 'Analyzing…' : 'Analyze enquiry'}
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={loading}
            onClick={fillSample}
          >
            Fill with sample
          </button>
        </div>
      </form>
      <div aria-live="polite">
        {loading && <p className="analyze-status">Analyzing enquiry…</p>}
        {status === 'error' && error && (
          <p className="analyze-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {status === 'success' && result && (
        <article className="enquiry analyze-result" aria-label="Analysis result">
          <h3>Analysis result</h3>
          <div className="label-row">
            {result.needsHuman ? (
              <span className="label status-awaiting">
                Human review required
              </span>
            ) : (
              <span className="label status-new">No human review flagged</span>
            )}
            {result.uncertain ? (
              <span className="label status-overdue">Uncertain</span>
            ) : (
              <span className="label status-new">Clear</span>
            )}
          </div>
          <h4>Missing information</h4>
          {result.missingInfo.length === 0 ? (
            <p className="enquiry-summary">None reported.</p>
          ) : (
            <ul className="missing-list">
              {result.missingInfo.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <h4>Recommended next action</h4>
          <p className="enquiry-summary">{result.nextAction}</p>
          <h4>Reason</h4>
          <p className="enquiry-summary">{result.actionReason}</p>
          <h4>Draft response</h4>
          <p className="draft-text">{result.draftResponse}</p>
          <p className="draft-note">
            Preview only. Nothing is sent from this screen.
          </p>
          {saveStatus === 'idle' ? (
            <div className="modal-actions">
              <button
                type="button"
                className="button-primary"
                onClick={saveToDrafts}
              >
                Save to Drafts
              </button>
            </div>
          ) : saveStatus === 'stored' ? (
            <p className="draft-note" role="status">
              Saved to Drafts. Stored only in this browser — open the Drafts
              page to review it.
            </p>
          ) : (
            <p className="analyze-error" role="alert">
              Browser storage is unavailable, so this draft is kept for this
              session only and will disappear if you reload. It is listed in
              Drafts until then.
            </p>
          )}
        </article>
      )}
    </section>
  )
}

function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reviewedIds, setReviewedIds] = useState<string[]>([])
  const [analyzeId, setAnalyzeId] = useState<string | null>(null)
  const [savedDrafts, setSavedDrafts] = useState<SavedDraft[]>(() =>
    loadSavedDrafts(),
  )

  const unresolved = enquiries.length
  const overdue = enquiries.filter(
    (enquiry) => enquiry.status === 'Overdue',
  ).length
  const awaitingReview =
    enquiries.filter((enquiry) => !reviewedIds.includes(enquiry.id)).length +
    savedDrafts.filter((draft) => !draft.reviewed).length

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SAVED_DRAFTS_KEY,
        JSON.stringify(savedDrafts),
      )
    } catch {
      // The session copy stays usable; the save action already reported
      // whether browser storage accepted the draft.
    }
  }, [savedDrafts])

  const selected =
    enquiries.find((enquiry) => enquiry.id === selectedId) ?? null
  const selectedSavedDraft =
    savedDrafts.find((draft) => draft.id === selectedId) ?? null

  const analyzeSource =
    enquiries.find((enquiry) => enquiry.id === analyzeId) ?? null

  const markReviewed = (id: string) => {
    setReviewedIds((current) =>
      current.includes(id) ? current : [...current, id],
    )
  }

  const handleSaveDraft = (input: NewSavedDraft): boolean => {
    const draft: SavedDraft = {
      ...input,
      id: createDraftId(),
      savedAt: new Date().toISOString(),
      reviewed: false,
    }
    const next = [draft, ...savedDrafts].slice(0, MAX_SAVED_DRAFTS)
    setSavedDrafts(next)
    try {
      window.localStorage.setItem(SAVED_DRAFTS_KEY, JSON.stringify(next))
      return true
    } catch {
      return false
    }
  }

  const handleUpdateDraft = (id: string, body: string) => {
    const trimmed = body.trim()
    if (trimmed === '' || trimmed.length > MAX_DRAFT_BODY) {
      return
    }
    setSavedDrafts((current) =>
      current.map((draft) =>
        draft.id === id ? { ...draft, body: trimmed, reviewed: false } : draft,
      ),
    )
  }

  const markSavedDraftReviewed = (id: string) => {
    setSavedDrafts((current) =>
      current.map((draft) =>
        draft.id === id ? { ...draft, reviewed: true } : draft,
      ),
    )
  }

  const handleNavigate = (next: Page) => {
    if (next === 'analyze') {
      setAnalyzeId(null)
    }
    setPage(next)
  }

  const startAnalysis = (id: string) => {
    setAnalyzeId(id)
    setPage('analyze')
  }

  return (
    <div className="app">
      <Sidebar page={page} onNavigate={handleNavigate} />
      <div className="main">
        <Topbar
          title={
            page === 'dashboard'
              ? 'Dashboard'
              : page === 'enquiries'
                ? 'Enquiries'
                : page === 'analyze'
                  ? 'Analyze enquiry'
                  : 'Drafts'
          }
        />
        <main className="content">
          {page === 'dashboard' ? (
            <>
              <section className="stats" aria-label="Follow-up summary">
                <StatCard
                  label="Unresolved enquiries"
                  value={unresolved}
                  accent="indigo"
                />
                <StatCard
                  label="Overdue follow-ups"
                  value={overdue}
                  accent="blue"
                />
                <StatCard
                  label="Drafts awaiting review"
                  value={awaitingReview}
                  accent="purple"
                />
              </section>
              <section aria-label="Needs attention">
                <h2>Needs attention</h2>
                <div className="enquiry-list">
                  {enquiries.map((enquiry) => (
                    <EnquiryCard
                      key={enquiry.id}
                      enquiry={enquiry}
                      reviewed={reviewedIds.includes(enquiry.id)}
                      onReview={() => setSelectedId(enquiry.id)}
                      onAnalyze={() => startAnalysis(enquiry.id)}
                    />
                  ))}
                </div>
              </section>
            </>
          ) : page === 'enquiries' ? (
            <EnquiriesPage
              reviewedIds={reviewedIds}
              onReview={(id) => setSelectedId(id)}
              onAnalyze={startAnalysis}
            />
          ) : page === 'analyze' ? (
            <AnalyzePage
              key={analyzeSource?.id ?? 'new'}
              initial={analyzeSource}
              onSaveDraft={handleSaveDraft}
            />
          ) : (
            <DraftsPage
              reviewedIds={reviewedIds}
              savedDrafts={savedDrafts}
              onReview={(id) => setSelectedId(id)}
            />
          )}
        </main>
      </div>
      {selectedSavedDraft ? (
        <DraftModal
          key={selectedSavedDraft.id}
          source={{ kind: 'saved', draft: selectedSavedDraft }}
          reviewed={selectedSavedDraft.reviewed}
          onMarkReviewed={() => markSavedDraftReviewed(selectedSavedDraft.id)}
          onSaveEdit={(body) => handleUpdateDraft(selectedSavedDraft.id, body)}
          onClose={() => setSelectedId(null)}
        />
      ) : (
        selected && (
          <DraftModal
            key={selected.id}
            source={{ kind: 'sample', enquiry: selected }}
            reviewed={reviewedIds.includes(selected.id)}
            onMarkReviewed={() => markReviewed(selected.id)}
            onSaveEdit={null}
            onClose={() => setSelectedId(null)}
          />
        )
      )}
    </div>
  )
}

export default App
