import { isUploadKind, kindSpec } from './kinds'

/**
 * 0093 «읽은 줄 N · 비운 칸 M» — 파일마다 한 줄(체크표 · 최근 올리기 · 카드).
 *   N = 파일에서 읽어 넣은 거래 줄(급여는 개인 줄 · 원장은 거래 줄 — 합계로 묶기 전).
 *   M = 꼭 있어야 하는 칸(kinds.ts required) 중 빈 채 저장된 칸 수. 0이 아니면 경고(조용히 저장하지 않는다 — 0092 규칙을 전 종류에).
 * 새 칸(DB) 없이 fin_uploads.warnings 맨 앞의 «ⓘ » 한 줄로 남긴다 — 화면은 splitStats로 떼어 경고로 세지 않는다.
 */
export const STATS_PREFIX = 'ⓘ '
const STATS_RE = /^ⓘ 읽은 줄 (\d+) · 비운 칸 (\d+)$/

export interface ReadStats {
  read: number
  blank: number
}

export interface BlankField {
  label: string
  count: number
  /** 머리글에서 그 열을 알아봤나 — 못 알아본 열은 0092 문구(«… 열을 못 알아봤습니다»)가 따로 말한다 */
  mapped: boolean
}

type Row = Record<string, unknown>

/** 꼭 있어야 하는 칸이 빈 줄 — 칸 이름별 수. skip = 줄을 고를 때 이미 본 칸(그 칸이 비면 줄을 넣지 않았다). */
export function blankRequired(kind: string, rows: readonly Row[], columns?: Record<string, number>, skip?: string): BlankField[] {
  if (!isUploadKind(kind)) return []
  const out: BlankField[] = []
  for (const f of kindSpec(kind).fields) {
    if (!f.required || f.key === skip) continue
    const count = rows.filter((r) => r[f.key] === null || r[f.key] === undefined || r[f.key] === '').length
    if (count) out.push({ label: f.label, count, mapped: !columns || f.key in columns })
  }
  return out
}

export function blankWarning(blanks: readonly BlankField[]): string | null {
  const shown = blanks.filter((b) => b.mapped)
  if (!shown.length) return null
  return `꼭 있어야 하는 칸이 빈 줄 — ${shown.map((b) => `«${b.label}» ${b.count}칸`).join(' · ')}. 그 칸은 비운 채 저장했습니다(빈칸은 0이 아닙니다 — 엑셀에서 채워 다시 올리면 바뀝니다).`
}

export function statsLine(s: ReadStats): string {
  return `${STATS_PREFIX}읽은 줄 ${s.read} · 비운 칸 ${s.blank}`
}

/** 저장할 경고 — 맨 앞에 통계 한 줄(앞서 붙은 통계 줄은 뺀다). */
export function withStats(warnings: readonly string[], s: ReadStats): string[] {
  return [statsLine(s), ...warnings.filter((w) => !w.startsWith(STATS_PREFIX))].slice(0, 40)
}

/** 저장된 경고 → 통계(없으면 null · 0093 전 올리기) + 진짜 경고. */
export function splitStats(warnings: readonly string[] | null | undefined): { stats: ReadStats | null; warnings: string[] } {
  let stats: ReadStats | null = null
  const rest: string[] = []
  for (const w of warnings ?? []) {
    const m = STATS_RE.exec(w)
    if (m) stats = { read: Number(m[1]), blank: Number(m[2]) }
    else if (!w.startsWith(STATS_PREFIX)) rest.push(w)
  }
  return { stats, warnings: rest }
}

export function statsText(s: ReadStats | null): string | null {
  return s ? `읽은 줄 ${s.read} · 비운 칸 ${s.blank}` : null
}
