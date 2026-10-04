import 'server-only'

import { kstToday } from '@/lib/chairman-project'
import { isStale } from '@/lib/initiative'
import { FINANCE_METRIC, type FinanceMetric, type Initiative } from '@/types'

import { CalcError, evaluate, sumOf } from './calc'
import {
  addEvidence,
  auditRestrictedRead,
  INITIATIVE_ROLES,
  krw,
  norm,
  resolveBusiness,
  str,
  strList,
  type AssistantTool,
  type ToolContext,
} from './kit'

/**
 * 읽기 도구 1 — 계산기 · 회사 · 재무 · 이니셔티브. 합 · 비교 · 추이는 **여기서 계산해 돌려준다**:
 * 모델은 받은 숫자를 옮겨 말할 뿐 더하지 않는다(프롬프트가 그렇게 시키고, 합이 필요하면 이 도구들이
 * 이미 낸 total을 쓰거나 calculate를 부른다).
 */

const PNL: FinanceMetric[] = ['Revenue', 'Cost', 'EBITDA', 'OperatingProfit', 'NetIncome']
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

export const calculateTool: AssistantTool = {
  def: {
    name: 'calculate',
    description:
      '산수를 한다. 모델은 직접 더하거나 나누지 않는다 — 합 · 차 · 비율 · 평균이 필요하면 반드시 이 도구를 부른다. ' +
      '숫자 · + - * / % ^ · 괄호 · sum() avg() min() max() abs() round(값, 자리수)만 안다. 예: "(252000000-204000000)/204000000*100".',
    input_schema: {
      type: 'object',
      properties: { expression: { type: 'string', description: '계산할 식' }, label: { type: 'string', description: '무엇을 계산하는지(짧게)' } },
      required: ['expression'],
    },
  },
  available: () => true,
  async run(input) {
    const expression = str(input.expression, 2000)
    try {
      return { expression, result: evaluate(expression), computed_by: 'server' }
    } catch (e) {
      return { expression, error: e instanceof CalcError ? e.message : '계산하지 못했습니다.' }
    }
  },
}

export const businessesTool: AssistantTool = {
  def: {
    name: 'list_businesses',
    description: '이 사람이 볼 수 있는 회사 목록(id · 이름 · 상태). 회사 이름을 id로 바꿀 때 먼저 부른다.',
    input_schema: { type: 'object', properties: {} },
  },
  available: () => true,
  async run(_input, ctx) {
    return (await ctx.businesses()).map((b) => ({ id: b.business_id, name: b.name, status: b.status, industry: b.industry }))
  },
}

