import 'server-only'

import { RULE_UNIT } from '@/lib/attention/brief'
import { canReadExceptions } from '@/lib/attention/screen'
import { kstToday } from '@/lib/chairman-project'
import { ATTACHMENT_ENTITY, type AttachmentEntity } from '@/types'

import { sumOf } from './calc'
import { addEvidence, auditRestrictedRead, krw, resolveBusiness, str, type AssistantTool } from './kit'

/**
 * 읽기 도구 2 — 결재 · 캘린더 · 조직 · 첨부 요약 · 의존도 · 주의(Attention) · Direction.
 * 전부 질문한 사람의 repo로 읽는다(RLS). 여기서 더 거르는 것은 셋뿐이다:
 * Vault 첨부(어느 도구도 싣지 않는다), 재무 권한 없는 사람의 금액, 회장 전용(선언문 · Direction).
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/

export const approvalsTool: AssistantTool = {
  def: {
    name: 'list_approvals',
    description:
      '결재(decisions) 목록. status(Open 대기 · Approved · Rejected …), business, template(purchase 구매 등)로 거른다. ' +
      '구매 결재는 금액(form.amount)과 **서버가 계산한 합계**를 같이 준다.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        business: { type: 'string' },
        template: { type: 'string' },
        month: { type: 'string', description: 'YYYY-MM — 마감일(deadline)이 그 달인 것만' },
      },
    },
  },
  available: () => true,
  async run(input, ctx) {
    const businesses = await ctx.businesses()
    const biz = str(input.business) ? resolveBusiness(str(input.business), businesses) : null
    if (str(input.business) && !biz) return { error: `회사를 찾지 못했습니다: «${str(input.business)}»` }
    const name = new Map(businesses.map((b) => [b.business_id, b.name]))
    const status = str(input.status)
    const template = str(input.template)
    const month = str(input.month)
    const rows = (await ctx.repo.listDecisions())
      .filter((d) => !status || d.status.toLowerCase() === status.toLowerCase())
      .filter((d) => !biz || d.business_id === biz.business_id)
      .filter((d) => !template || d.template_key === template)
      .filter((d) => !/^\d{4}-\d{2}$/.test(month) || d.deadline?.startsWith(month))
      .slice(0, 60)
      .map((d) => {
        const amount = Number(String(d.form?.amount ?? '').replace(/[^0-9.-]/g, ''))
        return {
          id: d.decision_id,
          title: d.title,
          business: name.get(d.business_id) ?? d.business_id,
          status: d.status,
          deadline: d.deadline,
          template: d.template_key ?? null,
          amount: d.form?.amount && Number.isFinite(amount) ? amount : null,
          options: d.options,
          link: `/approvals?id=${d.decision_id}`,
        }
      })
    for (const r of rows.slice(0, 6)) addEvidence(ctx, { label: r.title, href: r.link, detail: `${r.business} · ${r.status} · 마감 ${r.deadline ?? '—'}${r.amount !== null ? ` · ${krw(r.amount)}` : ''}` })
    const amounts = rows.map((r) => r.amount).filter((a): a is number => a !== null)
    return { count: rows.length, rows, amount_total: amounts.length ? { total: sumOf(amounts), readable: krw(sumOf(amounts)), counted: amounts.length } : null }
  },
}

export const calendarTool: AssistantTool = {
  def: {
    name: 'list_calendar',
    description: '캘린더(일정 · 이니셔티브 다음 행동 · 마일스톤 · 결재 마감). from~to(YYYY-MM-DD, 포함). 기본은 오늘부터 14일.',
    input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
  },
  available: () => true,
  async run(input, ctx) {
    const today = kstToday()
    const from = DATE.test(str(input.from)) ? str(input.from) : today
    const toRaw = str(input.to)
    const to = DATE.test(toRaw) ? toRaw : new Date(Date.parse(`${from}T00:00:00Z`) + 13 * 86_400_000).toISOString().slice(0, 10)
    const items = await ctx.repo.listCalendarItems(from, to)
    for (const i of items.slice(0, 6)) addEvidence(ctx, { label: i.title, href: i.href || '/calendar', detail: `${i.on_date} · ${i.kind}` })
    if (!items.length) addEvidence(ctx, { label: '캘린더', href: '/calendar', detail: `${from}~${to} 0건` })
    return { from, to, count: items.length, items: items.slice(0, 60) }
  },
}

export const orgTool: AssistantTool = {
  def: {
    name: 'org_lookup',
    description: '조직: 이 사람이 볼 수 있는 팀 목록, query를 주면 이름으로 사람을 찾는다(이름 · id만).',
    input_schema: { type: 'object', properties: { query: { type: 'string' } } },
  },
  available: () => true,
  async run(input, ctx) {
    const [teams, businesses] = await Promise.all([ctx.repo.listTeams().catch(() => []), ctx.businesses()])
    const name = new Map(businesses.map((b) => [b.business_id, b.name]))
    const q = str(input.query, 40)
    const people = q ? await ctx.repo.searchSharePeople(q).catch(() => []) : []
    return {
      teams: teams.map((t) => ({ id: t.team_id, name: t.name, business: name.get(t.business_id) ?? t.business_id, has_lead: !!t.lead_user_id })),
      people: people.slice(0, 20).map((p) => ({ id: p.user_id, name: p.display_name, name_en: p.display_name_en })),
    }
  },
}

export const attachmentsTool: AssistantTool = {
  def: {
    name: 'attachment_summaries',
    description:
      '첨부 파일의 AI 요약(3줄 · 핵심 숫자 · 필요한 결정 · 다음 행동). entity_table(initiatives · businesses · documents · decisions)과 ' +
      'entity_id를 주면 그 대상의 첨부, 없으면 최근 첨부. Vault 등급은 싣지 않는다.',
    input_schema: {
      type: 'object',
      properties: { entity_table: { type: 'string', enum: [...ATTACHMENT_ENTITY] }, entity_id: { type: 'string' } },
    },
  },
  available: (ctx) => ctx.channel === 'web',
  async run(input, ctx) {
    const table = str(input.entity_table) as AttachmentEntity
    const id = str(input.entity_id, 64)
    const list = ATTACHMENT_ENTITY.includes(table) && id
      ? await ctx.repo.listAttachments(table, id)
      : await ctx.repo.listRecentAttachments(null, 20)
    const rows = list
      .filter((a) => a.security_class !== 'Vault')
      .map((a) => ({
        id: a.attachment_id,
        file_name: a.file_name,
        on: `${a.entity_table}/${a.entity_id}`,
        security_class: a.security_class,
        status: a.status,
        summary: a.ai_summary ? { lines: a.ai_summary.summary_ko ?? a.ai_summary.summary, key_numbers: a.ai_summary.key_numbers, decisions_needed: a.ai_summary.decisions_needed, next_actions: a.ai_summary.next_actions } : null,
      }))
    for (const a of list.filter((x) => x.security_class === 'Restricted' && x.ai_summary)) {
      await auditRestrictedRead(ctx, { path: `/ai-assistant/attachments/${a.attachment_id}`, kind: 'document', entity_table: 'attachments', entity_id: a.attachment_id, business_id: a.business_id })
    }
    const hrefOf = (on: string) => {
      const [t, i] = on.split('/')
      return t === 'initiatives' ? `/initiatives/${i}` : t === 'businesses' ? `/business/${i}` : t === 'decisions' ? `/approvals?id=${i}` : '/documents'
    }
    for (const r of rows.slice(0, 5)) addEvidence(ctx, { label: `첨부 · ${r.file_name}`, href: hrefOf(r.on), detail: r.summary?.lines?.[0] ?? `요약 ${r.status}` })
    return { count: rows.length, vault_hidden: list.length - rows.length, rows }
  },
}

export const dependencyTool: AssistantTool = {
  def: {
    name: 'dependency',
    description: '회사 하나의 회장 의존도(§7 영역별 수준 · 이양 상태 · 목표일)와 분기 자율성 평가.',
    input_schema: { type: 'object', properties: { business: { type: 'string' } }, required: ['business'] },
  },
  // 의존도 · 주의는 회장 전용 화면이다 — 다른 역할에게는 도구째 주지 않는다(근거 링크 /dependency · /attention도 함께 닫힌다).
  available: (ctx) => ctx.user.role === 'Chairman' && ctx.channel === 'web',
  async run(input, ctx) {
    const biz = resolveBusiness(str(input.business), await ctx.businesses())
    if (!biz) return { error: `회사를 찾지 못했습니다: «${str(input.business)}»` }
    const [areas, autonomy] = await Promise.all([ctx.repo.listDependencyAreas(), ctx.repo.listAutonomyAssessments()])
    const mine = areas.filter((a) => a.business_id === biz.business_id)
    addEvidence(ctx, { label: `${biz.name} 의존도`, href: `/dependency/${biz.business_id}`, detail: `영역 ${mine.length}개` })
    return {
      business: biz.name,
      areas: mine.map((a) => ({ area: a.area, level: a.level ?? '평가 없음', transfer: a.transfer_status ?? '계획 없음', target_date: a.target_date, note: a.note })),
      autonomy: autonomy.filter((a) => a.business_id === biz.business_id).map((a) => ({ quarter: a.quarter, level: a.level, note: a.note })),
    }
  },
}

export const attentionTool: AssistantTool = {
  def: {
    name: 'attention',
    description:
      '주의(Attention) — 회사가 왜 RED · YELLOW인가. 걸린 규칙 · 잰 값 · 임계 · AI 분석 · 점수의 여섯 축(모르는 축 수). ' +
      '«왜 DY yellow» 같은 질문은 이것으로 근거를 설명한다.',
    input_schema: { type: 'object', properties: { business: { type: 'string' }, include_closed: { type: 'boolean' } } },
  },
  available: (ctx) => ctx.user.role === 'Chairman' && ctx.channel === 'web',
  async run(input, ctx) {
    // 0035: 예외의 독자는 [제한] 등급 독자뿐 — 그 밖의 역할에게 «0건»이라 말하면 거짓이다.
    if (!canReadExceptions(ctx.user.role)) return { readable: false, note: '이 계정은 이 자료를 볼 수 없습니다 — 0건이 아니라 권한 밖입니다.' }
    const businesses = await ctx.businesses()
    const biz = str(input.business) ? resolveBusiness(str(input.business), businesses) : null
    if (str(input.business) && !biz) return { error: `회사를 찾지 못했습니다: «${str(input.business)}»` }
    const [exceptions, scores, rules] = await Promise.all([ctx.repo.listExceptions(), ctx.repo.listAttentionScores(), ctx.repo.listExceptionRules()])
    const name = new Map(businesses.map((b) => [b.business_id, b.name]))
    const rule = new Map(rules.map((r) => [r.rule_key, r]))
    const rows = exceptions
      .filter((e) => !biz || e.business_id === biz.business_id)
      .filter((e) => input.include_closed === true || e.status !== 'closed')
      .slice(0, 30)
      .map((e) => {
        const s = scores.find((x) => x.exception_id === e.id)
        const r = rule.get(e.rule_key)
        return {
          business: name.get(e.business_id) ?? e.business_id,
          severity: e.severity,
          rule: r?.name ?? e.rule_key,
          metric: r?.metric ?? null,
          comparator: r?.comparator ?? null,
          period: e.period,
          value: ctx.financeAllowed ? e.value : null,
          threshold: ctx.financeAllowed ? e.threshold : null,
          unit: RULE_UNIT[e.rule_key] ?? null,
          analysis: e.ai_analysis,
          status: e.status,
          score: s ? { score: s.score, level: s.level, unknown_axes: s.unknown_axes } : null,
        }
      })
    if (ctx.financeAllowed && rows.length) {
      await auditRestrictedRead(ctx, { path: `/ai-assistant/attention${biz ? `/${biz.business_id}` : ''}`, kind: 'finance', entity_table: 'exceptions', business_id: biz?.business_id ?? null })
    }
    for (const r of rows.slice(0, 5)) addEvidence(ctx, { label: `${r.business} · ${r.severity} · ${r.rule}`, href: '/attention', detail: r.value !== null ? `값 ${r.value}${r.unit ?? ''} / 임계 ${r.threshold}${r.unit ?? ''}` : r.analysis ?? undefined })
    if (!rows.length) addEvidence(ctx, { label: '주의(Attention)', href: '/attention', detail: biz ? `${biz.name} 열린 예외 0건` : '열린 예외 0건' })
    return { readable: true, count: rows.length, rows, amounts_hidden: !ctx.financeAllowed }
  },
}

export const directionTool: AssistantTool = {
  def: {
    name: 'chairman_direction',
    description: '회장 전용: 회장 선언문과 회사별 Direction(5년 · 우선순위 · 하지 말 것 · 레드라인 …).',
    input_schema: { type: 'object', properties: { business: { type: 'string' } } },
  },
  // 선언문 · Direction은 회장 세션에서만(회장 지시). 도구 자체를 다른 역할에게 주지 않는다.
  available: (ctx) => ctx.user.role === 'Chairman' && ctx.channel === 'web',
  async run(input, ctx) {
    const businesses = await ctx.businesses()
    const biz = str(input.business) ? resolveBusiness(str(input.business), businesses) : null
    const [manifesto, directions] = await Promise.all([ctx.repo.getChairmanManifesto(), ctx.repo.listChairmanDirections()])
    addEvidence(ctx, { label: '회장 선언문', href: '/settings/chairman' })
    return {
      manifesto: manifesto.body || null,
      directions: directions
        .filter((d) => !biz || d.business_id === biz.business_id)
        .map((d) => ({ business: businesses.find((b) => b.business_id === d.business_id)?.name ?? d.business_id, ...d })),
    }
  },
}

