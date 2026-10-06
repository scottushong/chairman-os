import 'server-only'

import { AMOUNT_INVALID_MESSAGE, AMOUNT_PATTERN, approvalLine, toChairman } from '@/lib/approval-line'
import { approvalTitle, cleanForm, formProblem } from '@/lib/approval-submit'
import { canCloseBooks, canKeepBooks } from '@/lib/auth/roles'
import { boss, bossText, isChairman } from '@/lib/boss'
import { kstToday } from '@/lib/chairman-project'
import { closablePeriod } from '@/lib/ledger/closing'
import { isPeriodLocked, lastClosedPeriod } from '@/lib/ledger/journal'
import { JOURNAL_TEMPLATES } from '@/lib/ledger/journal-templates'
import type { ApprovalTemplate, Business } from '@/types'

import { addEvidence, FINANCE_ROLES, krw, norm, resolveBusiness, str, type AssistantTool, type ToolContext } from './kit'
import { propose } from './tools-propose'

/**
 * 직원도 쓰는 도구 — 내 결재 올리기(양식) · 월 마감 상태 · 문서 찾기 · 전표 입력 도움 · 내 업무.
 * 전부 **질문한 사람의 repo**로 읽는다(RLS). 여기서 넓히는 곳은 없다 — 좁히기만 한다(dummy는 역할과 무관하게
 * 주므로 재무는 역할 · 모듈 줄로 한 번 더 자른다, kit.ts 머리 주석).
 *
 * ■ 권한 밖은 침묵하지 않는다 ■ 이 사람이 못 하는 일이면 { error: 'no_permission', message: '권한이 없습니다 — …' }를
 *   돌려주고 모델은 그 문장을 그대로 옮긴다. 요청 대상은 «대표»(직원 화면 용어 원칙, CLAUDE.md). 이 파일의 글에는
 *   «회장»이 없다 — 보는 사람에 따라 boss(role)로 그린다.
 */

export const NO_APPROVAL_GRANT = '권한이 없습니다 — 결재를 올리려면 «결재 올리기» 권한이 필요합니다. 대표에게 켜 달라고 요청하세요.'
export const NO_FINANCE = '권한이 없습니다 — 월 마감 · 장부는 그 회사의 재무 권한이 있어야 볼 수 있습니다. 필요하면 대표에게 재무 권한을 요청하세요.'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/
const isDate = (v: string) => DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
const webOnly = (ctx: ToolContext) => ctx.channel === 'web'

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

/* ---------------------------------------------------------------- 결재 양식 */

function findTemplate(list: ApprovalTemplate[], query: string): ApprovalTemplate | null {
  const q = norm(query)
  if (!q) return null
  return (
    list.find((t) => t.template_key === query.trim() || norm(t.name_ko) === q || norm(t.name_en) === q) ??
    (() => {
      const hits = list.filter((t) => q.includes(norm(t.name_ko)) || norm(t.name_ko).includes(q))
      return hits.length === 1 ? hits[0] : null
    })()
  )
}

/** 이 양식이 대표까지 가는 규칙(보는 사람에 맞춘 호칭). */
function ruleText(t: ApprovalTemplate, viewer: ToolContext['user']['role']): string {
  if (t.chairman_always) return `금액과 상관없이 ${boss(viewer)} 결재`
  if (t.chairman_over === null) return `${boss(viewer)} 규칙 없음(팀장 선에서 끝남)`
  return `금액 ${krw(t.chairman_over)} 이상이면 ${boss(viewer)}까지`
}

const cannotSubmit = (ctx: ToolContext) => !isChairman(ctx.user.role) && ctx.user.approvals_write === false

