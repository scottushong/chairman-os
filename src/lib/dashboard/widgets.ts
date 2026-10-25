import 'server-only'

import { canReadBooks } from '@/lib/auth/roles'
import { kstToday } from '@/lib/chairman-project'
import { DATA_MODE } from '@/lib/env'
import { featureOn } from '@/lib/features-server'
import { computeBs, computeCash, computeDebt, addMonths } from '@/lib/finance-overview/engine'
import { eok, pctText, yearMonthKo } from '@/lib/finance-overview/format'
import { grainMonths, plSum } from '@/lib/finance-overview/grain'
import { computeKpis } from '@/lib/finance-overview/kpis'
import { loadOverview, type LoadedOverview } from '@/lib/finance-overview/load'
import { kindAllowed, widgetData, type DataScope, type HomeAccess } from '@/lib/home/data'
import { widgetDef, type Tone, type WidgetData, type WidgetItem, type WidgetStat } from '@/lib/home/widgets'
import { day, krw, seoulDateTime } from '@/lib/investment/format'
import { dashboardKpis, loadRadar } from '@/lib/investment/view'
import { latestNightOutputs } from '@/lib/night-brief-view'
import { getRepository, type ChairmanRepository } from '@/lib/repository'
import type { Business, SessionUser } from '@/types'

/**
 * 0097 대표 첫 화면 위젯 내용 — 위젯마다 **그 기능의 기존 조회 · 기존 문** 그대로(위젯을 더해도 볼 수 있는 것이 늘지 않는다).
 *   오늘의 경영 판단  repo.listAiNightOutputs()(0013 · 아침 루틴 — 대표만) → 최신 회차의 항목(중요도 순). 회사 범위 = 그 회사 줄만.
 *   재무 지표 · 자금 전망 · 자료 체크표 · 계열사 현황
 *                    /finance와 같은 loadOverview + 엔진(대표 · 그룹 CFO · can_read_books RLS). 달 = /finance 기본(지난달).
 *                    «전체 계열사» = 읽을 수 있는 회사마다 계산해 더한다(자료 없는 회사는 빼고 그렇게 적는다).
 *   투자 KPI · 매수가 도달 · 아침 투자 브리핑 · 투자 알림 · 월 투자금 집행
 *                    /investment와 같은 저장소 함수(inv_reader RLS — 대표 · 지정자). 회사 범위와 무관(대양산업 법인 투자).
 *   기억 검토함       repo.listMemoryReviews({status:'open'})(0088 — 대표만).
 * 숫자가 없으면 지어내지 않는다 — «자료 부족: 무엇이 필요한지». 한 위젯 실패는 그 위젯만(라우트가 위젯마다 따로 부른다).
 */

const LIST_MAX = 5

