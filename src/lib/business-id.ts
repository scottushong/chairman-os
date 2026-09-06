import type { BusinessId } from '@/types'

/**
 * CH-002. 새 회사의 business_id를 어떻게 발급하는가.
 *
 * 시드가 쓰는 규칙(biz_dy, biz_vana, biz_sticky…)을 그대로 잇는다.
 * 'biz_' + 영문 slug 다. 예전 localStorage 시절의 `biz_new_{timestamp}`와 달리
 * 사람이 읽고 기억할 수 있어야 한다 — 이 id는 audit_log·URL·시드 SQL에 그대로 박히고,
 * 한번 발급하면 다른 표들이 FK로 물기 때문에 바꿀 수 없다(DEFERRED D-08).
 *
 * 한글 이름에서 영문 slug를 기계적으로 만들 방법은 없다. 로마자 변환표를 앱에 두면
 * '보람'이 boram인지 poram인지를 코드가 정하게 된다. 그래서 slug는 사람이 정하고,
 * 이 파일은 그 값이 규칙에 맞는지만 본다. 이름에 영문이 섞여 있으면 초안만 만들어 준다.
 *
 * 클라이언트(모달)와 서버(Server Action)가 같은 함수를 쓴다.
 * 규칙이 두 벌이 되면 화면에서 통과한 값이 서버에서 거부되는 날이 온다.
 */

export const BUSINESS_ID_PREFIX = 'biz_'

/** 2~30자, 소문자로 시작, 소문자·숫자·밑줄. 대문자를 막는 이유는 URL과 SQL에서 대소문자가 섞이면 같은 회사가 둘로 보이기 때문이다. */
const SLUG_RE = /^[a-z][a-z0-9_]{1,29}$/

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug)
}

/**
 * 이름에서 slug 초안. 영문·숫자만 남기고 나머지는 밑줄로 접는다.
 * 한글만 있는 이름이면 빈 문자열이 나온다 — 그때는 사용자가 직접 적어야 한다.
 */
export function draftSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30)
    .replace(/_+$/, '')
}

export function toBusinessId(slug: string): BusinessId {
  return `${BUSINESS_ID_PREFIX}${slug}`
}

/** 규칙 설명 한 줄. 모달과 서버 오류 메시지가 같은 문장을 쓴다. */
export const SLUG_RULE_KO =
  '소문자로 시작하는 영문·숫자·밑줄 2~30자입니다. (예: newco_materials)'
