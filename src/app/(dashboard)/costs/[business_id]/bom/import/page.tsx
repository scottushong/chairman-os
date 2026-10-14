import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { CostImportPanel } from '@/components/cost-import/cost-import-panel'
import { PageHeader } from '@/components/layout/page-header'
import { currentUser } from '@/lib/auth/session'
import { costEngineError } from '@/lib/costs/errors'
import { getRepository } from '@/lib/repository'
import type { BomStatus } from '@/types'

/**
 * ⑦ 진짜 BOM 넣기(0063 · 0068 그대로 — 0081은 DB가 없다). 회장 전용 — 대표 외는 서버에서 /me로 돌린다(BOM 화면과 같다).
 * 엑셀 넣기는 BOM 화면과 같은 흐름(actions/cost-import.ts target 'bom')인데, 미리보기는 제품(파일의 제품 칸)마다 줄 수 · 상태만 그린다
 * — 원료 · 비율을 화면에 펼치지 않는다. «진짜 BOM 받기» 스위치는 BOM 화면에서 켜고 끈다. 순서는 docs/onboarding/real-bom-import.md.
 */
export default async function BomImportPage(props: PageProps<'/costs/[business_id]/bom/import'>) {
  const { business_id } = await props.params
  const [repo, user] = await Promise.all([getRepository(), currentUser()])
  if (user?.role !== 'Chairman') redirect('/me')
  const business = (await repo.listBusinesses()).find((b) => b.business_id === business_id)
  if (!business) notFound()

  let status: BomStatus | null = null
  let statusError: string | null = null
  try {
    status = await repo.bomStatus()
  } catch (e) {
    statusError = costEngineError(e, true, 'BOM 상태를 불러오지 못했습니다.')
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 px-4 py-5 sm:px-6">
      <PageHeader icon="layers" title={`${business.name} 진짜 BOM 넣기`} code="COST-B2" description="회장 전용 — R2에서 뽑은 엑셀을 올려 BOM 판을 넣습니다. 미리보기는 제품 코드 · 줄 수만." />
      <p className="text-t12">
        <Link href={`/costs/${business_id}/bom`} className="text-accent hover:underline">
          ← BOM 보기 · 넣기
        </Link>
      </p>
      <section className="rounded-xl border border-line-soft bg-panel p-4 text-t13" aria-label="진짜 BOM 받기 상태">
        {statusError ? (
          <p role="alert" className="text-critical">
            {statusError}
          </p>
        ) : status ? (
          <ul className="space-y-1">
            <li>
              «진짜 BOM 받기»:{' '}
              <span className={status.real_allowed ? 'font-semibold text-ok' : 'font-semibold text-warning'}>{status.real_allowed ? '켜짐' : '꺼짐 — 가짜 판으로만 들어갑니다'}</span>
              {status.changed_at ? <span className="text-ink-muted"> · 바꾼 때 {status.changed_at.slice(0, 16).replace('T', ' ')}</span> : null}
            </li>
            <li>
              BOM 암호 키: <span className={status.key_ready ? 'text-ok' : 'text-critical'}>{status.key_ready ? '준비됨' : '없음 — docs/onboarding/bom-key-setup.md 먼저'}</span>
            </li>
            <li className="text-t12 text-ink-muted">스위치를 켜고 끄는 곳은 BOM 화면입니다. 넣는 순서 · 확인 · 되돌리기는 docs/onboarding/real-bom-import.md.</li>
          </ul>
        ) : null}
      </section>
      <CostImportPanel businessId={business_id} target="bom" title="BOM 엑셀 올리기(제품 코드 · 줄 수 미리보기)" summaryOnly />
    </div>
  )
}