export const financeTool: AssistantTool = {
  def: {
    name: 'finance_query',
    description:
      '회사 하나의 월별 재무(원장에서 계산된 finance_kpis). 고른 달들의 줄과 **서버가 계산한 지표별 합계(total)**를 준다. ' +
      '요청한 달이 없으면 missing_periods와 있는 달(available_periods)을 준다 — 없는 달의 숫자를 만들지 말 것. ' +
      '«9월»처럼 해가 없으면 month만 넣는다(있는 해 전부가 온다). metric: Revenue 매출 · Cost 비용 · EBITDA · ' +
      'OperatingProfit 영업이익 · NetIncome 당기순이익 · Cash 현금 · AR 매출채권 · AP 매입채무. 기본은 손익 다섯.',
    input_schema: {
      type: 'object',
      properties: {
        business: { type: 'string', description: '회사 id 또는 이름(보이는 회사 목록에서)' },
        metrics: { type: 'array', items: { type: 'string', enum: [...FINANCE_METRIC] } },
        periods: { type: 'array', items: { type: 'string', description: 'YYYY-MM' } },
        month: { type: 'integer', minimum: 1, maximum: 12, description: '해 없이 달만 말했을 때' },
        from: { type: 'string', description: 'YYYY-MM (구간 시작)' },
        to: { type: 'string', description: 'YYYY-MM (구간 끝)' },
      },
      required: ['business'],
    },
  },
  available: (ctx) => ctx.financeAllowed && ctx.channel === 'web',
  async run(input, ctx) {
    const biz = resolveBusiness(str(input.business), await ctx.businesses())
    if (!biz) return { error: `회사를 찾지 못했습니다: «${str(input.business)}». list_businesses로 id를 확인하세요.` }
    const kpis = (await ctx.repo.listFinanceKpis()).filter((k) => k.business_id === biz.business_id)
    const available = [...new Set(kpis.map((k) => k.period))].sort()
    const metrics = (strList(input.metrics) as FinanceMetric[]).filter((m) => FINANCE_METRIC.includes(m))
    const want = metrics.length ? metrics : PNL

    let periods = strList(input.periods, 36).filter((p) => PERIOD.test(p))
    const month = Number(input.month)
    const from = str(input.from)
    const to = str(input.to)
    if (!periods.length && Number.isInteger(month) && month >= 1 && month <= 12) {
      const mm = String(month).padStart(2, '0')
      periods = available.filter((p) => p.endsWith(`-${mm}`))
      // 올해 그 달이 아직 없으면 그것도 알린다(«2026-09는 없습니다»).
      const thisYear = `${kstToday().slice(0, 4)}-${mm}`
      if (!periods.includes(thisYear)) periods.push(thisYear)
      periods.sort()
    } else if (!periods.length && PERIOD.test(from)) {
      const end = PERIOD.test(to) ? to : available.at(-1) ?? from
      periods = available.filter((p) => p >= from && p <= end)
      if (!periods.length) periods = [from]
    } else if (!periods.length) {
      periods = available.slice(-1)
    }

    const found = periods.filter((p) => available.includes(p))
    const missing = periods.filter((p) => !available.includes(p))
    const rows = kpis
      .filter((k) => found.includes(k.period) && want.includes(k.metric))
      .sort((a, b) => a.period.localeCompare(b.period) || want.indexOf(a.metric) - want.indexOf(b.metric))
      .map((k) => ({ period: k.period, metric: k.metric, value: k.value, basis: k.basis, source: k.source }))
    // 해 없이 «9월»을 물어 여러 해가 걸리면 해를 넘는 합은 내지 않는다 — «9월 합계»가 두 해를 더한 값으로 읽히면 틀린 숫자다.
    const crossYear = !!(Number.isInteger(month) && new Set(found.map((p) => p.slice(0, 4))).size > 1)
    const totals = crossYear ? null : Object.fromEntries(
      want.map((m) => {
        const vals = rows.filter((r) => r.metric === m).map((r) => r.value)
        return [m, { total: vals.length ? sumOf(vals) : null, months: vals.length, readable: vals.length ? krw(sumOf(vals)) : null }]
      }),
    )

    await auditRestrictedRead(ctx, { path: `/ai-assistant/finance/${biz.business_id}`, kind: 'finance', entity_table: 'finance_kpis', business_id: biz.business_id })
    for (const p of found) {
      const op = rows.find((r) => r.period === p && r.metric === 'OperatingProfit') ?? rows.find((r) => r.period === p)
      addEvidence(ctx, {
        label: `${biz.name} · ${p} 재무`,
        href: `/finance/${biz.business_id}/monthly`,
        detail: op ? `${op.metric} ${krw(op.value)} (${op.basis})` : undefined,
      })
    }
    if (!found.length) addEvidence(ctx, { label: `${biz.name} 재무`, href: `/finance/${biz.business_id}`, detail: `요청한 달 없음 · 있는 달 ${available[0] ?? '—'}~${available.at(-1) ?? '—'}` })

    return {
      business: { id: biz.business_id, name: biz.name },
      periods: found,
      missing_periods: missing,
      available_periods: available.length ? { first: available[0], last: available.at(-1), count: available.length } : null,
      rows,
      totals,
      per_period: crossYear
        ? Object.fromEntries(found.map((p) => [p, Object.fromEntries(rows.filter((r) => r.period === p).map((r) => [r.metric, { value: r.value, readable: krw(r.value) }]))]))
        : undefined,
      note: (crossYear ? '해가 여럿이라 합계를 내지 않았다 — 해마다 따로 말한다. ' : '') + 'total은 서버가 rows를 더한 값이다. basis: confirmed 확정 · provisional 잠정 · manual 시트 수기.',
      link: `/finance/${biz.business_id}`,
    }
  },
}

