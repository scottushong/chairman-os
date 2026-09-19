'use client'

import { useEffect, useState } from 'react'

import { DataModeBadge } from '@/components/layout/data-mode-badge'
import { GlassCard } from '@/components/ui/glass-card'
import { Icon } from '@/components/ui/icon'

/**
 * 상단 3칸 중 첫 칸 — 인사 + 큰 시계 + 세계 시간.
 *
 * **시각은 마운트 뒤에 채운다.** 서버는 UTC로 렌더링되므로 시간을 서버에서 그리면
 * 브라우저의 로컬 시각과 달라 하이드레이션이 어긋난다. null로 시작해 타이머 콜백에서만
 * 채우고, 그 전에도 같은 폭('--:--')으로 자리를 잡아 레이아웃이 튀지 않게 한다.
 * P5-2의 world-clocks.tsx가 쓰는 패턴 그대로다 — 첫 갱신도 effect 본문이 아니라
 * setTimeout 콜백에서 한다. effect 본문에서 곧바로 setState를 부르면
 * react-hooks/set-state-in-effect에 걸리고, 타이머 안으로 넣으면 '외부 시스템(시계) 구독'의
 * 정상 형태가 된다.
 *
 * 큰 시계는 **브라우저의 로컬 시각**이다. 회장은 여섯 도시를 오가고, 이 화면을 여는 자리의
 * 시각이 먼저다. 한국 날짜(dateLabel)는 서버가 Asia/Seoul로 찍어 내려 준다 —
 * 날짜는 초 단위로 움직이지 않고, 문자열을 그대로 그리므로 하이드레이션과 무관하다.
 *
 * 도시 목록을 여기서 다시 적는 이유: lib/geo.ts의 BUSINESS_CITIES는 next/headers를 import하는
 * 모듈에 있어 클라이언트 번들로 넘어오지 못하고, 애초에 시간대(tz) 값을 갖고 있지 않다.
 * 헤더의 WorldClocks도 그대로 쓰지 못한다 — 그쪽은 왼쪽 구분선이 붙은 헤더 전용 칩이라
 * 카드 안에 넣으면 카드 왼쪽 모서리에 세로줄이 하나 남는다.
 */
const CITIES: { tz: string; label: string }[] = [
  { tz: 'Asia/Seoul', label: '서울' },
  { tz: 'Asia/Ho_Chi_Minh', label: '호치민' },
  { tz: 'Asia/Dubai', label: '두바이' },
  { tz: 'America/Toronto', label: '토론토' },
]

interface Reading {
  /** 로컬 시각 HH:MM */
  local: string
  /** 로컬 초 SS. 큰 숫자 옆에 작게 붙는다. */
  seconds: string
  /** CITIES 순서와 같은 길이 */
  cities: string[]
}

function read(): Reading {
  const now = new Date()
  const hm = new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now)
  return {
    local: hm,
    seconds: String(now.getSeconds()).padStart(2, '0'),
    cities: CITIES.map(({ tz }) =>
      new Intl.DateTimeFormat('ko-KR', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(now),
    ),
  }
}

export function GreetingClock({ name, dateLabel }: { name: string | null; dateLabel: string }) {
  // null = 마운트 전. 서버와 첫 클라이언트 렌더가 똑같이 '--:--'를 그려야 하이드레이션이 맞는다.
  const [reading, setReading] = useState<Reading | null>(null)

  useEffect(() => {
    function tick() {
      setReading(read())
    }
    // 첫 갱신도 타이머 콜백 안에서 한다(위 주석 — set-state-in-effect).
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, 1000)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [])

  return (
    <GlassCard as="section" aria-label="인사와 시각" className="flex flex-col justify-between">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-[17px] font-semibold text-ink">
            좋은 아침입니다, {name ?? 'Chairman'}님
            <Icon name="crown" className="size-4 text-gold" filled />
          </h1>
          <p className="mt-0.5 text-[12px] text-ink-dim tnum">{dateLabel}</p>
        </div>
        {/* 더미 표식. (morning) 셸에는 헤더가 없어 이 칸이 그 표식을 다시 다는 자리다 —
            화면을 여는 순간 눈이 먼저 닿는 곳이 인사말이고, 회장이 아침에 제일 먼저 보는 이 화면에서
            시드 숫자를 실적으로 읽으면 그대로 잘못된 의사결정이 된다(data-mode-badge.tsx 주석).
            레일 발은 폭 76px이라 이 칩이 들어가지 않는다. live 모드에서는 스스로 아무것도 그리지 않는다. */}
        <DataModeBadge />
      </div>

      <p className="mt-4 flex items-baseline gap-1.5 text-ink">
        <span className="text-[52px] leading-none font-bold tnum">{reading?.local ?? '--:--'}</span>
        <span className="text-[18px] leading-none font-semibold text-ink-dim tnum">
          {reading?.seconds ?? '--'}
        </span>
      </p>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-line-soft pt-3">
        {CITIES.map((c, i) => (
          <span key={c.tz} className="leading-tight">
            <span className="block text-[10px] text-ink-muted">{c.label}</span>
            <span className="block text-[13px] text-ink-dim tnum">
              {reading ? reading.cities[i] : '--:--'}
            </span>
          </span>
        ))}
      </div>

      {/* 이 화면이 명세의 어느 줄인지 남긴다. PageHeader를 걷어 내면서 이 표기까지
          같이 사라지면, 보는 사람과 만드는 사람이 이 화면을 같은 이름으로 못 부른다. */}
      <p className="mt-3 text-[9px] text-ink-muted tnum">아침 루틴 · Phase 3-B · CH-019 · CH-045~048</p>
    </GlassCard>
  )
}
