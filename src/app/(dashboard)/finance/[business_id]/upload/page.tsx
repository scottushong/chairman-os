import Link from 'next/link'
import { notFound } from 'next/navigation'

import { NavSelect } from '@/components/finance-overview/nav-select'
import { UploadBoard, type HeldView } from '@/components/finance-overview/upload-board'
import { canCloseBooks, canKeepBooks } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { kstToday } from '@/lib/chairman-project'
import { buildChecklist } from '@/lib/finance-overview/checklist'
import { addMonths } from '@/lib/finance-overview/engine'
import { MSG_HOLD, revertableIds } from '@/lib/finance-upload/process'
import { featureOn } from '@/lib/features-server'
import { firstParam } from '@/lib/query'
import { getRepository } from '@/lib/repository'
import type { FinHoldKind } from '@/types'

/**
 * «회계 · 재무 자료 올리기»(0085 — 대표 확인 시안 finance-upload-mock.html) — /finance/<회사>/upload.
 * 칸 하나 · 파일 여러 개 · 놓으면 저장. 미리보기 · 넣기 · 종류별 탭 · 옛 «그 밖»(ECOUNT 계정과목 · 연간 · 월별) 칸은 화면에서 뺐다
 * (그 셋도 같은 칸에 놓으면 저장된다 — lib/finance-upload/legacy-auto.ts. 옛 /import 화면 코드는 남겨 두었다).
 * 보류만 그 자리에서 고른다(종류 · 달 · 마감 달 이유 · 급여 개인 줄). 판정은 DB(0070 · 0072 · 0085 RPC).
 */
export const maxDuration = 300

export default async function FinanceUploadPage(props: PageProps<'/finance/[business_id]/upload'>) {
  const { business_id } = await props.params
  const params = await props.searchParams
  const repo = await getRepository()
  const [businesses, user] = await Promise.all([repo.listBusinesses(), currentUser()])
  const business = businesses.find((b) => b.business_id === business_id)
  if (!business) notFound()
  if (!(await featureOn(user, 'finance_upload', business_id))) notFound()

  const canKeep = canKeepBooks(user, business_id)
  const asked = firstParam(params.month)
  const month = asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : addMonths(kstToday().slice(0, 7), -1)
  const keepable = businesses.filter((b) => b.status !== 'Archived' && canKeepBooks(user, b.business_id)).sort((a, b) => a.sort_order - b.sort_order)

  if (!canKeep) {
    return (
      <div className="min-h-full bg-[#f4f5f3]">
        <div className="mx-auto max-w-[1360px] px-4 py-6 sm:px-7">
          <h1 className="text-[22px] font-bold">회계 · 재무 자료 올리기</h1>
          <p className="mt-4 rounded-md bg-white px-3 py-2 text-[14px] text-[#6b7772]">이 회사의 재무를 넣을 권한이 없습니다. (대표 · 그룹 CFO · 해당 회사 대표이사 · 대표가 재무 입력 권한을 준 사람)</p>
        </div>
      </div>
    )
  }

  const uploads = await repo.listFinUploads(business_id).catch(() => [])
  if (user) await repo.finInboxSweep(`${business_id}/${user.user_id}`).catch(() => 0)
  const held: HeldView[] = []
  for (const u of uploads.filter((x) => x.status === 'needs_review').slice(0, 30)) {
    const p = await repo.finUploadPending(u.upload_id).catch(() => null)
    const hold: FinHoldKind = p?.meta?.hold ?? (u.kind === 'unknown' ? 'kind' : 'legacy')
    held.push({ upload: u, hold, message: p?.meta?.hold_message ?? MSG_HOLD[hold], warnings: p?.meta?.warnings ?? [] })
  }
  const payrollHeld = await repo.listFinPayrollHeld(business_id).catch(() => [])
  const [ledger, autoCodes, slips] = await Promise.all([repo.loadFinanceLedger().catch(() => null), repo.listAutoAccounts(business_id).catch(() => [] as string[]), repo.listFinanceImportSlips(business_id).catch(() => [])])
  const accts = (ledger?.accounts ?? []).filter((a) => a.business_id === business_id)
  const vals = await repo.listFinValuations(business_id, month).catch(() => [])
  const checklist = buildChecklist({
    period: month,
    uploads,
    accounts: accts.length === 0 ? 'none' : accts.every((a) => autoCodes.includes(a.account_code)) ? 'auto' : 'file',
    accountsAt: null,
    plMonthlyAt: slips.some((s) => s.month === month && s.superseded_at === null) ? `${month}-01` : null,
    valuationAt: vals.some((v) => !v.voided_at) ? `${month}-01` : null,
  })
  const official = await repo.listOfficialStatements(business_id).catch(() => [])
  const boss = user?.role === 'Chairman' || user?.role === 'GroupCFO'

  return (
    <div className="min-h-full bg-[#f4f5f3] text-[#1a211e]" style={{ fontFamily: '"IBM Plex Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif' }}>
      <div className="mx-auto flex max-w-[1360px] flex-col gap-5 px-4 pt-6 pb-12 sm:px-7">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <h1 className="text-[22px] font-bold">회계 · 재무 자료 올리기</h1>
          <NavSelect label="회사" value={business_id} options={keepable.map((b) => ({ value: b.business_id, label: b.name, href: `/finance/${encodeURIComponent(b.business_id)}/upload?month=${month}` }))} />
          <div className="ml-auto">
            <Link href={`/finance?biz=${encodeURIComponent(business_id)}&month=${month}`} className="text-[13px] text-[#0f6b5c] hover:underline">
              재무 현황으로 ›
            </Link>
          </div>
        </div>
        <UploadBoard
          businessId={business_id}
          month={month}
          userId={user?.user_id ?? ''}
          mode={repo.mode}
          recent={uploads.filter((u) => u.status !== 'needs_review' && !(u.status === 'failed' && (u.error ?? '').startsWith('AI 해석 기록'))).slice(0, 60)}
          held={held}
          payrollHeld={payrollHeld}
          boss={boss}
          revertable={revertableIds(uploads)}
          missing={checklist.filter((c) => c.state === 'missing').map((c) => c.label)}
          got={checklist.filter((c) => c.state !== 'missing').length}
          total={checklist.length}
          overviewHref={`/finance?biz=${encodeURIComponent(business_id)}&month=${month}`}
          accounts={accts.filter((a) => a.active).map((a) => ({ account_code: a.account_code, name: a.name, section: a.section }))}
          canClose={canCloseBooks(user, business_id)}
          officialYears={official.filter((s) => s.period_kind === 'year' && s.superseded_at === null).map((s) => s.period_key)}
        />
      </div>
    </div>
  )
}
