import { amountInvalid, approvalLine, missingFields, pickApprovalLead } from '@/lib/approval-line'
import type {
  ApprovalLead,
  ApprovalStep,
  ApprovalTemplate,
  DocFolder,
  Notice,
  NoticeInput,
  NoticeRead,
} from '@/types'

import { DUMMY_PEOPLE, DUMMY_TEAMS, DUMMY_UID, dummyCanWriteDocuments, dummyHasBusiness, dummyPerson, dummyViewer } from './dummy-org'
import type { AuditActor } from './types'

/**
 * 0038 그룹웨어의 dummy 자리 — 공지 · 읽음 · 결재 양식 · 결재선 첫 칸 · 문서 폴더.
 *
 * DB가 막는 것을 **여기서도** 막는다(쓰기 Executive 이상 · 그룹 공지는 그룹 범위 · 읽음 줄은
 * 본인/작성자/회장만). dummy에서 통과한 것이 live에서 막히면 dummy로 본 화면의 뜻이 없다.
 */

const RANK: Record<string, number> = {
  Chairman: 5, GroupCFO: 4, BusinessCEO: 3, Executive: 2, TeamLead: 1, Member: 0,
}
const GROUP_SCOPE = new Set(['Chairman', 'GroupCFO'])

type NoticeRow = Omit<Notice, 'created_by_name' | 'read_by_me'>

const notices: NoticeRow[] = [
  {
    notice_id: 1,
    business_id: null,
    title: '추석 연휴 근무 안내',
    body: '10월 3일~9일 그룹 전체 휴무입니다. 긴급 결재는 회장실로 연락 바랍니다.',
    title_en: 'Chuseok holiday schedule',
    body_en: 'The whole group is off Oct 3–9. Urgent approvals go to the Chairman’s office.',
    pinned: true,
    expires_on: '2026-10-10',
    created_by: DUMMY_UID.chair,
    created_at: '2026-09-25T09:00:00+09:00',
  },
  {
    notice_id: 2,
    business_id: 'biz_dy',
    title: 'DY 4분기 안전 점검',
    body: '10월 14일 생산동 전체 안전 점검이 있습니다. 해당 팀은 오전 작업을 비워 주세요.',
    title_en: null,
    body_en: null,
    pinned: false,
    expires_on: null,
    created_by: DUMMY_UID.dyCeo,
    created_at: '2026-09-26T14:00:00+09:00',
  },
]
let nextNotice = 3
const reads: { notice_id: number; user_id: string; read_at: string }[] = [
  { notice_id: 1, user_id: DUMMY_UID.dyCeo, read_at: '2026-09-25T10:12:00+09:00' },
  { notice_id: 1, user_id: DUMMY_UID.salesLead, read_at: '2026-09-25T11:40:00+09:00' },
]

const nameOf = (id: string) => dummyPerson(id)?.display_name ?? '미지정'

function canRead(n: NoticeRow): boolean {
  const viewer = dummyViewer()
  return n.business_id === null || dummyHasBusiness(viewer, n.business_id)
}

function canWrite(businessId: string | null, role: string): boolean {
  if ((RANK[role] ?? -1) < 2) return false
  if (businessId === null) return GROUP_SCOPE.has(role)
  return dummyHasBusiness(dummyViewer(), businessId)
}

export async function listNotices(): Promise<Notice[]> {
  const me = dummyViewer().user_id
  return notices
    .filter(canRead)
    .map((n) => ({
      ...n,
      created_by_name: nameOf(n.created_by),
      read_by_me: reads.some((r) => r.notice_id === n.notice_id && r.user_id === me),
    }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at))
}

export async function saveNotice(input: NoticeInput & { id?: number }, actor: AuditActor): Promise<number> {
  if (!canWrite(input.business_id, actor.role)) throw new Error('row-level security: notices')
  if (input.id) {
    const row = notices.find((n) => n.notice_id === input.id)
    if (!row || (row.created_by !== actor.user_id && actor.role !== 'Chairman')) {
      throw new Error('row-level security: notices')
    }
    Object.assign(row, input, { notice_id: row.notice_id })
    return row.notice_id
  }
  const id = nextNotice++
  notices.push({ ...input, notice_id: id, created_by: actor.user_id, created_at: new Date().toISOString() })
  return id
}

export async function deleteNotice(id: number, actor: AuditActor): Promise<void> {
  const at = notices.findIndex((n) => n.notice_id === id)
  const row = notices[at]
  if (!row || !canWrite(row.business_id, actor.role) || (row.created_by !== actor.user_id && actor.role !== 'Chairman')) {
    throw new Error('row-level security: notices')
  }
  notices.splice(at, 1)
}

