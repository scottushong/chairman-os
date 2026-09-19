'use client'

import { useEffect, useState } from 'react'

import { Icon } from '@/components/ui/icon'

/**
 * 헤더 세계시간 칩(P5-2 Step 1). 서울·호치민·토론토·두바이 네 곳을 1분마다 갱신한다.
 *
 * 서버는 UTC로 렌더링된다 — 서버에서 시각을 찍어 내려보내면 브라우저의 로컬 시각과 달라
 * 하이드레이션이 어긋난다. 그래서 useState(null)로 시작해 마운트 뒤 useEffect에서만 채운다.
 * 채워지기 전에도 자리는 같은 폭으로 잡아 둔다(레이아웃 점프 방지) — '--:--'로 시작한다.
 *
 * 이 칩은 헤더(.glass-nav) 안에서만 쓰인다. 헤더는 P5-1이 --color-nav를 .58로 올려
 * 최악 그라데이션 위에서도 보조 글자(text-ink-dim/-muted)가 AA를 넘도록 맞춘 면이라
 * 여기서 text-ink-muted를 써도 된다(globals.css 헤더 주석 D-1) — 카드 밖 규칙(항목 B)은
 * '유리 없는 맨 배경'에 대한 것이고 셸의 유리 면은 다르다.
 */
const CITIES: { tz: string; label: string }[] = [
  { tz: 'Asia/Seoul', label: '서울' },
  { tz: 'Asia/Ho_Chi_Minh', label: '호치민' },
  { tz: 'America/Toronto', label: '토론토' },
  { tz: 'Asia/Dubai', label: '두바이' },
]

function readTimes(): string[] {
  const now = new Date()
  return CITIES.map(({ tz }) =>
    new Intl.DateTimeFormat('ko-KR', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now),
  )
}

export function WorldClocks() {
  // null = 마운트 전. 서버와 첫 클라이언트 렌더가 똑같이 '--:--'를 그려야 하이드레이션이 맞는다.
  const [times, setTimes] = useState<string[] | null>(null)

  useEffect(() => {
    // setState를 effect 본문에서 곧바로 부르지 않는다(react-hooks/set-state-in-effect) —
    // 첫 갱신도 타이머 콜백 안에서 하면 '외부 시스템(시계) 구독'의 정상 형태가 된다.
    function tick() {
      setTimes(readTimes())
    }
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, 60_000)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [])

  return (
    <div
      aria-label="세계 시간"
      className="flex items-center gap-2.5 border-l border-line pl-3 text-[11px] text-ink-dim"
    >
      <Icon name="clock" className="size-3.5 shrink-0 text-ink-muted" />
      {CITIES.map((c, i) => (
        <span key={c.tz} className="flex flex-col items-center leading-tight">
          <span className="text-[9px] text-ink-muted">{c.label}</span>
          <span className="tnum">{times ? times[i] : '--:--'}</span>
        </span>
      ))}
    </div>
  )
}
