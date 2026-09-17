import type { AiNightOutput, Business, IsoDate } from '@/types'

/**
 * 야간 출력(ai_night_outputs)을 화면이 읽는 모양으로 묶는 규칙 한 곳.
 * 대시보드 CH-019 패널과 /ai 화면이 같은 규칙을 봐야 '어젯밤'이 두 화면에서 같은 뜻이 된다.
 */

/** 0.7 미만은 사람이 한 번 더 봐야 하는 결과다. 같은 크기로 나란히 두지 않는다. */
export const CONFIDENCE_FLOOR = 0.7

/** 브리핑 기준일. 0013 이전 행(시드)은 run_date가 없어 완료 시각의 KST 날짜로 대신한다. */
export function briefDateOf(o: AiNightOutput): IsoDate {
  if (o.run_date) return o.run_date
  const t = new Date(o.completed_at)
  if (Number.isNaN(t.getTime())) return o.completed_at.slice(0, 10)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(t)
}

export function outputName(businesses: Business[], businessId: string | null): string {
  if (businessId === null) return '그룹 브리핑'
  return businesses.find((b) => b.business_id === businessId)?.name ?? businessId
}

export interface NightRun {
  /** null = run_id 없는 이전 형식 행 묶음 */
  run_id: string | null
  date: IsoDate
  /** 가장 늦게 끝난 행의 시각 */
  finished_at: string
  group: AiNightOutput | null
  companies: AiNightOutput[]
  model: string | null
}

/**
 * 행을 실행(run) 단위로 묶는다. 최신 실행이 앞.
 * 그룹 행이 맨 위, 회사 행은 회사의 sort_order 순이다 — 회장이 늘 보는 카드 순서와 같다.
 */
export function groupRuns(outputs: AiNightOutput[], businesses: Business[]): NightRun[] {
  const order = new Map(businesses.map((b) => [b.business_id, b.sort_order]))
  const byRun = new Map<string, AiNightOutput[]>()
  for (const o of outputs) {
    const key = o.run_id ?? `legacy:${briefDateOf(o)}`
    const list = byRun.get(key)
    if (list) list.push(o)
    else byRun.set(key, [o])
  }

  const runs: NightRun[] = []
  for (const rows of byRun.values()) {
    const sorted = [...rows].sort((a, b) => b.completed_at.localeCompare(a.completed_at))
    const group = sorted.find((o) => o.business_id === null) ?? null
    const companies = sorted
      .filter((o) => o.business_id !== null)
      .sort(
        (a, b) =>
          (order.get(a.business_id!) ?? Number.MAX_SAFE_INTEGER) -
            (order.get(b.business_id!) ?? Number.MAX_SAFE_INTEGER) ||
          b.completed_at.localeCompare(a.completed_at),
      )
    runs.push({
      run_id: sorted[0].run_id ?? null,
      date: briefDateOf(sorted[0]),
      finished_at: sorted[0].completed_at,
      group,
      companies,
      model: sorted.find((o) => o.model)?.model ?? null,
    })
  }
  return runs.sort((a, b) => b.finished_at.localeCompare(a.finished_at))
}

/**
 * 대시보드가 보여 줄 '어젯밤'. run_id가 붙은 실행이 하나라도 있으면 그 최신 실행만,
 * 아직 한 번도 안 돌았으면(시드뿐이면) 있는 행 전부 — 빈 패널보다 낫고, 시드에는 DUMMY 뱃지가 붙는다.
 */
export function latestNightOutputs(outputs: AiNightOutput[], businesses: Business[]): AiNightOutput[] {
  const latest = groupRuns(outputs.filter((o) => o.run_id), businesses)[0]
  if (!latest) return [...outputs].sort((a, b) => b.completed_at.localeCompare(a.completed_at))
  return [...(latest.group ? [latest.group] : []), ...latest.companies]
}

/** '2026-09-17T14:02:11Z' → '09-17 23:02' (KST). 야간 작업은 날짜보다 시각이 먼저 읽힌다. */
export function formatRunTime(iso: string): string {
  const t = new Date(iso)
  // 시드는 '2026-09-01T06:40'처럼 시간대가 없다. 이미 현지 시각으로 적힌 값이라 그대로 자른다.
  if (Number.isNaN(t.getTime()) || !/[zZ]|[+-]\d\d:?\d\d$/.test(iso)) {
    return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(t)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

/**
 * 결과물 링크의 종류.
 *   internal  앱 안 경로(/ai?date=…). 야간 브리핑이 남기는 링크다.
 *   external  http/https. documents.ts의 isStorageLink와 같은 규칙.
 *   none      artifact://dummy/001 같은 자리 표시, javascript: 등. 링크로 그리지 않는다.
 */
export function linkKind(value: string | undefined): 'internal' | 'external' | 'none' {
  if (!value) return 'none'
  if (value.startsWith('/') && !value.startsWith('//')) return 'internal'
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? 'external' : 'none'
  } catch {
    return 'none'
  }
}
