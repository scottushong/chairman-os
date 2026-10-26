import type { ReactNode } from 'react'

import type { EaDocStatus, EaFollowupStatus, EaStepKind, EaStepStatus } from '@/lib/approvals/types'

/**
 * 0087 전자결재 공통 조각 — 시안(docs/specs/2026-10-19-approvals-mock.png)의 색 · 간격을 그대로 옮긴 것(재무 현황 0085와 같은 방식: 시안 값 · 밝은 바탕 고정). 0098부터 색은 디자인 토큰(globals.css)으로 그린다 — 아래는 예전 시안 값과 옮긴 토큰.
 *   바탕 #f4f6f9→bg-app · 카드 흰색→bg-card · 테두리 #e3e6eb→border-line · 글 #1f2329→text-ink · 흐린 글 #6b7280→text-ink-muted · 파랑 #2f5bd3→accent/link(버튼 #3361e0→bg-accent · 옅은 #eaf0fd→bg-accent-soft) · 주황 #b5532a→warning · 초록 #1f7a4d→ok · 빨강 #b4372b→critical
 */
export const C = {
  bg: 'bg-app',
  card: 'rounded-[10px] border border-line bg-card',
  ink: 'text-ink',
  muted: 'text-ink-muted',
  blue: 'text-accent',
  // 폰은 누르는 칸 44px(min-h-11) · 넓은 화면은 시안의 40px.
  btn: 'inline-flex min-h-11 lg:min-h-10 items-center justify-center rounded-md bg-accent px-4 text-[14px] font-semibold text-on-accent hover:bg-accent/90 disabled:opacity-50',
  btnLine: 'inline-flex min-h-11 lg:min-h-10 items-center justify-center rounded-md border border-line bg-card px-4 text-[14px] text-ink hover:bg-raised disabled:opacity-50',
  input: 'w-full rounded-md border border-line bg-card px-3 py-2 text-[14px] text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none',
} as const

export function Pill({ tone, children }: { tone: 'blue' | 'orange' | 'green' | 'red' | 'gray'; children: ReactNode }) {
  const t = {
    blue: 'bg-accent-soft text-accent',
    orange: 'bg-warning/10 text-warning',
    green: 'bg-ok/10 text-ok',
    red: 'bg-critical/10 text-critical',
    gray: 'bg-raised text-ink-dim',
  }[tone]
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[12px] font-medium whitespace-nowrap ${t}`}>{children}</span>
}

export const STATUS_TONE: Record<EaDocStatus, 'blue' | 'orange' | 'green' | 'red' | 'gray'> = {
  draft: 'gray',
  in_progress: 'blue',
  rejected: 'red',
  approved: 'green',
  withdrawn: 'gray',
}

export const FOLLOWUP_TONE: Record<EaFollowupStatus, 'blue' | 'orange' | 'green'> = { waiting: 'orange', doing: 'blue', done: 'green' }

/** 결재선 칸의 말 — 시안: «기안 완료» · «현재 검토» · «승인 예정». 마지막 승인 단계는 «승인», 앞의 승인 단계는 «검토». */
export function stepWord(kind: EaStepKind, last: boolean) {
  return kind === 'agree' ? '합의' : last ? '승인' : '검토'
}
export function stepLabel(kind: EaStepKind, status: EaStepStatus, last: boolean) {
  const w = stepWord(kind, last)
  return { planned: `${w} 예정`, waiting: `현재 ${w}`, approved: `${w} 완료`, rejected: '반려', skipped: '미처리' }[status]
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-t border-line-soft px-4 py-4 sm:px-[18px]">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="text-[12px] text-ink-muted">{label}</div>
      <div className="text-[14px] font-semibold break-words text-ink">{children}</div>
    </div>
  )
}
