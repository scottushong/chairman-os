/**
 * 0087 전자결재 — dummy 모드의 엔진. supabase/migrations/0087_approvals.sql의 ea_* 함수를 TS로 옮겨 적은 것이다(같은 규칙 · 같은 오류 키).
 * 운영에서는 쓰이지 않는다(판정은 DB). dummy 화면 · scripts/check-approvals.ts가 이 엔진으로 A · B · 대표 시나리오를 돈다.
 * 상태는 호출하는 쪽이 들고 있다(EaState) — dummy 저장소는 globalThis에 하나 둔다(webpack dev 두 벌 함정).
 */
import type {
  EaBox,
  EaCounts,
  EaDocStatus,
  EaDocView,
  EaDraftInput,
  EaField,
  EaFollowupStatus,
  EaForm,
  EaLineEntry,
  EaLineRule,
  EaListRow,
  EaMySettings,
  EaPerson,
  EaRefEntry,
  EaStepKind,
  EaStepStatus,
} from './types'

export interface EaPersonRow {
  user_id: string
  name: string
  role: string
  dept: string | null
  title: string | null
  business_ids: string[]
  active: boolean
}

export interface EaActor {
  uid: string
  role: string
}

interface DocRow {
  doc_id: string
  doc_no: string | null
  business_id: string
  form_key: string
  form_version: number | null
  form_snapshot: EaDocView['doc']['form_snapshot']
  title: string
  body: string
  fields: Record<string, string>
  amount: number | null
  line: EaLineEntry[]
  refs: EaRefEntry[]
  due_date: string | null
  wish_date: string | null
  followup_assignee: string | null
  related: string[]
  status: EaDocStatus
  current_seq: number | null
  version: number
  prev_doc_id: string | null
  drafter: string
  drafter_name: string
  drafter_dept: string | null
  created_at: string
  updated_at: string
  submitted_at: string | null
  decided_at: string | null
}
interface StepRow {
  doc_id: string
  seq: number
  kind: EaStepKind
  approver_user: string | null
  approver_role: 'Chairman' | null
  approver_name: string
  status: EaStepStatus
  acted_by: string | null
  acted_as_proxy: boolean
  comment: string | null
  acted_at: string | null
}
interface RefRow {
  doc_id: string
  user_id: string
  kind: 'cc' | 'viewer'
  seen_at: string | null
  confirmed_at: string | null
}
interface FollowupRow {
  doc_id: string
  kind: string
  assignee: string | null
  status: EaFollowupStatus
  due_date: string | null
  result: string | null
  ecount_slip: string | null
  done_by: string | null
  done_at: string | null
}
interface FileRow {
  file_id: string
  doc_id: string
  kind: 'doc' | 'evidence'
  path: string
  name: string
  size_bytes: number
  mime: string | null
  created_at: string
}
interface EventRow {
  doc_id: string
  actor: string
  action: string
  seq: number | null
  as_proxy: boolean
  original_user: string | null
  comment: string | null
  request_id: string | null
  at: string
}
interface ProxyRow {
  proxy_id: string
  owner: string
  proxy: string
  date_from: string
  date_to: string
  forms: string[] | null
  max_amount: number | null
  active: boolean
}
export interface EaNotice {
  user_id: string
  title: string
  link: string
  at: string
}

export interface EaState {
  forms: EaForm[]
  rules: EaLineRule[]
  docs: DocRow[]
  steps: StepRow[]
  refs: RefRow[]
  followups: FollowupRow[]
  files: FileRow[]
  events: EventRow[]
  proxies: ProxyRow[]
  favorites: { fav_id: string; owner: string; name: string; line: EaLineEntry[]; refs: EaRefEntry[] }[]
  settings: Map<string, EaMySettings['notify']>
  notices: EaNotice[]
  objects: Set<string>
  seq: number
}

const purchaseFields: EaField[] = [
  { key: 'item', label: '품목', type: 'text', required: true },
  { key: 'qty', label: '수량', type: 'number', required: true },
  { key: 'vendor', label: '거래처', type: 'text', required: true },
  { key: 'purpose', label: '사용 목적', type: 'text', required: true },
  { key: 'supply', label: '공급가', type: 'money', required: true },
  { key: 'vat', label: '부가세', type: 'money', required: true },
  { key: 'total', label: '합계', type: 'money', required: true },
  { key: 'delivery_date', label: '납품 희망일', type: 'date', required: false },
]

