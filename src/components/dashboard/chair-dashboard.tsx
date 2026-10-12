import Link from 'next/link'

import { FOURTEEN, loadChairDashboard, rollTrend, TREND_GRAIN_KO, type TrendGrain } from '@/lib/chair-dashboard'
import { kstToday } from '@/lib/chairman-project'
import { featureOn } from '@/lib/features-server'
import { formatEok } from '@/lib/format'
import type { ChairmanRepository } from '@/lib/repository/types'
import type { SessionUser } from '@/types'

/**
 * PHASE 8 대표 대시보드 — 대표 홈(/) 안의 한 칸(별도 앱 · 별도 화면 아님).
 * 스위치 'chairman_dashboard'(0073 · 기본 대표만)를 **서버에서** 본다 — 꺼지면 아무것도 그리지 않는다(읽기도 안 함).
 * 손익 · 매출 · 현금 = 0075 fin_pl_month 값만(그 RPC가 스위치 'monthly_pl' · 장부 읽기 권한을 다시 본다).
 * 제품 하나의 과거 전부는 0077 «판매 실적 · 마진» 화면(제품별)로 보낸다 — 하루 20번 문은 그 화면이 그대로 센다.
 */
export async function ChairDashboard({
  repo,
  user,
  businesses,
  businessId,
  grain,
}: {
  repo: ChairmanRepository
  user: Pick<SessionUser, 'role'> | null
  businesses: { business_id: string; name: string }[]
  businessId: string | undefined
  grain: string | undefined
}) {
  const biz = businesses.find((b) => b.business_id === businessId) ?? businesses[0]
  if (!biz || !(await featureOn(user, 'chairman_dashboard', biz.business_id))) return null
  const g: TrendGrain | 'day' | 'week' = grain === 'quarter' || grain === 'year' || grain === 'day' || grain === 'week' ? grain : 'month'
  const data = await loadChairDashboard(repo, biz.business_id, kstToday())
  const rows = g === 'day' || g === 'week' ? [] : rollTrend(data.months, g).reverse()
  const eok = (v: number | null) => (v === null ? '—' : formatEok(v, 2))
  const href = (o: { biz?: string; grain?: string }) => `/?dbiz=${o.biz ?? biz.business_id}&dgrain=${o.grain ?? g}#chair-dashboard`

  return (
    <section id="chair-dashboard" className="mt-5 scroll-mt-4 rounded-glass border border-line bg-panel p-4" data-testid="chair-dashboard">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-t14 font-semibold text-ink">대표 대시보드 — 손익 · 매출 · 현금 추이</h2>
        <span className="text-t11 text-ink-muted">월별 손익(재고 반영) 값만 · 지난 12달</span>
        <div className="ml-auto flex flex-wrap gap-1 text-t11">
          {businesses.map((b) => (
            <Link key={b.business_id} href={href({ biz: b.business_id })} className={`rounded-md border px-2 py-0.5 ${b.business_id === biz.business_id ? 'border-accent text-accent' : 'border-line text-ink-dim'}`}>
              {b.name}
            </Link>
          ))}
        </div>
      </div>
      <div className="mt-2 flex gap-1 text-t11" role="tablist">
        {(['day', 'week', 'month', 'quarter', 'year'] as const).map((x) => (
          <Link key={x} href={href({ grain: x })} role="tab" aria-selected={x === g} className={`rounded-md border px-2 py-0.5 ${x === g ? 'border-accent text-accent' : 'border-line text-ink-dim'}`}>
            {TREND_GRAIN_KO[x]}
          </Link>
        ))}
      </div>
      {g === 'day' || g === 'week' ? (
        <p className="mt-3 text-t12 text-ink-dim">월별 손익은 달 단위로 마감합니다 — 일 · 주로 나눈 손익은 만들지 않습니다(지어내지 않음). 월 · 분기 · 년을 고르세요.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-t12">
            <thead className="text-ink-muted">
              <tr>
                <th className="text-left font-normal">기간</th>
                <th className="text-right font-normal">매출</th>
                <th className="text-right font-normal">영업이익</th>
                <th className="text-right font-normal">현금 순증감</th>
                <th className="text-left font-normal">구분</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-line-soft">
                  <td className="py-1">{r.label}</td>
                  <td className="py-1 text-right tnum">{eok(r.revenue)}</td>
                  <td className="py-1 text-right tnum">{eok(r.operating_income)}</td>
                  <td className="py-1 text-right tnum">{eok(r.cash_net)}</td>
                  <td className="py-1">
                    <span className={r.basis === 'final' ? 'font-semibold text-ok' : 'text-warn'}>{r.basis === 'final' ? '확정' : '잠정'}</span>
                    {r.missing ? <span className="ml-1 text-ink-muted">· {r.missing}/{r.months}달 없음</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-t10h text-ink-muted">확정 = 묶음의 모든 달이 내부 마감 확정 · 잠정 = 한 달이라도 마감 전. 없는 달은 더하지 않습니다.</p>
        </div>
      )}
      <p className="mt-2 text-t11">
        <Link href={`/finance/${biz.business_id}/monthly`} className="text-accent hover:underline">월별 손익 자세히</Link>
        <span className="mx-2 text-ink-muted">·</span>
        <Link href={`/costs/${biz.business_id}/margins?by=product`} className="text-accent hover:underline">제품별 판매 kg · 매출 · 등급 · 견적 마진 vs 실제(권한자만)</Link>
      </p>

      <h3 className="mt-4 text-t12 font-semibold text-ink">14가지 자료 — 받은 것 / 없는 것</h3>
      {data.uploadsError ? (
        <p className="mt-1 text-t11 text-ink-muted">자료 올리기 목록을 읽지 못했습니다.</p>
      ) : (
        <div className="mt-1 overflow-x-auto">
          <table className="w-full min-w-[720px] text-t10h">
            <thead className="text-ink-muted">
              <tr>
                <th className="text-left font-normal">자료</th>
                {data.months.map((m) => (
                  <th key={m.period} className="text-center font-normal tnum">{m.period.slice(2).replace('-', '.')}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FOURTEEN.map((k) => (
                <tr key={k.kind} className="border-t border-line-soft">
                  <td className="py-0.5 pr-2 whitespace-nowrap">{k.no} {k.label}</td>
                  {data.months.map((m) => {
                    const got = data.received.has(`${k.kind}:${m.period}`)
                    return (
                      <td key={m.period} className={`text-center ${got ? 'text-ok' : 'text-ink-muted'}`} title={got ? '받음' : '없음'}>
                        {got ? '●' : '·'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-t10h text-ink-muted">● 받음(넣기 끝난 올리기) · · 없음. 올리기: <Link href={`/finance/${biz.business_id}/upload`} className="text-accent hover:underline">자료 올리기</Link></p>
        </div>
      )}
    </section>
  )
}
