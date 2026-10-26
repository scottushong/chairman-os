'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { Pill } from '@/components/home/ui'
import type { FavoriteOption, HomeWidget, WidgetData, WidgetDef } from '@/lib/home/widgets'

/**
 * 0086 위젯 한 칸의 내용 — 위젯마다 따로 부른다(한 위젯 실패가 홈 전체를 막지 않는다).
 * 상태 넷: 불러오는 중 · 없음 · 권한 없음 · 실패(+ 다시 시도). 연동 안 된 기능은 «연동 준비 중»(예시를 지어내지 않는다).
 * 건수와 목록은 서버가 같은 조건으로 센다. 직원 위젯에는 금액 · 재무 숫자가 오지 않는다.
 * 0097: 내용은 GET /api/home/widget(위젯마다 · 범위 biz/project)로 읽는다 — 넣을 수 없는 위젯이면 서버가 403(«권한 없음» 칸).
 *   대표 첫 화면 위젯은 숫자 칸(stats) · 표(table) · 긴 글(text) · 기준(basis) · 데이터 상태(LIVE/PARTIAL/UNAVAILABLE)를 더 싣는다.
 */

const LINK = 'inline-flex min-h-11 items-center text-[14px] text-link hover:underline'

export function WidgetContent({ widget, def, favorites, scope }: { widget: HomeWidget; def: WidgetDef; favorites: readonly FavoriteOption[]; scope?: { biz: string; project: string | null } }) {
  if (def.kind === 'favorites') return <FavoritesView widget={widget} options={favorites} />
  if (def.listOnly) {
    return (
      <div data-state="pending" className="flex flex-col items-start gap-1 px-4 py-4 text-[14px] text-ink-dim">
        <Pill tone="orange">준비 중</Pill>
        <p className="mt-1">{def.description} — 쓸 자료가 아직 이 시스템에 없습니다.</p>
      </div>
    )
  }
  return <Remote kind={def.kind} filter={widget.settings.filter} moreHref={def.moreHref} biz={scope?.biz ?? 'all'} project={scope?.project ?? null} />
}

async function fetchWidget(kind: string, filter: string | undefined, biz: string, project: string | null): Promise<WidgetData> {
  const q = new URLSearchParams({ kind, biz })
  if (filter) q.set('filter', filter)
  if (project) q.set('project', project)
  const r = await fetch(`/api/home/widget?${q}`, { cache: 'no-store' })
  const body = (await r.json().catch(() => null)) as WidgetData | null
  const text = body && 'text' in body && typeof body.text === 'string' ? body.text : null
  if (r.status === 403) return { state: 'denied', text: text ?? '권한이 없습니다.' }
  if (!r.ok || !body) return { state: 'error', text: text ?? '불러오지 못했습니다.' }
  return body
}

const STATUS_TONE = { LIVE: 'green', PARTIAL: 'orange', UNAVAILABLE: 'gray' } as const

