import { suggestAccountClass, type AccountClass } from '@/lib/ecount/excel/accounts-import'
import { ACCOUNT_CODE_PATTERN, ACCOUNT_NAME_MAX } from '@/lib/ledger/accounts'
import type { AuditActor, ChairmanRepository } from '@/lib/repository'
import type { AccountSection } from '@/types'

import { OFFICIAL_GROUP_KO, type OfficialGroup } from './official-lines'

/**
 * 0085 계정 «자동 생성» — 계정과목표가 없거나 모자랄 때, ECOUNT 원장 · 손익 · 결산 줄의 코드 · 이름으로 계정을 만든다(auto_created).
 * 분류는 계정과목 올리기와 같은 제안(lib/ecount/excel/accounts-import suggestAccountClass — 코드 대역 · 구분 · 이름)을 쓰고,
 * 모르면 이름 낱말로 한 번 더, 그래도 모르면 만들지 않는다(엉뚱한 구분에 숫자를 넣지 않는다 — 그 줄은 경고로 남는다).
 * 계정과목표 파일이 오면 같은 코드의 이름 · 구분을 덮어쓰고 auto_created를 내린다(legacy-auto.ts).
 */

export interface AutoAccountRow {
  code: string
  name: string
  /** 파일의 구분 · 묶음 글(있으면) */
  group?: string
}

const byName = (name: string): AccountClass | null => {
  const n = name.replace(/\s/g, '')
  if (/현금|예금|당좌/.test(n) && !/예수금/.test(n)) return { section: 'cash', category: 'asset', cash_flow: null }
  if (/외상매출금|받을어음|매출채권/.test(n)) return { section: 'receivable', category: 'asset', cash_flow: 'operating' }
  if (/외상매입금|지급어음|매입채무/.test(n)) return { section: 'payable', category: 'liability', cash_flow: 'operating' }
  if (/차입금|미지급|예수금|선수금/.test(n)) return { section: 'other_liability', category: 'liability', cash_flow: /차입금/.test(n) ? 'financing' : 'operating' }
  if (/자본금|잉여금/.test(n)) return { section: 'equity', category: 'equity', cash_flow: 'financing' }
  if (/매출$|매출액/.test(n) && !/원가/.test(n)) return { section: 'revenue', category: 'revenue', cash_flow: null }
  if (/원재료|부재료|재고|재공품|제품$|상품$/.test(n)) return { section: 'other_asset', category: 'asset', cash_flow: 'operating' }
  if (/이자수익|이자비용|외환|잡이익|잡손실/.test(n)) return { section: 'non_operating', category: 'other', cash_flow: null }
  if (/법인세/.test(n)) return { section: 'tax', category: 'other', cash_flow: null }
  if (/급여|상여|복리|운반|수수료|임차|접대|통신|차량|광고|판촉|여비|감가상각|보험|세금과공과|소모품|수도광열|전력/.test(n)) return { section: 'sga', category: /급여|상여/.test(n) ? 'labor' : /운반/.test(n) ? 'freight' : /전력|전기/.test(n) ? 'electricity' : 'other', cash_flow: null }
  return null
}

/** 그 회사에 없는 코드만 «자동 생성». 돌려주는 값 = 만든 코드 · 만들지 못한 코드(분류 모름). */
export async function ensureAccounts(repo: ChairmanRepository, actor: AuditActor, businessId: string, rows: AutoAccountRow[]): Promise<{ created: string[]; unknown: string[] }> {
  const ledger = await repo.loadFinanceLedger()
  const have = new Set(ledger.accounts.filter((a) => a.business_id === businessId).map((a) => a.account_code))
  const created: string[] = []
  const unknown: string[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    const code = r.code.trim()
    const name = r.name.trim().slice(0, ACCOUNT_NAME_MAX)
    if (!code || !name || have.has(code) || seen.has(code) || !ACCOUNT_CODE_PATTERN.test(code)) continue
    seen.add(code)
    const s = suggestAccountClass(code, name, r.group ?? '')
    const cls = (s.contradiction ? null : s.suggestion) ?? byName(name)
    if (!cls) {
      unknown.push(code)
      continue
    }
    try {
      await repo.createAccount({ business_id: businessId, account_code: code, name, section: cls.section, category: cls.category, cash_flow: cls.cash_flow, auto_created: true }, actor)
      created.push(code)
    } catch (e) {
      console.error('[auto-accounts] create', code, e instanceof Error ? e.message : e)
      unknown.push(code)
    }
  }
  return { created, unknown }
}

/** 공식 결산 «기타» 계정 — 묶음마다 하나(코드 «ZZ-묶음»). 못 맞춘 결산 줄은 여기로 가고 경고가 남는다. */
const OTHER_CLASS: Record<OfficialGroup, AccountClass> = {
  asset: { section: 'other_asset', category: 'asset', cash_flow: 'operating' },
  liability: { section: 'other_liability', category: 'liability', cash_flow: 'operating' },
  equity: { section: 'equity', category: 'equity', cash_flow: 'financing' },
  revenue: { section: 'revenue', category: 'revenue', cash_flow: null },
  cogs: { section: 'cogs', category: 'other', cash_flow: null },
  mfg: { section: 'cogs', category: 'other', cash_flow: null },
  sga: { section: 'sga', category: 'other', cash_flow: null },
  nonop_income: { section: 'non_operating', category: 'other', cash_flow: null },
  nonop_expense: { section: 'non_operating', category: 'other', cash_flow: null },
  tax: { section: 'tax', category: 'other', cash_flow: null },
}

export const otherCode = (g: OfficialGroup) => `ZZ-${g.toUpperCase().replace(/_/g, '-')}`

export async function ensureOtherAccount(repo: ChairmanRepository, actor: AuditActor, businessId: string, group: OfficialGroup, have: Set<string>): Promise<{ account_code: string; name: string; section: AccountSection }> {
  const code = otherCode(group)
  const cls = OTHER_CLASS[group]
  const name = `기타 ${OFFICIAL_GROUP_KO[group]}(자동)`
  if (!have.has(code)) {
    await repo.createAccount({ business_id: businessId, account_code: code, name, section: cls.section, category: cls.category, cash_flow: cls.cash_flow, auto_created: true }, actor)
    have.add(code)
  }
  return { account_code: code, name, section: cls.section }
}
