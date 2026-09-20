'use client'

import { useCallback, useState } from 'react'

import type { Coordinates } from '@/lib/cities'

/**
 * 브라우저 위치 권한을 명시적으로 묻는 훅.
 *
 * 마운트 시 자동으로 묻지 않는다 — locate()를 부른 시점(= 회장이 "현재 위치" 버튼을
 * 눌렀을 때, P5-5c)에만 navigator.geolocation.getCurrentPosition이 실행된다. 아침에
 * 화면을 열자마자 브라우저 권한 팝업이 뜨면 안 되기 때문이다.
 *
 * 거부·미지원·타임아웃 등 어떤 실패도 여기서 null로 삼키고 status로만 알린다 —
 * 에러를 던지면 호출부가 서버 폴백(geo.ts의 resolveLocation, IP 기반)으로 되돌아가는
 * 대신 화면 자체가 무너질 수 있다.
 */

export type GeolocationStatus = 'idle' | 'locating' | 'granted' | 'denied' | 'unsupported' | 'error'

interface UseGeolocationResult {
  coordinates: Coordinates | null
  status: GeolocationStatus
  /** "현재 위치" 버튼 onClick에 그대로 연결한다. */
  locate: () => void
}

export function useGeolocation(): UseGeolocationResult {
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null)
  const [status, setStatus] = useState<GeolocationStatus>('idle')

  const locate = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unsupported')
      return
    }

    setStatus('locating')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoordinates({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
        setStatus('granted')
      },
      (error) => {
        // PERMISSION_DENIED만 따로 구분한다 — 패널이 "거부됨"과 "일시 오류"를 다르게
        // 안내할 수 있게. 어느 쪽이든 coordinates는 null로 남아 서버 폴백이 유지된다.
        setCoordinates(null)
        setStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'error')
      },
      { timeout: 10_000 },
    )
  }, [])

  return { coordinates, status, locate }
}
