'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * 선언문 전문. 태블릿 · 데스크톱에서는 접지 않는다 — 회장이 매일 아침 처음부터 끝까지 읽는 글이다.
 * 폰(640px 미만)에서만 첫 3줄 + «더보기»로 접는다(회장 지시 2026-09-28 모바일 점검) —
 * 폰은 한 줄로 쌓여 선언문 전문이 브리핑을 한 화면 넘게 아래로 밀어낸다.
 * 접힘은 CSS(max-sm:line-clamp-3)만으로 한다. 글은 늘 DOM에 다 있어 검색 · 복사 · 읽기 도구가 전문을 본다.
 *
 * 줄바꿈·빈 줄(문단)은 저장된 그대로 그린다(whitespace-pre-wrap). 명조 15px, 폭 720px.
 *
 * 글꼴 클래스를 따로 주지 않는다. 앱의 font-sans가 곧 Noto Serif KR이다(layout.tsx) —
 * Tailwind의 font-serif를 쓰면 오히려 Georgia 계열로 바뀐다.
 */
export function Manifesto({ body }: { body: string }) {
  const [open, setOpen] = useState(false)
  // 3줄 안에 다 들어가는 짧은 선언문에는 «더보기»를 달지 않는다. 잘렸는지는 그려 봐야 안다.
  const [clipped, setClipped] = useState(false)
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setClipped(el.scrollHeight > el.clientHeight + 1)
    check()
    // 회전 · 창 크기 변경으로 폰 폭을 넘나들면 접힘 여부가 바뀐다.
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [body])

  if (!body) return null
  return (
    <div className="mx-auto max-w-[720px]">
      <article
        id="manifesto-body"
        ref={ref}
        aria-label="선언문"
        className={`text-t15 leading-[1.95] break-keep whitespace-pre-wrap text-ink ${
          open ? '' : 'max-sm:line-clamp-3'
        }`}
      >
        {body}
      </article>
      {clipped || open ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls="manifesto-body"
          onClick={() => setOpen((v) => !v)}
          className="mt-1 -mb-2 text-t13 font-semibold text-accent sm:hidden"
        >
          {open ? '접기' : '더보기'}
        </button>
      ) : null}
    </div>
  )
}