export async function markNoticeRead(id: number, actor: AuditActor): Promise<void> {
  const row = notices.find((n) => n.notice_id === id)
  if (!row || !canRead(row)) throw new Error('row-level security: notice_reads')
  if (!reads.some((r) => r.notice_id === id && r.user_id === actor.user_id)) {
    reads.push({ notice_id: id, user_id: actor.user_id, read_at: new Date().toISOString() })
  }
}

export async function listNoticeReads(id: number): Promise<NoticeRead[]> {
  const viewer = dummyViewer()
  const row = notices.find((n) => n.notice_id === id)
  if (!row) return []
  const all = viewer.role === 'Chairman' || row.created_by === viewer.user_id
  return reads
    .filter((r) => r.notice_id === id && (all || r.user_id === viewer.user_id))
    .map((r) => ({ user_id: r.user_id, name: nameOf(r.user_id), read_at: r.read_at }))
}

/* ------------------------------------------------------------------ 결재 양식 · 결재선 */

// 0038 시드에서 2026-10-06 권장 설정(/settings/approvals)으로 바꾼 값 — 첨부(사내 스토리지) 칸 없음 ·
// 지출 · 구매에 «구입처»(필수) · «링크»(선택) · 구매 대표 기준 500만원. live는 회장이 설정 화면에서 같은 값으로 저장한다.
const templates: ApprovalTemplate[] = [
  {
    template_key: 'expense', name_ko: '지출', name_en: 'Expense', attachment_required: false,
    chairman_always: false, chairman_over: 5_000_000, sort_order: 10,
    fields: [
      { key: 'amount', label_ko: '금액(원)', label_en: 'Amount (KRW)', type: 'money', required: true },
      { key: 'purpose', label_ko: '지출 목적', label_en: 'Purpose', type: 'textarea', required: true },
      { key: 'spent_on', label_ko: '지출일', label_en: 'Date', type: 'date', required: true },
      { key: 'vendor', label_ko: '구입처', label_en: 'Where bought', type: 'text', required: true },
      { key: 'link', label_ko: '링크', label_en: 'Link', type: 'url', required: false },
    ],
  },
  {
    template_key: 'purchase', name_ko: '구매', name_en: 'Purchase', attachment_required: false,
    chairman_always: false, chairman_over: 5_000_000, sort_order: 20,
    fields: [
      { key: 'item', label_ko: '품목', label_en: 'Item', type: 'text', required: true },
      { key: 'vendor', label_ko: '구입처', label_en: 'Where bought', type: 'text', required: true },
      { key: 'quantity', label_ko: '수량', label_en: 'Quantity', type: 'number', required: true },
      { key: 'amount', label_ko: '금액(원)', label_en: 'Amount (KRW)', type: 'money', required: true },
      { key: 'needed_on', label_ko: '필요일', label_en: 'Needed by', type: 'date', required: false },
      { key: 'link', label_ko: '링크', label_en: 'Link', type: 'url', required: false },
    ],
  },
  {
    template_key: 'leave', name_ko: '휴가', name_en: 'Leave', attachment_required: false,
    chairman_always: false, chairman_over: null, sort_order: 30,
    fields: [
      { key: 'starts_on', label_ko: '시작일', label_en: 'From', type: 'date', required: true },
      { key: 'ends_on', label_ko: '종료일', label_en: 'To', type: 'date', required: true },
      { key: 'reason', label_ko: '사유', label_en: 'Reason', type: 'textarea', required: false },
    ],
  },
  {
    template_key: 'contract', name_ko: '계약', name_en: 'Contract', attachment_required: false,
    chairman_always: true, chairman_over: null, sort_order: 40,
    fields: [
      { key: 'counterparty', label_ko: '계약 상대', label_en: 'Counterparty', type: 'text', required: true },
      { key: 'amount', label_ko: '계약 금액(원)', label_en: 'Amount (KRW)', type: 'money', required: true },
      { key: 'term', label_ko: '계약 기간', label_en: 'Term', type: 'text', required: true },
      { key: 'summary', label_ko: '주요 조건', label_en: 'Key terms', type: 'textarea', required: true },
    ],
  },
  {
    template_key: 'hiring', name_ko: '채용', name_en: 'Hiring', attachment_required: false,
    chairman_always: true, chairman_over: null, sort_order: 50,
    fields: [
      { key: 'position', label_ko: '직무', label_en: 'Position', type: 'text', required: true },
      { key: 'team', label_ko: '배치 팀', label_en: 'Team', type: 'text', required: true },
      { key: 'amount', label_ko: '연봉(원)', label_en: 'Annual salary (KRW)', type: 'money', required: true },
      { key: 'reason', label_ko: '채용 사유', label_en: 'Reason', type: 'textarea', required: true },
    ],
  },
]

