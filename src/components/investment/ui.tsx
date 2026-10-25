import Link from 'next/link'
import type { ReactNode } from 'react'

import { GlassCard } from '@/components/ui/glass-card'
import { day } from '@/lib/investment/format'
import type { ChangeStatus, DataStatus } from '@/lib/investment/types'

/**
 * Investment Intelligence 공통 조각 — 앱 테마 토큰(밝은 · 어두운 화면 둘 다)과 GlassCard를 그대로 쓴다(새 디자인 시스템 없음).
 * 폰: 글자 13px 이상 · 누르는 칸 44px 이상(check:mobile). 넓은 표는 카드 안에서만 옆으로 민다.
 */

export function InvCard({ title, sub, more, children, className = '', id, right }: { title?: ReactNode; sub?: ReactNode; more?: { href: string; label: string } | null; children: ReactNode; className?: string; id?: string; right?: ReactNode }) {
  return (
    <GlassCard as="section" padding="p-4 sm:p-5" className={`flex min-w-0 flex-col gap-3 ${className}`} id={id}>
      {title || more || right ? (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {title ? <h2 className="text-[16px] font-bold text-ink">{title}</h2> : null}
            {sub ? <p className="mt-0.5 text-[13px] text-ink-muted">{sub}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            {right}
            {more ? (
              <Link href={more.href} className="inline-flex min-h-11 items-center text-[13px] font-medium text-accent hover:underline lg:min-h-0">
                {more.label}
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
      {children}
    </GlassCard>
  )
}

export function Kpi({ label, value, sub, href, tone }: { label: string; value: ReactNode; sub?: ReactNode; href?: string; tone?: 'ok' | 'warn' | 'bad' | 'muted' }) {
  const body = (
    <>
      <div className="text-[13px] text-ink-muted">{label}</div>
      <div className={`text-[24px] font-bold leading-tight tnum ${tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-critical' : tone === 'warn' ? 'text-warning' : 'text-ink'}`}>{value}</div>
      {sub ? <div className="text-[13px] text-ink-muted">{sub}</div> : null}
    </>
  )
  return href ? (
    <Link href={href} className="glass flex min-h-11 min-w-0 flex-col gap-1 rounded-xl border border-line-soft p-4 transition-colors hover:border-accent/40">
      {body}
    </Link>
  ) : (
    <div className="glass flex min-w-0 flex-col gap-1 rounded-xl border border-line-soft p-4">{body}</div>
  )
}

const STATUS_CLASS: Record<DataStatus, string> = {
  LIVE: 'bg-ok/15 text-ok',
  PARTIAL: 'bg-warning/15 text-warning',
  DEMO: 'bg-accent/20 text-accent',
  UNAVAILABLE: 'bg-critical/12 text-critical',
  DISABLED: 'bg-ink-muted/15 text-ink-muted',
}

export function StatusBadge({ status, title }: { status: DataStatus; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[13px] font-bold tracking-wide whitespace-nowrap ${STATUS_CLASS[status]}`}>
      {status === 'UNAVAILABLE' ? 'UNAVAILABLE' : status}
    </span>
  )
}

const CHANGE_CLASS: Record<ChangeStatus, string> = {
  NEW: 'bg-ok/15 text-ok',
  ADD: 'bg-[#2f6fd0]/15 text-[#3b74d6]',
  TRIM: 'bg-critical/12 text-critical',
  EXIT: 'bg-ink-muted/20 text-ink-dim',
  HOLD: 'bg-raised text-ink-dim',
  UNKNOWN: 'bg-warning/12 text-warning',
}

export function ChangeBadge({ status, pct }: { status: ChangeStatus; pct?: number | null }) {
  const p = pct === null || pct === undefined || status === 'NEW' || status === 'EXIT' || status === 'HOLD' ? '' : ` ${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[13px] font-bold whitespace-nowrap tnum ${CHANGE_CLASS[status]}`}>{status}{p}</span>
}

/** DEMO 띠 — 원문 Demo 값을 그릴 때만. 실측과 섞지 않는다. */
export function DemoBanner({ children }: { children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-[13px] text-ink">
      <span className="rounded-full bg-accent px-2 py-0.5 text-[13px] font-bold text-white">DEMO DATA</span>
      <span>{children ?? '원문의 예시 숫자입니다 — 실제 데이터가 아닙니다.'}</span>
    </div>
  )
}

/** 출처 한 줄 — 출처 링크 · 기준일 · 공개일 · 수집 시각. 기준일과 공개일을 따로 적는다(검증 8). */
export function SourceLine({ url, label, asOf, published, ingested }: { url?: string | null; label?: string; asOf?: string | null; published?: string | null; ingested?: string | null }) {
  return (
    <p className="text-[13px] text-ink-muted">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
          {label ?? '출처'}
        </a>
      ) : (
        (label ?? '출처 없음')
      )}
      {asOf !== undefined ? <> · 기준일 {day(asOf)}</> : null}
      {published !== undefined ? <> · 공개일 {published ? day(published) : '파일에 없음'}</> : null}
      {ingested ? <> · 수집 {day(ingested)}</> : null}
    </p>
  )
}

/** 자료 없음 — 0을 그리지 않고 무엇이 필요한지 적는다. */
export function NoData({ need, href, hrefLabel }: { need: string; href?: string; hrefLabel?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-3 py-3 text-[13px] text-ink-muted">
      <span className="font-bold text-ink-dim">DATA NOT AVAILABLE</span> — {need}
      {href ? (
        <>
          {' '}
          <Link href={href} className="inline-flex min-h-11 items-center text-accent hover:underline lg:min-h-0">
            {hrefLabel ?? '데이터 상태'}
          </Link>
        </>
      ) : null}
    </div>
  )
}

export function T({ children, minWidth = 520 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full border-collapse tnum" style={{ minWidth }}>
        {children}
      </table>
    </div>
  )
}
export function Th({ children, n, className = '' }: { children?: ReactNode; n?: boolean; className?: string }) {
  return <th className={`border-b border-line-soft px-2 py-1.5 text-[13px] font-medium whitespace-nowrap text-ink-muted ${n ? 'text-right' : 'text-left'} ${className}`}>{children}</th>
}
export function Td({ children, n, className = '', title }: { children?: ReactNode; n?: boolean; className?: string; title?: string }) {
  return (
    <td title={title} className={`border-b border-line-soft/60 px-2 py-1.5 text-[14px] whitespace-nowrap text-ink ${n ? 'text-right' : ''} ${className}`}>
      {children}
    </td>
  )
}

/** 표 안 링크 — 폰에서 44px 높이. */
export function RowLink({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={`inline-flex min-h-11 items-center font-medium text-ink hover:text-accent hover:underline lg:min-h-0 ${className}`}>
      {children}
    </Link>
  )
}

export function PageTitle({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold text-ink sm:text-[26px]">{title}</h1>
        {sub ? <p className="mt-0.5 text-[14px] text-ink-muted">{sub}</p> : null}
      </div>
      {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
    </div>
  )
}
