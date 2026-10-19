import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * 재무 현황(0085) 공통 조각 — 시안(docs/specs/2026-10-19-finance-overview-mock/*.html)의 색 · 간격 · 글자 크기를 그대로 옮긴 것.
 * 앱의 테마 토큰이 아니라 시안 값을 쓴다(«시안과 다르게 보이면 시안이 우선» — 대표 확인 2026-10-19). 밝은 바탕 고정.
 *   바탕 #f4f5f3 · 카드 흰색 · 테두리 #e1e6e3 · 글 #1a211e · 흐린 글 #6b7772 · 초록 #0f6b5c · 주황 #9a4b12(#fdf4ec · #f8eadf) · 빨강 #b4432b
 */

export function Card({ title, more, children, className = '', id }: { title?: ReactNode; more?: { href: string; label?: string } | null; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`flex min-w-0 flex-col gap-2.5 rounded-[10px] border border-[#e1e6e3] bg-white px-[18px] py-4 ${className}`}>
      {title || more ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          {title ? <h2 className="text-[15px] font-bold text-[#1a211e]">{title}</h2> : <span />}
          {more ? (
            <Link href={more.href} className="text-[13px] text-[#0f6b5c] hover:underline">
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
    <div className="flex min-w-0 flex-col gap-1 rounded-[10px] border border-[#e1e6e3] bg-white px-4 py-3.5">
      <div className="text-[12px] text-[#6b7772]">{label}</div>
      <div className="text-[22px] font-bold leading-tight text-[#1a211e] tnum">
        {value} {aside ? <span className="text-[13px] font-medium text-[#6b7772]">{aside}</span> : null}
      </div>
      {sub ? <div className={`text-[12px] ${tone === 'up' ? 'text-[#0f6b5c]' : tone === 'down' ? 'text-[#b4432b]' : 'text-[#6b7772]'}`}>{sub}</div> : null}
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
  return <th className={`border-b border-[#e1e6e3] px-2 py-1.5 text-[12px] font-medium whitespace-nowrap text-[#6b7772] ${n ? 'text-right' : 'text-left'} ${className}`}>{children}</th>
}
export function Td({ children, n, bold, className = '', title }: { children?: ReactNode; n?: boolean; bold?: boolean; className?: string; title?: string }) {
  return (
    <td title={title} className={`border-b border-[#eef1ef] px-2 py-2 text-[14px] ${n ? 'text-right whitespace-nowrap' : ''} ${bold ? 'font-semibold' : ''} ${className}`}>
      {children}
    </td>
  )
}

export function Note({ tone = 'muted', children }: { tone?: 'muted' | 'warn' | 'bad'; children: ReactNode }) {
  if (tone === 'warn') return <div className="rounded-md bg-[#fdf4ec] px-2.5 py-1.5 text-[12px] text-[#9a4b12]">{children}</div>
  return <div className={`text-[12px] ${tone === 'bad' ? 'text-[#b4432b]' : 'text-[#6b7772]'}`}>{children}</div>
}

/** 자료 부족 — 빈칸 대신 무엇이 필요한지. */
export function Lack({ need, upload }: { need: string; upload?: string | null }) {
  return (
    <div className="rounded-md border border-dashed border-[#c9d1cd] bg-white px-3 py-2.5 text-[13px] text-[#6b7772]">
      자료 부족: {need}
      {upload ? (
        <>
          {' '}
          <Link href={upload} className="text-[#0f6b5c] hover:underline">
            올리기
          </Link>
        </>
      ) : null}
    </div>
  )
}

export function Badge({ final }: { final: boolean }) {
  return final ? (
    <span className="rounded-full bg-[#e1efeb] px-2.5 py-[3px] text-[13px] font-semibold text-[#0f6b5c]">확정</span>
  ) : (
    <span className="rounded-full bg-[#f8eadf] px-2.5 py-[3px] text-[13px] font-semibold text-[#9a4b12]">잠정</span>
  )
}

export const signTone = (v: number | null | undefined) => (v === null || v === undefined ? '' : v < 0 ? 'text-[#b4432b]' : v > 0 ? 'text-[#0f6b5c]' : '')