export async function listApprovalTemplates(): Promise<ApprovalTemplate[]> {
  return templates.map((t) => ({ ...t, fields: t.fields.map((f) => ({ ...f })) }))
}

/** 0038 approval_templates_write의 거울 — Chairman만. 첨부 필수는 늘 끈다(live와 같다). */
export async function updateApprovalTemplate(
  key: ApprovalTemplate['template_key'],
  patch: Pick<ApprovalTemplate, 'fields' | 'chairman_always' | 'chairman_over'>,
  actor: AuditActor,
): Promise<void> {
  if (actor.role !== 'Chairman') throw new Error('row-level security: approval_templates')
  const t = templates.find((x) => x.template_key === key)
  if (!t) throw new Error('approval_template_unknown')
  t.fields = patch.fields.map((f) => ({ ...f }))
  t.chairman_always = patch.chairman_always
  t.chairman_over = patch.chairman_over
  t.attachment_required = false
}

/** 0038/0054 my_approval_lead()와 같은 판정 — 팀장(공석·본인·떠남이면 reports_to), 대표는 후보가 아니다. */
export async function myApprovalLead(): Promise<ApprovalLead | null> {
  return pickApprovalLead(dummyViewer().user_id, DUMMY_PEOPLE, DUMMY_TEAMS)
}

/* ------------------------------------------------------------------ 문서 폴더 */

const folders: DocFolder[] = [
  { folder_id: 1, business_id: 'biz_dy', team_id: null, parent_id: null, name: '계약서' },
  { folder_id: 2, business_id: 'biz_dy', team_id: 'team_dy_sales', parent_id: null, name: '견적' },
  { folder_id: 3, business_id: 'biz_dy', team_id: 'team_dy_sales', parent_id: 2, name: '2026' },
  { folder_id: 4, business_id: 'biz_vana', team_id: null, parent_id: null, name: '투자 자료' },
]
let nextFolder = 5

export async function listDocFolders(): Promise<DocFolder[]> {
  const viewer = dummyViewer()
  return folders.filter((f) => dummyHasBusiness(viewer, f.business_id)).map((f) => ({ ...f }))
}

export async function saveDocFolder(
  input: Omit<DocFolder, 'folder_id'>,
  actor: AuditActor,
): Promise<number> {
  // 0048 doc_folders_insert = can_write_documents(business_id) — 회사 범위 AND 그 회사의 문서 등록 권한.
  if (!dummyCanWriteDocuments(dummyViewer(), input.business_id)) throw new Error('row-level security: doc_folders')
  void actor
  if (input.team_id && !DUMMY_TEAMS.some((t) => t.team_id === input.team_id && t.business_id === input.business_id)) {
    throw new Error('doc_folder_team_business_mismatch')
  }
  if (input.parent_id && !folders.some((f) => f.folder_id === input.parent_id && f.business_id === input.business_id)) {
    throw new Error('doc_folder_parent_business_mismatch')
  }
  const id = nextFolder++
  folders.push({ ...input, folder_id: id })
  return id
}

/**
 * 0038 decisions_approval_line() 트리거의 dummy 거울 — 필수 항목 · 첨부가 비면 던지고,
 * 결재선(팀장 → 규칙 → 회장)을 만든다. 규칙 문장은 lib/approval-line.ts가 트리거와 같게 쓴다.
 */
export async function draftApprovalLine(input: {
  template_key?: ApprovalTemplate['template_key']
  form?: Record<string, string>
  attachment_url?: string
}): Promise<ApprovalStep[]> {
  const template = templates.find((t) => t.template_key === input.template_key)
  if (!template) throw new Error('approval_template_unknown')
  const form = input.form ?? {}
  const missing = missingFields(template, form)
  if (missing.length > 0) throw new Error(`approval_form_missing:${missing[0]}`)
  // 0054 리뷰 C1 — 대표 기준 금액이 있으면 금액은 숫자 모양이어야 한다(트리거와 같은 정규식).
  if (amountInvalid(template, form)) throw new Error('approval_amount_invalid')
  if (template.attachment_required && !(input.attachment_url ?? '').trim()) {
    throw new Error('approval_attachment_missing')
  }
  const chairman = DUMMY_PEOPLE.find((p) => p.role === 'Chairman' && !p.revoked_at)
  return approvalLine(template, form, await myApprovalLead(), {
    user_id: chairman?.user_id ?? null,
    name: '대표',
  })
}
