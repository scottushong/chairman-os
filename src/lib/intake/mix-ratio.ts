/**
 * 배합비 감지 — AI를 부르기 **전에**, 서버에서, 결정적으로(설계서 A5). 순수 함수만 — 검사 스크립트(check:intake)가 같은 함수를 잰다.
 *
 * 입력은 extract.ts가 뽑은 글(시트 · 쪽 · 문서 단위의 문자열 배열)이다. 표는 줄마다 칸을 탭(엑셀 — extract.ts xlsx)
 * · 세로줄(|) · 두 칸 이상의 공백으로 가른다.
 *
 *   ⓐ 낱말 — 배합 · 배합비 · 배합표 · 처방 · 레시피 · formula · formulation · recipe · 투입비 · 함량비 · w/w · wt% · phr
 *   ⓑ 모양 — 한 표에서 퍼센트 열의 합이 99~101, 또는 «부(parts)» 열의 합이 100 · 1000
 *   ⓒ 원료명 열 + 비율 열이 같이 있는 표
 *   **ⓑ 또는 ⓐ+ⓒ일 때 건다.** ⓐ 하나만으로는 걸지 않는다(«배합 사료 단가표» 같은 말이 흔하다).
 *
 * **한계(화면에 그대로 적는다 — MIX_RATIO_LIMITS)**: 비율을 무게(kg/배치)로 적은 표 · 암호 같은 코드 이름 · 여러 시트에
 * 흩어 놓은 표 · 그림 속 표(사진 · 스캔본은 글자층이 없어 이 감지를 못 탄다 — 올린 사람의 «배합비 아님» 확인이 1차 문)를
 * 놓친다. 거꾸로 지분표 · 할인율 표처럼 퍼센트 합이 100인 표를 잘못 건다 — 그때는 대표가 «배합비 아님»으로 푼다(F3).
 * 감지는 **안전망이지 보증이 아니다** — 배합비는 처음부터 Vault에 두는 것이 규칙이다.
 */

export type MixRule = 'percent_sum' | 'parts_sum' | 'keyword_and_ratio_table'

export interface MixVerdict {
  hit: boolean
  rule: MixRule | null
  /** 사람이 읽는 근거 한 줄(감사 메모 · 화면). 표 내용 · 숫자는 담지 않는다 — 열 이름과 합계만. */
  detail: string | null
  /** 찾은 낱말(ⓐ) — 걸지 않았어도 남긴다(검사 · 디버그용). */
  keywords: string[]
}

export const MIX_RULE_LABEL_KO: Record<MixRule, string> = {
  percent_sum: '퍼센트 열의 합이 100',
  parts_sum: '«부(parts)» 열의 합이 100 · 1000',
  keyword_and_ratio_table: '배합 낱말 + 원료명 · 비율 열',
}

export const MIX_RATIO_MESSAGE =
  '이 파일은 배합비로 보입니다 — AI에 보내지 않았습니다. Vault에 두세요(문서 › 링크로 등록). 올린 파일은 지우세요.'

export const MIX_RATIO_LIMITS =
  '감지는 안전망이지 보증이 아닙니다 — 비율을 무게(kg/배치)로 적은 표, 코드 이름, 여러 시트에 흩어 놓은 표, 그림 속 표는 놓치고, 지분표 · 할인율 표는 잘못 걸 수 있습니다. 배합비는 처음부터 Vault에 두세요.'

const KEYWORDS: [string, RegExp][] = [
  ['배합', /배합/],
  ['처방', /처방/],
  ['레시피', /레시피/],
  ['formula', /\bformula(?:tion)?s?\b/i],
  ['recipe', /\brecipes?\b/i],
  ['투입비', /투입\s*비/],
  ['함량비', /함량\s*비/],
  ['w/w', /\bw\s*\/\s*w\b/i],
  ['wt%', /\bwt\s*\.?\s*%/i],
  ['phr', /\bphr\b/i],
]

/** 원료명 열의 머리. */
const INGREDIENT_HEADER = /^(?:원료|원료\s*명|원재료|원재료\s*명|성분|성분\s*명|재료|재료\s*명|품목|품명|ingredients?|raw\s*materials?|materials?|components?)$/i
/** 비율 열의 머리(ⓒ). */
const RATIO_HEADER = /(?:%|비율|함량|배합|투입\s*비|ratio|w\s*\/\s*w|wt|phr|parts?|중량\s*부|^부$|\(부\))/i
/** 퍼센트 열의 머리(ⓑ). «율» 하나로는 걸지 않는다(할인율 · 수율 · 이익률). */
const PERCENT_HEADER = /(?:%|퍼센트|percent|비율|함량|배합\s*비|w\s*\/\s*w|wt)/i
/** «부(parts)» 열의 머리(ⓑ). «부서» · «부가세»는 아니다. */
const PARTS_HEADER = /(?:^부$|\(부\)|중량\s*부|\bparts?\b|\bphr\b|\bpbw\b)/i
/** 합계 줄 — 더하지 않는다. */
const TOTAL_ROW = /^(?:합\s*계|총\s*계|계|소계|total|sum|subtotal)$/i

