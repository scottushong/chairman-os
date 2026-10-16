import type { AccountSection } from '@/types'

import { signedAmount } from './official-sign'

/**
 * 공식 결산(세무사 확정 · 국세청 표준재무제표) 줄 다루기 — 화면 · 서버 같이 씀(node 의존 없음). 2026-10-17 운영 고침.
 *
 *   cleanLabel     «29.전기료» · «Ⅳ.판매비와관리비» · «(1)당좌자산» · «①이자수익» → 번호를 뗀 이름. 번호 모양이 묶음 줄의 단서다
 *                  (표준재무제표: 로마 숫자 = 큰 묶음 · (1) = 작은 묶음 · 1. = 계정).
 *   OFFICIAL_GROUPS 표의 어느 부분인가(자산 · 부채 · … · 영업외비용) → 맞출 수 있는 계정 구분(section). 판관비의 «급여»가 제조 «노무비»로,
 *                  영업외의 «외화환산이익»이 매출로 가지 않게 묶음 안에서만 찾는다.
 *   matchOfficial  이름 그대로 → 표준재무제표 이름 바꿈(전기료 → 전력비 · 수도광열비 …) → 앞 · 뒤 일치 → 영업외 묶음 계정. how로 «추정»을 알린다.
 *   officialLines  저장 줄 — 같은 계정에 묶인 줄은 더하고(0020 줄 키가 statement_id + account_code) 0원은 뺀다.
 */

export type OfficialGroup = 'asset' | 'liability' | 'equity' | 'revenue' | 'cogs' | 'mfg' | 'sga' | 'nonop_income' | 'nonop_expense' | 'tax'

export const OFFICIAL_GROUP_KO: Record<OfficialGroup, string> = {
  asset: '자산',
  liability: '부채',
  equity: '자본',
  revenue: '매출',
  cogs: '매출원가',
  mfg: '제조원가',
  sga: '판관비',
  nonop_income: '영업외수익',
  nonop_expense: '영업외비용',
  tax: '법인세',
}

export const GROUP_SECTIONS: Record<OfficialGroup, AccountSection[]> = {
  asset: ['cash', 'receivable', 'other_asset'],
  liability: ['payable', 'other_liability'],
  equity: ['equity'],
  revenue: ['revenue'],
  cogs: ['cogs'],
  mfg: ['cogs'],
  sga: ['sga', 'd_and_a'],
  nonop_income: ['non_operating'],
  nonop_expense: ['non_operating'],
  tax: ['tax'],
}

/** AI가 적은 구분 낱말 → 묶음. 모르면 null. */
export function groupOf(raw: unknown): OfficialGroup | null {
  if (typeof raw !== 'string') return null
  const s = raw.normalize('NFKC').replace(/\s/g, '')
  if (!s) return null
  if (/영업외수익|기타수익|금융수익/.test(s)) return 'nonop_income'
  if (/영업외비용|기타비용|금융비용|금융원가/.test(s)) return 'nonop_expense'
  if (/법인세/.test(s)) return 'tax'
  if (/제조원가|원가명세|노무비|제조경비|재료비/.test(s)) return 'mfg'
  if (/매출원가/.test(s)) return 'cogs'
  if (/판매비|관리비|판관비/.test(s)) return 'sga'
  if (/매출|수익/.test(s)) return 'revenue'
  if (/부채/.test(s)) return 'liability'
  if (/자본/.test(s)) return 'equity'
  if (/자산/.test(s)) return 'asset'
  return null
}

const PREFIX = /^(?:\(\s*\d{1,3}\s*\)|\d{1,3}\s*[.)]|[IVX]{1,6}\s*[.)]|\(\s*[가-하]\s*\)|[가-하]\s*[.)])\s*/i

/** 번호를 뗀 이름과 번호 모양. NFKC가 «Ⅳ»를 «IV»로, «①»을 «1»로 바꾼다(그래서 «①이자수익»은 번호 없는 «1이자수익»이 되어 따로 뗀다). */
export function cleanLabel(raw: string): { name: string; mark: 'roman' | 'paren' | 'number' | 'none' } {
  const n = raw.normalize('NFKC').trim()
  const circled = /^[①-⑳]/.test(raw.trim())
  const m = PREFIX.exec(n)
  if (m) {
    const p = m[0].replace(/\s/g, '')
    const mark = /^[IVX]/i.test(p) ? 'roman' : p.startsWith('(') ? 'paren' : 'number'
    return { name: n.slice(m[0].length).trim(), mark }
  }
  if (circled) return { name: n.replace(/^\d{1,2}/, '').trim(), mark: 'number' }
  return { name: n, mark: 'none' }
}

/** 비교용 — 띄어쓰기 · 괄호 안 · 점 · 가운뎃점을 뺀 소문자. */
export const plain = (s: string) => cleanLabel(s).name.replace(/\(.*?\)|[·.\s]/g, '').toLowerCase()