export const approvalTemplatesTool: AssistantTool = {
  def: {
    name: 'list_approval_templates',
    description:
      '결재 양식(지출 · 구매 · 휴가 · 계약 · 채용)과 양식마다 채울 항목(key · 이름 · 형식 · 필수), 결재선 규칙, 이 사람의 결재선 첫 칸(팀장)을 준다. ' +
      '결재를 올리자는 요청이면 먼저 이것으로 항목을 확인하고, 빈 필수 항목은 사용자에게 묻는다.',
    input_schema: { type: 'object', properties: {} },
  },
  available: webOnly,
  async run(_input, ctx) {
    const [templates, lead] = await Promise.all([ctx.repo.listApprovalTemplates(), ctx.repo.myApprovalLead().catch(() => null)])
    addEvidence(ctx, { label: '결재 올리기', href: '/approvals/new', detail: `양식 ${templates.length}개` })
    return {
      can_submit: cannotSubmit(ctx) ? false : ctx.user.approvals_write === true ? true : 'unknown',
      ...(cannotSubmit(ctx) ? { permission: NO_APPROVAL_GRANT } : {}),
      first_approver: lead ? { name: lead.display_name, as: lead.via === 'team_lead' ? '팀장' : '팀장 부재 · 직속 상위' } : null,
      templates: templates
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((t) => ({
          key: t.template_key,
          name: t.name_ko,
          rule: ruleText(t, ctx.user.role),
          fields: t.fields.map((f) => ({ key: f.key, label: f.label_ko, type: f.type, required: f.required })),
        })),
      note: '파일 첨부는 이 대화로 받지 않는다 — 결재를 올린 뒤 결재 화면에서 그 건을 열고 «첨부» 칸에 올린다.',
    }
  },
}

