/**
 * 이니셔티브 로고의 순수 규칙 (Phase 5 다듬기 4-a → P5-A).
 *
 * 화면·Server Action·두 어댑터가 같은 상한과 같은 경로 규칙을 봐야 한다.
 * 세 곳에 따로 적으면 브라우저는 통과시키고 서버가 거절하는 조합이 생긴다.
 */

export const LOGO_BUCKET = 'initiative-logos'

/** 2MB. 상표 이미지는 수십 KB면 충분하다. 이 상한은 실수로 사진을 올리는 것을 잡는 자리다. */
export const LOGO_MAX_BYTES = 2_097_152

/**
 * SVG를 뺐다. <img>는 SVG 안의 스크립트를 실행하지 않지만, 서명 URL을 새 탭에서 열면
 * 같은 파일이 문서로 열린다. 로고에 SVG가 꼭 필요한 상황이 아니라 뺀다.
 */
export const LOGO_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const
export type LogoMime = (typeof LOGO_MIME)[number]

/**
 * 한 건에 객체 하나. 확장자를 붙이지 않는다 — 다시 올릴 때 PNG→JPG로 바뀌면
 * 경로가 달라져 옛 객체가 고아로 남는다. 서명 URL은 저장된 content-type으로 나간다.
 */
export function logoPath(initiativeId: string): string {
  return `${initiativeId}/logo`
}

/**
 * 로고가 없을 때의 원형 배지 글자. 제목 첫 글자 1자다.
 * 한글 음절·한자·라틴 알파벳 모두 한 글자로 떨어진다. 이모지는 서로게이트 쌍이라
 * [...title][0]으로 뽑는다 — title[0]을 쓰면 깨진 반쪽이 나온다.
 */
export function logoInitial(title: string): string {
  const first = [...title.trim()][0]
  return first ? first.toUpperCase() : '·'
}
