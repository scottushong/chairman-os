'use server'

import { revalidatePath } from 'next/cache'

import { canCloseBooks } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'
import { balanceCheck } from '@/lib/statements/balance'
import { readStatementLines } from '@/lib/statements/lines'
import { isValidPeriodKey, type OfficialPeriodKind } from '@/lib/statements/period'
import type { NewOfficialStatement } from '@/types'

/**
 * Phase 2-C 블록 1 — 공식 재무제표 저장 (0020).
 *
 * 권한 판정은 여기서 하지 않는다. 로그인한 본인 세션으로 DB에 붙고 0020의 can_keep_books()가
 * 역할과 회사 범위를 본다. 감사 기록은 official_statement_save()가 남긴다.
 * 여기서는 입력 검증만 한다 — 그리고 그 검증은 **DB가 한 번 더 한다**.
 * 화면 검증은 사람에게 먼저 알려 주려는 것이고, 판정의 마지막 자리는 DB다.
 */

export interface StatementState {
  error?: string
  /** 저장된 재무제표 id */
  id?: number
  /** 자산 − (부채 + 자본). 안 맞을 때만 채워 보낸다 — 화면이 금액으로 말해 준다. */
  difference?: number
  /** 같은 해 확정이 이미 있다(0083) — 화면이 «바꾸기»를 확인한 뒤 replace로 다시 보낸다 */
  exists?: boolean
}

