/**
 * 0087 전자결재 — 화면 · 서버 · dummy 엔진이 같이 쓰는 모양과 말. 브라우저 번들에도 들어가므로 서버 모듈을 들이지 않는다.
 * DB 쪽 원본은 supabase/migrations/0087_approvals.sql(ea_*). 여기 이름은 그 칸 이름을 그대로 쓴다.
 * 직원 화면이다 — «회장»이 들어가지 않는다(역할 단계는 «대표»).
 */

export const EA_BOXES = ['todo', 'planned', 'mine', 'drafts', 'history', 'refs', 'followups'] as const
export type EaBox = (typeof EA_BOXES)[number]

export const EA_BOX_LABEL: Record<EaBox, string> = {
  todo: '결재할 문서',
  planned: '결재 예정',
  mine: '내가 올린 문서',
  drafts: '임시저장',
  history: '내 처리 이력',
  refs: '참조·공유',
  followups: '후속 처리',
}

export const EA_BOX_HINT: Record<EaBox, string> = {
  todo: '지금 내 차례인 승인·합의 요청입니다.',
  planned: '결재선에 있지만 아직 내 차례가 아닌 문서입니다. 앞 단계가 끝나야 처리할 수 있습니다.',
  mine: '내가 상신한 문서와 지금 담당자입니다.',
  drafts: '작성 중인 문서입니다. 결재자에게는 보이지 않습니다.',
  history: '내가 승인·합의·반려한 기록입니다. 내 결과와 문서 전체 상태를 따로 보여 줍니다.',
  refs: '내가 참조자 또는 열람자로 지정된 문서입니다.',
  followups: '최종 승인 뒤 내가 맡은 구매·지급·행정 처리입니다.',
}

export type EaDocStatus = 'draft' | 'in_progress' | 'rejected' | 'approved' | 'withdrawn'
export type EaStepStatus = 'planned' | 'waiting' | 'approved' | 'rejected' | 'skipped'
export type EaStepKind = 'approve' | 'agree'
export type EaFollowupStatus = 'waiting' | 'doing' | 'done'

export const DOC_STATUS_LABEL: Record<EaDocStatus, string> = {
  draft: '임시저장',
  in_progress: '진행 중',
  rejected: '반려',
  approved: '승인 완료',
  withdrawn: '회수',
}

export const STEP_STATUS_LABEL: Record<EaStepStatus, string> = {
  planned: '예정',
  waiting: '대기',
  approved: '승인',
  rejected: '반려',
  skipped: '미처리',
}

export const FOLLOWUP_STATUS_LABEL: Record<EaFollowupStatus | 'none', string> = {
  none: '해당 없음',
  waiting: '처리 대기',
  doing: '처리 중',
  done: '처리 완료',
}

export const STEP_KIND_LABEL: Record<EaStepKind, string> = { approve: '승인', agree: '합의' }

export type EaFieldType = 'text' | 'textarea' | 'number' | 'money' | 'date' | 'select'
export interface EaField {
  key: string
  label: string
  type: EaFieldType
  required: boolean
  options?: string[]
}

export interface EaForm {
  form_key: string
  name_ko: string
  version: number
  fields: EaField[]
  attachment_required: boolean
  followup_kind: string | null
  followup_required: boolean
  note: string | null
  active: boolean
  sort_order: number
}

export interface EaLineRule {
  rule_id: string
  form_key: string | null
  business_id: string | null
  min_amount: number
  require_chairman: boolean
  note: string | null
  active: boolean
}

/** 작성 중 결재선 한 칸 — 사람(user_id) 또는 역할 «대표»(role: 'Chairman'). */
export interface EaLineEntry {
  user_id?: string
  role?: 'Chairman'
  kind: EaStepKind
}

export interface EaRefEntry {
  user_id: string
  kind: 'cc' | 'viewer'
}

export interface EaListRow {
  doc_id: string
  doc_no: string | null
  title: string
  form_key: string
  form_name: string
  drafter_name: string
  drafter_dept: string | null
  submitted_at: string | null
  status: EaDocStatus
  current_label: string
  due_date: string | null
  overdue: boolean
  my_role: EaStepKind | null
  my_result: EaStepStatus | null
  as_proxy: boolean
  ref_confirmed: boolean
  followup_status: EaFollowupStatus | null
  followup_kind: string | null
  amount: number | null
  updated_at: string
  version: number
}

export type EaCounts = Record<EaBox, number>

export interface EaStepView {
  seq: number
  kind: EaStepKind
  name: string
  role: 'Chairman' | null
  user_id: string | null
  status: EaStepStatus
  acted_by_name: string | null
  as_proxy: boolean
  comment: string | null
  acted_at: string | null
  mine: boolean
  can_act: boolean
}