/** 0087 1절 시드와 같다. */
export function seedForms(): EaForm[] {
  return [
    { form_key: 'purchase', name_ko: '구매품의', version: 1, fields: purchaseFields, attachment_required: true, followup_kind: '구매 담당자 발주', followup_required: true, note: '견적서를 첨부합니다. 합계 = 공급가 + 부가세(서버가 다시 확인).', active: true, sort_order: 1 },
    {
      form_key: 'expense', name_ko: '지출결의', version: 1,
      fields: [
        { key: 'payee', label: '지급처', type: 'text', required: true },
        { key: 'reason', label: '지급 사유', type: 'text', required: true },
        { key: 'total', label: '금액', type: 'money', required: true },
        { key: 'pay_date', label: '지급 희망일', type: 'date', required: false },
        { key: 'related_no', label: '관련 품의 문서번호', type: 'text', required: false },
      ],
      attachment_required: true, followup_kind: '관리부 지급', followup_required: true, note: '증빙을 첨부합니다. 회계 · 재무 숫자에는 자동 반영하지 않습니다(결재만).', active: true, sort_order: 2,
    },
    {
      form_key: 'vacation', name_ko: '휴가신청', version: 1,
      fields: [
        { key: 'leave_type', label: '휴가 종류', type: 'select', required: true, options: ['연차', '반차', '병가', '경조', '기타'] },
        { key: 'start', label: '시작일', type: 'date', required: true },
        { key: 'end', label: '종료일', type: 'date', required: true },
        { key: 'days', label: '사용 일수', type: 'number', required: true },
        { key: 'handover', label: '업무 인수인계', type: 'textarea', required: false },
      ],
      attachment_required: false, followup_kind: '근태 반영 여부 확인', followup_required: false, note: '잔여일수 · 중복 신청 검증은 근태 기능 연동 준비 중입니다.', active: true, sort_order: 3,
    },
    {
      form_key: 'trip', name_ko: '출장신청', version: 1,
      fields: [
        { key: 'start', label: '시작일', type: 'date', required: true },
        { key: 'end', label: '종료일', type: 'date', required: true },
        { key: 'place', label: '방문처', type: 'text', required: true },
        { key: 'purpose', label: '목적', type: 'text', required: true },
        { key: 'total', label: '예상 비용', type: 'money', required: false },
      ],
      attachment_required: false, followup_kind: null, followup_required: false, note: null, active: true, sort_order: 4,
    },
    {
      form_key: 'repair', name_ko: '설비수리 품의', version: 1,
      fields: [
        { key: 'equipment', label: '설비명', type: 'text', required: true },
        { key: 'location', label: '위치', type: 'text', required: true },
        { key: 'symptom', label: '증상', type: 'textarea', required: true },
        { key: 'scope', label: '수리 범위', type: 'textarea', required: true },
        { key: 'total', label: '견적 금액', type: 'money', required: false },
      ],
      attachment_required: false, followup_kind: '설비 담당 수리 진행', followup_required: false, note: '견적서 · 사진을 첨부하면 좋습니다.', active: true, sort_order: 5,
    },
    { form_key: 'general', name_ko: '일반품의', version: 1, fields: [], attachment_required: false, followup_kind: null, followup_required: false, note: null, active: true, sort_order: 6 },
  ]
}

export function seedRules(): EaLineRule[] {
  return ['purchase', 'expense', 'repair'].map((f, i) => ({
    rule_id: `00000000-0000-0000-0000-00000000870${i + 1}`, form_key: f, business_id: null, min_amount: 10_000_000, require_chairman: true, note: '기본값(0087) — 1천만 원 이상은 대표 승인', active: true,
  }))
}

export function emptyState(): EaState {
  return { forms: seedForms(), rules: seedRules(), docs: [], steps: [], refs: [], followups: [], files: [], events: [], proxies: [], favorites: [], settings: new Map(), notices: [], objects: new Set(), seq: 0 }
}

const err = (key: string, detail?: string) => new Error(detail ? `${key} (${detail})` : key)
const now = () => new Date().toISOString()
const seoulToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
const uuid = () => globalThis.crypto.randomUUID()

export interface EaEnv {
  state: EaState
  people: EaPersonRow[]
  /** feature_on('approvals', 회사) — 이 사람(역할)에게 켜져 있나. */
  featureOn: (role: string, businessId: string) => boolean
}

export class EaEngine {
  constructor(
    private env: EaEnv,
    private me: EaActor,
  ) {}

  private get s() {
    return this.env.state
  }
  private person(uid: string | null) {
    return uid ? this.env.people.find((p) => p.user_id === uid) : undefined
  }
  private human() {
    const p = this.person(this.me.uid)
    return !!p && p.active && !['AIAgent', 'Integration'].includes(p.role)
  }
  private chairmanUid() {
    return this.env.people.find((p) => p.role === 'Chairman' && p.active)?.user_id ?? null
  }
  private stepOwner(st: Pick<StepRow, 'approver_user' | 'approver_role'>) {
    return st.approver_user ?? (st.approver_role === 'Chairman' ? this.chairmanUid() : null)
  }
  private proxyFor(owner: string | null, form: string, amount: number | null) {
    const t = seoulToday()
    return !!owner && this.s.proxies.some((x) => x.owner === owner && x.proxy === this.me.uid && x.active && x.date_from <= t && t <= x.date_to && (!x.forms || x.forms.includes(form)) && (x.max_amount == null || (amount ?? 0) <= x.max_amount))
  }
  private feature(b: string) {
    return this.env.featureOn(this.person(this.me.uid)?.role ?? '', b)
  }
  private name(uid: string | null) {
    return this.person(uid)?.name ?? '—'
  }

