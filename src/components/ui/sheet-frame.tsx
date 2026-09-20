'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * 구글 시트 게시본을 띄우는 iframe (Phase 5-D).
 *
 * **교차 출처라 안을 볼 수 없다.** 시트가 떴는지 코드로 확인할 방법이 없어서
 * 처음에는 실패 안내를 뒤에 깔고 iframe이 덮게 했는데, 그러면 **불러오는 동안
 * '시트를 열 수 없습니다'가 보인다** — 실패가 아닌데 실패라고 말하는 화면이 된다.
 *
 * 그래서 상태를 셋으로 나눈다:
 *   loading  onLoad가 아직 안 왔다. '불러오는 중'이라고 말한다.
 *   ok       onLoad가 왔다. 안내를 치운다.
 *   failed   onError가 왔거나 제한 시간이 지나도 onLoad가 없다.
 *
 * onLoad는 교차 출처에서도 온다(안을 못 읽을 뿐이다). 구글이 오류 페이지를 그려도
 * onLoad는 오므로 '떴다'가 '읽을 수 있다'를 뜻하지는 않는다 — 그래도
 * 정상 경로에서 거짓 오류를 띄우지 않는 쪽이 낫다.
 */

/** 이 시간 안에 onLoad가 없으면 실패로 본다. 느린 회선에서도 넉넉한 값이다. */
const LOAD_TIMEOUT_MS = 12_000

export function SheetFrame({
  src,
  title,
  className = '',
}: {
  src: string
  title: string
  className?: string
}) {
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading')
  // effect가 보는 값을 ref로 들고 간다 — setState를 effect 본문에서 부르지 않기 위해서다
  // (react-hooks/set-state-in-effect. rail-sidebar.tsx가 같은 규칙에 걸린 적이 있다).
  const loaded = useRef(false)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!loaded.current) setState('failed')
    }, LOAD_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [src])

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {state !== 'ok' ? (
        <p className="absolute inset-0 z-10 flex items-center justify-center bg-panel px-4 text-center text-[11.5px] text-ink-muted">
          {state === 'loading' ? '시트를 불러오는 중…' : '시트를 열 수 없습니다 — 게시 설정을 확인하세요.'}
        </p>
      ) : null}
      <iframe
        key={src}
        src={src}
        title={title}
        onLoad={() => {
          loaded.current = true
          setState('ok')
        }}
        onError={() => setState('failed')}
        // 게시본은 읽기 전용이지만 sandbox로 한 번 더 좁힌다.
        // allow-same-origin이 없으면 구글 스크립트가 안 돌아 표가 안 그려진다.
        sandbox="allow-scripts allow-same-origin allow-popups"
        referrerPolicy="no-referrer"
        className="h-full w-full bg-white"
      />
    </div>
  )
}