export interface EaDocView {
  doc: {
    doc_id: string
    doc_no: string | null
    business_id: string
    form_key: string
    form_name: string
    form_version: number | null
    form_snapshot: { name: string; fields: EaField[]; attachment_required: boolean; followup_kind: string | null; version: number } | null
    title: string
    body: string
    fields: Record<string, string>
    amount: number | null
    status: EaDocStatus
    current_seq: number | null
    version: number
    prev_doc_id: string | null
    drafter: string
    drafter_name: string
    drafter_dept: string | null
    due_date: string | null
    wish_date: string | null
    followup_assignee: string | null
    followup_assignee_name: string | null
    related: string[]
    created_at: string
    submitted_at: string | null
    decided_at: string | null
    line: EaLineEntry[] | null
    refs_draft: EaRefEntry[] | null
  }
  steps: EaStepView[]
  refs: { name: string; kind: 'cc' | 'viewer'; seen: boolean; confirmed: boolean; me: boolean }[]
  files: { file_id: string; name: string; size: number; kind: 'doc' | 'evidence'; path: string }[]
  events: { action: string; actor: string; as_proxy: boolean; original: string | null; comment: string | null; seq: number | null; at: string }[]
  followup: {
    kind: string
    status: EaFollowupStatus
    assignee: string
    mine: boolean
    due_date: string | null
    result: string | null
    ecount_slip: string | null
    done_by: string | null
    done_at: string | null
  } | null
  related: { doc_id: string; title: string | null; doc_no: string | null }[]
  versions: { doc_id: string; version: number; status: EaDocStatus; doc_no: string | null }[]
  next_version: string | null
  me: { drafter: boolean; can_withdraw: boolean; can_resubmit: boolean; ref: { kind: 'cc' | 'viewer'; confirmed: boolean } | null }
}

export interface EaPerson {
  user_id: string
  name: string
  dept: string | null
  title: string | null
}

export interface EaMySettings {
  proxies: { proxy_id: string; proxy: string; proxy_id_user: string; from: string; to: string; forms: string[] | null; max_amount: number | null; active: boolean }[]
  proxy_for: { owner: string; from: string; to: string }[]
  favorites: { fav_id: string; name: string; line: EaLineEntry[]; refs: EaRefEntry[] }[]
  notify: { turn: boolean; result: boolean; followup: boolean; ref: boolean }
}

export interface EaDraftInput {
  doc_id: string | null
  business_id: string
  form_key: string
  title: string
  body: string
  fields: Record<string, string>
  line: EaLineEntry[]
  refs: EaRefEntry[]
  due_date: string | null
  wish_date: string | null
  followup_assignee: string | null
  related: string[]
}

/** DB 오류 키 → 화면 말. «대표»로 쓴다. */
export const EA_ERROR: Record<string, string> = {
  ea_denied: '이 문서를 처리할 권한이 없습니다.',
  ea_form: '쓸 수 없는 양식입니다.',
  ea_shape: '입력 모양이 맞지 않습니다.',
  ea_not_draft: '이미 상신된 문서라 고칠 수 없습니다. 반려 · 회수된 뒤 «재상신»으로 새 판을 만드세요.',
  ea_title: '제목을 두 글자 이상 적어 주세요.',
  ea_required: '필수 항목이 비었습니다',
  ea_number: '숫자만 적는 칸입니다',
  ea_total: '공급가 + 부가세가 합계와 다릅니다.',
  ea_dates: '종료일이 시작일보다 앞입니다.',
  ea_attachment: '이 양식은 첨부가 필요합니다.',
  ea_followup_assignee: '후속 담당자를 지정해 주세요.',
  ea_line: '결재선이 올바르지 않습니다',
  ea_line_rule: '이 금액은 대표 승인이 필요합니다 — 결재선 끝에 «대표»를 넣어 주세요.',
  ea_step_not_waiting: '이미 처리된 단계입니다(다른 창 · 다른 기기에서 처리됐을 수 있습니다). 새로 고친 화면에서 상태를 확인하세요.',
  ea_not_your_turn: '지금 내 차례가 아닙니다.',
  ea_reason: '사유(결과)를 두 글자 이상 적어 주세요.',
  ea_not_in_progress: '진행 중인 문서만 회수할 수 있습니다.',
  ea_withdraw_acted: '이미 처리한 결재자가 있어 직접 회수할 수 없습니다. 지금 담당자에게 반려를 요청하세요.',
  ea_resubmit_state: '반려 · 회수된 문서만 재상신할 수 있습니다.',
  ea_followup_done: '이미 완료된 후속 처리입니다.',
  ea_file_missing: '파일이 저장소에 없습니다 — 다시 올려 주세요.',
  ea_proxy_user: '대결자로 지정할 수 없는 사람입니다.',
  ea_unavailable: '전자결재가 아직 이 DB에 반영되지 않았습니다(0087).',
}

export function eaErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  const key = /ea_[a-z_]+/.exec(msg)?.[0]
  if (key && EA_ERROR[key]) {
    const detail = /\(([^)]+)\)$/.exec(msg)?.[1]
    return detail ? `${EA_ERROR[key]} — ${detail}` : EA_ERROR[key]
  }
  return '처리하지 못했습니다. 잠시 뒤 화면을 새로 고쳐 실제 상태를 확인한 다음 다시 시도해 주세요.'
}

export const won = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n).toLocaleString('ko-KR')}원`)

/** «10.19» — 목록의 짧은 날짜(서울). */
export function shortDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const p = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' }).formatToParts(d)
  return `${p.find((x) => x.type === 'month')?.value}.${p.find((x) => x.type === 'day')?.value}`
}

/** «2026.10.19» */
export function fullDate(iso: string | null): string {
  if (!iso) return '—'
  const p = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso))
  const g = (t: string) => p.find((x) => x.type === t)?.value
  return `${g('year')}.${g('month')}.${g('day')}`
}

export function dateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}

export const EVENT_LABEL: Record<string, string> = {
  submit: '상신',
  approve: '승인',
  agree: '합의',
  reject: '반려',
  withdraw: '회수',
  resubmit: '재상신(새 판)',
  confirm: '참조 확인',
  followup: '후속 처리',
  reassign: '처리자 변경',
  file: '첨부',
}
