import { cellText, type EcountCell, type EcountUnit } from './cells'

/**
 * ECOUNT 엑셀 공통 탐지 — 머리글 행 · 기간 · 단위 · 행 종류(합계 · 소계 · 로마숫자 머리). 순수 함수.
 *
 * **대상별(계정과목 · 연간 · 월별) 열 매핑은 여기 없다** — 열 구성(ECOUNT 화면 캡처) 확인 뒤 대상별 단계가
 * 이 함수들을 써서 만든다(설계서 D · E). 여기는 어느 대상이든 같은 일만 한다.
 */

/** 머리글 · 과목명 비교용 — 전각 → 반각(NFKC), 공백 전부 제거. «계 정 과 목»과 «계정과목»이 같다. */
export function normalizeLabel(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, '')
}

// ---------------------------------------------------------------- 기간

export interface EcountPeriod {
  /** YYYY-MM-DD */
  from: string
  to: string
}

const DATE = String.raw`(\d{4})\s*(?:[./-]|년)\s*(\d{1,2})\s*(?:[./-]|월)\s*(\d{1,2})\s*일?`
const PERIOD_RE = new RegExp(`${DATE}\\s*[~∼〜～–—-]\\s*${DATE}`)

function isoDate(y: string, m: string, d: string): string | null {
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  const t = new Date(`${iso}T00:00:00Z`)
  // 2025-02-30 같은 날은 Date가 3월로 넘긴다 — 되돌려 읽어 같은지 본다.
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === iso ? iso : null
}

/** «2025/01/01 ~ 2025/12/31» · «2025-01-01~2025-12-31» · «2025년 1월 1일 ~ 2025년 12월 31일». 없거나 틀린 날이면 null. */
export function detectPeriod(text: string): EcountPeriod | null {
  const m = PERIOD_RE.exec(text.normalize('NFKC'))
  if (!m) return null
  const from = isoDate(m[1], m[2], m[3])
  const to = isoDate(m[4], m[5], m[6])
  if (!from || !to || from > to) return null
  return { from, to }
}

/** 한 해 전체(1/1 ~ 12/31)면 그 해 'YYYY', 아니면 null. 연간 재무제표의 period_key 후보. */
export function fullYearOf(p: EcountPeriod): string | null {
  const y = p.from.slice(0, 4)
  return p.from === `${y}-01-01` && p.to === `${y}-12-31` ? y : null
}

// ---------------------------------------------------------------- 단위

