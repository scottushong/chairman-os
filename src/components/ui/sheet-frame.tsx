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
 *   loading  onLoad가 아직 안 왔다. 화면을 덮고 '불러오는 중'이라고 말한다.
 *   ok       onLoad가 왔다. 안내를 치운다.
 *   slow     제한 시간이 지나도 onLoad가 없다.
 *
 * **'slow'를 '실패'라고 부르지 않는다.** 처음엔 failed로 두고 화면을 덮었는데,
 * 실제로는 시트가 멀쩡히 떠 있는데도 그 위에 '시트를 열 수 없습니다'가 얹혔다 —
 * 구글 게시본은 느릴 때 onLoad가 12초를 넘기고, 우리는 교차 출처라 안을 볼 수 없어
 * 늦는 것과 못 뜨는 것을 구분할 방법이 없다. 그래서 늦으면 **덮지 않고**
 * 아래에 한 줄만 띄운다. 시트가 떴으면 그대로 읽히고, 안 떴으면 그 줄이 다음 할 일을 말한다.
 *
 * **onLoad만으로는 모자란다.** 구글 게시본에서는 시트가 다 그려진 뒤에도 onLoad가
 * 오지 않는 경우가 있다(실측: 시트가 멀쩡히 렌더됐는데 15초가 지나도 안 왔다).
 * 그래서 `contentWindow.length`를 같이 본다 — 교차 출처에서도 읽을 수 있는 몇 안 되는 값이고,
 * 구글 게시본은 안에 프레임을 하나 두므로 문서가 실제로 들어오면 0에서 1이 된다.
 * 둘 중 먼저 오는 쪽을 '떴다'로 친다.
 */

/** 이 시간이 지나면 '늦다'고만 말한다. 실패로 단정하지 않는다. */
const SLOW_AFTER_MS = 15_000

/**
 * 축소 배율. 구글 시트 게시본은 폭이 넓어서 카드 안에 1:1로 넣으면 몇 칸만 보인다.
 * iframe을 (1/scale)만큼 넓게 만들고 그만큼 줄여 그리면, 글자는 작아지지만
 * **같은 넓이에 더 많은 칸이 들어온다.**
 *
 * 0.75가 기본이다. 0.7 아래로 내리면 글자가 읽히지 않고, 0.85 위로 올리면
 * 1:1과 크게 다르지 않아 줄이는 뜻이 없다. 폭이 넓은 화면에서는 호출 쪽이 올려 잡는다.
 */
const DEFAULT_SCALE = 0.75

export function SheetFrame({
  src,
  title,
  className = '',
  scale = DEFAULT_SCALE,
}: {
  src: string
  title: string
  className?: string
  /** 0.7~0.9. 작을수록 많이 보이고 글자가 작아진다. */
  scale?: number
}) {
  const [state, setState] = useState<'loading' | 'ok' | 'slow'>('loading')
  // effect가 보는 값을 ref로 들고 간다 — setState를 effect 본문에서 부르지 않기 위해서다
  // (react-hooks/set-state-in-effect. rail-sidebar.tsx가 같은 규칙에 걸린 적이 있다).
  const loaded = useRef(false)

  const frame = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    // 0.5초마다 '안에 문서가 들어왔나'를 본다. setState는 콜백 안에서만 부른다
    // (effect 본문에서 부르면 react-hooks/set-state-in-effect에 걸린다).
    const poll = window.setInterval(() => {
      if (loaded.current) return
      let inner = 0
      try {
        inner = frame.current?.contentWindow?.length ?? 0
      } catch {
        // 교차 출처라 대부분의 속성은 막히지만 length는 읽힌다. 막히면 그냥 기다린다.
      }
      if (inner > 0) {
        loaded.current = true
        setState('ok')
      }
    }, 500)

    const timer = window.setTimeout(() => {
      if (!loaded.current) setState('slow')
    }, SLOW_AFTER_MS)

    return () => {
      window.clearInterval(poll)
      window.clearTimeout(timer)
    }
  }, [src])

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* 불러오는 동안만 덮는다. 덮는 것은 '아직 아무것도 없다'가 참일 때뿐이다. */}
      {state === 'loading' ? (
        <p className="absolute inset-0 z-10 flex items-center justify-center bg-panel px-4 text-center text-[11.5px] text-ink-muted">
          시트를 불러오는 중…
        </p>
      ) : null}
      {/* 늦으면 아래 한 줄. 시트가 떠 있으면 그 위를 가리지 않는다. */}
      {state === 'slow' ? (
        <p className="pointer-events-none absolute right-0 bottom-0 left-0 z-10 bg-warning/15 px-3 py-1 text-center text-[11px] text-warning">
          시트가 늦게 뜹니다 — 비어 있으면 게시 설정을 확인하거나 전체 화면으로 여세요.
        </p>
      ) : null}
      {/*
       * 축소 렌더. width/height를 1/scale로 키우고 그만큼 scale()로 줄인다.
       * transform-origin을 top left로 두지 않으면 가운데를 기준으로 줄어들어
       * 왼쪽 위 모서리가 컨테이너 밖으로 빠져나간다 — 시트의 첫 행·첫 열이 잘린다.
       *
       * **absolute로 띄운다.** 흐름 안에 두고 height를 %로 주면 부모의 height 속성을
       * 찾는데, 부모가 min-height와 flex로만 높이를 얻으면 확정 높이가 없어서
       * iframe 기본값 150px로 떨어진다 — 시트 머리글만 나오고 본문이 통째로 잘린다.
       * absolute면 %가 컨테이닝 블록(이 relative 상자)의 실제 높이로 풀린다.
       */}
      <iframe
        key={src}
        ref={frame}
        src={src}
        title={title}
        onLoad={() => {
          loaded.current = true
          setState('ok')
        }}
        onError={() => setState('slow')}
        // 게시본은 읽기 전용이지만 sandbox로 한 번 더 좁힌다.
        // allow-same-origin이 없으면 구글 스크립트가 안 돌아 표가 안 그려진다.
        sandbox="allow-scripts allow-same-origin allow-popups"
        referrerPolicy="no-referrer"
        className="absolute top-0 left-0 border-0 bg-white"
        style={{
          width: `${100 / scale}%`,
          height: `${100 / scale}%`,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      />
    </div>
  )
}
