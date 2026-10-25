import 'server-only'

import type { ChairmanRepository } from '@/lib/repository/types'

import { countChanges, effectivePeriods, type EffectivePeriod } from './changes'
import { COMPARABLE_QUALITY } from './collect/run'
import { DEMO_KPIS } from './demo'
import type {
  ChangeStatus,
  DataStatus,
  InstitutionalRow,
  InvChange,
  InvDisclosure,
  InvManager,
  InvPosition,
  InvSecurity,
  InvSettings,
  InvSource,
  ManagerId,
} from './types'

/**
 * 화면 집계 — 저장소에서 읽은 원천을 화면 모양으로. 계산은 결정론(AI 없음).
 * KPI는 «실측»과 «DEMO»를 섞지 않는다: 실측이 하나도 없으면 kpis.mode = 'empty'(0 · DATA NOT AVAILABLE),
 * 대표가 «Demo 보기»를 눌렀을 때만 mode = 'demo'(원문 값 + DEMO 띠).
 */

export interface SourcePair {
  source: InvSource
  manager: InvManager
  periods: EffectivePeriod[]
  from: EffectivePeriod | null
  to: EffectivePeriod | null
  counts: Record<ChangeStatus, number> | null
}

export interface RadarState {
  managers: InvManager[]
  sources: InvSource[]
  disclosures: InvDisclosure[]
  pairs: SourcePair[]
  /** 13F 네 곳의 최신 비교쌍 판정(주식 수 기준) */
  latest13F: InvChange[]
}

export async function loadRadar(repo: ChairmanRepository): Promise<RadarState> {
  const [managers, sources, disclosures] = await Promise.all([repo.invManagers(), repo.invSources(), repo.invDisclosures()])
  const pairs: SourcePair[] = []
  for (const s of sources.filter((x) => x.kind === 'sec_13f' || x.kind === 'nbim_holdings' || x.kind === 'factsheet' || x.kind === 'site')) {
    const manager = managers.find((m) => m.manager_id === s.manager_id)
    if (!manager) continue
    const periods = effectivePeriods(disclosures.filter((d) => d.source_id === s.source_id && (d.data_quality ?? 100) >= COMPARABLE_QUALITY))
    const to = periods.at(-1) ?? null
    const from = periods.at(-2) ?? null
    pairs.push({ source: s, manager, periods, from, to, counts: null })
  }
  const ids13F = pairs.filter((p) => p.source.kind === 'sec_13f' && p.from && p.to).map((p) => p.to!.primary.disclosure_id)
  const latest13F = await repo.invChanges({ toDisclosures: ids13F })
  for (const p of pairs) {
    if (!p.to || !p.from) continue
    p.counts =
      p.source.kind === 'sec_13f'
        ? countChanges(latest13F.filter((c) => c.to_disclosure === p.to!.primary.disclosure_id))
        : await repo.invChangeCounts(p.to.primary.disclosure_id)
  }
  return { managers, sources, disclosures, pairs, latest13F }
}

export interface DashboardKpis {
  mode: 'live' | 'empty' | 'demo'
  managers: number | null
  candidates: number | null
  newPositions: number | null
  added: number | null
  trimmed: number | null
  /** 가치평가(2단계) 전에는 null — NEED DATA */
  buyZone: number | null
  monthlyKrw: number
  yearlyKrw: number
  asOf: string | null
}

export function dashboardKpis(radar: RadarState, watch: readonly InvSecurity[], settings: InvSettings, demo: boolean, buyZone: number | null): DashboardKpis {
  if (demo) return { mode: 'demo', ...DEMO_KPIS, asOf: null }
  const live = radar.disclosures.filter((d) => !d.is_demo)
  if (live.length === 0) {
    return { mode: 'empty', managers: 0, candidates: 0, newPositions: null, added: null, trimmed: null, buyZone: null, monthlyKrw: settings.monthly_budget_krw, yearlyKrw: settings.monthly_budget_krw * 12, asOf: null }
  }
  const c = countChanges(radar.latest13F)
  const tracked = new Set(live.map((d) => d.manager_id))
  return {
    mode: 'live',
    managers: tracked.size,
    candidates: watch.length,
    newPositions: c.NEW,
    added: c.ADD,
    trimmed: c.TRIM,
    buyZone,
    monthlyKrw: settings.monthly_budget_krw,
    yearlyKrw: settings.monthly_budget_krw * 12,
    asOf: live.map((d) => d.data_as_of).sort().at(-1) ?? null,
  }
}

