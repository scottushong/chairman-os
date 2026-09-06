'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { search, type SearchState } from '@/app/actions/search'
import { Icon } from '@/components/ui/icon'
import {
  MIN_QUERY_LENGTH,
  SEARCH_KIND,
  SEARCH_KIND_LABEL_KO,
  hitHref,
  type SearchHit,
  type SearchKind,
} from '@/lib/search'

/**
 * CH-043 헤더 검색창.
 *
 * 결과를 종류별로 묶는다. 다섯 표에서 온 스무 줄을 섞어 놓으면 회장은 매 줄마다
 * '이게 업무인가 문서인가'를 먼저 판단해야 한다. 묶는 순서는 사이드바 순서와 맞춘다.
 *
 * 입력이 멈추면 찾는다. 글자마다 던지면 '핫멜트'를 치는 동안 세 번 왕복하고,
 * 그중 먼저 던진 응답이 나중에 도착해 최신 결과를 덮는 일이 생긴다 —
 * 그래서 응답에 질의를 같이 실어 보내고(SearchState.query) 지금 친 글자와 다르면 버린다.
 */

/** 입력이 멎고 이만큼 지나면 찾는다. 한글은 조합 중에도 값이 바뀌어 이보다 짧으면 왕복이 는다. */
const DEBOUNCE_MS = 250

export function GlobalSearch() {
  const [query, setQuery] = useState('')
  /**
   * 마지막으로 받은 응답. 결과·오류·'찾는 중'을 따로 담지 않고 이 하나만 둔다.
   * 셋을 각각 state로 두면 질의가 바뀔 때마다 effect 안에서 셋을 비워야 하고,
   * 그 순간이 곧 화면이 잠깐 거짓말하는 순간이다(옛 결과 + 새 질의).
   */
  const [result, setResult] = useState<SearchState | null>(null)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  /** 지금 화면에 있는 글자. 응답이 돌아왔을 때 그게 아직 최신인지 판단하는 기준이다. */
  const latest = useRef('')

  useEffect(() => {
    const q = query.trim()
    latest.current = q
    if (q.length < MIN_QUERY_LENGTH) return

    const timer = setTimeout(async () => {
      const next = await search(q)
      // 그사이 더 친 글자가 있으면 이 결과는 이미 낡았다. 최신 응답을 덮지 않는다.
      if (latest.current !== next.query) return
      setResult(next)
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query])

  // 바깥을 누르면 닫는다. 결과를 열어 둔 채 다른 패널을 조작하면 드롭다운이 가린다.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const q = query.trim()
  const short = q.length > 0 && q.length < MIN_QUERY_LENGTH
  const showPanel = open && q.length > 0

  /**
   * 지금 친 글자의 결과만 화면에 쓴다. 질의가 다르면 아직 안 온 것이고, 그게 곧 '찾는 중'이다.
   * busy를 따로 들고 있지 않은 이유가 이거다 — 두 값이 어긋나면 결과는 떠 있는데 계속 도는 화면이 된다.
   */
  const fresh = result?.query === q ? result : null
  const busy = q.length >= MIN_QUERY_LENGTH && fresh === null
  const hits: SearchHit[] = fresh?.hits ?? []
  const error = fresh?.error ?? null

  return (
    <div ref={boxRef} className="relative mx-auto w-full max-w-[560px]">
      <Icon
        name="search"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
      />
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        role="combobox"
        aria-expanded={showPanel}
        aria-controls="global-search-results"
        placeholder="전체 검색 (회사, 프로젝트, 업무, 결정, 문서)"
        className="h-9 w-full rounded-lg border border-line bg-panel pr-3 pl-9 text-[13px] text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
      />

      {showPanel ? (
        <div
          id="global-search-results"
          className="absolute top-11 right-0 left-0 z-40 max-h-[420px] overflow-y-auto rounded-xl border border-line bg-panel py-1.5 shadow-2xl"
        >
          {short ? (
            <p className="px-3.5 py-3 text-[12px] text-ink-muted">
              {MIN_QUERY_LENGTH}글자 이상 입력하세요.
            </p>
          ) : error ? (
            <p role="alert" className="px-3.5 py-3 text-[12px] text-critical">
              {error}
            </p>
          ) : hits.length === 0 ? (
            <p className="px-3.5 py-3 text-[12px] text-ink-muted">
              {busy ? '찾는 중…' : '결과가 없습니다.'}
            </p>
          ) : (
            <>
              {SEARCH_KIND.map((kind) => (
                <Group
                  key={kind}
                  kind={kind}
                  hits={hits.filter((h) => h.kind === kind)}
                  onPick={() => setOpen(false)}
                />
              ))}
              {/* 왜 이만큼만 나오는지 말해 둔다. '전부 검색했다'로 읽히면 없는 걸 없다고 믿는다. */}
              <p className="border-t border-line-soft px-3.5 pt-2 pb-1 text-[10px] text-ink-muted">
                종류별 상위 결과입니다. 볼 권한이 없는 항목은 검색되지 않습니다.
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

function Group({
  kind,
  hits,
  onPick,
}: {
  kind: SearchKind
  hits: SearchHit[]
  onPick: () => void
}) {
  if (hits.length === 0) return null

  return (
    <div className="px-1.5 py-1">
      <p className="px-2 pb-1 text-[10px] font-semibold tracking-[0.08em] text-ink-muted">
        {SEARCH_KIND_LABEL_KO[kind]}
        <span className="ml-1 font-normal tnum">{hits.length}</span>
      </p>
      <ul>
        {hits.map((hit) => (
          <li key={`${hit.kind}-${hit.id}`}>
            <Link
              href={hitHref(hit)}
              onClick={onPick}
              className="block rounded-lg px-2 py-1.5 transition-colors hover:bg-raised"
            >
              <span className="block truncate text-[12.5px] font-semibold">{hit.title}</span>
              <span className="block truncate text-[10.5px] text-ink-muted">{hit.subtitle}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
