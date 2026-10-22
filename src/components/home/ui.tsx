import type { ReactNode } from 'react'

import { C as EA } from '@/components/e-approval/parts'

/**
 * 0086 «내 홈» 조각 — 전자결재(0087) 시안 색을 그대로 쓰되, 폰 기준(check:mobile)에 맞게 누를 것은 44px · 글자는 13px 이상.
 */
export const C = {
  ...EA,
  btn: EA.btn.replace('min-h-10', 'min-h-11'),
  btnLine: EA.btnLine.replace('min-h-10', 'min-h-11'),
} as const

export function Pill({ tone, children }: { tone: 'blue' | 'orange' | 'green' | 'red' | 'gray'; children: ReactNode }) {
  const t = {
    blue: 'bg-[#eaf0fd] text-[#2f5bd3]',
    orange: 'bg-[#fdeee8] text-[#b5532a]',
    green: 'bg-[#e7f5ee] text-[#1f7a4d]',
    red: 'bg-[#fdecea] text-[#b4372b]',
    gray: 'bg-[#eef0f3] text-[#4b5563]',
  }[tone]
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[13px] font-medium whitespace-nowrap ${t}`}>{children}</span>
}