  /** 0093 ea_shown_name 거울 — 대표 본인 화면은 실명, 그 밖은 대표를 «대표»로(결재선 칸과 같은 규칙). */
  private shown(uid: string | null) {
    if (this.person(this.me.uid)?.role !== 'Chairman' && this.person(uid)?.role === 'Chairman') return '대표'
    return this.name(uid)
  }

  private drafterShown(d: { drafter: string; drafter_name: string }) {
    return this.shown(d.drafter) === '대표' ? '대표' : d.drafter_name
  }
  private doc(id: string) {
    return this.s.docs.find((d) => d.doc_id === id)
  }
  private seen(req: string | null) {
    return !!req && this.s.events.some((e) => e.request_id === req)
  }
  private event(doc: string, action: string, o: Partial<EventRow> = {}) {
    if (o.request_id && this.seen(o.request_id)) throw err('duplicate request_id')
    this.s.events.push({ doc_id: doc, actor: this.me.uid, action, seq: null, as_proxy: false, original_user: null, comment: null, request_id: null, at: now(), ...o, ...(o.comment != null ? { comment: o.comment.trim() || null } : {}) })
  }
  private notify(uid: string | null, title: string, doc: string, box: EaBox) {
    if (!uid) return
    const key = box === 'todo' ? 'turn' : box === 'mine' ? 'result' : box === 'followups' ? 'followup' : 'ref'
    if (this.s.settings.get(uid)?.[key] === false) return
    this.s.notices.push({ user_id: uid, title: title.slice(0, 200), link: `/e-approval?box=${box}&doc=${doc}`, at: now() })
  }

  canRead(id: string): boolean {
    if (!this.human()) return false
    const d = this.doc(id)
    if (!d || !this.feature(d.business_id)) return false
    if (d.drafter === this.me.uid) return true
    if (d.status === 'draft') return false
    if (this.s.steps.some((st) => st.doc_id === id && (this.stepOwner(st) === this.me.uid || this.proxyFor(this.stepOwner(st), d.form_key, d.amount)))) return true
    if (this.s.refs.some((r) => r.doc_id === id && r.user_id === this.me.uid)) return true
    return d.status === 'approved' && this.s.followups.some((f) => f.doc_id === id && f.assignee === this.me.uid)
  }

  saveDraft(i: EaDraftInput): string {
    if (!this.human() || !this.feature(i.business_id)) throw err('ea_denied')
    const p = this.person(this.me.uid)!
    if (p.role !== 'Chairman' && p.role !== 'GroupCFO' && !p.business_ids.includes(i.business_id)) throw err('ea_denied')
    if (!this.s.forms.some((f) => f.form_key === i.form_key && f.active)) throw err('ea_form')
    const amount = /^[0-9]+$/.test(i.fields.total ?? '') ? Number(i.fields.total) : null
    const patch = {
      business_id: i.business_id, form_key: i.form_key, title: i.title.trim() || '(제목 없음)', body: i.body ?? '', fields: { ...i.fields }, amount,
      line: i.line, refs: i.refs, due_date: i.due_date, wish_date: i.wish_date, followup_assignee: i.followup_assignee, related: i.related, updated_at: now(),
    }
    if (!i.doc_id) {
      const id = uuid()
      this.s.docs.push({
        ...patch, doc_id: id, doc_no: null, form_version: null, form_snapshot: null, status: 'draft', current_seq: null, version: 1, prev_doc_id: null,
        drafter: this.me.uid, drafter_name: p.name, drafter_dept: p.dept, created_at: now(), submitted_at: null, decided_at: null,
      })
      this.event(id, 'draft')
      return id
    }
    const d = this.doc(i.doc_id)
    if (!d || d.drafter !== this.me.uid) throw err('ea_denied')
    if (d.status !== 'draft') throw err('ea_not_draft')
    Object.assign(d, patch)
    return d.doc_id
  }

  deleteDraft(id: string): string[] {
    const d = this.doc(id)
    if (!d || d.drafter !== this.me.uid || !this.human()) throw err('ea_denied')
    if (d.status !== 'draft') throw err('ea_not_draft')
    const paths = this.s.files.filter((f) => f.doc_id === id).map((f) => f.path)
    this.s.files = this.s.files.filter((f) => f.doc_id !== id)
    this.s.events = this.s.events.filter((e) => e.doc_id !== id)
    this.s.docs = this.s.docs.filter((x) => x.doc_id !== id)
    return paths
  }

