import { redirect } from 'next/navigation'

/**
 * 예전 주소 — «회계 · 재무 자료 올리기» v2(/finance/<회사>/upload)로 넘긴다(대표 결정 2026-10-12).
 * 계정과목 · 연간 · 월별의 지금까지 흐름은 새 화면의 «그 밖» 칸에 그대로 있다.
 */
export default async function EcountImportRedirect(props: PageProps<'/finance/[business_id]/import'>) {
  const { business_id } = await props.params
  redirect(`/finance/${encodeURIComponent(business_id)}/upload`)
}