export const proposeApprovalFormTool: AssistantTool = {
  def: {
    name: 'propose_approval_form',
    description:
      '양식 결재(지출 · 구매 · 휴가 · 계약 · 채용)를 **제안**한다 — 화면에 미리보기 카드(결재선 포함)와 [확인] 버튼을 띄울 뿐, 올리지 않는다. ' +
      '사용자가 카드의 «확인 — 저장»을 누르면 결재 화면의 «결재 올리기»와 같은 문으로 올라간다. template은 key 또는 이름, ' +
      'fields는 {항목 key: 값}(list_approval_templates의 key), deadline은 결재 기한 YYYY-MM-DD(없으면 7일 뒤). ' +
      '필수 항목이 비면 missing_fields가 온다 — 값을 지어내지 말고 사용자에게 묻는다.',
    input_schema: {
      type: 'object',
      properties: {
        template: { type: 'string' },
        business: { type: 'string', description: '회사 id 또는 이름(하나만 보이면 생략 가능)' },
        title: { type: 'string', description: '비우면 양식 이름 + 첫 항목' },
        deadline: { type: 'string', description: 'YYYY-MM-DD' },
        fields: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['template', 'fields'],
    },
  },
  available: webOnly,
  async run(input, ctx) {
    if (cannotSubmit(ctx)) return { error: 'no_permission', message: NO_APPROVAL_GRANT }
    const templates = await ctx.repo.listApprovalTemplates()
    const template = findTemplate(templates, str(input.template))
    if (!template) return { error: 'unknown_template', message: '양식을 찾지 못했습니다.', templates: templates.map((t) => ({ key: t.template_key, name: t.name_ko })) }

    const visible = await ctx.businesses()
    let biz: Business | null = str(input.business) ? resolveBusiness(str(input.business), visible) : null
    if (!str(input.business) && visible.length === 1) biz = visible[0]
    if (!biz) {
      return { error: 'need_business', message: str(input.business) ? `회사를 찾지 못했습니다: «${str(input.business)}»` : '어느 회사의 결재인지 물어 주세요.', businesses: visible.map((b) => b.name) }
    }

    const today = kstToday()
    const deadline = str(input.deadline) || addDays(today, 7)
    if (!isDate(deadline) || deadline < today) return { error: 'invalid', message: '결재 기한은 오늘 이후 YYYY-MM-DD입니다.' }

    const known = new Set(template.fields.map((f) => f.key))
    const raw = cleanForm(input.fields)
    const form = Object.fromEntries(Object.entries(raw).filter(([k]) => known.has(k)).map(([k, v]) => [k, v.slice(0, 2000)]))
    const ignored = Object.keys(raw).filter((k) => !known.has(k))
    for (const f of template.fields) {
      const v = form[f.key]
      if (!v) continue
      // 금액 칸은 0054 트리거 · 화면과 같은 모양(AMOUNT_PATTERN)만 — «600만» · «60,00,000»이면 카드 전에 같은 문장으로 되묻는다.
      if ((f.type === 'money' || f.key === 'amount') && !AMOUNT_PATTERN.test(v)) {
        return { error: 'invalid', field: f.key, message: AMOUNT_INVALID_MESSAGE }
      }
      if (f.type === 'number' && !/^[0-9][0-9,]*(\.[0-9]+)?\s*(원|개|명)?$/.test(v)) {
        return { error: 'invalid', field: f.key, message: `${f.label_ko}은(는) 숫자로 넣으세요(예: 1,200,000).` }
      }
      if (f.type === 'date' && !isDate(v)) return { error: 'invalid', field: f.key, message: `${f.label_ko}은(는) YYYY-MM-DD입니다.` }
    }
    const problem = formProblem(template, form, ctx.user.role)
    if (problem) {
      return {
        error: problem.startsWith('필수') ? 'missing_fields' : 'invalid',
        message: problem,
        fields: template.fields.map((f) => ({ key: f.key, label: f.label_ko, type: f.type, required: f.required, value: form[f.key] ?? null })),
      }
    }

    const lead = await ctx.repo.myApprovalLead().catch(() => null)
    const line = approvalLine(template, form, lead, { user_id: null, name: boss(ctx.user.role) })
    const lineText = line
      .map((st) => (st.step === 'lead' ? (st.user_id ? `팀장 ${st.name}` : '팀장 없음') : st.step === 'rule' ? `규칙(${st.why})` : boss(ctx.user.role)))
      .map((t) => bossText(t, ctx.user.role))
      .join(' → ')
    const recordsOnly = !lead && !toChairman(template, form)
    const title = approvalTitle(template, form, input.title)

    return {
      ...(await propose(
        ctx,
        'approval_draft',
        { template_key: template.template_key, business_id: biz.business_id, title, deadline, form },
        {
          title: `${template.name_ko} 결재 — ${title}`,
          lines: [
            { label: '회사', before: null, after: biz.name },
            ...template.fields.filter((f) => form[f.key]).map((f) => ({ label: f.label_ko, before: null, after: form[f.key] })),
            { label: '결재 기한', before: null, after: deadline },
            { label: '결재선', before: null, after: lineText },
          ],
          warning:
            (recordsOnly ? '팀장 결재 단계가 없고 기준 미만이라, 올리면 승인 단계 없이 «기록 완료»로 저장됩니다. ' : '') +
            '확인하면 결재 화면의 «결재 올리기»와 똑같이 올라가고, 결재선은 올리는 순간 다시 정해집니다. 파일은 올린 뒤 결재 화면에서 그 건을 열고 «첨부» 칸에 붙입니다.',
          href: '/approvals',
        },
        { table: 'businesses', id: biz.business_id, business_id: biz.business_id },
      )),
      ...(ignored.length ? { ignored_fields: ignored } : {}),
    }
  },
}

/* ---------------------------------------------------------------- 월 마감 상태 */

/** 이 사람이 장부를 읽을 회사. 역할로 읽는 사람은 보이는 회사 전부, 그 밖에는 재무 모듈 줄이 있는 회사만(좁히기만 한다). */
function bookCompanies(ctx: ToolContext, visible: Business[]): Business[] {
  if (FINANCE_ROLES.has(ctx.user.role)) return visible
  return visible.filter((b) => ctx.user.finance[b.business_id]?.write || ctx.user.finance[b.business_id]?.close)
}

export const closingStatusTool: AssistantTool = {
  def: {
    name: 'closing_status',
    description:
      '월 마감(장부 결산) 상태 — 회사마다 마지막으로 마감한 달, 마감 차례인 달, 물은 달(period, 기본 이번 달)이 마감됐는지 · 그 달 전표 수, ' +
      '이 사람이 그 회사에 전표를 넣을 수 있는지 · 마감할 수 있는지. 금액은 주지 않는다. 권한이 없으면 no_permission.',
    input_schema: {
      type: 'object',
      properties: { business: { type: 'string' }, period: { type: 'string', description: 'YYYY-MM' } },
    },
  },
  available: webOnly,
  async run(input, ctx) {
    if (!ctx.financeAllowed) return { error: 'no_permission', message: NO_FINANCE }
    const visible = await ctx.businesses()
    const readable = bookCompanies(ctx, visible)
    const asked = str(input.business) ? resolveBusiness(str(input.business), visible) : null
    if (str(input.business) && !asked) return { error: 'not_found', message: `회사를 찾지 못했습니다: «${str(input.business)}»` }
    if (asked && !readable.some((b) => b.business_id === asked.business_id)) {
      return { error: 'no_permission', message: `권한이 없습니다 — ${asked.name}의 장부를 볼 재무 권한이 없습니다. 필요하면 대표에게 요청하세요.` }
    }
    const today = kstToday()
    const period = PERIOD.test(str(input.period)) ? str(input.period) : today.slice(0, 7)
    const ledger = await ctx.repo.loadFinanceLedger()
    const rows = (asked ? [asked] : readable).map((b) => {
      const id = b.business_id
      const last = lastClosedPeriod(ledger, id)
      const entries = ledger.entries.filter((e) => e.business_id === id && e.entry_date.startsWith(period)).length
      return {
        business: b.name,
        business_id: id,
        last_closed: last,
        next_to_close: closablePeriod(ledger, id, today),
        period,
        period_closed: isPeriodLocked(ledger, id, period),
        period_ended: period < today.slice(0, 7),
        slips_in_period: entries,
        can_enter_slips: canKeepBooks(ctx.user, id),
        can_close: canCloseBooks(ctx.user, id),
        where: `/finance/${id}`,
      }
    })
    for (const r of rows.slice(0, 6)) {
      addEvidence(ctx, { label: `${r.business} · 월 마감`, href: r.where, detail: `마지막 마감 ${r.last_closed ?? '없음'} · ${r.period} ${r.period_closed ? '마감됨' : '열림'} · 전표 ${r.slips_in_period}장` })
    }
    return {
      today,
      rows,
      note:
        '마감은 회사 재무 화면의 «N월 마감» 버튼(마감 권한이 있는 사람에게만 보인다). 끝나지 않은 달은 마감할 수 없고, 앞선 달부터 순서대로 한다. ' +
        '마감된 달은 고치지 않는다 — 당월에 정정 전표로 바로잡는다. 마감 권한이 없으면 대표에게 요청한다.',
    }
  },
}

/* ---------------------------------------------------------------- 전표 입력 도움 */

export const financeInputHelpTool: AssistantTool = {
  def: {
    name: 'finance_input_help',
    description:
      '전표 입력 도움(읽기만) — 어디서 · 어떻게 넣는지, 자주 쓰는 전표 모양(차변 · 대변 계정), 입력이 잠긴 달, 계정과목 찾기(account_query: 이름 · 코드 일부). ' +
      '전표를 대신 넣지는 않는다.',
    input_schema: {
      type: 'object',
      properties: { business: { type: 'string' }, account_query: { type: 'string' } },
      required: ['business'],
    },
  },
  available: (ctx) => ctx.financeAllowed && webOnly(ctx),
  async run(input, ctx) {
    const visible = await ctx.businesses()
    const biz = resolveBusiness(str(input.business), visible)
    if (!biz) return { error: 'not_found', message: `회사를 찾지 못했습니다: «${str(input.business)}»`, businesses: bookCompanies(ctx, visible).map((b) => b.name) }
    if (!bookCompanies(ctx, visible).some((b) => b.business_id === biz.business_id)) {
      return { error: 'no_permission', message: `권한이 없습니다 — ${biz.name}의 장부에 대한 재무 권한이 없습니다. 필요하면 대표에게 요청하세요.` }
    }
    const ledger = await ctx.repo.loadFinanceLedger()
    const accounts = ledger.accounts.filter((a) => a.business_id === biz.business_id)
    const nameOf = new Map(accounts.map((a) => [a.account_code, a]))
    const q = norm(str(input.account_query, 40))
    const found = q ? accounts.filter((a) => norm(a.name).includes(q) || a.account_code.includes(q)).slice(0, 15) : []
    const href = `/finance/${biz.business_id}/journal`
    addEvidence(ctx, { label: `${biz.name} 전표`, href, detail: canKeepBooks(ctx.user, biz.business_id) ? '입력 가능' : '읽기만' })
    if (q) addEvidence(ctx, { label: `${biz.name} 계정과목`, href: `/finance/${biz.business_id}/accounts`, detail: `«${str(input.account_query, 40)}» ${found.length}건` })
    const locked = lastClosedPeriod(ledger, biz.business_id)
    return {
      business: biz.name,
      can_enter: canKeepBooks(ctx.user, biz.business_id),
      ...(canKeepBooks(ctx.user, biz.business_id) ? {} : { permission: `권한이 없습니다 — ${biz.name} 전표 입력 권한이 없습니다. 필요하면 대표에게 요청하세요.` }),
      where: `회사 재무 › 전표(${href})`,
      how: [
        '전표 일자 · 적요를 넣고, 줄마다 계정과 차변 또는 대변 금액을 넣는다(증빙 링크는 선택).',
        '차변 합과 대변 합이 같아야 저장된다.',
        locked ? `${locked}까지는 마감되어 그 달 날짜로는 넣을 수 없다 — 바꿀 것이 있으면 당월에 정정 전표로 넣는다.` : '아직 마감한 달이 없다.',
        '자주 쓰는 모양(아래 templates)을 고르면 계정이 채워지고, 회사에 그 계정이 없으면 비어서 나온다.',
      ],
      templates: JOURNAL_TEMPLATES.map((t) => ({
        label: t.label,
        lines: t.lines.map((l) => `${l.side === 'debit' ? '차변' : '대변'} ${nameOf.get(l.code)?.name ?? `(이 회사에 ${l.code} 계정 없음)`}`),
      })),
      accounts: q ? found.map((a) => ({ code: a.account_code, name: a.name, category: a.category, active: a.active })) : undefined,
      accounts_total: accounts.length,
    }
  },
}

/* ---------------------------------------------------------------- 문서 · 첨부 찾기 */

const ATTACH_HREF = (table: string, id: string) =>
  table === 'initiatives' ? `/initiatives/${id}` : table === 'businesses' ? `/business/${id}` : table === 'decisions' ? `/approvals?id=${id}` : `/documents/${id}`
const ON_KO: Record<string, string> = { initiatives: '이니셔티브', businesses: '회사', decisions: '결재', documents: '문서' }

export const searchDocumentsTool: AssistantTool = {
  def: {
    name: 'search_documents',
    description:
      '문서(문서함의 링크 문서)와 첨부 파일을 이름 · 종류 · 태그로 찾는다(이 사람이 볼 수 있는 것만, Vault 제외). query가 비면 최근 것. ' +
      '첨부 요약 내용이 필요하면 attachment_summaries를 쓴다.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' }, business: { type: 'string' } },
    },
  },
  available: webOnly,
  async run(input, ctx) {
    const visible = await ctx.businesses()
    const biz = str(input.business) ? resolveBusiness(str(input.business), visible) : null
    if (str(input.business) && !biz) return { error: 'not_found', message: `회사를 찾지 못했습니다: «${str(input.business)}»` }
    const name = new Map(visible.map((b) => [b.business_id, b.name]))
    const q = norm(str(input.query, 60))
    const [docs, files] = await Promise.all([ctx.repo.listDocuments().catch(() => []), ctx.repo.listRecentAttachments(null, 200).catch(() => [])])
    const hit = (...texts: (string | undefined | null)[]) => !q || texts.some((t) => t && norm(t).includes(q))
    const documents = docs
      .filter((d) => d.security_class !== 'Vault')
      .filter((d) => !biz || d.business_id === biz.business_id)
      .filter((d) => hit(d.title, d.doc_type, ...(d.tags ?? [])))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 20)
      .map((d) => ({
        id: d.document_id,
        title: d.title,
        type: d.doc_type,
        business: d.business_id === 'group' ? '그룹 공통' : (name.get(d.business_id) ?? d.business_id),
        version: d.version,
        tags: d.tags ?? [],
        created_at: d.created_at.slice(0, 10),
        link: `/documents/${d.document_id}`,
      }))
    const attachments = files
      .filter((a) => a.security_class !== 'Vault')
      .filter((a) => !biz || a.business_id === biz.business_id)
      .filter((a) => hit(a.file_name))
      .slice(0, 20)
      .map((a) => ({
        id: a.attachment_id,
        file_name: a.file_name,
        on: `${ON_KO[a.entity_table] ?? a.entity_table} ${a.entity_id}`,
        security_class: a.security_class,
        summary_status: a.status,
        created_at: a.created_at.slice(0, 10),
        link: ATTACH_HREF(a.entity_table, a.entity_id),
      }))
    for (const d of documents.slice(0, 4)) addEvidence(ctx, { label: `문서 · ${d.title}`, href: d.link, detail: `${d.business} · ${d.type} · v${d.version}` })
    for (const a of attachments.slice(0, 4)) addEvidence(ctx, { label: `첨부 · ${a.file_name}`, href: a.link, detail: a.on })
    if (!documents.length && !attachments.length) addEvidence(ctx, { label: '문서', href: '/documents', detail: q ? `«${str(input.query, 60)}» 0건` : '0건' })
    return { query: str(input.query, 60) || null, documents, attachments }
  },
}

