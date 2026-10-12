import { notFound } from 'next/navigation'

import { BooksNav } from '@/components/finance/books-nav'
import { EcountImportDrafts, type EcountDraftRow } from '@/components/finance/ecount-import-drafts'
import { EcountImportPanel } from '@/components/finance/ecount-import-panel'
import { FinanceUploadBoard, type PendingView } from '@/components/finance/finance-upload-board'
import { PageHeader } from '@/components/layout/page-header'
import { canImportEcount, canKeepBooks } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { parseMapping } from '@/lib/ecount/excel/mapping'
import { outlineFromSummary } from '@/lib/ecount/excel/workbook'
import { aiLimits } from '@/lib/finance-upload/ai'
import { KIND_SPECS } from '@/lib/finance-upload/kinds'
import { kstToday } from '@/lib/chairman-project'
import { revertableIds } from '@/lib/finance-upload/process'
import { firstParam } from '@/lib/query'
import { getRepository } from '@/lib/repository'
import { FINANCE_IMPORT_KIND } from '@/types'

/**
 * «회계 · 재무 자료 올리기» v2(대표 결정 2026-10-12) — /finance/<회사>/upload. 예전 /import는 여기로 넘긴다.
 *
 * 놓는 칸 하나(여러 파일) → 파일 카드(종류 · 기간 · 상태: 자동 넣음 · 확인 필요 · 실패 · 되돌림) → 미리보기 대기(종류 · 칸 · 기간 ·
 * 겹침 · 이유) → 넣기. 위쪽은 14가지 자료의 «이번 달 받은 것 / 아직 없는 것» 체크표. 계정과목 · 연간 · 월별 손익 · 공식 결산은
 * 지금까지의 흐름을 «그 밖» 칸에 접어 둔다(ECOUNT는 «출처» 값일 뿐 — 화면 이름에 쓰지 않는다).
 * 권한이 없으면 문장으로 말한다. 판정은 0070 RPC(can_keep_books)다.
 */
export default async function FinanceUploadPage(props: PageProps<'/finance/[business_id]/upload'>) {
  const { business_id } = await props.params
  const params = await props.searchParams
  const repo = await getRepository()
  const [businesses, user] = await Promise.all([repo.listBusinesses(), currentUser()])
  const business = businesses.find((b) => b.business_id === business_id)
  if (!business) notFound()

  const canKeep = canKeepBooks(user, business_id)
  const asked = firstParam(params.month)
  const month = asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : kstToday().slice(0, 7)

  const uploads = canKeep ? await repo.listFinUploads(business_id).catch(() => []) : []
  const pendings: PendingView[] = []
  for (const u of uploads.filter((x) => x.status === 'needs_review').slice(0, 20)) {
    const p = await repo.finUploadPending(u.upload_id).catch(() => null)
    if (p) {
      const overlap = !!u.period && uploads.some((o) => o.kind === u.kind && o.period === u.period && o.status === 'applied')
      pendings.push({ upload: u, rows: p.rows.slice(0, 30), rowCount: p.rows.length, peopleCount: p.people?.length ?? null, hasGrid: !!p.grid, meta: p.meta ?? {}, overlap })
    }
  }
  const received = Object.fromEntries(KIND_SPECS.map((k) => [k.kind, uploads.find((u) => u.kind === k.kind && u.period === month && u.status === 'applied') ?? null]))

  // 그 밖(기존 흐름) — ECOUNT 코드 회사(DY)만.
  const legacy = canImportEcount(user, business_id)
  let drafts: EcountDraftRow[] = []
  if (legacy && user) {
    const rows = await repo.listFinanceImports(business_id, 'draft').catch(() => [])
    const files = await Promise.all(rows.map((r) => repo.listAttachments('finance_imports', r.import_id).catch(() => [])))
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
  const limits = aiLimits()
  const revertable = revertableIds(uploads)

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
      <PageHeader
        icon="arrow-up"
        title={`${business.name} — 회계 · 재무 자료 올리기`}
        code=""
        description="엑셀(xlsx · xls · csv) · PDF · 사진을 놓으면 종류 · 기간 · 칸을 알아내 넣습니다. 확실하지 않으면 미리보기로 멈춥니다."
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <BooksNav businessId={business_id} current="import" canImport={canKeep} />
        </div>
      </PageHeader>

      {canKeep ? (
        <>
          <FinanceUploadBoard
            businessId={business_id}
            month={month}
            uploads={uploads.slice(0, 60)}
            pendings={pendings}
            received={received}
            role={user?.role ?? 'Member'}
            ai={{ on: limits.perFile > 0 && limits.perDay > 0, perFile: limits.perFile, perDay: limits.perDay }}
            revertable={revertable}
          />
          {legacy ? (
            <details className="mt-4 rounded-xl border border-line-soft bg-panel p-3">
              <summary className="cursor-pointer text-t12 font-semibold">그 밖 — 계정과목표 · 재무제표(연간) · 월별 손익(지금까지의 흐름)</summary>
              <p className="mt-2 text-t11h text-ink-dim">순서: 계정과목 → 연간 · 월별. 마감된 달은 받지 않습니다. 세무사 확정 결산은 «공식 결산» 탭에서 넣습니다.</p>
              <div className="mt-3 grid gap-4 lg:grid-cols-3">
                {FINANCE_IMPORT_KIND.map((kind) => (
                  <EcountImportPanel key={kind} businessId={business_id} kind={kind} mode={repo.mode} />
                ))}
              </div>
              <EcountImportDrafts drafts={drafts} />
            </details>
          ) : null}
        </>
      ) : (
        <p className="mt-4 rounded-md bg-panel px-3 py-2 text-t12 text-ink-dim">
          이 회사의 재무를 넣을 권한이 없습니다. (대표 · 그룹 CFO · 해당 회사 대표이사 · 대표가 재무 입력 권한을 준 사람)
        </p>
      )}
    </div>
  )
}