  submit(id: string, req: string): string {
    if (this.seen(req)) return this.doc(id)?.doc_no ?? ''
    const d = this.doc(id)
    if (!d || d.drafter !== this.me.uid || !this.human() || !this.feature(d.business_id)) throw err('ea_denied')
    if (d.status !== 'draft') throw err('ea_not_draft')
    const f = this.s.forms.find((x) => x.form_key === d.form_key)
    if (!f?.active) throw err('ea_form')
    if (d.title.trim().length < 2 || d.title === '(제목 없음)') throw err('ea_title')
    for (const fl of f.fields) {
      const v = (d.fields[fl.key] ?? '').trim()
      if (fl.required && !v) throw err('ea_required', fl.label)
      if ((fl.type === 'money' || fl.type === 'number') && v && !/^[0-9]+(\.[0-9]+)?$/.test(v)) throw err('ea_number', fl.label)
    }
    if (d.form_key === 'general' && d.body.trim().length < 2) throw err('ea_required', '신청 내용')
    if (d.form_key === 'purchase' && Number(d.fields.supply) + Number(d.fields.vat) !== Number(d.fields.total)) throw err('ea_total')
    if ((d.form_key === 'vacation' || d.form_key === 'trip') && d.fields.end < d.fields.start) throw err('ea_dates')
    if (f.attachment_required && !this.s.files.some((x) => x.doc_id === id && x.kind === 'doc')) throw err('ea_attachment')
    if (f.followup_required && !d.followup_assignee) throw err('ea_followup_assignee')
    if (d.followup_assignee && !this.person(d.followup_assignee)?.active) throw err('ea_followup_assignee')
    if (d.line.length === 0 || d.line.length > 10) throw err('ea_line', '결재선 1~10단계')
    const steps: StepRow[] = []
    const seen: string[] = []
    d.line.forEach((e, i) => {
      if (!['approve', 'agree'].includes(e.kind)) throw err('ea_line', '단계 종류')
      let owner: string | null
      if (e.role) {
        if (e.role !== 'Chairman' || e.user_id) throw err('ea_line', '역할 단계는 대표만')
        owner = this.chairmanUid()
        if (!owner) throw err('ea_line', '대표 계정 없음')
      } else {
        const p = this.person(e.user_id ?? null)
        if (!p || !p.active || ['AIAgent', 'Integration'].includes(p.role)) throw err('ea_line', '결재자 없음 · 퇴사')
        owner = p.user_id
      }
      if (owner === this.me.uid) throw err('ea_line', '기안자가 결재선에')
      if (seen.includes(owner)) throw err('ea_line', '같은 사람이 두 번')
      seen.push(owner)
      steps.push({
        doc_id: id, seq: i + 1, kind: e.kind, approver_user: e.role ? null : owner, approver_role: e.role ? 'Chairman' : null, approver_name: e.role ? '대표' : this.name(owner),
        status: i === 0 ? 'waiting' : 'planned', acted_by: null, acted_as_proxy: false, comment: null, acted_at: null,
      })
    })
    if (steps.at(-1)!.kind !== 'approve') throw err('ea_line', '마지막 단계는 승인')
    const need = this.s.rules.some((r) => r.active && r.require_chairman && (!r.form_key || r.form_key === d.form_key) && (!r.business_id || r.business_id === d.business_id) && (d.amount ?? 0) >= r.min_amount)
    if (need && !steps.some((s) => s.approver_role === 'Chairman') && this.person(this.me.uid)?.role !== 'Chairman') throw err('ea_line_rule', '이 금액은 대표 승인이 필요합니다')
    this.s.steps = this.s.steps.filter((s) => s.doc_id !== id).concat(steps)
    this.s.refs = this.s.refs.filter((r) => r.doc_id !== id)
    const refSeen = new Set<string>()
    for (const r of d.refs) {
      if (refSeen.has(r.user_id) || r.user_id === this.me.uid || !this.person(r.user_id)?.active || !['cc', 'viewer'].includes(r.kind)) continue
      refSeen.add(r.user_id)
      this.s.refs.push({ doc_id: id, user_id: r.user_id, kind: r.kind, seen_at: null, confirmed_at: null })
    }
    this.s.seq += 1
    const no = `GW-${seoulToday().slice(0, 4)}-${String(this.s.seq).padStart(4, '0')}`
    const me = this.person(this.me.uid)!
    Object.assign(d, {
      status: 'in_progress', current_seq: 1, submitted_at: now(), updated_at: now(), doc_no: no, form_version: f.version,
      form_snapshot: { name: f.name_ko, fields: f.fields, attachment_required: f.attachment_required, followup_kind: f.followup_kind, version: f.version },
      drafter_name: me.name, drafter_dept: me.dept,
    })
    this.event(id, 'submit', { request_id: req })
    this.notify(this.stepOwner(steps[0]), `결재 요청: ${d.title}`, id, 'todo')
    for (const r of this.s.refs.filter((x) => x.doc_id === id)) this.notify(r.user_id, `참조: ${d.title}`, id, 'refs')
    return no
  }

