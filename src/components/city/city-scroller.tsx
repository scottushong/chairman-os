'use client'

import { useEffect, useRef } from 'react'

/**
 * 폰(768px 미만)에서 도시 그림을 두 배 폭으로 펴고 옆으로 밀게 한다.
 *
 * 360px 폭에 가로로 긴 그림(2752×1536)을 다 넣으면 건물 하나가 엄지보다 작아 누를 수도, 알아볼 수도 없다.
 * 그림은 크게 두고 화면이 창이 된다. 처음 창 자리는 focusX(그림 폭의 %) — 고른 건물이 있으면 그 건물,
 * 없으면 회사들의 가운데다. 맨 왼쪽에서 시작하면 첫 화면이 빈 강가일 수 있다.
 *
 * 768px 이상은 아무것도 하지 않는다(감싼 div 둘이 w-full 그대로라 데스크톱 모양이 예전과 같다).
 */
export function CityScroller({ focusX, children }: { focusX: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || el.scrollWidth <= el.clientWidth) return
    el.scrollLeft = (el.scrollWidth * focusX) / 100 - el.clientWidth / 2
  }, [focusX])

  return (
    <div ref={ref} className="max-md:overflow-x-auto max-md:rounded-glass">
      <div className="max-md:w-[200%]">{children}</div>
    </div>
  )
}
