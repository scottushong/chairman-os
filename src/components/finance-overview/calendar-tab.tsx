'use client'

import { useState } from 'react'

import type { CashCalendar } from '@/lib/finance-overview/cash-days'
import { eok, monthKo } from '@/lib/finance-overview/format'

/**
 * «현금흐름 달력» — 시안 finance-calendar-mock.html: 위 네 칸(월초 · 들어올 돈 · 나갈 돈 · 월말 예상 · 이달 최저) → 달력(날짜 칸에 들어온 돈 · 나간 돈 · 그날 잔액,
 * 큰 지출 날 주황 · 큰 수금 날 초록) → 이달 항목별 · 앞으로 3개월. 지난 날 = 실제(진하게) · 앞날 = 예정(흐리게 «예정»). 날짜를 누르면 그날 거래 목록.
 */
export function CalendarTab({ cal }: { cal: CashCalendar }) {
  const [open, setOpen] = useState<string | null>(null)
  const sel = cal.days.find((d) => d.date === open) ?? null
  const cells: (CashCalendar['days'][number] | null)[] = [...Array.from({ length: cal.lead }, () => null), ...cal.days]
  while (cells.length % 7) cells.push(null)
  const safe = cal.safety.value
  const lowWarn = cal.low && safe !== null && cal.low.balance < safe * 1.2
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Box label={`월초 잔액 (${Number(cal.period.slice(5, 7))}/1)`} value={eok(cal.opening)} />
        <Box label="이달 들어올 돈" value={eok(cal.inflow, 1, true)} tone="up" />
        <Box label="이달 나갈 돈" value={eok(-cal.outflow, 1, true)} tone="down" />
        <div className={`rounded-[10px] border px-4 py-3 ${lowWarn ? 'border-[#e8d2bf] bg-[#fdf4ec]' : 'border-[#e1e6e3] bg-white'}`}>
          <div className={`text-[12px] ${lowWarn ? 'text-[#9a4b12]' : 'text-[#6b7772]'}`}>월말 예상 잔액 · 이달 최저</div>
          <div className="text-[20px] font-bold tnum">
            {eok(cal.closing)}{' '}
            {cal.low ? <span className={`text-[13px] font-medium ${lowWarn ? 'text-[#9a4b12]' : 'text-[#6b7772]'}`}>최저 {eok(cal.low.balance)} ({Number(cal.low.date.slice(5, 7))}/{Number(cal.low.date.slice(8, 10))})</span> : null}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-[10px] border border-[#e1e6e3] bg-white px-4 py-3.5">
        <div className="grid grid-cols-7 gap-1.5 text-center text-[12px] text-[#6b7772]">
          <div className="text-[#b4432b]">일</div>
          <div>월</div>
          <div>화</div>
          <div>수</div>
          <div>목</div>
          <div>금</div>
          <div className="text-[#0f6b5c]">토</div>
        </div>
        <div className="grid grid-cols-7 gap-1.5" data-testid="cash-calendar">
          {cells.map((d, i) =>
            d === null ? (
              <div key={`x${i}`} className="min-h-[64px] rounded-md bg-[#f4f5f3] sm:min-h-[104px]" />
            ) : (
              <button
                type="button"
                key={d.date}
                onClick={() => setOpen(open === d.date ? null : d.date)}
                aria-pressed={open === d.date}
                className={`flex min-h-[64px] min-w-0 flex-col gap-0.5 overflow-hidden rounded-md border px-1.5 py-1.5 text-left sm:min-h-[104px] sm:px-2 ${d.big === 'out' ? 'bg-[#fdf4ec]' : d.big === 'in' ? 'bg-[#e1efeb]' : 'bg-white'} ${open === d.date ? 'border-[#0f6b5c]' : 'border-[#e1e6e3]'}`}
              >
                <div className="text-[12px] font-semibold text-[#6b7772]">{Number(d.date.slice(8, 10))}</div>
                {d.items.slice(0, 3).map((x, j) => (
                  <div key={j} className={`hidden truncate text-[12px] sm:block ${x.kind === 'in' ? 'text-[#0f6b5c]' : 'text-[#b4432b]'} ${x.planned ? 'opacity-70' : 'font-medium'}`}>
                    {x.kind === 'in' ? '+' : '−'}
                    {(x.krw / 1e8).toFixed(x.krw >= 1e8 ? 1 : 2)}억 {x.label}
                    {x.planned ? ' (예정)' : ''}
                  </div>
                ))}
                {d.items.length > 3 ? <div className="hidden text-[11px] text-[#6b7772] sm:block">+{d.items.length - 3}건</div> : null}
                {d.items.length ? <div className="mt-auto hidden text-[12px] font-semibold text-[#1a211e] sm:block">잔액 {d.balance === null ? '—' : eok(d.balance)}</div> : null}
                {d.items.length ? <div className="mt-auto h-1.5 w-1.5 rounded-full bg-[#0f6b5c] sm:hidden" /> : null}
              </button>
            ),
          )}
        </div>
        <div className="flex flex-wrap gap-4 text-[12px] text-[#6b7772]">
          <span><span className="text-[#0f6b5c]">■</span> 들어오는 돈</span>
          <span><span className="text-[#b4432b]">■</span> 나가는 돈</span>
          <span><span className="inline-block size-2.5 border border-[#e8d2bf] bg-[#fdf4ec] align-middle" /> 큰 지출 날</span>
          <span><span className="inline-block size-2.5 bg-[#e1efeb] align-middle" /> 큰 수금 날</span>
          <span>실제 = 진하게 · 예정 = 수금예정 · 지급예정 · 대출 일정에서 자동</span>
          <span>날짜를 누르면 그날 거래 목록</span>
        </div>
        {sel ? (
          <div className="rounded-md border border-[#e1e6e3] px-3 py-2" data-testid="day-list">
            <div className="text-[14px] font-semibold">
              {Number(sel.date.slice(5, 7))}월 {Number(sel.date.slice(8, 10))}일 {sel.past ? '(실제)' : '(예정)'}
            </div>
            {sel.items.length ? (
              <ul className="mt-1 space-y-0.5 text-[13px]">
                {sel.items.map((x, j) => (
                  <li key={j} className={x.kind === 'in' ? 'text-[#0f6b5c]' : 'text-[#b4432b]'}>
                    {x.kind === 'in' ? '+' : '−'}
                    {Math.round(x.krw).toLocaleString('ko-KR')}원 · {x.label}
                    {x.planned ? ' · 예정' : ''}
                    {x.source === 'loan' ? ' · 대출 일정' : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-[13px] text-[#6b7772]">이 날 거래가 없습니다.</div>
            )}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="flex flex-col gap-2 rounded-[10px] border border-[#e1e6e3] bg-white px-[18px] py-4">
          <h2 className="text-[15px] font-bold">이달 현금흐름 — 항목별</h2>
          <table className="w-full border-collapse tnum">
            <thead>
              <tr>
                <th className="border-b border-[#e1e6e3] px-2 py-1.5 text-left text-[12px] font-medium text-[#6b7772]">구분</th>
                <th className="border-b border-[#e1e6e3] px-2 py-1.5 text-right text-[12px] font-medium text-[#6b7772]">들어옴</th>
                <th className="border-b border-[#e1e6e3] px-2 py-1.5 text-right text-[12px] font-medium text-[#6b7772]">나감</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['operating', '영업 — 매출 수금 / 원료 · 급여 · 경비'],
                  ['investing', '투자 — 설비 · 보증금'],
                  ['financing', '재무 — 대출 원금 · 이자'],
                ] as const
              ).map(([k, label]) => (
                <tr key={k}>
                  <td className="border-b border-[#eef1ef] px-2 py-2 text-[14px]">{label}</td>
                  <td className="border-b border-[#eef1ef] px-2 py-2 text-right text-[14px] text-[#0f6b5c]">{cal.byClass[k].in ? eok(cal.byClass[k].in) : '—'}</td>
                  <td className="border-b border-[#eef1ef] px-2 py-2 text-right text-[14px] text-[#b4432b]">{cal.byClass[k].out ? eok(-cal.byClass[k].out) : '—'}</td>
                </tr>
              ))}
              <tr>
                <td className="px-2 py-2 text-[14px] font-semibold">합계</td>
                <td className="px-2 py-2 text-right text-[14px] font-semibold">{eok(cal.inflow)}</td>
                <td className="px-2 py-2 text-right text-[14px] font-semibold">{eok(-cal.outflow)}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section className="flex flex-col gap-2 rounded-[10px] border border-[#e1e6e3] bg-white px-[18px] py-4">
          <h2 className="text-[15px] font-bold">앞으로 3개월 — 월별 전망</h2>
          <table className="w-full border-collapse tnum">
            <thead>
              <tr>
                {['달', '들어옴', '나감', '월말 잔액', '최저'].map((h, i) => (
                  <th key={h} className={`border-b border-[#e1e6e3] px-2 py-1.5 text-[12px] font-medium text-[#6b7772] ${i ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cal.forecast.map((f) => {
                const tight = safe !== null && f.low !== null && f.low < safe * 1.2
                return (
                  <tr key={f.period} className={tight ? 'bg-[#fdf4ec]' : ''}>
                    <td className="border-b border-[#eef1ef] px-2 py-2 text-[14px]">
                      {monthKo(f.period)}
                      {f.estimated ? <span className="text-[12px] text-[#6b7772]"> (추정)</span> : null}
                    </td>
                    <td className="border-b border-[#eef1ef] px-2 py-2 text-right text-[14px]">{eok(f.inflow)}</td>
                    <td className="border-b border-[#eef1ef] px-2 py-2 text-right text-[14px]">{eok(-f.outflow)}</td>
                    <td className="border-b border-[#eef1ef] px-2 py-2 text-right text-[14px]">{eok(f.closing)}</td>
                    <td className={`border-b border-[#eef1ef] px-2 py-2 text-right text-[14px] ${tight ? 'font-semibold text-[#b4432b]' : ''}`}>{eok(f.low)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="text-[12px] text-[#9a4b12]">
            안전선 {safe === null ? '없음(기준값에서 정함)' : eok(safe)}
            {cal.safety.from === 'average' ? ' — 기준값이 없어 최근 3개월 한 달 평균 지출' : ''}
            {safe !== null && cal.forecast.some((f) => f.low !== null && f.low < safe) ? ' · 안전선 아래로 내려가는 달이 있습니다 — 수금을 당기거나 지출을 미루세요.' : ''}
          </div>
        </section>
      </div>
      {cal.missing.length ? <div className="text-[12px] text-[#6b7772]">자료 부족: {cal.missing.join(' · ')}</div> : null}
    </div>
  )
}

function Box({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="rounded-[10px] border border-[#e1e6e3] bg-white px-4 py-3">
      <div className="text-[12px] text-[#6b7772]">{label}</div>
      <div className={`text-[20px] font-bold tnum ${tone === 'up' ? 'text-[#0f6b5c]' : tone === 'down' ? 'text-[#b4432b]' : ''}`}>{value}</div>
    </div>
  )
}