  act(id: string, seq: number, action: 'approve' | 'reject', comment: string | null, req: string): EaDocStatus {
    if (this.seen(req)) return this.doc(id)?.status ?? 'in_progress'
    if (!this.human()) throw err('ea_denied')
    const d = this.doc(id)
    if (!d || !this.feature(d.business_id)) throw err('ea_denied')
    if (d.status !== 'in_progress') throw err('ea_step_not_waiting')
    const st = this.s.steps.find((x) => x.doc_id === id && x.seq === seq)
    if (!st || st.status !== 'waiting' || d.current_seq !== seq) throw err('ea_step_not_waiting')
    const owner = this.stepOwner(st)
    let proxy = false
    if (owner === this.me.uid) proxy = false
    else if (this.proxyFor(owner, d.form_key, d.amount)) proxy = true
    else throw err('ea_not_your_turn')
    if (action === 'reject' && (comment ?? '').trim().length < 2) throw err('ea_reason')
    Object.assign(st, { status: action === 'approve' ? 'approved' : 'rejected', acted_by: this.me.uid, acted_as_proxy: proxy, comment: (comment ?? '').trim() || null, acted_at: now() })
    this.event(id, action === 'reject' ? 'reject' : st.kind === 'agree' ? 'agree' : 'approve', { seq, as_proxy: proxy, original_user: proxy ? owner : null, comment, request_id: req })
    if (action === 'reject') {
      for (const x of this.s.steps) if (x.doc_id === id && x.status === 'planned') x.status = 'skipped'
      Object.assign(d, { status: 'rejected', current_seq: null, decided_at: now(), updated_at: now() })
      this.notify(d.drafter, `반려: ${d.title}`, id, 'mine')
      return 'rejected'
    }
    const next = this.s.steps.filter((x) => x.doc_id === id && x.seq > seq).sort((a, b) => a.seq - b.seq)[0]
    if (next) {
      next.status = 'waiting'
      Object.assign(d, { current_seq: next.seq, updated_at: now() })
      this.notify(this.stepOwner(next), `결재 요청: ${d.title}`, id, 'todo')
      return 'in_progress'
    }
    Object.assign(d, { status: 'approved', current_seq: null, decided_at: now(), updated_at: now() })
    const fk = d.form_snapshot?.followup_kind
    if (fk && !this.s.followups.some((f) => f.doc_id === id)) {
      this.s.followups.push({ doc_id: id, kind: fk, assignee: d.followup_assignee, status: 'waiting', due_date: d.wish_date, result: null, ecount_slip: null, done_by: null, done_at: null })
      this.notify(d.followup_assignee, `후속 처리: ${d.title}`, id, 'followups')
    }
    this.notify(d.drafter, `승인 완료: ${d.title}`, id, 'mine')
    return 'approved'
  }

  withdraw(id: string, req: string): boolean {
    if (this.seen(req)) return true
    const d = this.doc(id)
    if (!d || d.drafter !== this.me.uid || !this.human()) throw err('ea_denied')
    if (d.status !== 'in_progress') throw err('ea_not_in_progress')
    if (this.s.steps.some((x) => x.doc_id === id && x.acted_at)) throw err('ea_withdraw_acted')
    for (const x of this.s.steps) if (x.doc_id === id && (x.status === 'planned' || x.status === 'waiting')) x.status = 'skipped'
    Object.assign(d, { status: 'withdrawn', current_seq: null, decided_at: now(), updated_at: now() })
    this.event(id, 'withdraw', { request_id: req })
    return true
  }

  resubmit(id: string): string {
    const d = this.doc(id)
    if (!d || d.drafter !== this.me.uid || !this.human()) throw err('ea_denied')
    if (d.status !== 'rejected' && d.status !== 'withdrawn') throw err('ea_resubmit_state')
    const open = this.s.docs.find((n) => n.prev_doc_id === id && n.status === 'draft')
    if (open) return open.doc_id
    const me = this.person(this.me.uid)!
    const nid = uuid()
    this.s.docs.push({
      ...d, doc_id: nid, doc_no: null, form_version: null, form_snapshot: null, status: 'draft', current_seq: null, version: d.version + 1, prev_doc_id: id,
      related: [...d.related, id], drafter_name: me.name, drafter_dept: me.dept, created_at: now(), updated_at: now(), submitted_at: null, decided_at: null,
      fields: { ...d.fields }, line: [...d.line], refs: [...d.refs],
    })
    for (const f of this.s.files.filter((x) => x.doc_id === id && x.kind === 'doc')) this.s.files.push({ ...f, file_id: uuid(), doc_id: nid })
    this.event(id, 'resubmit')
    this.event(nid, 'draft')
    return nid
  }

  refMark(id: string, confirm: boolean): boolean {
    if (!this.canRead(id)) throw err('ea_denied')
    const r = this.s.refs.find((x) => x.doc_id === id && x.user_id === this.me.uid)
    if (!r) return false
    r.seen_at ??= now()
    if (confirm && !r.confirmed_at) {
      r.confirmed_at = now()
      this.event(id, 'confirm')
    }
    return true
  }

