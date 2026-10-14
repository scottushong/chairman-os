'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * 가격 리포트 html을 그대로(채팅 리포트와 같은 화면) — **스크립트를 막은** sandbox iframe. 외부 글(AI · 웹)이 들어가므로:
 *   sandbox="allow-same-origin"만 — 스크립트 · 폼 · 팝업 · 상단 이동 없음. 리포트는 SVG라 스크립트 없이 그대로 그려진다
 *   (DB도 <script> · javascript: 가 든 html을 거부한다 — 0082). allow-same-origin은 이 화면(부모)이 높이를 재려고 둔다 — 안에서 도는 코드는 없다.
 */
export function PriceReportFrame({ html, title }: { html: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(2400)
  const fit = () => {
    const doc = ref.current?.contentDocument
    if (!doc) return
    const h = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0)
    if (h > 0) setHeight(h + 8)
  }
  // 폭이 바뀌면(폰 돌리기 · 창 크기) 높이를 다시 잰다.
  useEffect(() => {
    const on = () => {
      setHeight(400)
      requestAnimationFrame(() => {
        const doc = ref.current?.contentDocument
        if (doc) setHeight(Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0) + 8)
      })
    }
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return (
    <iframe
      ref={ref}
      title={title}
      srcDoc={html}
      sandbox="allow-same-origin"
      referrerPolicy="no-referrer"
      onLoad={() => {
        fit()
        // 글꼴이 늦게 붙으면 높이가 바뀐다 — 한 번 더.
        setTimeout(fit, 400)
      }}
      className="block w-full rounded-xl border-0 bg-[#0b0d12]"
      style={{ height }}
      data-testid="price-report-frame"
    />
  )
}
