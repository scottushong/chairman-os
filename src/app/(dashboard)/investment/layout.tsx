import type { ReactNode } from 'react'

import { InvestmentTabs } from '@/components/investment/tabs'
import { investmentViewer } from '@/lib/investment/screen'

/**
 * CAPITAL › Investment Intelligence(0094~) — 대표 · «/investment» 지정자만(나머지는 /me), 스위치 investment가 꺼지면 404.
 * 실거래 · 증권사 연동 · 자동 주문은 없다(원문 12.4 · 머리말).
 */
export default async function InvestmentLayout({ children }: { children: ReactNode }) {
  await investmentViewer()
  return (
    <div className="mx-auto flex w-full max-w-[1400px] min-w-0 flex-col gap-4 px-4 py-5 sm:px-6">
      <InvestmentTabs />
      {children}
      <p className="pb-4 text-[13px] text-ink-muted">실거래 · 증권사 연동 · 자동 주문 없음 — 모든 실제 매매는 사람이 결정하고 손으로 입력합니다.</p>
    </div>
  )
}
