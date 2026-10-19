import type { DailyReport } from '@/lib/finance-overview/cash-days'
import { eok, usd, won } from '@/lib/finance-overview/format'

import { Card, Lack, Note, T, Td, Th } from './parts'

/** «일별 자금보고» — 시안 finance-daily-mock.html: ① 계좌별 잔액 ② 이달 매출과 수금 ③ 대출 현황 ④ 10일 잔액 추이 · 오늘 들어오고 나간 돈. */
export function DailyTab({ d, upload }: { d: DailyReport; upload: string }) {
  const mon = Number(d.asOf.slice(5, 7))
  const day = Number(d.asOf.slice(8, 10))
  const max = Math.max(1, ...d.trend.map((t) => t.krw))
  const min = Math.min(...d.trend.map((t) => t.krw), max)
  const h = (v: number) => Math.round(40 + ((v - min) / Math.max(1, max - min)) * 80)
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="① 현금 잔액 — 오늘 아침">
          {d.balances.length ? (
            <T>
              <thead>
                <tr>
                  <Th>계좌</Th>
                  <Th n>원화</Th>
                  <Th n>달러</Th>
                </tr>
              </thead>
              <tbody>
                {d.balances.map((b) => (
                  <tr key={b.account}>
                    <Td>{b.account}</Td>
                    <Td n>{b.krw === null ? '—' : won(b.krw)}</Td>
                    <Td n>{b.usd === null ? '—' : usd(b.usd)}</Td>
                  </tr>
                ))}
                <tr>
                  <Td bold>합계</Td>
                  <Td n bold>{won(d.totalKrw)}</Td>
                  <Td n bold>{d.totalUsd === null ? '—' : usd(d.totalUsd)}</Td>
                </tr>
                {d.totalUsd !== null ? (
                  <tr>
                    <Td className="text-[#6b7772]">원화 환산{d.usdKrw ? ` (${d.usdKrw.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}원)` : ''}</Td>
                    <Td n className="text-[#6b7772]">{d.usdKrw ? won(d.totalConverted) : '환율 없음'}</Td>
                    <Td />
                  </tr>
                ) : null}
              </tbody>
            </T>
          ) : (
            <Lack need="월별 자금흐름표(계좌 · 잔액 칸)" upload={upload} />
          )}
          <Note>
            {d.vsYesterday !== null ? `전일 대비 ${won(d.vsYesterday, true)}원${d.biggestOutToday && d.vsYesterday < 0 ? ` (${d.biggestOutToday})` : ''}` : d.balanceFrom === 'books' ? '장부 월말 현금입니다(자금흐름표에 잔액 칸이 있으면 계좌별 · 오늘 기준).' : '전일 비교는 잔액 칸이 있는 자금흐름표가 이틀 이상 있으면 보입니다.'}
            {d.vsYesterdayUsd !== null ? ` · 달러 ${d.vsYesterdayUsd === 0 ? '변동 없음' : usd(d.vsYesterdayUsd, true)}` : ''}
          </Note>
        </Card>

        <Card title={`② ${mon}월 매출과 수금 (1~${day}일)`}>
          <T>
            <thead>
              <tr>
                <Th>구분</Th>
                <Th n>원</Th>
                <Th n>%</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td>이달 매출 ({d.sales.revenueFrom === 'tax_invoice' ? '세금계산서 기준' : d.sales.revenueFrom === 'sales' ? '판매현황 기준' : '자료 없음'})</Td>
                <Td n>{won(d.sales.revenue)}</Td>
                <Td n>{d.sales.target && d.sales.revenue !== null ? `목표 대비 ${Math.round((d.sales.revenue / d.sales.target) * 100)}%` : '목표 없음'}</Td>
              </tr>
              <tr>
                <Td>이달 수금</Td>
                <Td n>{won(d.sales.collected)}</Td>
                <Td n>{d.sales.collected !== null && d.sales.revenue ? `매출 대비 ${Math.round((d.sales.collected / d.sales.revenue) * 100)}%` : '—'}</Td>
              </tr>
              <tr>
                <Td className="pl-6 text-[#6b7772]">그중 전월 매출 수금</Td>
                <Td n className="text-[#6b7772]">{won(d.sales.collectedPrevMonth)}</Td>
                <Td n />
              </tr>
              <tr>
                <Td>미수금 잔액</Td>
                <Td n>{won(d.sales.receivable)}</Td>
                <Td n>{d.sales.dso !== null ? `평균 회수 ${d.sales.dso}일` : '—'}</Td>
              </tr>
              <tr>
                <Td className="text-[#b4432b]">기준일 넘은 미수</Td>
                <Td n className="text-[#b4432b]">{d.sales.overdue ? won(d.sales.overdue.amount) : '—'}</Td>
                <Td n className="text-[#b4432b]">{d.sales.overdue ? `${d.sales.overdue.customers}곳` : '자료 부족'}</Td>
              </tr>
            </tbody>
          </T>
          <Note>
            {d.sales.expectThisWeek !== null || d.sales.expectNextWeek !== null
              ? `수금 예정: 이번 주 ${won(d.sales.expectThisWeek)} · 다음 주 ${won(d.sales.expectNextWeek)}`
              : '수금 예정은 자금흐름표의 «예정» 줄이 있으면 보입니다.'}
            {d.sales.overdueNeed ? ` · 연체는 ${d.sales.overdueNeed}가 있으면 계산합니다.` : ''}
          </Note>
        </Card>

        <Card title="③ 대출 현황">
          {d.loans.rows.length ? (
            <T>
              <thead>
                <tr>
                  <Th>기관</Th>
                  <Th n>총액</Th>
                  <Th n>잔액</Th>
                  <Th n>월 이자</Th>
                </tr>
              </thead>
              <tbody>
                {d.loans.rows.map((r, i) => (
                  <tr key={i}>
                    <Td>
                      {r.lender} {r.type !== '대출' ? <span className="text-[#6b7772]">{r.type.replace(/자금$/, '')}</span> : null}
                    </Td>
                    <Td n>{won(r.total)}</Td>
                    <Td n>{won(r.balance)}</Td>
                    <Td n>{won(r.monthlyInterest)}</Td>
                  </tr>
                ))}
                <tr>
                  <Td bold>합계</Td>
                  <Td n bold>{won(d.loans.rows.reduce((s, r) => s + (r.total ?? 0), 0))}</Td>
                  <Td n bold>{won(d.loans.total)}</Td>
                  <Td n bold>{won(d.loans.monthlyInterest)}</Td>
                </tr>
              </tbody>
            </T>
          ) : (
            <Lack need="대출현황 · 차입금" upload={upload} />
          )}
          {d.loans.nextMaturity ? <Note tone="warn">다음 만기: {d.loans.nextMaturity.lender} {d.loans.nextMaturity.type} {d.loans.nextMaturity.maturity!.slice(0, 7)}</Note> : null}
        </Card>
      </div>

      <Card title="④ 최근 10일 잔액 추이 · 오늘 들어오고 나간 돈">
        <div className="-mt-1 text-[12px] text-[#6b7772]">원화 + 달러 환산</div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {d.trend.length ? (
            <div className="flex h-[140px] items-end gap-1.5 border-b border-[#e1e6e3] px-1" aria-label="최근 잔액 막대">
              {d.trend.map((t, i) => {
                const today = i === d.trend.length - 1
                return (
                  <div key={t.date} className="flex flex-1 flex-col items-center gap-1" title={`${t.date} ${eok(t.krw)}`}>
                    <div className={`w-full rounded-t-[3px] ${today ? 'bg-[#0f6b5c]' : 'bg-[#b9d8d0]'}`} style={{ height: `${h(t.krw)}px` }} />
                    <div className={`text-[11px] ${today ? 'font-semibold text-[#1a211e]' : 'text-[#6b7772]'}`}>{today ? '오늘' : `${Number(t.date.slice(5, 7))}/${Number(t.date.slice(8, 10))}`}</div>
                  </div>
                )
              })}
            </div>
          ) : (
            <Lack need="잔액 칸이 있는 월별 자금흐름표" upload={upload} />
          )}
          <T>
            <thead>
              <tr>
                <Th>오늘</Th>
                <Th>내용</Th>
                <Th n>금액</Th>
              </tr>
            </thead>
            <tbody>
              {d.today.length ? (
                d.today.map((t, i) => (
                  <tr key={i}>
                    <Td className={t.kind === 'in' ? 'text-[#0f6b5c]' : 'text-[#b4432b]'}>{t.kind === 'in' ? '입금' : '출금'}</Td>
                    <Td>{t.label}</Td>
                    <Td n className={t.kind === 'in' ? 'text-[#0f6b5c]' : 'text-[#b4432b]'}>
                      {t.usd !== null ? usd(t.kind === 'in' ? t.usd : -t.usd, true) : won(t.kind === 'in' ? t.krw : -(t.krw ?? 0), true)}
                    </Td>
                  </tr>
                ))
              ) : (
                <tr>
                  <Td className="text-[#6b7772]">—</Td>
                  <Td className="text-[#6b7772]">오늘 입출금 줄이 아직 없습니다</Td>
                  <Td />
                </tr>
              )}
              {d.today.length ? (
                <tr>
                  <Td bold>순변동</Td>
                  <Td />
                  <Td n bold>
                    {won(d.todayNet.krw, true)}
                    {d.todayNet.usd ? ` · ${usd(d.todayNet.usd, true).replace('$ ', '$')}` : ''}
                  </Td>
                </tr>
              ) : null}
            </tbody>
          </T>
        </div>
      </Card>
      {d.missing.length ? <Note>자료 부족: {d.missing.join(' · ')}</Note> : null}
      {d.sales.revenue !== null && d.sales.target ? <Note>목표는 기준값 «올해 매출 목표» ÷ 12입니다.</Note> : null}
    </div>
  )
}