/** «(단위 : 천원)» · «[단위:원]» · «단위: 백만원». «단위»라는 낱말이 있어야 한다 — 과목명 «…원»을 잡지 않게. */
export function detectUnit(text: string): EcountUnit | null {
  const m = /단위[:：]?[(\[]?(백만원|천원|원)/.exec(normalizeLabel(text))
  if (!m) return null
  return m[1] === '백만원' ? 'million' : m[1] === '천원' ? 'thousand' : 'won'
}

export interface Found<T> {
  value: T
  /** 0부터 센 행 · 열 */
  row: number
  col: number
}

function scan<T>(rows: EcountCell[][], maxRows: number, pick: (text: string) => T | null): Found<T> | null {
  for (let r = 0; r < Math.min(rows.length, maxRows); r += 1) {
    const row = rows[r]
    for (let c = 0; c < row.length; c += 1) {
      const text = cellText(row[c])
      if (!text) continue
      const value = pick(text)
      if (value !== null) return { value, row: r, col: c }
    }
  }
  return null
}

/** 시트 머리(기본 위 15행)에서 기간을 찾는다. */
export function findPeriod(rows: EcountCell[][], maxRows = 15): Found<EcountPeriod> | null {
  return scan(rows, maxRows, detectPeriod)
}

/** 시트 머리(기본 위 15행)에서 단위를 찾는다. 없으면 null — 단위를 짐작하지 않는다(대상별 판정이 «단위 미상»으로 막는다). */
export function findUnit(rows: EcountCell[][], maxRows = 15): Found<EcountUnit> | null {
  return scan(rows, maxRows, detectUnit)
}

// ---------------------------------------------------------------- 머리글 행

export interface HeaderSpec {
  /** 대상별 단계가 쓰는 열 이름(account_code · name · amount …) */
  key: string
  /** 이 열로 볼 머리글 표기들 — normalizeLabel 뒤 **정확히 같은** 것만 맞는다. */
  names: string[]
  required?: boolean
}

export interface HeaderMatch {
  /** 0부터 센 머리글 행 */
  row: number
  /** 열 이름 → 맞은 열들(0부터, 왼쪽부터). 한 이름이 두 열에 맞으면 둘 다 — «당기 금액이 두 칸(소계/합계)»을 대상별 단계가 고른다. */
  columns: Record<string, number[]>
}

/**
 * 머리글 행을 찾는다 — 위에서부터 maxRows행 안에서 required 열이 **전부** 있는 첫 행.
 * 없으면 null(대상별 판정이 «머리글을 찾지 못함»으로 막는다).
 */
export function findHeaderRow(rows: EcountCell[][], specs: HeaderSpec[], maxRows = 30): HeaderMatch | null {
  const wanted = specs.map((s) => ({ ...s, names: new Set(s.names.map(normalizeLabel)) }))
  for (let r = 0; r < Math.min(rows.length, maxRows); r += 1) {
    const labels = rows[r].map((c) => normalizeLabel(cellText(c)))
    const columns: Record<string, number[]> = {}
    for (const s of wanted) {
      const cols = labels.flatMap((l, i) => (l && s.names.has(l) ? [i] : []))
      if (cols.length) columns[s.key] = cols
    }
    if (wanted.every((s) => !s.required || columns[s.key])) {
      if (Object.keys(columns).length > 0) return { row: r, columns }
    }
  }
  return null
}

// ---------------------------------------------------------------- 행 종류

/**
 *   line      보통 줄(계정 · 과목)
 *   heading   로마숫자 머리(Ⅰ. 매출액 · II. 매출원가) — K-GAAP 손익계산서의 구분 머리. 금액이 붙어 있어도 «소계»다
 *   total     합계 · 총계(자산총계 · 부채와자본총계 · 합계 · 계)
 *   subtotal  소계
 *   profit    계산된 이익 줄(매출총이익 · 영업이익 · 법인세차감전순이익 · 당기순이익 — «(손실)» 꼴 포함)
 *   blank     과목이 빈 줄
 * 대상별 판정이 이 종류로 «싣지 않음 · 대조만»을 정한다. 여기서는 어떤 줄도 버리지 않는다.
 */
export type RowKind = 'line' | 'heading' | 'total' | 'subtotal' | 'profit' | 'blank'

export interface RowLabel {
  kind: RowKind
  /** 번호(Ⅰ. · 1. · (1) · 가.)를 걷고 공백을 지운 이름 */
  name: string
}

// 계정과목명에 «…이익»이 많다(유형자산처분이익 · 외환차익) — 접미사가 아니라 정해진 이름만 이익 줄이다.
const PROFIT = new Set(
  ['매출총이익', '매출총손실', '영업이익', '영업손실', '법인세비용차감전순이익', '법인세비용차감전순손실', '법인세차감전순이익', '법인세차감전순손실', '당기순이익', '당기순손실'],
)

const ASCII_ROMAN = /^(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)[.)]/
const NUMBERING = /^(?:\d{1,2}[.)]|\(\d{1,2}\)|[가-하][.)]|\([가-하]\))/

export function classifyRowLabel(label: string): RowLabel {
  const raw = label.trim()
  // 유니코드 로마숫자(Ⅰ U+2160 …)는 NFKC가 «I»로 바꾸므로 정규화 전에 본다.
  const unicodeRoman = /^[Ⅰ-ⅿ]/.test(raw)
  const flat = normalizeLabel(raw)
  if (!flat) return { kind: 'blank', name: '' }

  if (unicodeRoman || ASCII_ROMAN.test(flat)) {
    const name = unicodeRoman
      ? normalizeLabel(raw.replace(/^[Ⅰ-ⅿ]+\s*[.)]?/, ''))
      : flat.replace(ASCII_ROMAN, '')
    return { kind: 'heading', name }
  }

  const name = flat.replace(NUMBERING, '')
  // «영업이익(손실)» · «당기순이익(손실)» — 괄호 꼬리를 걷고 이익 줄인지 본다.
  const bare = name.replace(/\((?:손실|이익)\)$/, '')
  if (name === '소계' || name.endsWith('소계')) return { kind: 'subtotal', name }
  if (name === '계' || name === '합계' || name === '총계' || name.endsWith('총계') || name.endsWith('합계')) return { kind: 'total', name }
  if (PROFIT.has(bare)) return { kind: 'profit', name: bare }
  return { kind: 'line', name }
}