/* ---------------------------------------------------------------- 내 업무 */

export const myTasksTool: AssistantTool = {
  def: {
    name: 'my_tasks',
    description: '내 업무(내가 담당인 것). filter: open(끝나지 않은 것, 기본) · overdue(기한 지남) · all.',
    input_schema: { type: 'object', properties: { filter: { type: 'string', enum: ['open', 'overdue', 'all'] } } },
  },
  available: webOnly,
  async run(input, ctx) {
    const today = kstToday()
    const filter = str(input.filter) || 'open'
    const mine = (await ctx.repo.listTasks()).filter((t) => t.owner === ctx.user.user_id)
    const rows = mine
      .filter((t) => filter === 'all' || t.status !== 'Done')
      .filter((t) => filter !== 'overdue' || (!!t.deadline && t.deadline < today))
      .sort((a, b) => (a.deadline ?? '9').localeCompare(b.deadline ?? '9'))
      .slice(0, 40)
      .map((t) => ({ id: t.task_id, title: t.title, status: t.status, priority: t.priority, deadline: t.deadline, overdue: !!t.deadline && t.deadline < today && t.status !== 'Done', link: `/tasks/${t.task_id}` }))
    for (const r of rows.slice(0, 6)) addEvidence(ctx, { label: r.title, href: r.link, detail: `${r.status} · 기한 ${r.deadline ?? '없음'}` })
    if (!rows.length) addEvidence(ctx, { label: '내 업무', href: '/me', detail: `조건(${filter}) 0건` })
    return { today, filter, count: rows.length, total_mine: mine.length, rows }
  },
}
