import 'server-only'

import { headers } from 'next/headers'

import { supabaseConfig } from '@/lib/supabase/config'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * '계정·보안' 절이 보여 줄 수 있는 것 — 그리고 보여 줄 수 **없는** 것 (Phase 5-E 4절).
 *
 * ■ 못 가져오는 칸은 '—'다. 그럴듯하게 채우지 않는다 ■
 *
 * 회장 지시 원문은 "로그인 기록(일시·기기·IP·위치)"과 "활성 세션 목록"을 요구했다.
 * 지금 이 저장소가 실제로 답할 수 있는 것은 다음뿐이다.
 *
 *   마지막 로그인 시각   Supabase auth의 `user.last_sign_in_at`. 세션 하나가 아는 값이라 정확하다.
 *   계정 생성 시각       `user.created_at`.
 *   지금 이 기기          요청 헤더의 User-Agent. 브라우저와 OS를 대략만 읽는다.
 *   지금 이 접속의 위치   Vercel 엣지 헤더(x-vercel-ip-city/-country). 로컬·Vercel 밖에는 없다.
 *   지금 이 접속의 IP     x-forwarded-for의 첫 값. 같은 사정이다.
 *
 * 다음은 **만들 수 없다.**
 *
 *   과거 로그인 목록   audit_log에 action='login'이 쌓이고는 있지만(actions/auth.ts) 그 줄에는
 *                      기기도 IP도 없다. 그 칸들은 블록 7(회장 전용 접속 현황 /settings/activity)이
 *                      더하기로 되어 있는 것이고, 없는 칸을 여기서 추측으로 채우면
 *                      '기록'이라는 말의 뜻이 무너진다. 목록은 그 블록이 온 뒤에 선다.
 *   다른 기기의 세션   GoTrue에는 자기 세션 목록을 주는 API가 없다(admin API는 service_role이
 *                      필요하고 이 프로젝트에는 그 키가 없다 — CLAUDE.md 데이터 원칙).
 *                      그래서 '활성 세션 목록'은 **지금 이 기기 한 줄**이 전부다.
 *                      "다른 기기 모두 로그아웃"은 목록 없이도 할 수 있다(scope: 'others').
 */

export interface SessionInfo {
  /** Supabase가 붙어 있는가. dummy 개발에서는 false이고 아래 값이 전부 null이다. */
  live: boolean
  lastSignInAt: string | null
  accountCreatedAt: string | null
  /** 'Chrome · Windows' 같은 한 줄. 못 읽으면 null. */
  device: string | null
  /** '서울, KR'. Vercel 엣지 밖에서는 null. */
  place: string | null
  /** 접속 IP. Vercel 엣지 밖에서는 null. */
  ip: string | null
}

/** 화면이 '—'를 그리게 하는 값. 빈 문자열이 아니라 null이어야 '못 가져왔다'가 드러난다. */
function nonEmpty(value: string | null | undefined): string | null {
  const v = value?.trim() ?? ''
  return v === '' ? null : v
}

/**
 * User-Agent에서 브라우저와 OS만 대충 읽는다.
 *
 * 라이브러리를 들이지 않는다. 이 값이 쓰이는 자리는 "지금 이 기기가 무엇인가" 한 줄이고,
 * 그 한 줄을 위해 UA 파서를 의존성으로 들이면 유지비가 값보다 크다.
 * 모르면 null이다 — 'Unknown Browser'라고 적어 두면 그게 이름인 줄 안다.
 */
function readDevice(ua: string | null): string | null {
  if (!ua) return null
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) && /Version\//.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox'
    : null
  const os =
    /Windows NT/.test(ua) ? 'Windows'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Android/.test(ua) ? 'Android'
    : /Linux/.test(ua) ? 'Linux'
    : null
  if (!browser && !os) return null
  return [browser, os].filter(Boolean).join(' · ')
}

export async function readSessionInfo(): Promise<SessionInfo> {
  const h = await headers()
  const device = readDevice(h.get('user-agent'))

  const city = nonEmpty(h.get('x-vercel-ip-city'))
  const country = nonEmpty(h.get('x-vercel-ip-country'))
  // Vercel 문서상 도시명은 URI 인코딩되어 온다. 깨진 값이 오면 예외가 아니라 null이다
  // (lib/geo.ts decodeCity와 같은 이유 — 이름 하나 때문에 화면이 500이 되면 안 된다).
  let placeCity: string | null = city
  if (city) {
    try {
      placeCity = decodeURIComponent(city)
    } catch {
      placeCity = city
    }
  }
  const place = placeCity ? [placeCity, country].filter(Boolean).join(', ') : null

  // x-forwarded-for는 프록시를 거칠수록 쉼표로 이어진다. 맨 앞이 원 요청자다.
  const ip = nonEmpty(h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip'))

  if (!supabaseConfig()) {
    // 키가 없으면 로그인이라는 개념이 없다(lib/supabase/proxy.ts). 시각 두 칸은 '—'다.
    return { live: false, lastSignInAt: null, accountCreatedAt: null, device, place, ip }
  }

  const sb = await createSupabaseServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()

  return {
    live: true,
    lastSignInAt: nonEmpty(user?.last_sign_in_at),
    accountCreatedAt: nonEmpty(user?.created_at),
    device,
    place,
    ip,
  }
}
