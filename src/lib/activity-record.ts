import 'server-only'

import { headers } from 'next/headers'

import { summarizeUserAgent, type ActivityKind } from '@/lib/activity'
import { getRepository } from '@/lib/repository'

/**
 * 열람 기록을 남기는 자리 (블록 7).
 *
 * ■ 여기서 하는 일 ■ 요청 헤더에서 **기기 요약**과 **도시**만 꺼내 0031의 record_read()에
 * 넘긴다. 5분 중복 억제도, 값의 정규화도 DB가 한다 — 이 파일은 억제 판정을 하지 않는다.
 * 클라이언트는 물론이고 앱 서버도 "이번엔 안 보낼게"를 정하지 않는다. 그것이 기록이다.
 *
 * ■ IP를 읽지 않는다 ■ x-forwarded-for를 여기서 한 번도 안 읽는다. 읽어서 버리는 것이
 * 아니라 **읽지 않는다** — 변수에 담기는 순간 로그·에러 리포트·디버그 출력으로 새는 길이
 * 열린다. 도시(x-vercel-ip-city)까지다. 그 헤더가 없으면(로컬·Vercel 밖) 도시는 null이고
 * 화면은 '—'를 그린다. IP로 도시를 추측하는 외부 서비스를 붙이지 않았다.
 *
 * ■ 실패는 조용하다 ■ 기록이 안 됐다고 화면이 500이 되면 안 된다. 감사 기록 장애가
 * 곧 전면 장애가 되는 구조를 만들지 않는다(actions/auth.ts의 로그인 기록과 같은 판단).
 * 대신 서버 로그에는 남긴다 — 조용히 사라지면 "왜 기록이 없지"에 답할 자리가 없다.
 */

export interface ActivityOrigin {
  /** 'Chrome · Windows'. 못 읽으면 null. 원문 UA가 아니다. */
  device: string | null
  /** 'Seoul, KR'. Vercel 엣지 밖에서는 null. IP가 아니다. */
  city: string | null
}

function nonEmpty(value: string | null | undefined): string | null {
  const v = value?.trim() ?? ''
  return v === '' ? null : v
}

/**
 * 지금 이 요청의 기기와 도시.
 *
 * Vercel 문서상 도시명은 URI 인코딩되어 온다("Ho%20Chi%20Minh%20City"). 깨진 값이
 * 오면 예외가 아니라 원문 그대로 둔다 — 이름 하나 때문에 화면이 500이 되면 안 된다
 * (lib/geo.ts decodeCity와 같은 이유).
 *
 * 나라 코드를 뒤에 붙인다. 같은 이름의 도시가 여럿이라 그것까지가 '도시'다.
 */
export async function readActivityOrigin(): Promise<ActivityOrigin> {
  const h = await headers()

  const rawCity = nonEmpty(h.get('x-vercel-ip-city'))
  let city: string | null = rawCity
  if (rawCity) {
    try {
      city = decodeURIComponent(rawCity)
    } catch {
      city = rawCity
    }
  }
  const country = nonEmpty(h.get('x-vercel-ip-country'))

  return {
    device: summarizeUserAgent(h.get('user-agent')),
    city: city ? [city, country].filter(Boolean).join(', ') : null,
  }
}

export interface ScreenRead {
  /** 앱 안의 경로. 이것이 '같은 화면'의 정의이자 5분 억제의 키다. */
  path: string
  kind: ActivityKind
  /** 문서 id 등. 페이지 진입에는 없다. */
  entity_id?: string | null
  /** 그 id가 어느 표의 것인가. 'documents' 같은 실제 표 이름. */
  entity_table?: string | null
  business_id?: string | null
}

/**
 * 화면 하나를 봤다는 사실을 남긴다. 서버 컴포넌트에서 부른다.
 *
 * 돌려주는 값(true = 이번에 한 줄 남겼다)은 화면이 쓰지 않는다. 검사와 dummy 확인이
 * 5분 억제를 눈으로 보는 데 쓴다.
 */
export async function recordScreenRead(input: ScreenRead): Promise<boolean> {
  try {
    const { device, city } = await readActivityOrigin()
    const repo = await getRepository()
    return await repo.recordRead({
      path: input.path,
      kind: input.kind,
      entity_id: input.entity_id ?? null,
      entity_table: input.entity_table ?? null,
      business_id: input.business_id ?? null,
      device,
      city,
    })
  } catch (e) {
    console.error('[activity] 열람 기록 실패', e instanceof Error ? e.message : String(e))
    return false
  }
}