  followupUpdate(id: string, status: EaFollowupStatus, result: string | null, slip: string | null, req: string): EaFollowupStatus {
    const x = this.s.followups.find((f) => f.doc_id === id)
    if (this.seen(req)) return x?.status ?? status
    if (!x || x.assignee !== this.me.uid || !this.human()) throw err('ea_denied')
    if (x.status === 'done') throw err('ea_followup_done')
    if (status === 'done' && (result ?? '').trim().length < 2) throw err('ea_reason')
    Object.assign(x, {
      status, result: (result ?? '').trim() || x.result, ecount_slip: (slip ?? '').trim() || x.ecount_slip,
      done_by: status === 'done' ? this.me.uid : null, done_at: status === 'done' ? now() : null,
    })
    this.event(id, 'followup', { comment: result, request_id: req })
    return status
  }

  /** dummy 첨부: 경로만 기록한다(바이트는 dummy 저장소 Map이 들고 있다). */
  fileAdd(id: string, path: string, name: string, size: number, mime: string | null): string {
    const [docPart, file] = path.split('/')
    const d = this.doc(id)
    const ok = docPart === id && !!d && ((d.status === 'draft' && d.drafter === this.me.uid) || (d.status === 'approved' && file.startsWith('fu-') && this.s.followups.some((f) => f.doc_id === id && f.assignee === this.me.uid && f.status !== 'done')))
    if (!ok || !this.human()) throw err('ea_denied')
    const kind = file.startsWith('fu-') ? 'evidence' : 'doc'
    const row = { file_id: uuid(), doc_id: id, kind, path, name: name.slice(0, 255), size_bytes: size, mime, created_at: now() } as FileRow
    this.s.files.push(row)
    return row.file_id
  }

  fileRemove(fileId: string): string {
    const f = this.s.files.find((x) => x.file_id === fileId)
    const d = f && this.doc(f.doc_id)
    if (!f || !d || d.status !== 'draft' || d.drafter !== this.me.uid) throw err('ea_denied')
    this.s.files = this.s.files.filter((x) => x.file_id !== fileId)
    return f.path
  }

  objectReadOk(path: string): boolean {
    if (!this.human()) return false
    return this.s.files.some((f) => f.path === path && this.canRead(f.doc_id)) || this.s.docs.some((d) => d.doc_id === path.split('/')[0] && d.drafter === this.me.uid)
  }

  list(box: EaBox, q?: string | null): EaListRow[] {
    if (!this.human()) return []
    const needle = (q ?? '').trim().toLowerCase()
    const rows: EaListRow[] = []
    for (const d of this.s.docs) {
      if (!this.feature(d.business_id)) continue
      if (needle && !d.title.toLowerCase().includes(needle) && !this.drafterShown(d).toLowerCase().includes(needle)) continue
      const steps = this.s.steps.filter((x) => x.doc_id === d.doc_id)
      const mine = steps
        .map((x) => ({ x, own: this.stepOwner(x) === this.me.uid }))
        .filter(({ x, own }) => own || x.acted_by === this.me.uid || (x.status === 'waiting' && this.proxyFor(this.stepOwner(x), d.form_key, d.amount)))
        .sort((a, b) => Number(b.x.status === 'waiting') - Number(a.x.status === 'waiting') || a.x.seq - b.x.seq)[0]
      const ref = this.s.refs.find((r) => r.doc_id === d.doc_id && r.user_id === this.me.uid)
      const fu = this.s.followups.find((f) => f.doc_id === d.doc_id)
      const ok =
        box === 'todo' ? d.status === 'in_progress' && mine?.x.status === 'waiting'
        : box === 'planned' ? d.status === 'in_progress' && mine?.x.status === 'planned' && mine.own
        : box === 'mine' ? d.drafter === this.me.uid && d.status !== 'draft'
        : box === 'drafts' ? d.drafter === this.me.uid && d.status === 'draft'
        : box === 'history' ? steps.some((x) => x.acted_by === this.me.uid && (x.status === 'approved' || x.status === 'rejected'))
        : box === 'refs' ? !!ref && d.status !== 'draft'
        : box === 'followups' ? fu?.assignee === this.me.uid && d.status === 'approved'
        : false
      if (!ok) continue
      const cur = steps.find((x) => x.seq === d.current_seq)
      rows.push({
        doc_id: d.doc_id, doc_no: d.doc_no, title: d.title, form_key: d.form_key,
        form_name: d.form_snapshot?.name ?? this.s.forms.find((f) => f.form_key === d.form_key)?.name_ko ?? d.form_key,
        drafter_name: this.drafterShown(d), drafter_dept: d.drafter_dept, submitted_at: d.submitted_at, status: d.status,
        current_label: d.status === 'in_progress' ? `${cur?.approver_name ?? ''} ${cur?.kind === 'agree' ? '합의' : '검토'}` : d.status === 'approved' ? '승인 완료' : d.status === 'rejected' ? '반려' : d.status === 'withdrawn' ? '회수' : '임시저장',
        due_date: d.due_date, overdue: !!d.due_date && d.status === 'in_progress' && d.due_date < seoulToday(),
        my_role: mine?.x.kind ?? null, my_result: mine?.x.status ?? null,
        as_proxy: (mine?.x.acted_as_proxy ?? false) || (!!mine && !mine.own && mine.x.status === 'waiting'),
        ref_confirmed: !!ref?.confirmed_at, followup_status: fu?.status ?? null, followup_kind: fu?.kind ?? null, amount: d.amount, updated_at: d.updated_at, version: d.version,
      })
    }
    return rows.sort((a, b) => (b.submitted_at ?? b.updated_at).localeCompare(a.submitted_at ?? a.updated_at)).slice(0, 300)
  }