/** 데이터 상태 띠 — 경로 상태 그대로, 단 한 번도 성공하지 못했으면 UNAVAILABLE. */
export function sourceStatus(s: InvSource | undefined): DataStatus {
  if (!s) return 'UNAVAILABLE'
  if (s.status === 'DISABLED' || s.status === 'DEMO') return s.status
  if (!s.last_success_at && s.kind !== 'manual') return 'UNAVAILABLE'
  return s.status
}

/** 공통 보유(원문 4.4) — 13F 네 곳 최신 공시 기준, 같은 CUSIP을 보유한 기관 수 · 신호 가중치 합(NBIM 0.5). */
export interface CommonHolding {
  cusip: string
  issuer: string
  security_id: string | null
  managers: ManagerId[]
  weight: number
  value: number
}

export async function commonHoldings(repo: ChairmanRepository, radar: RadarState): Promise<CommonHolding[]> {
  const latest = radar.pairs.filter((p) => p.source.kind === 'sec_13f' && p.to)
  const rows = await repo.invPositions({ disclosureIds: latest.flatMap((p) => p.to!.members.map((d) => d.disclosure_id)) })
  const byDisclosure = new Map(radar.disclosures.map((d) => [d.disclosure_id, d.manager_id]))
  const m = new Map<string, CommonHolding>()
  for (const r of rows) {
    if (!r.cusip || r.put_call || r.share_type === 'PRN') continue
    const mid = byDisclosure.get(r.disclosure_id)!
    const h = m.get(r.cusip) ?? { cusip: r.cusip, issuer: r.issuer_name, security_id: r.security_id, managers: [], weight: 0, value: 0 }
    if (!h.managers.includes(mid)) {
      h.managers.push(mid)
      h.weight += radar.managers.find((x) => x.manager_id === mid)?.signal_weight ?? 1
    }
    h.value += r.value ?? 0
    h.security_id ??= r.security_id
    m.set(r.cusip, h)
  }
  return [...m.values()].filter((h) => h.managers.length >= 2).sort((a, b) => b.managers.length - a.managers.length || b.weight - a.weight || b.value - a.value)
}

/** 종목 한 개의 기관별 보유 추이(공시 기준일마다 주식 수 · 평가액 합)와 최신 판정. */
export function institutionalRows(
  managers: readonly InvManager[],
  disclosures: readonly InvDisclosure[],
  positions: readonly InvPosition[],
  changes: readonly InvChange[],
): InstitutionalRow[] {
  const dmap = new Map(disclosures.map((d) => [d.disclosure_id, d]))
  return managers.map((m) => {
    const src = `sec13f:${m.manager_id}`
    const periods = effectivePeriods(disclosures.filter((d) => d.source_id === src && (d.data_quality ?? 100) >= COMPARABLE_QUALITY))
    const points = periods.slice(-5).map((p) => {
      const ids = new Set(p.members.map((d) => d.disclosure_id))
      const rows = positions.filter((r) => ids.has(r.disclosure_id) && !r.put_call && r.share_type !== 'PRN')
      return {
        as_of: p.as_of,
        shares: rows.length ? rows.reduce((s, r) => s + (r.shares ?? 0), 0) : null,
        value: rows.length ? rows.reduce((s, r) => s + (r.value ?? 0), 0) : null,
        disclosure_id: p.primary.disclosure_id,
      }
    })
    const lastTo = periods.at(-1)?.primary.disclosure_id
    const latest = changes.find((c) => c.to_disclosure === lastTo && dmap.get(c.to_disclosure)?.manager_id === m.manager_id) ?? null
    return { manager_id: m.manager_id, points, latest }
  })
}