/** 표준재무제표 이름 → 이 회사 계정과목표에서 찾아볼 이름들(앞이 먼저). 묶음 안에서만 쓴다. */
const ALIASES: [RegExp, string[]][] = [
  [/^현금및(현금성자산|예금)$|^현금$/, ['현금및현금성자산', '현금', '보통예금']],
  [/^(보통|당좌|제)예금$/, ['보통예금', '현금및현금성자산']],
  [/^매출채권$/, ['외상매출금']],
  [/^매입채무$/, ['외상매입금']],
  [/^부가(가치)?세대급금$/, ['부가세대급금']],
  [/^부가(가치)?세예수금$/, ['부가세예수금']],
  [/^(토지|건물|구축물|기계장치|차량운반구|공구(와|와기구|기구)?|비품|집기비품|시설장치|건설중인자산)$/, ['유형자산']],
  [/감가상각누계액$/, ['감가상각누계액']],
  [/^(특허권|산업재산권|소프트웨어|개발비|영업권|상표권|실용신안권|디자인권)$/, ['무형자산']],
  [/^(임차)?보증금$|^전세권$/, ['임차보증금']],
  [/^단기차입금$/, ['차입금', '단기차입금']],
  [/^(장기차입금|유동성장기(부채|차입금))$/, ['장기차입금', '차입금']],
  [/^(보통주)?자본금$/, ['자본금']],
  [/^(미처분|이월)?이익잉여금$|^미처리결손금$|^(미처분이익잉여금|이익잉여금)미처리결손금$/, ['이월이익잉여금', '미처분이익잉여금', '이익잉여금']],
  [/^(급여|임원급여|직원급여|급료와임금|급료|임금)$/, ['급여(판관)', '급여', '직원급여', '제조인건비', '임금']],
  [/^(노무비|제조노무비)$/, ['제조인건비', '노무비']],
  [/^(재료비|원재료비|주요재료비|원재료사용액)$/, ['원재료비', '재료비']],
  [/^(접대비|기업업무추진비)$/, ['접대비', '기업업무추진비']],
  [/^(전기료|전력비|전기요금)$/, ['전력비', '수도광열비', '전기료']],
  [/^(가스수도료|수도료|난방비|연료비)$/, ['수도광열비']],
  [/^세금과공과금?$/, ['세금과공과', '세금과공과금']],
  [/^(지급)?임차료$/, ['지급임차료', '임차료']],
  [/^(지급수수료|수수료비용|수수료)$/, ['지급수수료']],
  [/^운반비$/, ['운반비(판관)', '운반비']],
  [/^(경상)?연구개발비$/, ['연구개발비', '경상연구개발비']],
  [/^(외주가공비|외주비)$/, ['외주가공비']],
  [/^(외환차손|외화환산손실)$/, ['외환차손', '외화환산손실']],
  [/^(외환차익|외화환산이익)$/, ['외환차익', '외화환산이익']],
  [/^(법인세비용|법인세등|법인세)$/, ['법인세비용', '법인세등']],
]

/** 영업외는 낱낱이 맞는 계정이 없으면 묶음 계정으로(표준표: 영업외수익 · 잡손실). */
const GROUP_CATCH_ALL: Partial<Record<OfficialGroup, string[]>> = {
  nonop_income: ['영업외수익', '잡이익', '기타영업외수익'],
  nonop_expense: ['잡손실', '영업외비용', '기타영업외비용'],
}

export type MatchHow = 'exact' | 'alias' | 'near' | 'group'

export interface OfficialAccount {
  account_code: string
  name: string
  section: AccountSection
}

export function matchOfficial<A extends OfficialAccount>(label: string, group: OfficialGroup | null, accounts: A[]): { acc: A; how: MatchHow } | null {
  const l = plain(label)
  if (!l) return null
  const pool = group ? accounts.filter((a) => GROUP_SECTIONS[group].includes(a.section)) : accounts
  const one = (xs: A[]) => (xs.length === 1 ? xs[0] : null)
  const byName = (name: string) => one(pool.filter((a) => plain(a.name) === plain(name)))
  const exact = byName(label)
  if (exact) return { acc: exact, how: 'exact' }
  for (const [re, names] of ALIASES) {
    if (!re.test(l)) continue
    for (const n of names) {
      const hit = byName(n)
      if (hit) return { acc: hit, how: 'alias' }
    }
  }
  const near = one(
    pool.filter((a) => {
      const n = plain(a.name)
      return n.length >= 2 && l.length >= 2 && (n.startsWith(l) || l.startsWith(n))
    }),
  )
  if (near) return { acc: near, how: 'near' }
  for (const n of (group && GROUP_CATCH_ALL[group]) ?? []) {
    const hit = byName(n)
    if (hit) return { acc: hit, how: 'group' }
  }
  return null
}

/** 저장할 줄 하나(화면이 고른 계정 · 그 해 금액) */
export interface PickedLine {
  label: string
  account: OfficialAccount
  printed: number
}

/** 0020 저장 줄 — 같은 계정은 더하고 0원은 뺀다(줄 키가 statement_id + account_code — 겹치면 23505). */
export function officialLines(picked: PickedLine[]): { account_code: string; section: AccountSection; amount: number }[] {
  const by = new Map<string, { account_code: string; section: AccountSection; amount: number }>()
  for (const p of picked) {
    const amount = signedAmount(p.account.section, p.account.name, p.printed, cleanLabel(p.label).name)
    const cur = by.get(p.account.account_code) ?? { account_code: p.account.account_code, section: p.account.section, amount: 0 }
    cur.amount = Math.round((cur.amount + amount) * 100) / 100
    by.set(p.account.account_code, cur)
  }
  return [...by.values()].filter((l) => l.amount !== 0)
}
