import { type NextRequest } from 'next/server'

import { auditFilters, canExportLedger, ledgerFileName, ledgerHistory, ledgerTotals, parseLedgerFilters } from '@/lib/approval-ledger'
import { loadLedger } from '@/lib/approval-ledger-load'
import { buildLedgerWorkbook, contentDisposition, XLSX_CONTENT_TYPE } from '@/lib/approval-ledger-xlsx'
import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'

/**
 * GET /approvals/ledger/export?<대장 화면과 같은 거르기> — 결재 대장 엑셀(.xlsx) 내려받기.
 *
 * ■ 왜 /api 밑이 아닌가 ■ proxy.ts는 /api/*에 2단계 인증(/mfa) 관문을 걸지 않는다. 회사 결재 전부가 담기는 파일이라
 *   화면과 같은 관문(로그인 + 2단계)을 그대로 타게 화면 주소 밑에 둔다. 로그인 안 했으면 proxy가 /login으로 돌린다.
 *
 * ■ 범위 ■ 요청한 사람의 쿠키 세션으로 읽는다(getRepository — service_role 없음). RLS가 다시 거르므로
 *   못 읽는 결재는 파일에 들어올 길이 없다. URL 값은 그 안에서 좁히기만 한다(parseLedgerFilters).
 *
 * ■ 누가 ■ 회장(전체 · 회사) 또는 «결재 대장 열람» 줄이 있는 회사를 고른 사람만(canExportLedger = 0059 approval_ledger_log의 거울).
 *   그 밖은 403. 본인 · 결재선 줄만 보는 사람은 화면에서 보기만 한다.
 *
 * ■ 감사 ■ 파일을 돌려주기 **전에** approval_ledger_log를 남긴다. 기록이 실패하면 파일도 주지 않는다 —
 *   기록 없는 내려받기는 없다.
 */
export const dynamic = 'force-dynamic'

function fail(status: number, message: string) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

export async function GET(request: NextRequest) {
  const user = await currentUser()
  if (!user) return fail(401, '로그인이 필요합니다.')

  const filters = parseLedgerFilters(Object.fromEntries(request.nextUrl.searchParams))
  if (!canExportLedger(user.role, user.ledger, filters.company)) {
    return fail(403, '엑셀 내려받기는 «결재 대장 열람»이 켜진 회사를 고른 뒤에 할 수 있습니다.')
  }

  try {
    const repo = await getRepository()
    const { rows, decisions, steps, templates, businesses } = await loadLedger(repo, user.role, filters)
    const totals = ledgerTotals(rows, filters.grain)
    const history = ledgerHistory(rows, steps, decisions, user.role)
    const wb = buildLedgerWorkbook({
      rows,
      totals,
      history,
      templates,
      filters,
      businessNames: Object.fromEntries(businesses.map((b) => [b.business_id, b.name])),
    })
    const buffer = await wb.xlsx.writeBuffer()

    // 파일을 돌려주기 전에 기록한다. 실패하면(DB가 권한을 다시 본다) 아래 catch로 — 파일은 나가지 않는다.
    await repo.logLedgerExport(filters.company ?? null, rows.length, auditFilters(filters), { user_id: user.user_id, role: user.role })

    return new Response(new Uint8Array(buffer as ArrayBuffer), {
      status: 200,
      headers: {
        'Content-Type': XLSX_CONTENT_TYPE,
        'Content-Disposition': contentDisposition(ledgerFileName(filters)),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (e) {
    console.error('[approvals/ledger/export]', e instanceof Error ? e.message : String(e))
    // DB가 감사 기록을 거절했다(0059 approval_ledger_log — 권한 없음). 파일은 나가지 않는다.
    if (e instanceof Error && e.message.includes('approval_not_found')) {
      return fail(403, '이 회사의 결재 대장을 내려받을 권한이 없습니다.')
    }
    return fail(500, '엑셀을 만들지 못했습니다. 잠시 뒤 다시 눌러 주세요.')
  }
}