/** 같은 사람 · 회사 · 달의 재무 계산을 위젯 넷이 나눠 쓴다(한 화면이 같은 숫자를 네 번 읽지 않게) — 60초. 사람 세션의 RLS로 읽은 값이라 사람 id가 열쇠다. */
const G = globalThis as { __dashFin?: Map<string, { at: number; p: Promise<LoadedOverview> }> }
function overviewOnce(repo: ChairmanRepository, user: SessionUser, biz: string, period: string, today: string, auto: boolean): Promise<LoadedOverview> {
  const cache = (G.__dashFin ??= new Map())
  const key = `${user.user_id}|${biz}|${period}|${today}|${auto ? 1 : 0}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 60_000) return hit.p
  for (const [k, v] of cache) if (Date.now() - v.at >= 60_000) cache.delete(k)
  const p = loadOverview(repo, biz, period, today, { auto })
  p.catch(() => cache.delete(key))
  cache.set(key, { at: Date.now(), p })
  return p
}

interface FinOne {
  business: Business
  /** null = 이 회사는 재무 현황이 꺼졌거나 못 읽음. */
  loaded: LoadedOverview | null
  error: boolean
}

/** 범위 안의 회사(등록된 회사 · 보관 아님 · 장부를 읽을 수 있는 회사 · 스위치 finance_overview). */
async function financeCompanies(repo: ChairmanRepository, user: SessionUser, scope: DataScope): Promise<{ list: FinOne[]; period: string }> {
  const today = kstToday()
  const period = addMonths(today.slice(0, 7), -1)
  const businesses = (await repo.listBusinesses())
    .filter((b) => b.status !== 'Archived' && canReadBooks(user, b.business_id))
    .filter((b) => scope.biz === 'all' || b.business_id === scope.biz)
    .sort((a, b) => a.sort_order - b.sort_order)
  const list = await Promise.all(
    businesses.map(async (b): Promise<FinOne> => {
      if (!(await featureOn(user, 'finance_overview', b.business_id))) return { business: b, loaded: null, error: false }
      try {
        const auto = await featureOn(user, 'finance_auto', b.business_id)
        return { business: b, loaded: await overviewOnce(repo, user, b.business_id, period, today, auto), error: false }
      } catch (e) {
        console.error('[dashboard] 재무 읽기 실패', b.business_id, e)
        return { business: b, loaded: null, error: true }
      }
    }),
  )
  return { list, period }
}

/** 재무 현황 «요약» 위 다섯 칸과 같은 값(월 기준). */
function fiveOf(l: LoadedOverview, period: string) {
  const cur = plSum(l.ctx, grainMonths(period, 'month'))
  const prev = plSum(l.ctx, grainMonths(addMonths(period, -1), 'month'))
  const bs = computeBs(l.ctx, period)
  const cash = computeCash(l.ctx, period, bs)
  const debt = computeDebt(l.ctx, period)
  return { revenue: cur.revenue, gross: cur.gross, op: cur.op, cash: cash.closing, debt: debt.total, revenuePrev: prev.revenue }
}

const sumOf = (xs: (number | null)[]) => (xs.some((x) => x !== null) ? xs.reduce<number>((s, x) => s + (x ?? 0), 0) : null)

function scopeName(list: FinOne[], scope: DataScope) {
  return scope.biz === 'all' ? `전체 계열사 ${list.length}곳` : (list[0]?.business.name ?? scope.biz)
}

async function finKpis(repo: ChairmanRepository, user: SessionUser, scope: DataScope): Promise<WidgetData> {
  const { list, period } = await financeCompanies(repo, user, scope)
  if (list.length === 0) return { state: 'denied', text: scope.biz === 'all' ? '장부를 읽을 수 있는 회사가 없습니다.' : '이 회사의 장부를 읽을 수 없습니다.' }
  const got = list.filter((x) => x.loaded)
  if (got.length === 0) return list.some((x) => x.error) ? { state: 'error', text: '재무 현황을 불러오지 못했습니다.' } : { state: 'pending', text: '재무 현황이 꺼진 회사입니다(기능 설정).' }
  const rows = got.map((x) => fiveOf(x.loaded!, period))
  const t = { revenue: sumOf(rows.map((r) => r.revenue)), gross: sumOf(rows.map((r) => r.gross)), op: sumOf(rows.map((r) => r.op)), cash: sumOf(rows.map((r) => r.cash)), debt: sumOf(rows.map((r) => r.debt)), prev: sumOf(rows.map((r) => r.revenuePrev)) }
  const many = got.length > 1
  type Five = 'revenue' | 'gross' | 'op' | 'cash' | 'debt'
  const part = (k: Five, need: string) => {
    if (t[k] === null) return `자료 부족: ${need}`
    const have = rows.filter((r) => r[k] !== null).length
    return many && have < got.length ? `${got.length}곳 중 ${have}곳 자료` : null
  }
  const mom = t.revenue !== null && t.prev ? (t.revenue - t.prev) / Math.abs(t.prev) : null
  const margin = (v: number | null) => (v !== null && t.revenue ? ` · ${((v / t.revenue) * 100).toFixed(1)}%` : '')
  const href = scope.biz === 'all' ? '/finance' : `/finance?biz=${encodeURIComponent(scope.biz)}&month=${period}`
  const stats: WidgetStat[] = [
    { label: '매출액', value: eok(t.revenue), sub: part('revenue', '판매현황 · 계정별 원장') ?? (mom !== null ? `전월 ${pctText(mom * 100)}` : null), tone: (mom ?? 0) >= 0 ? 'up' : 'down', href },
    { label: '매출총이익', value: eok(t.gross), sub: part('gross', '계정별 원장 또는 월별 손익계산서') ?? (margin(t.gross).slice(3) || null), href },
    { label: '영업이익', value: eok(t.op), sub: part('op', '계정별 원장 또는 월별 손익계산서') ?? (margin(t.op).slice(3) || null), tone: (t.op ?? 0) >= 0 ? 'up' : 'down', href },
    { label: '기말 현금', value: eok(t.cash), sub: part('cash', '월별 자금흐름표'), href },
    { label: '차입 잔액', value: eok(t.debt), sub: part('debt', '대출현황 · 차입금'), href },
  ]
  const off = list.length - got.length
  return {
    state: 'ok',
    count: got.length,
    items: [],
    stats,
    hideCount: true,
    status: stats.every((s) => s.value !== '—' && !s.sub?.startsWith('자료 부족')) ? 'LIVE' : 'PARTIAL',
    basis: `${yearMonthKo(period)} · ${scopeName(list, scope)}${many ? ' 합계' : ''} · 잠정(자동 계산)`,
    note: off ? `재무 현황이 꺼졌거나 읽지 못한 회사 ${off}곳은 뺐습니다.` : undefined,
  }
}

async function cashForecast(repo: ChairmanRepository, user: SessionUser, scope: DataScope): Promise<WidgetData> {
  const { list, period } = await financeCompanies(repo, user, scope)
  if (list.length === 0) return { state: 'denied', text: '이 범위의 장부를 읽을 수 없습니다.' }
  const got = list.filter((x) => x.loaded)
  if (got.length === 0) return list.some((x) => x.error) ? { state: 'error', text: '재무 현황을 불러오지 못했습니다.' } : { state: 'pending', text: '재무 현황이 꺼진 회사입니다(기능 설정).' }
  const k8 = got.map((x) => ({ b: x.business, k: computeKpis(x.loaded!.ctx, period).find((k) => k.no === 8) ?? null }))
  const tone = (t: string | undefined): { text: string; tone: Tone } =>
    t === 'good' ? { text: '괜찮음', tone: 'green' } : t === 'warn' ? { text: '살펴볼 것', tone: 'orange' } : t === 'bad' ? { text: '조치 필요', tone: 'red' } : { text: '자료 부족', tone: 'gray' }
  if (got.length === 1) {
    const k = k8[0].k
    return {
      state: 'ok',
      count: 1,
      items: [],
      hideCount: true,
      stats: [{ label: k?.title ?? '자금 전망 (3개월)', value: k?.value ?? '자료 부족', sub: k?.need ? `필요한 것: ${k.need}` : (k?.aside ?? null), tone: k?.asideTone === 'down' ? 'down' : 'muted', href: `/finance?biz=${encodeURIComponent(got[0].business.business_id)}&tab=kpi` }],
      text: k && !k.need ? `${k.detail} → ${k.answer}` : undefined,
      status: k && !k.need ? 'LIVE' : 'PARTIAL',
      basis: `${yearMonthKo(period)} 기준 · ${got[0].business.name}`,
    }
  }
  return {
    state: 'ok',
    count: got.length,
    items: [],
    hideCount: true,
    table: {
      head: ['회사', '3개월 최저 잔액', '판단'],
      numeric: [1],
      rows: k8.map(({ b, k }) => ({ id: b.business_id, cells: [b.name, k?.need ? '—' : `${k?.value.replace(/^최저 잔액 /, '') ?? '—'}${k?.aside ? ` (${k.aside})` : ''}`, ''], href: `/finance?biz=${encodeURIComponent(b.business_id)}&tab=kpi`, badge: tone(k?.tone) })),
    },
    status: k8.every((x) => x.k && !x.k.need) ? 'LIVE' : 'PARTIAL',
    basis: `${yearMonthKo(period)} 기준 · ${scopeName(list, scope)} · 회사마다(더하지 않음 — 자금은 회사 사이에 옮겨지지 않는다)`,
  }
}

async function finChecklist(repo: ChairmanRepository, user: SessionUser, scope: DataScope): Promise<WidgetData> {
  const { list, period } = await financeCompanies(repo, user, scope)
  if (list.length === 0) return { state: 'denied', text: '이 범위의 장부를 읽을 수 없습니다.' }
  const got = list.filter((x) => x.loaded)
  if (got.length === 0) return list.some((x) => x.error) ? { state: 'error', text: '재무 현황을 불러오지 못했습니다.' } : { state: 'pending', text: '재무 현황이 꺼진 회사입니다(기능 설정).' }
  if (got.length === 1) {
    const c = got[0].loaded!.checklist
    const missing = c.filter((x) => x.state === 'missing')
    const warn = c.filter((x) => x.state === 'warn')
    return {
      state: 'ok',
      count: missing.length,
      items: [...missing, ...warn].slice(0, LIST_MAX).map((x) => ({
        id: x.key,
        title: x.label,
        href: `/finance/${encodeURIComponent(got[0].business.business_id)}/upload?month=${period}`,
        badge: x.state === 'missing' ? { text: '없음', tone: 'red' as Tone } : { text: '확인', tone: 'orange' as Tone },
      })),
      stats: [{ label: '받은 자료', value: `${c.length - missing.length}/${c.length}`, sub: warn.length ? `확인할 것 ${warn.length}` : null }],
      status: missing.length ? 'PARTIAL' : 'LIVE',
      basis: `${yearMonthKo(period)} · ${got[0].business.name} · 건수 = 없는 자료`,
    }
  }
  return {
    state: 'ok',
    count: got.reduce((s, x) => s + x.loaded!.checklist.filter((c) => c.state === 'missing').length, 0),
    items: [],
    table: {
      head: ['회사', '받은 자료', '없음'],
      numeric: [1, 2],
      rows: got.map((x) => {
        const c = x.loaded!.checklist
        const miss = c.filter((i) => i.state === 'missing').length
        return { id: x.business.business_id, cells: [x.business.name, `${c.length - miss}/${c.length}`, String(miss)], href: `/finance?biz=${encodeURIComponent(x.business.business_id)}&month=${period}` }
      }),
    },
    basis: `${yearMonthKo(period)} · ${scopeName(list, scope)} · 건수 = 없는 자료 합계`,
  }
}

async function companies(repo: ChairmanRepository, user: SessionUser, scope: DataScope): Promise<WidgetData> {
  const { list, period } = await financeCompanies(repo, user, scope)
  if (list.length === 0) return { state: 'denied', text: '장부를 읽을 수 있는 회사가 없습니다.' }
  return {
    state: 'ok',
    count: list.length,
    items: [],
    table: {
      head: ['회사', '매출', '영업이익', '기말 현금', '자료'],
      numeric: [1, 2, 3, 4],
      rows: list.map((x) => {
        if (!x.loaded) return { id: x.business.business_id, cells: [x.business.name, '—', '—', '—', x.error ? '읽기 실패' : '꺼짐'], href: `/finance?biz=${encodeURIComponent(x.business.business_id)}` }
        const f = fiveOf(x.loaded, period)
        const c = x.loaded.checklist
        const miss = c.filter((i) => i.state === 'missing').length
        const badge: { text: string; tone: Tone } = f.revenue === null && f.op === null ? { text: '자료 부족', tone: 'gray' } : (f.op ?? 0) < 0 ? { text: '주의', tone: 'red' } : { text: '정상', tone: 'green' }
        return { id: x.business.business_id, cells: [x.business.name, eok(f.revenue), eok(f.op), eok(f.cash), `${c.length - miss}/${c.length}`], href: `/finance?biz=${encodeURIComponent(x.business.business_id)}&month=${period}`, badge }
      }),
    },
    basis: `${yearMonthKo(period)} · 등록된 회사 ${list.length}곳(장부를 읽을 수 있는 회사) · 재무 현황 숫자`,
    note: '상태: 영업이익이 0보다 작으면 «주의» · 손익 자료가 없으면 «자료 부족».',
  }
}

/* ------------------------------------------------------------------ 아침 루틴 · 기억 */

const SEV: Record<string, { rank: number; text: string; tone: Tone }> = {
  critical: { rank: 0, text: '검토 필요', tone: 'red' },
  warning: { rank: 1, text: '살펴볼 것', tone: 'orange' },
  info: { rank: 2, text: '참고', tone: 'blue' },
}

async function aiJudgment(repo: ChairmanRepository, scope: DataScope): Promise<WidgetData> {
  const [outputs, businesses] = await Promise.all([repo.listAiNightOutputs(), repo.listBusinesses()])
  const latest = latestNightOutputs(outputs, businesses).filter((o) => o.status === 'Done' && (scope.biz === 'all' || o.business_id === scope.biz))
  const name = new Map(businesses.map((b) => [b.business_id, b.name]))
  const rows: (WidgetItem & { rank: number })[] = []
  for (const o of latest) {
    const who = o.business_id ? (name.get(o.business_id) ?? o.business_id) : '그룹'
    const items = o.items?.length ? o.items : [{ title: o.result_summary, detail: '', severity: 'info' as const }]
    items.forEach((it, i) =>
      rows.push({
        id: `${o.output_id ?? o.completed_at}-${o.business_id ?? 'g'}-${i}`,
        title: it.title,
        href: o.run_date ? `/ai?date=${o.run_date}` : '/ai',
        badge: { text: SEV[it.severity]?.text ?? '참고', tone: SEV[it.severity]?.tone ?? 'blue' },
        meta: [who, it.detail].filter(Boolean).join(' · ').slice(0, 120),
        right: seoulDateTime(o.completed_at).slice(5),
        example: o.is_example || undefined,
        rank: SEV[it.severity]?.rank ?? 2,
      }),
    )
  }
  rows.sort((a, b) => a.rank - b.rank)
  const run = latest[0]?.run_date ?? null
  return {
    state: 'ok',
    count: rows.length,
    items: rows.slice(0, LIST_MAX).map((r) => ({ id: r.id, title: r.title, href: r.href, badge: r.badge, meta: r.meta, right: r.right, example: r.example })),
    basis: run ? `${run} 아침 루틴` : latest.length ? '최근 아침 루틴' : undefined,
    note: latest.length ? undefined : '아침 루틴 결과가 아직 없습니다.',
  }
}

async function memoryReview(repo: ChairmanRepository): Promise<WidgetData> {
  const rows = await repo.listMemoryReviews({ status: 'open', limit: 300 })
  const order = { critical: 0, high: 1, medium: 2, low: 3 } as const
  const tone: Record<string, Tone> = { critical: 'red', high: 'orange', medium: 'blue', low: 'gray' }
  const label: Record<string, string> = { critical: '긴급', high: '높음', medium: '보통', low: '낮음' }
  const sorted = [...rows].sort((a, b) => order[a.priority] - order[b.priority] || b.created_at.localeCompare(a.created_at))
  return {
    state: 'ok',
    count: rows.length,
    items: sorted.slice(0, LIST_MAX).map((r) => ({ id: r.review_id, title: r.title, href: '/memory/review', badge: { text: label[r.priority] ?? r.priority, tone: tone[r.priority] ?? 'gray' }, right: r.created_at.slice(5, 10).replace('-', '.') })),
  }
}

/* ------------------------------------------------------------------ 투자(0094~0096) */

async function invKpis(repo: ChairmanRepository): Promise<WidgetData> {
  const [radar, watch, settings, recs, runs] = await Promise.all([loadRadar(repo), repo.invSecurities({ watch: true }), repo.invSettings(), repo.invRecommendations({ latestOnly: true }), repo.invRuns(1)])
  const buyZone = recs.length ? recs.filter((r) => r.status === 'BUY ZONE').length : null
  const k = dashboardKpis(radar, watch, settings, false, buyZone)
  const v = (n: number | null) => (n === null ? 'NEED DATA' : n.toLocaleString('ko-KR'))
  const last = runs[0] ?? null
  return {
    state: 'ok',
    count: 0,
    items: [],
    hideCount: true,
    stats: [
      { label: '추적 기관', value: v(k.managers), sub: k.asOf ? `공시 기준일 ${day(k.asOf)}` : null, href: '/investment/radar' },
      { label: '투자 후보', value: v(k.candidates), href: '/investment/securities' },
      { label: '새로 편입', value: v(k.newPositions), href: '/investment/radar?status=NEW' },
      { label: '수량 증가', value: v(k.added), href: '/investment/radar?status=ADD' },
      { label: '수량 감소', value: v(k.trimmed), href: '/investment/radar?status=TRIM' },
      { label: '매수가 도달', value: v(k.buyZone), sub: k.buyZone === null ? '추천 생성 전' : 'BUY ZONE', href: '/investment/recommendations' },
    ],
    status: k.mode === 'live' ? 'LIVE' : 'UNAVAILABLE',
    basis: `마지막 수집 ${last ? seoulDateTime(last.finished_at ?? last.started_at) : '없음'} · 실측(Demo 아님)`,
    note: k.mode === 'empty' ? '아직 수집된 공시가 없습니다 — 데이터 상태 화면에서 확인.' : undefined,
  }
}

async function invBuyZone(repo: ChairmanRepository): Promise<WidgetData> {
  const [recs, secs] = await Promise.all([repo.invRecommendations({ latestOnly: true }), repo.invSecurities()])
  const sec = new Map(secs.map((s) => [s.security_id, s]))
  const zone = recs.filter((r) => r.status === 'BUY ZONE').sort((a, b) => (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0))
  return {
    state: 'ok',
    count: zone.length,
    items: zone.slice(0, LIST_MAX).map((r) => ({
      id: `${r.security_id}-${r.version}`,
      title: `${sec.get(r.security_id)?.ticker ?? ''} ${sec.get(r.security_id)?.name ?? r.security_id}`.trim(),
      href: `/investment/securities/${encodeURIComponent(r.security_id)}`,
      badge: { text: 'BUY ZONE', tone: 'green' as Tone },
      meta: r.buy_price !== null ? `Buy Below $${r.buy_price.toFixed(2)}` : undefined,
      right: r.opportunity_score !== null ? `기회 ${r.opportunity_score}` : undefined,
    })),
    note: recs.length === 0 ? '추천이 아직 없습니다(분석 전).' : zone.length === 0 ? '검증 조건을 전부 통과한 종목이 없습니다.' : undefined,
  }
}

async function invBrief(repo: ChairmanRepository): Promise<WidgetData> {
  const [brief] = await repo.invBriefs(1)
  if (!brief) return { state: 'ok', count: 0, items: [], hideCount: true, note: '브리핑이 아직 없습니다 — 아침 cron(06:30) 뒤에 보입니다.' }
  const items = Object.entries((brief.content.items ?? {}) as Record<string, unknown>)
  const short = (v: unknown) => (typeof v === 'string' ? v : Array.isArray(v) ? `${v.length}건` : v && typeof v === 'object' ? `${Object.keys(v).length}항목` : String(v ?? ''))
  return {
    state: 'ok',
    count: items.length,
    hideCount: true,
    text: brief.ai_summary ?? undefined,
    items: items.slice(0, LIST_MAX).map(([k, v]) => ({ id: k, title: k, href: '/investment', meta: short(v).slice(0, 120) })),
    basis: `${brief.brief_date} · 원천 기준일 ${day(brief.data_as_of)}${brief.model_version ? ` · AI 요약 ${brief.model_version}` : ' · 결정론 집계'}`,
    status: 'LIVE',
  }
}

async function invAlerts(repo: ChairmanRepository): Promise<WidgetData> {
  const rows = await repo.invAlerts(20)
  const tone: Record<string, Tone> = { critical: 'red', warn: 'orange', info: 'blue' }
  const unread = rows.filter((a) => !a.read_at)
  return {
    state: 'ok',
    count: unread.length,
    items: rows.slice(0, LIST_MAX).map((a, i) => ({
      id: String(a.alert_id ?? i),
      title: a.title,
      href: a.link && a.link.startsWith('/') ? a.link : '/investment',
      badge: { text: a.severity === 'critical' ? '중요' : a.severity === 'warn' ? '주의' : '알림', tone: tone[a.severity] ?? 'blue' },
      meta: a.body?.slice(0, 100) ?? undefined,
      right: a.created_at ? a.created_at.slice(5, 10).replace('-', '.') : undefined,
    })),
    basis: '건수 = 안 읽은 알림',
  }
}

async function invMonthly(repo: ChairmanRepository): Promise<WidgetData> {
  const [txs, settings] = await Promise.all([repo.invCorpTxs(), repo.invSettings()])
  const month = kstToday().slice(0, 7)
  const now = txs.filter((t) => t.trade_date.startsWith(month))
  const sum = (k: string) => now.filter((t) => t.kind === k).reduce((s, t) => s + Math.abs(t.amount_krw), 0)
  const plan = settings.monthly_budget_krw
  const deposit = sum('deposit')
  const bought = sum('buy')
  return {
    state: 'ok',
    count: now.length,
    items: [],
    stats: [
      { label: '이번 달 입금', value: krw(deposit), sub: plan ? `계획 ${krw(plan)} 대비 ${Math.round((deposit / plan) * 100)}%` : null, href: '/investment/portfolio' },
      { label: '이번 달 매수', value: krw(bought), sub: `거래 ${now.length}건(손 입력)`, href: '/investment/portfolio' },
    ],
    basis: `${yearMonthKo(month)} · Real 계좌 손 입력 기준(자동 주문 없음) · 건수 = 이번 달 거래`,
    note: now.length === 0 ? '이번 달 입력된 거래가 없습니다.' : undefined,
  }
}

/* ------------------------------------------------------------------ 나누기 */

/** 대표 첫 화면 위젯인가(audience ≠ all) — 라우트가 이 판정으로 여기 또는 lib/home/data.ts로 보낸다. */
export function isBoardKind(kind: string): boolean {
  const a = widgetDef(kind)?.audience
  return !!a && a !== 'all'
}

/** 위젯 하나. 문(kindAllowed)은 라우트가 먼저 본다 — 여기서 한 번 더(기능 스위치 · 역할). */
export async function boardWidgetData(user: SessionUser, access: HomeAccess, kind: string, filter: string | undefined, scope: DataScope): Promise<WidgetData> {
  const def = widgetDef(kind)
  if (!def) return { state: 'error', text: '알 수 없는 위젯입니다.' }
  if (!isBoardKind(kind)) return widgetData(user, access, kind, filter, scope)
  if (def.listOnly) return { state: 'pending', text: '준비 중 — 이 위젯에 쓸 자료가 아직 이 시스템에 없습니다.' }
  if (!kindAllowed(access, kind)) return { state: 'denied', text: '이 계정으로는 쓸 수 없는 위젯입니다.' }
  const repo = await getRepository()
  try {
    if (DATA_MODE === 'dummy' && process.env.DUMMY_HOME_WIDGET_FAIL === kind) throw new Error('dummy 위젯 실패(시험)')
    switch (kind) {
      case 'fin_kpis':
        return await finKpis(repo, user, scope)
      case 'cash_forecast':
        return await cashForecast(repo, user, scope)
      case 'fin_checklist':
        return await finChecklist(repo, user, scope)
      case 'companies':
        return await companies(repo, user, scope)
      case 'ai_judgment':
        return await aiJudgment(repo, scope)
      case 'memory_review':
        return await memoryReview(repo)
      case 'inv_kpis':
        return await invKpis(repo)
      case 'inv_buy_zone':
        return await invBuyZone(repo)
      case 'inv_brief':
        return await invBrief(repo)
      case 'inv_alerts':
        return await invAlerts(repo)
      case 'inv_monthly':
        return await invMonthly(repo)
    }
  } catch (e) {
    console.error('[dashboard] 위젯 조회 실패', kind, e)
    const m = e instanceof Error ? e.message : ''
    return { state: 'error', text: /unavailable/.test(m) ? '이 기능의 DB가 아직 반영되지 않았습니다.' : '불러오지 못했습니다.' }
  }
  return { state: 'error', text: '알 수 없는 위젯입니다.' }
}