/** 0083 학습 줄 — «묶음:이름» → 계정. 모양이 틀린 줄은 버린다(DB도 버린다). */
function readLearn(raw: unknown): { std_key: string; account_code: string }[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is { std_key: string; account_code: string } => !!x && typeof (x as { std_key?: unknown }).std_key === 'string' && typeof (x as { account_code?: unknown }).account_code === 'string')
    .filter((x) => /^[a-z_]{1,20}:.{1,80}$/.test(x.std_key) && x.account_code.length <= 40)
    .slice(0, 500)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function saveOfficialStatement(input: {
  businessId: unknown
  periodKind: unknown
  periodKey: unknown
  evidenceUrl: unknown
  memo: unknown
  lines: unknown
  /** 0083: 올린 원본(fin-official-evidence) — 있으면 링크는 비워도 된다 */
  evidenceFile?: unknown
  /** 0083: 재무상태표가 닫히지 않은 채 저장하는 이유(대표 · CFO · 마감 권한자) */
  unbalancedReason?: unknown
  /** 0083: 같은 해 확정을 바꾼다(화면이 확인함) */
  replace?: unknown
  /** 0083: 계정 맞춤 학습 */
  learn?: unknown
}): Promise<StatementState> {
  const business_id = text(input.businessId)
  const period_kind = text(input.periodKind) as OfficialPeriodKind
  const period_key = text(input.periodKey)
  const evidence_url = text(input.evidenceUrl)
  const memo = text(input.memo)
  const evidence_file = text(input.evidenceFile) || null
  const reason = text(input.unbalancedReason).slice(0, 500)

  if (!business_id) return { error: '어느 회사의 재무제표인지 알 수 없습니다.' }
  if (period_kind !== 'year' && period_kind !== 'quarter') {
    return { error: '기간 단위는 연간 또는 분기입니다.' }
  }
  if (!isValidPeriodKey({ kind: period_kind, key: period_key })) {
    return { error: '기간 형식이 올바르지 않습니다. (연간 2025 · 분기 2026-Q1)' }
  }
  // 증빙과 메모를 막는 이유: 확정 꼬리표를 다는 숫자에 근거가 없으면 그 꼬리표가 거짓이 된다.
  if (evidence_file && !evidence_file.startsWith(`${business_id}/`)) return { error: '증빙 파일이 이 회사 것이 아닙니다 — 다시 올려 주세요.' }
  if (evidence_url && !/^https?:\/\//i.test(evidence_url)) return { error: '증빙 링크는 https:// 로 시작하는 주소입니다.' }
  if (!evidence_url && !evidence_file) {
    return { error: '증빙이 필요합니다. 결산서 원본을 올리거나 사내 스토리지의 PDF 주소를 넣으세요.' }
  }
  if (!memo) return { error: '메모가 필요합니다. (예: 성연회계법인 2025 결산)' }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    const ledger = await repo.loadFinanceLedger()
    const sectionOf = new Map(
      ledger.accounts.filter((a) => a.business_id === business_id).map((a) => [a.account_code, a.section]),
    )

    // 화면에서 온 줄 — 숫자가 아니면 통째로 실패 · 같은 계정은 더함 · 0원은 뺌(lib/statements/lines.ts).
    const parsed = readStatementLines(input.lines, sectionOf)
    if (!parsed) return { error: '금액을 읽을 수 없는 줄이 있습니다. 숫자만 넣으세요.' }
    if (parsed.lines.length === 0) return { error: '금액이 있는 줄이 하나도 없습니다.' }

    // 저장 전에 같은 규칙으로 한 번 본다. 판정은 DB가 한 번 더 한다(0020).
    const balance = balanceCheck(parsed.typed)
    // 0083: 안 닫히면 대표 · CFO · 마감 권한자가 이유(5자 이상)를 적었을 때만. 판정은 DB가 한 번 더 한다.
    if (!balance.balanced && (reason.length < 5 || !canCloseBooks(user, business_id))) {
      return {
        error: `재무상태표가 닫히지 않습니다. 자산 − (부채 + 자본) = ${balance.difference.toLocaleString('ko-KR')}원${canCloseBooks(user, business_id) ? ' — 그대로 저장하려면 이유를 적어 주세요.' : ' — 계정 · 부호를 확인하거나 대표 · CFO에게 저장을 부탁하세요.'}`,
        difference: balance.difference,
      }
    }

    const statement: NewOfficialStatement = {
      business_id,
      period_kind,
      period_key,
      evidence_url,
      evidence_file,
      memo,
      lines: parsed.lines,
      unbalanced_reason: balance.balanced ? null : reason,
      replace: input.replace === true,
      learn: readLearn(input.learn),
    }
    const id = await repo.saveOfficialStatement(statement, { user_id: user.user_id, role: user.role })

    const base = `/finance/${encodeURIComponent(business_id)}`
    revalidatePath(`${base}/statements`)
    revalidatePath(`${base}/monthly`)
    revalidatePath(base)
    revalidatePath('/finance')
    revalidatePath(`/business/${encodeURIComponent(business_id)}`)
    revalidatePath('/')
    return { id }
  } catch (e) {
    console.error('[saveOfficialStatement]', e)
    const message = e instanceof Error ? e.message : ''
    if (/official_exists/.test(message)) return { error: '이 해의 확정 결산이 이미 있습니다 — 바꾸려면 «바꾸기»를 확인해 주세요.', exists: true }
    if (/official_unbalanced_forbidden/.test(message)) return { error: '닫히지 않은 결산은 대표 · 그룹 CFO · 마감 권한자만 이유를 적고 저장합니다.' }
    if (/official_unbalanced/.test(message)) return { error: '재무상태표가 닫히지 않습니다 — 그대로 저장하려면 이유(5자 이상)를 적어 주세요.' }
    if (/official_evidence_file_missing/.test(message)) return { error: '보관된 증빙 파일을 찾지 못했습니다 — 결산서를 다시 올리거나 링크를 넣어 주세요.' }
    if (/official_evidence_missing/.test(message)) return { error: '증빙이 필요합니다(올린 원본 또는 링크).' }
    if (/official_line_unknown_account/.test(message)) return { error: '계정과목표에 없는 계정이 있습니다 — 새로 고친 뒤 다시 골라 주세요.' }
    if (/official_line_duplicate/.test(message)) return { error: '같은 계정이 두 줄입니다 — 새로 고친 뒤 다시 저장해 주세요.' }
    if (/닫히지 않습니다/.test(message)) return { error: message }
    // 0051 리뷰 m-3: 같은 기간을 두 사람이 동시에 저장하면 활성 unique(23505)나 supersede 가드가 둘째를 막는다.
    if (/23505|official_statements_one_active|official_statement_immutable/.test(message)) {
      return { error: '다른 사람이 같은 해 결산을 방금 등록했습니다. 새로 고친 뒤 다시 확인해 주세요.' }
    }
    if (/42501|PGRST301|row-level security/.test(message)) {
      return { error: '이 회사의 결산을 넣을 권한이 없습니다. (대표 · 그룹 CFO · 해당 회사 대표이사 · 대표가 재무 입력 권한을 준 사람)' }
    }
    return { error: '재무제표를 저장하지 못했습니다.' }
  }
}