/* ---------------------------------------------------------------- 이니셔티브 */

function initiativeRow(i: Initiative, today: string) {
  return {
    id: i.initiative_id,
    title: i.title,
    kind: i.kind,
    stage: i.stage,
    status: i.status,
    business_id: i.business_id,
    target_date: i.target_date,
    next_action: i.next_action,
    next_action_date: i.next_action_date,
    next_action_owner: i.next_action_owner,
    blocker: i.blocker,
    overdue_next_action: !!i.next_action_date && i.next_action_date < today && i.status === 'Active',
    stale: isStale(i, today),
    link: `/initiatives/${i.initiative_id}`,
  }
}

/** id · 제목으로 한 건을 찾는다. 여럿이 걸리면 후보를 준다(고르지 않는다). */
export async function findInitiative(ctx: ToolContext, query: string): Promise<{ hit: Initiative | null; candidates: Initiative[] }> {
  const q = norm(query)
  const list = await ctx.repo.listInitiatives()
  const byId = list.find((i) => i.initiative_id === query.trim())
  if (byId) return { hit: byId, candidates: [] }
  const exact = list.filter((i) => norm(i.title) === q)
  if (exact.length === 1) return { hit: exact[0], candidates: [] }
  const partial = q ? list.filter((i) => norm(i.title).includes(q) || (q.length >= 3 && q.includes(norm(i.title)))) : []
  if (partial.length === 1 && exact.length === 0) return { hit: partial[0], candidates: [] }
  return { hit: null, candidates: exact.length ? exact : partial }
}

export const initiativesTool: AssistantTool = {
  def: {
    name: 'list_initiatives',
    description:
      '회장의 이니셔티브(신사업 · 딜 · 투자유치 등) 목록. filter: all · no_target_date(목표일 없음 = «기한 없는») · ' +
      'no_next_action_date(다음 행동 날짜 없음) · overdue_next_action(다음 행동 날짜 지남) · stale(14일 이상 안 고침). ' +
      '기본은 진행 중(Active)만, include_closed=true면 종료 · 접음도.',
    input_schema: {
      type: 'object',
      properties: {
        filter: { type: 'string', enum: ['all', 'no_target_date', 'no_next_action_date', 'overdue_next_action', 'stale'] },
        query: { type: 'string', description: '제목에 들어간 말' },
        include_closed: { type: 'boolean' },
      },
    },
  },
  staffDescription:
    '그룹 이니셔티브(신사업 · 딜 · 투자유치 등) 목록. filter: all · no_target_date(목표일 없음 = «기한 없는») · ' +
    'no_next_action_date(다음 행동 날짜 없음) · overdue_next_action(다음 행동 날짜 지남) · stale(14일 이상 안 고침). ' +
    '기본은 진행 중(Active)만, include_closed=true면 종료 · 접음도.',
  // 카카오도 목록은 읽는다(AI Agent 세션은 0017에서 이니셔티브 읽기가 있다). 상세(메모 · 첨부)는 앱에서만.
  available: (ctx) => INITIATIVE_ROLES.has(ctx.user.role),
  async run(input, ctx) {
    const today = kstToday()
    const filter = str(input.filter) || 'all'
    const q = norm(str(input.query))
    const all = await ctx.repo.listInitiatives()
    const rows = all
      .filter((i) => input.include_closed === true || i.status === 'Active')
      .filter((i) => !q || norm(i.title).includes(q))
      .map((i) => initiativeRow(i, today))
      .filter((r) =>
        filter === 'no_target_date' ? !r.target_date
        : filter === 'no_next_action_date' ? !r.next_action_date
        : filter === 'overdue_next_action' ? r.overdue_next_action
        : filter === 'stale' ? r.stale
        : true,
      )
    for (const r of rows.slice(0, 8)) {
      addEvidence(ctx, { label: r.title, href: r.link, detail: `목표일 ${r.target_date ?? '없음'} · 다음 행동 ${r.next_action || '—'} (${r.next_action_date ?? '날짜 없음'})` })
    }
    if (!rows.length) addEvidence(ctx, { label: '이니셔티브 목록', href: '/initiatives', detail: `조건(${filter})에 맞는 건 0건 · 전체 ${all.length}건` })
    return { today, filter, count: rows.length, total_initiatives: all.length, rows: rows.slice(0, 40) }
  },
}