  counts(): EaCounts {
    return {
      todo: this.list('todo').length,
      planned: this.list('planned').length,
      mine: this.list('mine').filter((r) => r.status === 'in_progress').length,
      drafts: this.list('drafts').length,
      history: this.list('history').length,
      refs: this.list('refs').filter((r) => !r.ref_confirmed).length,
      followups: this.list('followups').filter((r) => r.followup_status !== 'done').length,
    }
  }

  detail(id: string): EaDocView | null {
    if (!this.canRead(id)) return null
    const d = this.doc(id)!
    const fu = this.s.followups.find((f) => f.doc_id === id)
    const steps = this.s.steps.filter((x) => x.doc_id === id).sort((a, b) => a.seq - b.seq)
    const versions: EaDocView['versions'] = []
    let p = d.prev_doc_id ? this.doc(d.prev_doc_id) : undefined
    while (p) {
      if (this.canRead(p.doc_id)) versions.unshift({ doc_id: p.doc_id, version: p.version, status: p.status, doc_no: p.doc_no })
      p = p.prev_doc_id ? this.doc(p.prev_doc_id) : undefined
    }
    const next = this.s.docs.find((n) => n.prev_doc_id === id && this.canRead(n.doc_id))
    const myRef = this.s.refs.find((r) => r.doc_id === id && r.user_id === this.me.uid)
    return {
      doc: {
        doc_id: d.doc_id, doc_no: d.doc_no, business_id: d.business_id, form_key: d.form_key,
        form_name: d.form_snapshot?.name ?? this.s.forms.find((f) => f.form_key === d.form_key)?.name_ko ?? d.form_key,
        form_version: d.form_version, form_snapshot: d.form_snapshot, title: d.title, body: d.body, fields: d.fields, amount: d.amount, status: d.status,
        current_seq: d.current_seq, version: d.version, prev_doc_id: d.prev_doc_id, drafter: d.drafter, drafter_name: this.drafterShown(d), drafter_dept: d.drafter_dept,
        due_date: d.due_date, wish_date: d.wish_date, followup_assignee: d.followup_assignee, followup_assignee_name: d.followup_assignee ? this.shown(d.followup_assignee) : null,
        related: d.related, created_at: d.created_at, submitted_at: d.submitted_at, decided_at: d.decided_at,
        line: d.status === 'draft' ? d.line : null, refs_draft: d.status === 'draft' ? d.refs : null,
      },
      steps: steps.map((x) => ({
        seq: x.seq, kind: x.kind, name: x.approver_name, role: x.approver_role, user_id: x.approver_user, status: x.status,
        acted_by_name: x.acted_by ? this.shown(x.acted_by) : null, as_proxy: x.acted_as_proxy, comment: x.comment, acted_at: x.acted_at,
        mine: this.stepOwner(x) === this.me.uid,
        can_act: d.status === 'in_progress' && x.status === 'waiting' && d.current_seq === x.seq && (this.stepOwner(x) === this.me.uid || this.proxyFor(this.stepOwner(x), d.form_key, d.amount)),
      })),
      refs: this.s.refs.filter((r) => r.doc_id === id).map((r) => ({ name: this.shown(r.user_id), kind: r.kind, seen: !!r.seen_at, confirmed: !!r.confirmed_at, me: r.user_id === this.me.uid })),
      files: this.s.files.filter((f) => f.doc_id === id).map((f) => ({ file_id: f.file_id, name: f.name, size: f.size_bytes, kind: f.kind, path: f.path })),
      events: this.s.events.filter((e) => e.doc_id === id && e.action !== 'draft').map((e) => ({ action: e.action, actor: this.shown(e.actor), as_proxy: e.as_proxy, original: e.original_user ? this.shown(e.original_user) : null, comment: e.comment, seq: e.seq, at: e.at })),
      followup: fu ? { kind: fu.kind, status: fu.status, assignee: this.shown(fu.assignee), mine: fu.assignee === this.me.uid, due_date: fu.due_date, result: fu.result, ecount_slip: fu.ecount_slip, done_by: fu.done_by ? this.shown(fu.done_by) : null, done_at: fu.done_at } : null,
      related: d.related.map((r) => (this.canRead(r) ? { doc_id: r, title: this.doc(r)!.title, doc_no: this.doc(r)!.doc_no } : { doc_id: r, title: null, doc_no: null })),
      versions,
      next_version: next?.doc_id ?? null,
      me: {
        drafter: d.drafter === this.me.uid,
        can_withdraw: d.drafter === this.me.uid && d.status === 'in_progress' && !steps.some((x) => x.acted_at),
        can_resubmit: d.drafter === this.me.uid && (d.status === 'rejected' || d.status === 'withdrawn'),
        ref: myRef ? { kind: myRef.kind, confirmed: !!myRef.confirmed_at } : null,
      },
    }
  }