function cellsOf(line: string): string[] {
  const parts = line.includes('\t') ? line.split('\t') : line.includes('|') ? line.split('|') : line.split(/\s{2,}/)
  return parts.map((c) => c.trim()).filter((c, i, all) => c !== '' || (i > 0 && i < all.length - 1))
}

/** «12.5%» · «1,000» · «(3.0)» → 숫자. 숫자가 아니면 null. */
function num(cell: string): number | null {
  const t = cell.replace(/[,\s]/g, '').replace(/%$/, '').replace(/^\((.*)\)$/, '$1')
  if (!/^-?\d+(?:\.\d+)?$/.test(t)) return null
  return Number(t)
}

interface Table {
  header: string[]
  rows: string[][]
}

/** 한 단위(시트 · 쪽 · 문서)의 줄들에서 표를 찾는다 — 칸이 둘 이상인 줄이 이어진 덩어리. 첫 줄 중 숫자가 아닌 칸이 많은 줄이 머리. */
export function findTables(unit: string): Table[] {
  const tables: Table[] = []
  let block: string[][] = []
  const flush = () => {
    if (block.length >= 3) {
      const hi = block.findIndex((r) => r.filter((c) => num(c) === null && c !== '').length >= Math.max(2, Math.ceil(r.length / 2)))
      if (hi >= 0 && hi < block.length - 1) tables.push({ header: block[hi], rows: block.slice(hi + 1) })
    }
    block = []
  }
  for (const raw of unit.split(/\r?\n/)) {
    const cells = cellsOf(raw)
    if (cells.length >= 2) block.push(cells)
    else flush()
  }
  flush()
  return tables
}

function columnSum(t: Table, col: number): { sum: number; count: number } {
  let sum = 0
  let count = 0
  for (const r of t.rows) {
    if (r.some((c) => TOTAL_ROW.test(c))) continue
    const v = num(r[col] ?? '')
    if (v === null) continue
    sum += v
    count++
  }
  return { sum: Math.round(sum * 1000) / 1000, count }
}

/** 값이 «%»로 끝나는 칸이 그 열 숫자의 6할 이상인가 — 머리 없이 값에 %를 붙인 표. */
function percentValues(t: Table, col: number): boolean {
  const vals = t.rows.map((r) => r[col] ?? '').filter((c) => num(c) !== null)
  return vals.length >= 2 && vals.filter((c) => /%\s*$/.test(c)).length / vals.length >= 0.6
}

export function detectMixRatio(units: string[]): MixVerdict {
  const text = units.join('\n')
  const keywords = KEYWORDS.filter(([, re]) => re.test(text)).map(([k]) => k)
  let ratioTable: string | null = null

  for (const unit of units) {
    for (const t of findTables(unit)) {
      const width = Math.max(t.header.length, ...t.rows.map((r) => r.length))
      for (let col = 0; col < width; col++) {
        const head = t.header[col] ?? ''
        const { sum, count } = columnSum(t, col)
        if (count < 2) continue
        // ⓑ 퍼센트 열의 합 99~101
        if ((PERCENT_HEADER.test(head) || percentValues(t, col)) && sum >= 99 && sum <= 101) {
          return { hit: true, rule: 'percent_sum', detail: `열 «${head || '(이름 없음)'}»의 합 ${sum}`, keywords }
        }
        // ⓑ «부(parts)» 열의 합 100 · 1000
        if (PARTS_HEADER.test(head) && (Math.abs(sum - 100) <= 0.5 || Math.abs(sum - 1000) <= 1)) {
          return { hit: true, rule: 'parts_sum', detail: `열 «${head}»의 합 ${sum}`, keywords }
        }
      }
      // ⓒ 원료명 열 + 비율 열
      const ing = t.header.findIndex((h) => INGREDIENT_HEADER.test(h.replace(/\s+/g, ' ').trim()))
      const ratio = t.header.findIndex((h, i) => i !== ing && RATIO_HEADER.test(h))
      if (ing >= 0 && ratio >= 0 && !ratioTable) ratioTable = `«${t.header[ing]}» + «${t.header[ratio]}»`
    }
  }
  // ⓐ + ⓒ
  if (keywords.length && ratioTable) {
    return { hit: true, rule: 'keyword_and_ratio_table', detail: `낱말 ${keywords.join(' · ')} + 열 ${ratioTable}`, keywords }
  }
  return { hit: false, rule: null, detail: null, keywords }
}