export const initiativeTool: AssistantTool = {
  def: {
    name: 'get_initiative',
    description:
      '이니셔티브 한 건의 전부(칸 · 키맨 · 문서 링크 · 일정 · 첨부 요약 · 회장 메모[회장만]). id 또는 제목으로 찾는다. ' +
      '못 찾으면 found=false와 후보를 준다 — 없는 건을 지어내지 말 것.',
    input_schema: { type: 'object', properties: { id_or_title: { type: 'string' } }, required: ['id_or_title'] },
  },
  staffDescription:
    '이니셔티브 한 건의 전부(칸 · 키맨 · 문서 링크 · 일정 · 첨부 요약). id 또는 제목으로 찾는다. ' +
    '못 찾으면 found=false와 후보를 준다 — 없는 건을 지어내지 말 것.',
  available: (ctx) => INITIATIVE_ROLES.has(ctx.user.role) && ctx.channel === 'web',
  async run(input, ctx) {
    const { hit, candidates } = await findInitiative(ctx, str(input.id_or_title))
    if (!hit) {
      return {
        found: false,
        query: str(input.id_or_title),
        candidates: candidates.slice(0, 8).map((i) => ({ id: i.initiative_id, title: i.title })),
        total_initiatives: (await ctx.repo.listInitiatives()).length,
      }
    }
    const [keymen, docs, events, note, attachments] = await Promise.all([
      ctx.repo.listInitiativeKeymen().catch(() => []),
      ctx.repo.listInitiativeDocs().catch(() => []),
      ctx.repo.listEvents().catch(() => []),
      ctx.user.role === 'Chairman' ? ctx.repo.getInitiativeNote(hit.initiative_id).catch(() => null) : Promise.resolve(null),
      ctx.repo.listAttachments('initiatives', hit.initiative_id).catch(() => []),
    ])
    const row = initiativeRow(hit, kstToday())
    addEvidence(ctx, { label: hit.title, href: row.link, detail: `다음 행동: ${hit.next_action || '—'} (${hit.next_action_date ?? '날짜 없음'})` })
    return {
      found: true,
      initiative: { ...row, goal: hit.goal, updated_at: hit.updated_at },
      keymen: keymen.filter((k) => k.initiative_id === hit.initiative_id).map((k) => ({ name: k.name, relation: k.relation, last_contact_on: k.last_contact_on })),
      docs: docs.filter((d) => d.initiative_id === hit.initiative_id).map((d) => ({ title: d.title })),
      events: events.filter((e) => e.initiative_id === hit.initiative_id).map((e) => ({ title: e.title, starts_on: e.starts_on, kind: e.kind })),
      // 회장 메모 칸은 회장에게만 싣는다 — 다른 역할에는 칸 이름도 보내지 않는다(직원 화면 용어 원칙).
      ...(ctx.user.role === 'Chairman' ? { chairman_note: note } : {}),
      attachments: attachments
        .filter((a) => a.security_class !== 'Vault')
        .map((a) => ({ id: a.attachment_id, file_name: a.file_name, status: a.status, security_class: a.security_class, summary: a.ai_summary?.summary ?? null })),
    }
  },
}