  peopleList(): EaPerson[] {
    if (!this.human()) return []
    const me = this.person(this.me.uid)!
    const wide = me.role === 'Chairman' || me.role === 'GroupCFO'
    return this.env.people
      .filter((p) => p.active && p.user_id !== me.user_id && !['AIAgent', 'Integration', 'Chairman'].includes(p.role))
      .filter((p) => wide || p.role === 'GroupCFO' || p.business_ids.some((b) => me.business_ids.includes(b)))
      .map((p) => ({ user_id: p.user_id, name: p.name, dept: p.dept, title: p.title }))
      .sort((a, b) => (a.dept ?? '힣').localeCompare(b.dept ?? '힣') || a.name.localeCompare(b.name))
  }

  mySettings(): EaMySettings | null {
    if (!this.human()) return null
    const t = seoulToday()
    return {
      proxies: this.s.proxies.filter((x) => x.owner === this.me.uid).map((x) => ({ proxy_id: x.proxy_id, proxy: this.shown(x.proxy), proxy_id_user: x.proxy, from: x.date_from, to: x.date_to, forms: x.forms, max_amount: x.max_amount, active: x.active })),
      proxy_for: this.s.proxies.filter((x) => x.proxy === this.me.uid && x.active && x.date_from <= t && t <= x.date_to).map((x) => ({ owner: this.shown(x.owner), from: x.date_from, to: x.date_to })),
      favorites: this.s.favorites.filter((f) => f.owner === this.me.uid).map(({ fav_id, name, line, refs }) => ({ fav_id, name, line, refs })),
      notify: this.s.settings.get(this.me.uid) ?? { turn: true, result: true, followup: true, ref: true },
    }
  }

  proxySave(proxy: string, from: string, to: string, forms: string[] | null, max: number | null): string {
    if (!this.human()) throw err('ea_denied')
    const p = this.person(proxy)
    if (!p?.active || ['AIAgent', 'Integration'].includes(p.role) || proxy === this.me.uid) throw err('ea_proxy_user')
    if (to < from) throw err('ea_shape')
    const id = uuid()
    this.s.proxies.push({ proxy_id: id, owner: this.me.uid, proxy, date_from: from, date_to: to, forms, max_amount: max, active: true })
    return id
  }

  proxyEnd(id: string): boolean {
    const x = this.s.proxies.find((p) => p.proxy_id === id && p.owner === this.me.uid && p.active)
    if (x) x.active = false
    return !!x
  }

  favoriteSave(name: string, line: EaLineEntry[], refs: EaRefEntry[]): string {
    if (!this.human()) throw err('ea_denied')
    const id = uuid()
    this.s.favorites.push({ fav_id: id, owner: this.me.uid, name, line, refs })
    return id
  }

  favoriteDelete(id: string): boolean {
    const n = this.s.favorites.length
    this.s.favorites = this.s.favorites.filter((f) => !(f.fav_id === id && f.owner === this.me.uid))
    return n !== this.s.favorites.length
  }

  settingsSave(notify: EaMySettings['notify']) {
    if (!this.human()) throw err('ea_denied')
    this.s.settings.set(this.me.uid, notify)
  }

  private admin() {
    return this.human() && this.person(this.me.uid)?.role === 'Chairman'
  }

  formSave(f: Omit<EaForm, 'version' | 'sort_order'>): number {
    if (!this.admin()) throw err('ea_denied')
    const cur = this.s.forms.find((x) => x.form_key === f.form_key)
    if (cur) {
      Object.assign(cur, { ...f, version: cur.version + 1 })
      return cur.version
    }
    this.s.forms.push({ ...f, version: 1, sort_order: 99 })
    return 1
  }

  ruleSave(r: Omit<EaLineRule, 'rule_id'> & { rule_id: string | null }): string {
    if (!this.admin()) throw err('ea_denied')
    if (r.rule_id) {
      const cur = this.s.rules.find((x) => x.rule_id === r.rule_id)
      if (!cur) throw err('ea_denied')
      Object.assign(cur, r)
      return cur.rule_id
    }
    const id = uuid()
    this.s.rules.push({ ...r, rule_id: id })
    return id
  }
}
