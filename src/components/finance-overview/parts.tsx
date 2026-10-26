import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * 재무 현황(0085) 공통 조각 — 시안(docs/specs/2026-10-19-finance-overview-mock/*.html)의 색 · 간격 · 글자 크기를 그대로 옮긴 것.
 * 0098부터 색은 앱 디자인 토큰(globals.css)을 쓴다 — 시안 색을 의미로 옮김:
 *   바탕 bg-app · 카드 bg-card · 테두리 border-line · 글 text-ink · 흐린 글 text-ink-muted · 초록 accent(증감은 positive) · 주황 warning · 빨강 critical(증감은 negative)
 */

export function Card({ title, more, children, className = '', id }: { title?: ReactNode; more?: { href: string; label?: string } | null; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`flex min-w-0 flex-col gap-2.5 rounded-[10px] border border-line bg-card px-[18px] py-4 ${className}`}>
      {title || more ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          {title ? <h2 className="text-[15px] font-bold text-ink">{title}</h2> : <span />}
          {more ? (
            <Link href={more.href} className="inline-flex items-center text-[13px] text-accent hover:underline">
              {more.label ?? '자세히 ›'}
            </Link>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export function Stat({ label, value, aside, sub, tone = 'muted' }: { label: string; value: string; aside?: string | null; sub?: string | null; tone?: 'up' | 'down' | 'muted' }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[10px] border border-line bg-card px-4 py-3.5">
      <div className="text-[14px] lg:text-[12px] text-ink-muted">{label}</div>
      <div className="text-[22px] font-bold leading-tight text-ink tnum">
        {value} {aside ? <span className="text-[13px] font-medium text-ink-muted">{aside}</span> : null}
      </div>
      {sub ? <div className={`text-[14px] lg:text-[12px] ${tone === 'up' ? 'text-positive' : tone === 'down' ? 'text-negative' : 'text-ink-muted'}`}>{sub}</div> : null}
    </div>
  )
}

/** 시안의 표(머리 12px 흐림 · 칸 14px · 숫자 오른쪽 · 줄 사이 옅은 선). */
export function T({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className={`w-full min-w-[320px] border-collapse tnum ${className}`}>{children}</table>
    </div>
  )
}
export function Th({ children, n, className = '' }: { children?: ReactNode; n?: boolean; className?: string }) {
  return <th className={`border-b border-line px-2 py-1.5 text-[14px] lg:text-[12px] font-medium whitespace-nowrap text-ink-muted ${n ? 'text-right' : 'text-left'} ${className}`}>{children}</th>
}
export function Td({ children, n, bold, className = '', title }: { children?: ReactNode; n?: boolean; bold?: boolean; className?: string; title?: string }) {
  return (
    <td title={title} className={`border-b border-line-soft px-2 py-2 text-[14px] whitespace-nowrap ${n ? 'text-right' : ''} ${bold ? 'font-semibold' : ''} ${className}`}>
      {children}
    </td>
  )
}

export function Note({ tone = 'muted', children }: { tone?: 'muted' | 'warn' | 'bad'; children: ReactNode }) {
  if (tone === 'warn') return <div className="rounded-md bg-warning/10 px-2.5 py-1.5 text-[14px] lg:text-[12px] text-warning">{children}</div>
  return <div className={`text-[14px] lg:text-[12px] ${tone === 'bad' ? 'text-critical' : 'text-ink-muted'}`}>{children}</div>
}

/** 자료 부족 — 빈칸 대신 무엇이 필요한지. */
export function Lack({ need, upload }: { need: string; upload?: string | null }) {
  return (
    <div className="rounded-md border border-dashed border-line bg-card px-3 py-2.5 text-[13px] text-ink-muted">
      자료 부족: {need}
      {upload ? (
        <>
          {' '}
          <Link href={upload} className="inline-flex items-center text-accent hover:underline">
            올리기
          </Link>
        </>
      ) : null}
    </div>
  )
}

export function Badge({ final }: { final: boolean }) {
  return final ? (
    <span className="rounded-full bg-ok/10 px-2.5 py-[3px] text-[13px] font-semibold text-ok">확정</span>
  ) : (
    <span className="rounded-full bg-warning/10 px-2.5 py-[3px] text-[13px] font-semibold text-warning">잠정</span>
  )
}

export const signTone = (v: number | null | undefined) => (v === null || v === undefined ? '' : v < 0 ? 'text-negative' : v > 0 ? 'text-positive' : '')
