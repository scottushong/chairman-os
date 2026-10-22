'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { loadHomeWidget } from '@/app/actions/home'
import { Pill } from '@/components/home/ui'
import type { FavoriteOption, HomeWidget, WidgetData, WidgetDef } from '@/lib/home/widgets'

/**
 * 0086 위젯 한 칸의 내용 — 위젯마다 따로 서버 액션을 부른다(한 위젯 실패가 홈 전체를 막지 않는다).
 * 상태 넷: 불러오는 중 · 없음 · 권한 없음 · 실패(+ 다시 시도). 연동 안 된 기능은 «연동 준비 중»(예시를 지어내지 않는다).
 * 건수와 목록은 서버가 같은 조건으로 센다. 금액 · 재무 숫자는 오지 않는다.
 */

const LINK = 'inline-flex min-h-11 items-center text-[14px] text-[#2f5bd3] hover:underline'

export function WidgetContent({ widget, def, favorites }: { widget: HomeWidget; def: WidgetDef; favorites: readonly FavoriteOption[] }) {
  if (def.kind === 'favorites') return <FavoritesView widget={widget} options={favorites} />
  return <Remote kind={def.kind} filter={widget.settings.filter} moreHref={def.moreHref} />
}

function Remote({ kind, filter, moreHref }: { kind: string; filter?: string; moreHref?: string }) {
  const [tick, setTick] = useState(0)
  const key = `${kind}|${filter ?? ''}|${tick}`
  const [got, setGot] = useState<{ key: string; data: WidgetData } | null>(null)
  useEffect(() => {
    let alive = true
    loadHomeWidget(kind, filter)
      .then((d) => {
        if (alive) setGot({ key, data: d })
      })
      .catch(() => {
        if (alive) setGot({ key, data: { state: 'error', text: '불러오지 못했습니다(연결 문제).' } })
      })
    return () => {
      alive = false
    }
  }, [key, kind, filter])
  const data = got?.key === key ? got.data : null

  if (!data) {
    return (
      <div data-state="loading" className="flex flex-col gap-2 px-4 py-4" aria-busy="true">
        <div className="h-4 w-3/4 animate-pulse rounded bg-[#eef0f3]" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-[#eef0f3]" />
        <span className="sr-only">불러오는 중</span>
      </div>
    )
  }
  if (data.state === 'error') {
    return (
      <div data-state="error" className="flex flex-col items-start gap-1 px-4 py-4 text-[14px] text-[#b4372b]">
        {data.text}
        <button type="button" onClick={() => setTick((t) => t + 1)} className="inline-flex min-h-11 items-center rounded-md border border-[#d5d9e0] bg-white px-3 text-[14px] text-[#1f2329] hover:bg-[#f4f6f9]">
          다시 시도
        </button>
      </div>
    )
  }
  if (data.state === 'denied') {
    return (
      <div data-state="denied" className="px-4 py-4 text-[14px] text-[#6b7280]">
        <Pill tone="gray">권한 없음</Pill> <span className="ml-1">{data.text}</span>
      </div>
    )
  }
  if (data.state === 'pending') {
    return (
      <div data-state="pending" className="flex flex-col items-start gap-1 px-4 py-4 text-[14px] text-[#6b7280]">
        <Pill tone="orange">연동 준비 중</Pill>
        <p className="mt-1">{data.text.replace(/^연동 준비 중 — /, '')}</p>
        {data.links?.map((l) => (
          <Link key={l.href} href={l.href} className={LINK}>
            {l.label} →
          </Link>
        ))}
      </div>
    )
  }
  return (
    <div data-state="ok" data-count={data.count} className="flex flex-col">
      <div className="flex items-center justify-between px-4 pt-1 pb-1 text-[13px] text-[#6b7280]">
        <span>
          <span className="font-semibold text-[#1f2329] tnum" data-testid="widget-count">
            {data.count}
          </span>
          건
        </span>
        {moreHref ? (
          <Link href={moreHref} className="inline-flex min-h-11 items-center text-[13px] text-[#2f5bd3] hover:underline">
            전체 보기
          </Link>
        ) : null}
      </div>
      {data.items.length === 0 ? (
        <p className="px-4 pb-4 text-[14px] text-[#6b7280]">표시할 항목이 없습니다.</p>
      ) : (
        <ul>
          {data.items.map((it) => (
            <li key={it.id} className="border-t border-[#eceef2]">
              <Link href={it.href} className="flex min-h-11 flex-col gap-1 px-4 py-2.5 hover:bg-[#f7f9fc]">
                <span className="flex min-w-0 items-center gap-2">
                  {it.badge ? <Pill tone={it.badge.tone}>{it.badge.text}</Pill> : null}
                  {it.example ? <Pill tone="gray">예시</Pill> : null}
                  <span className="min-w-0 flex-1 truncate text-[14px] text-[#1f2329]">{it.title}</span>
                </span>
                {it.meta || it.right ? (
                  <span className="flex items-center justify-between gap-2 text-[13px] text-[#6b7280]">
                    <span className="min-w-0 truncate">{it.meta}</span>
                    {it.right ? <span className="shrink-0 tnum">{it.right}</span> : null}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data.note ? <p className="border-t border-[#eceef2] px-4 py-2 text-[13px] text-[#6b7280]">{data.note}</p> : null}
      {data.links?.length ? (
        <div className="flex flex-wrap gap-x-3 border-t border-[#eceef2] px-4">
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

function FavoritesView({ widget, options }: { widget: HomeWidget; options: readonly FavoriteOption[] }) {
  const byKey = new Map(options.map((o) => [o.key, o]))
  const items = (widget.settings.items ?? []).map((k) => byKey.get(k)).filter((o): o is FavoriteOption => !!o)
  if (items.length === 0) {
    return <p className="px-4 py-4 text-[14px] text-[#6b7280]">즐겨찾기가 없습니다. «홈 편집»에서 결재 양식이나 메뉴를 더하세요.</p>
  }
  return (
    <div className="flex flex-wrap gap-2 px-4 py-3">
      {items.map((o) => (
        <Link key={o.key} href={o.href} className="inline-flex min-h-11 items-center rounded-md border border-[#d5d9e0] bg-white px-3 text-[14px] text-[#1f2329] hover:bg-[#f4f6f9]">
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
      {shown.length === 0 ? <p className="text-[14px] text-[#6b7280]">아직 고른 항목이 없습니다.</p> : null}
      <ul className="flex flex-col gap-1">
        {shown.map((k, i) => (
          <li key={k} className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-[14px] text-[#1f2329]">{byKey.get(k)!.label}</span>
            <button type="button" aria-label={`${byKey.get(k)!.label} 앞으로`} disabled={i === 0} onClick={() => move(i, -1)} className="min-h-11 min-w-11 rounded-md border border-[#d5d9e0] text-[14px] disabled:opacity-40">
              ↑
            </button>
            <button type="button" aria-label={`${byKey.get(k)!.label} 뒤로`} disabled={i === shown.length - 1} onClick={() => move(i, 1)} className="min-h-11 min-w-11 rounded-md border border-[#d5d9e0] text-[14px] disabled:opacity-40">
              ↓
            </button>
            <button type="button" aria-label={`${byKey.get(k)!.label} 빼기`} onClick={() => onChange(shown.filter((x) => x !== k))} className="min-h-11 min-w-11 rounded-md border border-[#d5d9e0] text-[14px]">
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
          className="min-h-11 rounded-md border border-[#d5d9e0] bg-white px-2 text-[14px] text-[#1f2329]"
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
