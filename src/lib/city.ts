import { averageAutonomy, type DependencySummary } from '@/lib/dependency'
import type {
  AutonomyLevel,
  BusinessId,
  CityLayout,
  CityStage,
  FinanceKpi,
} from '@/types'

/**
 * 그룹 시티(Phase 8 G-1)의 계산은 전부 여기 한 곳에서 한다 — /group, HOME 도시 띠,
 * /group/edit가 같은 회사에 같은 완성도·같은 단계를 말해야 한다.
 *
 * 이 파일은 데이터를 스스로 읽지 않는다(lib/finance.ts와 같은 원칙). 서버 컴포넌트가
 * repository에서 읽어 내려 준 것만 접는다.
 */

/* ------------------------------------------------------------------ 완성도 */

/**
 * 가중치. 원문이 준 셋(Autonomy · 매출목표 · 이양률)이고, **자율성이 가장 무겁다** —
 * 도시의 건물이 «회장 없이 서 있는가»를 그리는 그림이라서다. 매출과 이양은 같은 무게.
 */
export const COMPLETION_WEIGHTS = { autonomy: 0.4, revenue: 0.3, transfer: 0.3 } as const

export interface CompletionParts {
  /** 0~1. 최근 평가의 L을 5로 나눈 값(L5 = 1). 평가가 없으면 null. */
  autonomy: number | null
  /** 0~1. 올해 목표가 있는 달들의 매출 합 ÷ 목표 합, 1에서 자른다. 목표가 없으면 null. */
  revenue: number | null
  /** 0~1. 이양 완료 ÷ 계획된 영역. 계획이 없으면 null. */
  transfer: number | null
}

export interface Completion {
  /** 0~100 정수. 셋 다 null이면 null — 0%가 아니다(«아직 잴 것이 없다»). */
  pct: number | null
  parts: CompletionParts
}

/**
 * 셋 중 **있는 것만** 가중 평균한다. 없는 칸을 0으로 채우면 목표를 안 적은 회사가
 * 목표를 못 채운 회사가 된다 — 그것은 반대의 사실이다. 가중치는 있는 것끼리 다시 나눈다.
 */
export function completionOf(parts: CompletionParts): Completion {
  let sum = 0
  let weight = 0
  for (const key of ['autonomy', 'revenue', 'transfer'] as const) {
    const v = parts[key]
    if (v === null) continue
    sum += COMPLETION_WEIGHTS[key] * Math.min(1, Math.max(0, v))
    weight += COMPLETION_WEIGHTS[key]
  }
  return { pct: weight === 0 ? null : Math.round((sum / weight) * 100), parts }
}

/**
 * 올해(가장 최근 달의 해) 목표가 적힌 달만 모아 실적 ÷ 목표. 목표가 없는 달의 실적은
 * 분자에도 넣지 않는다 — 넣으면 목표를 반만 적은 회사가 초과 달성으로 보인다.
 */
export function revenueProgress(kpis: FinanceKpi[], businessId: BusinessId): number | null {
  const rows = kpis.filter((k) => k.business_id === businessId && k.metric === 'Revenue')
  if (rows.length === 0) return null
  const year = rows.map((k) => k.period).sort().at(-1)!.slice(0, 4)
  const targeted = rows.filter((k) => k.period.startsWith(year) && typeof k.target === 'number' && k.target > 0)
  if (targeted.length === 0) return null
  const actual = targeted.reduce((a, k) => a + k.value, 0)
  const target = targeted.reduce((a, k) => a + (k.target ?? 0), 0)
  return Math.min(1, actual / target)
}

export function autonomyScore(level: AutonomyLevel | null | undefined): number | null {
  if (!level) return null
  const avg = averageAutonomy([level])
  return avg === null ? null : avg / 5
}

/** 회사 하나의 완성도. 의존 요약(summarizeDependency)과 재무 원천에서 접는다. */
export function businessCompletion(
  businessId: BusinessId,
  dependency: DependencySummary | undefined,
  kpis: FinanceKpi[],
): Completion {
  const transfer = dependency?.transfer
  return completionOf({
    autonomy: autonomyScore(dependency?.autonomy?.level),
    revenue: revenueProgress(kpis, businessId),
    transfer: transfer && transfer.planned > 0 ? transfer.done / transfer.planned : null,
  })
}

/* ------------------------------------------------------------------ 단계 */

/**
 * 원문의 문턱: 0~25 기초 / ~60 골조 / ~90 마감 / 100 완공.
 *
 * **91~99는 마감이다.** 원문은 90과 100 사이를 말하지 않았고, 완공은 «셋 다 끝났다»일 때만
 * 서야 한다 — 99%에 완공 그림을 걸면 남은 1%가 그림에서 사라진다. 판단은 DEFERRED에 적었다.
 * 완성도가 없으면(null) 기초다: 잴 것이 없는 회사는 아직 땅을 다지는 중이다.
 */
export function stageOf(pct: number | null): CityStage {
  if (pct === null || pct <= 25) return 'foundation'
  if (pct <= 60) return 'frame'
  if (pct < 100) return 'finishing'
  return 'complete'
}

/**
 * 화면에 걸리는 단계. 이니셔티브 터는 늘 빈 터다. 회사는 stage_image가 있으면 그 값
 * (회장이 고정한 것 — 승격 직후의 'foundation'이 그렇다), 없으면 완성도에서 낸다.
 */
export function effectiveStage(layout: CityLayout, pct: number | null): CityStage {
  if (layout.initiative_id !== null) return 'lot'
  return layout.stage_image ?? stageOf(pct)
}

/* ------------------------------------------------------------------ 그림 */

export type CityPhase = 'day' | 'dusk'

