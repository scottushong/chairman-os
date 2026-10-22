import { redirect } from 'next/navigation'

/**
 * 예전 주소 — «월별 간이 손익(CH-026) · 월별 손익 — 재고 반영»(지움 2026-10-20 A5, docs/onboarding/remove-legacy-finance-1020.md).
 * 재무 현황 «손익계산서» 탭으로 넘긴다(?pl=YYYY-MM 이면 그 달 — 없으면 탭의 기본 달).
 * 내부 마감 확정 · 조정 제안 · 설정은 그 탭 아래로 옮겼다. 손입력으로 넣은 전표는 장부에 그대로 있고 재무 현황이 읽는다.
 */
export default async function MonthlyRedirect(props: PageProps<'/finance/[business_id]/monthly'>) {
  const { business_id } = await props.params
  const q = await props.searchParams
  const pl = Array.isArray(q.pl) ? q.pl[0] : q.pl
  const month = typeof pl === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(pl) ? pl : null
  redirect(`/finance?biz=${encodeURIComponent(business_id)}&tab=pl${month ? `&month=${month}` : ''}`)
}
