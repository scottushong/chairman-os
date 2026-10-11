import { notFound, redirect } from 'next/navigation'

import { BomBoard } from '@/components/bom/bom-board'
import { CostImportPanel } from '@/components/cost-import/cost-import-panel'
import { PageHeader } from '@/components/layout/page-header'
import { currentUser } from '@/lib/auth/session'
import { kstToday } from '@/lib/chairman-project'
import { costEngineError } from '@/lib/costs/errors'
import { getRepository } from '@/lib/repository'
import type { BomCurrent, BomStatus, BomVersionRow } from '@/types'

/**
 * 대표 BOM(0063 · 설계서 7절) — 회장 전용. 대표 외는 서버에서 /me로 돌린다(존재를 말하지 않는다 — CLAUDE.md 직원 화면 용어 원칙).
 *
 * 키 상태 · «진짜 BOM 받기» 스위치 · 제품마다 지금 판(원료 · kg/kg) · 분해 · 판 이력 · 새 판 저장. 판을 열 때마다 DB가 열람 감사를 남긴다.
 * BOM 값은 AI 코드(src/lib/ai)로 가지 않는다 — 이 화면은 그것을 import하지 않는다(check:sales-cost).
 */
export default async function BomPage(props: PageProps<'/costs/[business_id]/bom'>) {
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

  const [products, materials] = await Promise.all([repo.listCostProducts(business_id), repo.listCostMaterials(business_id)])
  let versions: BomVersionRow[] = []
  try {
    versions = await repo.bomVersions(business_id)
  } catch (e) {
    statusError ??= costEngineError(e, true, 'BOM 이력을 불러오지 못했습니다.')
  }

  // 제품마다 지금 판 — 키가 없거나 깨졌으면 그 제품 칸에 이유를 적는다(조용히 비우지 않는다).
  const current: Record<string, BomCurrent | null> = {}
  const currentErrors: Record<string, string> = {}
  await Promise.all(
    products.map(async (p) => {
      try {
        current[p.product_id] = await repo.bomGet(p.product_id)
      } catch (e) {
        currentErrors[p.product_id] = costEngineError(e, true, 'BOM을 불러오지 못했습니다.')
      }
    }),
  )

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
      <PageHeader icon="layers" title={`${business.name} BOM`} code="COST-B1" description="회장 전용 — 배합(원료 · kg/kg)은 암호문으로만 저장되고, 열 때마다 기록이 남습니다." />
      <div className="mt-4">
        <CostImportPanel businessId={business_id} target="bom" title="BOM 엑셀로 넣기" />
      </div>
      <BomBoard
        businessId={business_id}
        today={kstToday()}
        status={status}
        statusError={statusError}
        products={products}
        materials={materials}
        current={current}
        currentErrors={currentErrors}
        versions={versions}
      />
    </div>
  )
}
