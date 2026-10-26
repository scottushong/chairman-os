'use client'

import { useState } from 'react'

import { longTermSim } from '@/lib/investment/portfolio'

/**
 * DY 장기투자 시뮬레이터(시안 investment-mock-simulator.png) — 매년 말 적립 · 수익 전액 재투자 · 일정 수익률 단순 복리.
 * 계산은 lib/investment/portfolio.ts longTermSim 하나(검사 대상). 시안의 기본값 = 2억 · 20년 · 6% → 73.6억.
 */
const eok = (v: number) => (v >= 1e8 ? `${(v / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억` : `${Math.round(v / 1e4).toLocaleString('ko-KR')}만`)

export function LongTermSimulator() {
  const [yearly, setYearly] = useState(200_000_000)
  const [years, setYears] = useState(20)
  const [rate, setRate] = useState(6)
  const r = longTermSim(yearly, years, rate)
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-[13px] text-ink-muted">예상 최종 투자자산</div>
        <div className="text-[28px] font-bold tnum">{eok(r.final)} 원</div>
        <span className="rounded-full bg-raised px-2 py-0.5 text-[13px]">매년 말 적립 · 수익 전액 재투자</span>
      </div>
      <Row label="매년 적립 금액" value={yearly} min={50_000_000} max={1_000_000_000} step={10_000_000} onChange={setYearly} show={`${eok(yearly)} 원`} lo="5천만 원" hi="10억 원" />
      <Row label="투자 기간" value={years} min={1} max={40} step={1} onChange={setYears} show={`${years}년`} />
      <Row label="연평균 가정 수익률" value={rate} min={0} max={12} step={0.5} onChange={setRate} show={`${rate}%`} />
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-line-soft px-3 py-2"><div className="text-[13px] text-ink-muted">총 납입원금</div><div className="text-[18px] font-bold tnum">{eok(r.principal)}</div></div>
        <div className="rounded-lg border border-line-soft px-3 py-2"><div className="text-[13px] text-ink-muted">가정 누적 투자수익</div><div className="text-[18px] font-bold tnum">{eok(r.gains)}</div></div>
      </div>
      <p className="text-[13px] text-ink-muted">일정 수익률을 가정한 단순 복리 계산. 실제 수익률은 변동하며 세금 · 수수료 · 환율 · 물가 · 중도인출은 반영하지 않았음.</p>
    </div>
  )
}

function Row({ label, value, min, max, step, onChange, show, lo, hi }: { label: string; value: number; min: number; max: number; step: number; onChange: (n: number) => void; show: string; lo?: string; hi?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center justify-between text-[15px]"><span>{label}</span><strong className="tnum">{show}</strong></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-11 w-full accent-gold lg:h-6" aria-label={label} />
      {lo ? <span className="flex justify-between text-[13px] text-ink-muted"><span>{lo}</span><span>{hi}</span></span> : null}
    </label>
  )
}
