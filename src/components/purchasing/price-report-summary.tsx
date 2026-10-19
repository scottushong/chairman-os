import Link from 'next/link'

import { featureOn } from '@/lib/features-server'
import { canReadPriceReport, kstLabel, SLOT_KO } from '@/lib/price-report/rules'
import type { ChairmanRepository } from '@/lib/repository'
import type { PriceReportMeta, SessionUser } from '@/types'

/**
 * 0084 가격 리포트 요약 — 구매 개요 카드(Brent · 두바이 · 나프타 · 크랙 · 상태 · 마지막 업데이트 · 전체 보기)와 시장가 화면 참고 한 줄.
 * 숫자는 엔진이 저장한 figures.cards 그대로다. **원가 엔진 원료 시세 표(cost_market_prices)에는 넣지 않는다**(원가 · BOM 경로와 분리).
 * 스위치 꺼짐 · 권한 없음 · 0084 전 DB · 리포트 없음이면 아무것도 그리지 않는다.
 */

async function latest(repo: ChairmanRepository, user: SessionUser, businessId: string): Promise<PriceReportMeta | null> {
  if (!canReadPriceReport(user, businessId) || !(await featureOn(user, 'purchase_price_report', businessId))) return null
  return (await repo.listPriceReports(businessId, 1).catch(() => []))[0] ?? null
}

const usd = (v: number | undefined | null, d = 2) => (typeof v === 'number' ? `$${v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}` : '—')

export async function PriceReportSummaryCard({ repo, user, businessId }: { repo: ChairmanRepository; user: SessionUser; businessId: string }) {
  const r = await latest(repo, user, businessId)
  if (!r) return null
  const c = r.cards
  const cell = (label: string, value: string, note?: string) => (
    <div className="min-w-[8rem] flex-1 rounded-lg bg-raised px-3 py-2">
      <div className="text-t10h text-ink-muted">{label}</div>
      <div className="text-t13 font-semibold tnum">{value}</div>
      {note ? <div className="text-t10 text-ink-muted">{note}</div> : null}
    </div>
  )
  return (
    <section className="mt-4 rounded-xl border border-line-soft bg-panel p-3" aria-label="가격 리포트 요약" data-testid="price-report-card">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-t13 font-semibold">가격 리포트</h2>
        <span className="text-t11h text-ink-muted">
          {kstLabel(r.created_at)} · {SLOT_KO[r.slot] ?? r.slot} ·{' '}
          <span className={r.status === 'ok' ? 'text-ok' : 'text-gold'}>{r.status === 'ok' ? '정상' : '미확인'}</span>
        </span>
        <Link href={`/purchasing/${encodeURIComponent(businessId)}/price-report`} className="ml-auto text-t12 font-semibold text-accent hover:underline">
          전체 보기
        </Link>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {cell('Brent', usd(c?.brent?.value), c?.brent ? `${c.brent.date.slice(5)} ${c.brent.kind === 'intraday' ? '장중' : '정산'}` : undefined)}
        {cell('두바이', usd(c?.dubai?.value), c?.dubai ? `${c.dubai.date.slice(5)} 정산` : undefined)}
        {cell('나프타 CFD($/톤)', usd(c?.naphtha_cfd?.value, 0), c?.naphtha_cfd?.date.slice(5))}
        {cell('오피넷 나프타($/bbl)', usd(c?.opinet_naphtha_bbl?.value), c?.opinet_naphtha_bbl?.date.slice(5))}
        {cell('나프타−Brent 크랙', typeof c?.crack?.value === 'number' ? `${c.crack.value >= 0 ? '+' : ''}${c.crack.value.toFixed(1)}/bbl` : '—', c?.crack?.date.slice(5))}
      </div>
      {r.headline ? <p className="mt-2 line-clamp-2 text-t11h text-ink-dim">{r.headline}</p> : null}
    </section>
  )
}

/** 시장가 화면 «참고: 오늘 나프타 · 원유» 한 줄. */
export async function PriceReportLine({ repo, user, businessId }: { repo: ChairmanRepository; user: SessionUser; businessId: string }) {
  const r = await latest(repo, user, businessId)
  if (!r?.cards) return null
  const c = r.cards
  return (
    <p className="mt-3 rounded-md border border-line-soft bg-panel px-3 py-2 text-t11h text-ink-dim" data-testid="price-report-line">
      <span className="font-semibold text-ink">참고: 오늘 나프타 · 원유</span> — Brent {usd(c.brent?.value)} · 두바이 {usd(c.dubai?.value)} · 나프타 CFD {usd(c.naphtha_cfd?.value, 0)}/톤 · 오피넷 나프타{' '}
      {usd(c.opinet_naphtha_bbl?.value)}/bbl ({kstLabel(r.created_at)} 가격 리포트 —{' '}
      <Link href={`/purchasing/${encodeURIComponent(businessId)}/price-report`} className="text-accent hover:underline">
        보기
      </Link>
      ). 원료 시세 표에는 넣지 않습니다.
    </p>
  )
}
