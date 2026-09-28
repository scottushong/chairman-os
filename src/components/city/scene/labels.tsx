'use client'

import { Html } from '@react-three/drei'
import { createContext, useContext, type CSSProperties, type RefObject } from 'react'

/**
 * 이름표는 drei <Html>(DOM)로 — 한글을 3D 글자(troika)로 그리면 원격 글꼴을 받아야 한다.
 * DOM 이면 앱 글꼴이 그대로 쓰인다. 포인터는 통과시켜 건물 클릭을 막지 않는다.
 * zIndexRange 를 낮게 — 기본값(수천만)이면 페이지의 머리띠 · 패널 위로 올라온다.
 */
const Z: [number, number] = [20, 0]

/**
 * 이름표를 붙일 DOM 자리(씬의 바깥 div). 주지 않으면 drei 가 첫 렌더에는 캔버스 부모에, 이벤트가
 * 붙은 뒤에는 다른 요소에 붙이려고 root 를 렌더 도중 다시 만든다(React 경고). 한 곳으로 못 박는다.
 */
export const LabelPortal = createContext<RefObject<HTMLElement | null> | null>(null)

function usePortal() {
  return (useContext(LabelPortal) ?? undefined) as RefObject<HTMLElement> | undefined
}

export function NameTag({ name, fact, strong }: { name: string; fact: string | null; strong: boolean }) {
  const box: CSSProperties = {
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
    padding: '3px 8px 4px',
    borderRadius: 8,
    background: 'rgba(18,16,14,0.72)',
    border: `1px solid ${strong ? 'rgba(222,186,120,0.95)' : 'rgba(176,141,87,0.45)'}`,
    boxShadow: strong ? '0 0 12px rgba(222,186,120,0.45)' : 'none',
    color: '#f3eee4',
    textAlign: 'center',
    lineHeight: 1.25,
    transition: 'border-color 200ms, box-shadow 200ms',
  }
  const portal = usePortal()
  return (
    <Html center portal={portal} zIndexRange={Z} style={{ pointerEvents: 'none' }}>
      <div style={box}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '-0.01em' }}>{name}</div>
        {fact && <div style={{ fontSize: 10, color: '#d9c39a', fontVariantNumeric: 'tabular-nums' }}>{fact}</div>}
      </div>
    </Html>
  )
}

/** 사람 이름표 — 회장이 볼 때만 온다(label 이 null 이 아니면). 아주 작게. */
export function PersonTag({ label }: { label: string }) {
  const portal = usePortal()
  return (
    <Html center portal={portal} zIndexRange={Z} style={{ pointerEvents: 'none' }}>
      <div
        style={{
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          fontSize: 9,
          padding: '1px 5px',
          borderRadius: 6,
          background: 'rgba(18,16,14,0.6)',
          color: '#f3eee4',
        }}
      >
        {label}
      </div>
    </Html>
  )
}

/** 월 매출(원) → «3.2억». 없으면 null — 0억으로 적지 않는다. */
export function eok(revenue: number | null): string | null {
  if (revenue === null || !Number.isFinite(revenue)) return null
  return `${(revenue / 1e8).toFixed(1)}억`
}
