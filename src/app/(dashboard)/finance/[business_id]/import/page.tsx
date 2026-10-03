import { notFound } from 'next/navigation'

import { BooksNav } from '@/components/finance/books-nav'
import { EcountImportDrafts, type EcountDraftRow } from '@/components/finance/ecount-import-drafts'
import { EcountImportPanel } from '@/components/finance/ecount-import-panel'
import { PageHeader } from '@/components/layout/page-header'
import { canImportEcount } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { parseMapping } from '@/lib/ecount/excel/mapping'
import { outlineFromSummary } from '@/lib/ecount/excel/workbook'
import { ECOUNT_CODE_BUSINESSES } from '@/lib/ledger/standard-chart'
import { getRepository } from '@/lib/repository'
import { FINANCE_IMPORT_KIND } from '@/types'

/**
 * ECOUNT 엑셀 업로드 (설계서 docs/superpowers/specs/2026-10-02-ecount-excel-import.md A절 · 0050).
 *
 * 세 단 — 계정과목 / 연간 재무제표 / 월별 손익. 계정이 먼저 들어와야 연간 · 월별이 계정에 맞춰진다.
 * 파일을 올리면 서버가 원본을 다시 읽어 해시 · 개요를 적고, 사람이 열을 지정(짐작 · 지난 업로드 지정을 확인)한 뒤
 * 미리보기를 한다. 계정과목은 등록까지, 연간 · 월별은 미리보기 검증까지(등록은 DB 등록 함수가 생긴 뒤).
 * 진행 중 업로드는 아래 목록에서 이어 가거나 취소한다.
 *
 * 없는 회사 · 볼 수 없는 회사 · ECOUNT를 쓰지 않는 회사는 404(다른 재무 화면과 같다 — HANDOVER ⑤).
 * 권한이 없으면 공식 결산 입력 화면처럼 문장으로 말한다. 판정은 0050 RLS(can_keep_books)가 한다.
 */
export default async function EcountImportPage(props: PageProps<'/finance/[business_id]/import'>) {
  const { business_id } = await props.params
  const repo = await getRepository()
  const [businesses, user] = await Promise.all([repo.listBusinesses(), currentUser()])

  const business = businesses.find((b) => b.business_id === business_id)
  if (!business || !ECOUNT_CODE_BUSINESSES.includes(business_id)) notFound()

  const canImport = canImportEcount(user, business_id)

  let drafts: EcountDraftRow[] = []
  if (canImport && user) {
    const rows = await repo.listFinanceImports(business_id, 'draft')
    const files = await Promise.all(rows.map((r) => repo.listAttachments('finance_imports', r.import_id)))
    drafts = rows.map((r, i) => ({
      import_id: r.import_id,
      kind: r.kind,
      file_name: r.file_name,
      created_at: r.created_at,
      hasFile: files[i].length > 0,
      checked: !!r.file_sha256,
      mapped: parseMapping(r.summary?.mapping, r.kind) !== null,
      mine: r.created_by === user.user_id,
      outline: outlineFromSummary(r.summary),
    }))
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
      <PageHeader
        icon="arrow-up"
        title={`${business.name} — ECOUNT 업로드`}
        // 직원이 주로 쓰는 화면이다 — 기능번호(CH-0xx)를 새로 달지 않는다(DEFERRED 2026-10-02 직원 화면 용어 원칙).
        code=""
        description="ECOUNT에서 내려받은 엑셀(.xlsx)을 올립니다. 원본은 재무 권한자만 보는 첨부로 남고, 들어간 숫자에는 «ECOUNT» 출처가 붙습니다(세무사 확정과 따로)."
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <BooksNav businessId={business_id} current="import" canImport={canImport} />
        </div>
      </PageHeader>

      {canImport ? (
        <div className="mt-4 space-y-4">
          <p className="rounded-md border border-line-soft bg-raised/40 px-3 py-2 text-t11h text-ink-dim">
            순서: 계정과목 → 연간 · 월별. 계정이 먼저 있어야 금액 줄이 계정에 맞춰집니다. 마감된 달은 받지 않습니다.
          </p>
          <div className="grid gap-4 lg:grid-cols-3">
            {FINANCE_IMPORT_KIND.map((kind) => (
              <EcountImportPanel key={kind} businessId={business_id} kind={kind} mode={repo.mode} />
            ))}
          </div>
          <EcountImportDrafts drafts={drafts} />
        </div>
      ) : (
        <p className="mt-4 rounded-md bg-panel px-3 py-2 text-t12 text-ink-dim">
          이 회사의 재무를 넣을 권한이 없습니다. (대표 · 그룹 CFO · 해당 회사 대표이사 · 대표가 재무 입력 권한을 준 사람)
        </p>
      )}
    </div>
  )
}
