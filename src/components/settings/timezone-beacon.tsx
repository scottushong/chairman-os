'use client'

import { useEffect } from 'react'

/**
 * 아침 알림의 ① — 이 기기의 시간대를 서버에 한 줄 남긴다 (Phase 3-C 현지 시간).
 *
 * 그려지는 것이 없다. 로그인한 셸((dashboard)·(morning)) 안에 한 번 서서, 브라우저만 아는
 * `Intl.DateTimeFormat().resolvedOptions().timeZone`을 /api/settings/timezone으로 보낸다.
 * 그 값이 user_settings.current_tz가 되고, 회장이 출장 일정을 안 넣었어도 **비행기에서 내려
 * 앱을 한 번 열면** 다음 아침 알림이 그 도시 06시에 온다.
 *
 * 하루에 한 번, 값이 바뀌었을 때만 보낸다. localStorage에 '무엇을 언제 보냈나'를 남겨 두고
 * 같으면 건너뛴다 — 화면을 옮길 때마다 보내면 회장이 하루에 수십 번 같은 값을 쓰게 된다.
 * localStorage를 못 쓰는 환경(사생활 보호 창 등)에서는 그냥 매번 보낸다. 요청 한 번이
 * 시간대를 영영 모르는 것보다 싸다.
 *
 * 실패해도 아무 말도 하지 않는다. 사용자가 할 수 있는 일이 없고, 시간대는 ②나 기본값으로
 * 이어진다 — 아무도 고칠 수 없는 경고를 화면에 띄우지 않는다.
 */
const KEY = 'chairman-os:current-tz'

export function TimezoneBeacon() {
  useEffect(() => {
    let tz = ''
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
    } catch {
      return
    }
    if (!tz) return

    // 'Asia/Seoul@2026-09-21'. 날짜가 같이 들어가야 "어제 보냈으니 오늘도 안 보낸다"가 아니라
    // "오늘 보냈으니 오늘은 그만"이 된다.
    const stamp = `${tz}@${new Date().toISOString().slice(0, 10)}`
    try {
      if (window.localStorage.getItem(KEY) === stamp) return
    } catch {
      // 저장소를 못 읽는 환경. 아래로 내려가 그냥 보낸다.
    }

    void fetch('/api/settings/timezone', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timezone: tz }),
    })
      .then((res) => {
        if (!res.ok) return
        try {
          window.localStorage.setItem(KEY, stamp)
        } catch {
          // 다음 화면에서 한 번 더 보내게 된다. 그 정도는 괜찮다.
        }
      })
      .catch(() => {})
  }, [])

  return null
}