/** 전경 폭(scripts/city-assets.mjs의 WIDTHS와 같은 셋). 원본 비율 2752×1536. */
export const CITY_WIDTHS = [1280, 1920, 2752] as const
export const CITY_ASPECT = 1536 / 2752

export function citySrc(phase: CityPhase, width: (typeof CITY_WIDTHS)[number] = 1920): string {
  return `/city/gen/${phase}-${width}.webp`
}

export function citySrcSet(phase: CityPhase): string {
  return CITY_WIDTHS.map((w) => `${citySrc(phase, w)} ${w}w`).join(', ')
}

/** 현지 시각 6시~17시는 낮, 나머지는 저녁. */
export function phaseAt(hour: number): CityPhase {
  return hour >= 6 && hour < 18 ? 'day' : 'dusk'
}

/**
 * 5개사 클로즈업(scripts/city-assets.mjs COMPANY_CROP). 원본 그림에 건물이 있는 회사만 —
 * 없는 회사는 단계 그림을 쓴다.
 */
export const COMPANY_CLOSEUP: Partial<Record<BusinessId, string>> = {
  biz_dy: '/city/gen/company-dy.webp',
  biz_vana: '/city/gen/company-vana.webp',
  biz_sticky: '/city/gen/company-sticky.webp',
  biz_hof: '/city/gen/company-hof.webp',
  biz_boram: '/city/gen/company-boram.webp',
}

/** 단계 그림. 완공은 따로 없다 — 완공이면 회사 클로즈업, 그것도 없으면 마감 그림. */
export function stageSrc(stage: CityStage): string {
  return `/city/gen/stage-${stage === 'complete' ? 'finishing' : stage}.webp`
}

/**
 * 패널 맨 위 그림 한 장. 회사 건물 그림이 있으면 **단계와 상관없이 그것을 건다** —
 * 회장이 5개사를 잘라 달라고 한 이유가 그 건물을 보려는 것이라서다. 단계는 그 위에
 * 작은 그림(stageSrc)과 글자로 따로 말한다.
 */
export function closeupSrc(layout: CityLayout, stage: CityStage): string {
  const own = layout.business_id ? COMPANY_CLOSEUP[layout.business_id] : undefined
  return own ?? stageSrc(stage)
}

/* ------------------------------------------------------------------ 편집 */

/** 상자를 그림 안에 가둔다(0037 city_layout_box_check와 같은 판정). 소수 둘째 자리. */
export function clampBox(box: { x: number; y: number; w: number; h: number }) {
  const r = (v: number) => Math.round(v * 100) / 100
  const w = r(Math.min(100, Math.max(1, box.w)))
  const h = r(Math.min(100, Math.max(1, box.h)))
  return {
    x: r(Math.min(100 - w, Math.max(0, box.x))),
    y: r(Math.min(100 - h, Math.max(0, box.y))),
    w,
    h,
  }
}

/* ------------------------------------------------------------------ 핫스팟 한 칸 */

export interface CityItem {
  layout: CityLayout
  kind: 'business' | 'initiative'
  /** business_id 또는 initiative_id */
  id: string
  name: string
  /** 상세 화면. 회사 = /business/[id], 터 = /initiatives/[id]. */
  href: string
  /** 가장 최근 달의 매출(원). 재무 자료가 없으면 null — 0원이 아니다. */
  revenue: number | null
  revenuePeriod: string | null
  level: AutonomyLevel | null
  completion: Completion
  stage: CityStage
}

/**
 * 배치 줄에 이름·숫자를 붙인다. /group과 HOME 도시 띠가 이것 하나를 쓴다.
 *
 * 주인을 못 찾는 줄은 버린다 — 숨긴 회사(visible=false)거나 이 사람이 못 보는 이니셔티브다.
 * RLS가 이미 거른 것을 여기서 다시 판정하지는 않는다. 끝난 이니셔티브(Done/Dropped)의 터는
 * 그대로 둔다: 치울지 승격할지는 회장이 /group/edit에서 정한다.
 */
export function buildCityItems(input: {
  layout: CityLayout[]
  businesses: { business_id: BusinessId; name: string; visible: boolean }[]
  initiatives: { initiative_id: string; title: string }[]
  dependency: DependencySummary[]
  kpis: FinanceKpi[]
}): CityItem[] {
  const latest = input.kpis
    .filter((k) => k.metric === 'Revenue')
    .map((k) => k.period)
    .sort()
    .at(-1) ?? null

  const items: CityItem[] = []
  for (const layout of input.layout) {
    if (layout.business_id !== null) {
      const b = input.businesses.find((x) => x.business_id === layout.business_id && x.visible)
      if (!b) continue
      const dep = input.dependency.find((d) => d.business_id === b.business_id)
      const completion = businessCompletion(b.business_id, dep, input.kpis)
      const row = latest
        ? input.kpis.find((k) => k.business_id === b.business_id && k.metric === 'Revenue' && k.period === latest)
        : undefined
      items.push({
        layout,
        kind: 'business',
        id: b.business_id,
        name: b.name,
        href: `/business/${b.business_id}`,
        revenue: row ? row.value : null,
        revenuePeriod: row ? latest : null,
        level: dep?.autonomy?.level ?? null,
        completion,
        stage: effectiveStage(layout, completion.pct),
      })
    } else if (layout.initiative_id !== null) {
      const i = input.initiatives.find((x) => x.initiative_id === layout.initiative_id)
      if (!i) continue
      items.push({
        layout,
        kind: 'initiative',
        id: i.initiative_id,
        name: i.title,
        href: `/initiatives/${i.initiative_id}`,
        revenue: null,
        revenuePeriod: null,
        level: null,
        completion: { pct: null, parts: { autonomy: null, revenue: null, transfer: null } },
        stage: 'lot',
      })
    }
  }
  return items
}