function Remote({ kind, filter, moreHref, biz, project }: { kind: string; filter?: string; moreHref?: string; biz: string; project: string | null }) {
  const [tick, setTick] = useState(0)
  const key = `${kind}|${filter ?? ''}|${biz}|${project ?? ''}|${tick}`
  const [got, setGot] = useState<{ key: string; data: WidgetData } | null>(null)
  useEffect(() => {
    let alive = true
    fetchWidget(kind, filter, biz, project)
      .then((d) => {
        if (alive) setGot({ key, data: d })
      })
      .catch(() => {
        if (alive) setGot({ key, data: { state: 'error', text: '불러오지 못했습니다(연결 문제).' } })
      })
    return () => {
      alive = false
    }
  }, [key, kind, filter, biz, project])
  const data = got?.key === key ? got.data : null

  if (!data) {
    return (
      <div data-state="loading" className="flex flex-col gap-2 px-4 py-4" aria-busy="true">
        <div className="h-4 w-3/4 animate-pulse rounded bg-raised" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-raised" />
        <span className="sr-only">불러오는 중</span>
      </div>
    )
  }
  if (data.state === 'error') {
    return (
      <div data-state="error" className="flex flex-col items-start gap-1 px-4 py-4 text-[14px] text-critical">
        {data.text}
        <button type="button" onClick={() => setTick((t) => t + 1)} className="inline-flex min-h-11 items-center rounded-md border border-line bg-raised px-3 text-[14px] text-ink hover:border-accent">
          다시 시도
        </button>
      </div>
    )
  }
  if (data.state === 'denied') {
    return (
      <div data-state="denied" className="px-4 py-4 text-[14px] text-ink-dim">
        <Pill tone="gray">권한 없음</Pill> <span className="ml-1">{data.text}</span>
      </div>
    )
  }
  if (data.state === 'pending') {
    return (
      <div data-state="pending" className="flex flex-col items-start gap-1 px-4 py-4 text-[14px] text-ink-dim">
        <Pill tone="orange">연동 준비 중</Pill>
        <p className="mt-1">{data.text.replace(/^(연동 )?준비 중 — /, '')}</p>
        {data.links?.map((l) => (
          <Link key={l.href} href={l.href} className={LINK}>
            {l.label} →
          </Link>
        ))}
      </div>
    )
  }
  const fixed = !!(data.stats?.length || data.table || data.text)
  return (
    <div data-state="ok" data-count={data.count} className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-2 px-4 pt-1 pb-1 text-[13px] text-ink-muted">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {data.hideCount ? null : (
            <span>
              <span className="font-semibold text-ink tnum" data-testid="widget-count">
                {data.count}
              </span>
              건
            </span>
          )}
          {data.status ? <Pill tone={STATUS_TONE[data.status]}>{data.status}</Pill> : null}
          {data.basis ? (
            <span data-testid="widget-basis" className="min-w-0 break-words">
              {data.basis}
            </span>
          ) : null}
        </span>
        {moreHref ? (
          <Link href={moreHref} className="inline-flex min-h-11 items-center text-[13px] text-link hover:underline">
            전체 보기
          </Link>
        ) : null}
      </div>
      {data.stats?.length ? (
        <dl data-testid="widget-stats" className="grid grid-cols-2 gap-2 px-4 pb-3 sm:grid-cols-3 xl:grid-cols-[repeat(auto-fit,minmax(120px,1fr))]">
          {data.stats.map((st) => {
            const inner = (
              <>
                <dt className="text-[13px] text-ink-dim">{st.label}</dt>
                <dd className="text-[18px] font-bold break-words text-ink tnum">{st.value}</dd>
                {st.sub ? <dd className={`text-[13px] ${st.tone === 'down' ? 'text-negative' : st.tone === 'up' ? 'text-positive' : 'text-ink-muted'}`}>{st.sub}</dd> : null}
              </>
            )
            return st.href ? (
              <Link key={st.label} href={st.href} className="flex min-h-11 min-w-0 flex-col rounded-lg bg-raised/70 px-3 py-2 hover:ring-1 hover:ring-accent">
                {inner}
              </Link>
            ) : (
              <div key={st.label} className="flex min-w-0 flex-col rounded-lg bg-raised/70 px-3 py-2">
                {inner}
              </div>
            )
          })}
        </dl>
      ) : null}
      {data.text ? <p className="mx-4 mb-3 rounded-lg bg-raised/70 px-3 py-2 text-[14px] text-ink">{data.text}</p> : null}
      {data.table ? <Table table={data.table} /> : null}
      {data.items.length === 0 ? (
        fixed || data.note ? null : <p className="px-4 pb-4 text-[14px] text-ink-dim">표시할 항목이 없습니다.</p>
      ) : (
        <ul>
          {data.items.map((it) => (
            <li key={it.id} className="border-t border-line-soft">
              <Link href={it.href} className="flex min-h-11 flex-col gap-1 px-4 py-2.5 hover:bg-raised/60">
                <span className="flex min-w-0 items-center gap-2">
                  {it.badge ? <Pill tone={it.badge.tone}>{it.badge.text}</Pill> : null}
                  {it.example ? <Pill tone="gray">예시</Pill> : null}
                  <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{it.title}</span>
                </span>
                {it.meta || it.right ? (
                  <span className="flex items-center justify-between gap-2 text-[13px] text-ink-muted">
                    <span className="min-w-0 truncate">{it.meta}</span>
                    {it.right ? <span className="shrink-0 tnum">{it.right}</span> : null}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data.note ? <p className="border-t border-line-soft px-4 py-2 text-[13px] text-ink-muted">{data.note}</p> : null}
      {data.links?.length ? (
        <div className="flex flex-wrap gap-x-3 border-t border-line-soft px-4">
          {data.links.map((l) => (
            <Link key={l.href} href={l.href} className={LINK}>
              {l.label} →
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Table({ table }: { table: NonNullable<Extract<WidgetData, { state: 'ok' }>['table']> }) {
  const num = (i: number) => table.numeric?.includes(i)
  return (
    <div className="overflow-x-auto px-2 pb-2">
      <table data-testid="widget-table" className="w-full min-w-[420px] text-[13px]">
        <thead>
          <tr className="text-left text-ink-muted">
            {table.head.map((h, i) => (
              <th key={h} className={`px-2 py-1.5 font-medium ${num(i) ? 'text-right' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r) => (
            <tr key={r.id} className="border-t border-line-soft">
              {r.cells.map((c, i) => (
                <td key={i} className={`px-2 py-1 text-ink ${num(i) ? 'text-right tnum' : ''}`}>
                  {i === 0 && r.href ? (
                    <Link href={r.href} className="inline-flex min-h-11 items-center gap-1.5 hover:underline">
                      {c}
                    </Link>
                  ) : c === '' && r.badge ? (
                    <Pill tone={r.badge.tone}>{r.badge.text}</Pill>
                  ) : (
                    c
                  )}
                  {i === 0 && r.badge && !r.cells.includes('') ? <span className="ml-1.5"><Pill tone={r.badge.tone}>{r.badge.text}</Pill></span> : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FavoritesView({ widget, options }: { widget: HomeWidget; options: readonly FavoriteOption[] }) {
  const byKey = new Map(options.map((o) => [o.key, o]))
  const items = (widget.settings.items ?? []).map((k) => byKey.get(k)).filter((o): o is FavoriteOption => !!o)
  if (items.length === 0) {
    return <p className="px-4 py-4 text-[14px] text-ink-dim">즐겨찾기가 없습니다. «편집 모드»에서 결재 양식이나 메뉴를 더하세요.</p>
  }
  return (
    <div className="flex flex-wrap gap-2 px-4 py-3">
      {items.map((o) => (
        <Link key={o.key} href={o.href} className="inline-flex min-h-11 items-center rounded-md border border-line bg-raised px-3 text-[14px] text-ink hover:border-accent">
          {o.label}
        </Link>
      ))}
    </div>
  )
}

/** 편집 중 즐겨찾기 고치기 — 더하기 · 빼기 · 앞뒤 순서. */
export function FavoritesEditor({ items, options, onChange }: { items: string[]; options: readonly FavoriteOption[]; onChange: (items: string[]) => void }) {
  const byKey = new Map(options.map((o) => [o.key, o]))
  const shown = items.filter((k) => byKey.has(k))
  const rest = options.filter((o) => !items.includes(o.key))
  const move = (i: number, by: -1 | 1) => {
    const j = i + by
    if (j < 0 || j >= shown.length) return
    const next = [...shown]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      {shown.length === 0 ? <p className="text-[14px] text-ink-dim">아직 고른 항목이 없습니다.</p> : null}
      <ul className="flex flex-col gap-1">
        {shown.map((k, i) => (
          <li key={k} className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{byKey.get(k)!.label}</span>
            <button type="button" aria-label={`${byKey.get(k)!.label} 앞으로`} disabled={i === 0} onClick={() => move(i, -1)} className="min-h-11 min-w-11 rounded-md border border-line text-[14px] disabled:opacity-40">
              ↑
            </button>
            <button type="button" aria-label={`${byKey.get(k)!.label} 뒤로`} disabled={i === shown.length - 1} onClick={() => move(i, 1)} className="min-h-11 min-w-11 rounded-md border border-line text-[14px] disabled:opacity-40">
              ↓
            </button>
            <button type="button" aria-label={`${byKey.get(k)!.label} 빼기`} onClick={() => onChange(shown.filter((x) => x !== k))} className="min-h-11 min-w-11 rounded-md border border-line text-[14px]">
              ✕
            </button>
          </li>
        ))}
      </ul>
      {rest.length ? (
        <select
          aria-label="즐겨찾기 더하기"
          value=""
          onChange={(e) => e.target.value && onChange([...shown, e.target.value].slice(0, 20))}
          className="min-h-11 rounded-md border border-line bg-raised px-2 text-[14px] text-ink"
        >
          <option value="">+ 항목 더하기</option>
          {(['결재 양식', '메뉴'] as const).map((g) => (
            <optgroup key={g} label={g}>
              {rest
                .filter((o) => o.group === g)
                .map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      ) : null}
    </div>
  )
}
