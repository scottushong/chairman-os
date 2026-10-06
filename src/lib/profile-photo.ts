/**
 * 프로필 사진의 순수 규칙 (0032).
 *
 * 화면·Server Action·두 어댑터가 같은 상한과 같은 경로 규칙을 봐야 한다.
 * 세 곳에 따로 적으면 브라우저는 통과시키고 서버가 거절하는 조합이 생긴다.
 * lib/initiative-logo.ts와 나란히 있고, 같은 모양이다 — 다른 것은 '누가'뿐이다.
 */

import { makeFileCheck } from '@/lib/file-drop'

export const PHOTO_BUCKET = 'profile-photos'

/**
 * 2MB. 로고와 같은 상한이다.
 *
 * 얼굴 사진은 요즘 휴대폰에서 바로 올리면 5~10MB가 예사다. 이 상한은 그것을 잡는
 * 자리이고, 잡히면 화면이 "줄여서 올려 주세요"라고 말한다. 서버가 이미지를 다시
 * 인코딩해 주지 않는다 — 그러려면 이미지 라이브러리 하나가 의존성으로 들어오고,
 * 그 유지비가 이 한 칸의 값보다 크다.
 */
export const PHOTO_MAX_BYTES = 2_097_152

/**
 * SVG를 뺐다. 0018이 로고에서 뺀 것과 같은 이유다 — <img>는 SVG 안의 스크립트를 실행하지
 * 않지만, 서명 URL을 새 탭에서 열면 같은 파일이 문서로 열린다.
 */
export const PHOTO_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const
export type PhotoMime = (typeof PHOTO_MIME)[number]

/** 화면에서 «놓자마자» 보는 검사 — 서버 액션과 같은 규칙(file.type 그대로 · PHOTO_MAX_BYTES). */
export const checkPhotoFile = makeFileCheck({
  typeOk: (f) => (PHOTO_MIME as readonly string[]).includes(f.type),
  formats: 'PNG · JPG · WebP',
  maxBytes: PHOTO_MAX_BYTES,
})

/**
 * 한 사람에 객체 하나. `<user_id>/photo`다.
 *
 * **이 모양이 곧 정책이다.** 0032의 profile_photo_owner()가 이 문자열에서 주인을 읽고,
 * 쓰기 정책 셋이 그 값과 auth.uid()를 비교한다. 여기서 모양을 바꾸면 SQL 쪽 정규식도
 * 같이 바뀌어야 한다 — 그 사실을 양쪽 주석에 적어 두었다.
 *
 * 확장자를 붙이지 않는다. 다시 올릴 때 PNG→JPG로 바뀌면 경로가 달라져 옛 객체가
 * 고아로 남는다. 서명 URL은 저장된 content-type으로 나간다.
 */
export function photoPath(userId: string): string {
  return `${userId}/photo`
}

/**
 * 사진이 없을 때의 원형 배지 글자. 이름 첫 글자 1자다.
 *
 * 한글 음절·한자·라틴 알파벳 모두 한 글자로 떨어진다. 이모지는 서로게이트 쌍이라
 * [...name][0]으로 뽑는다 — name[0]을 쓰면 깨진 반쪽이 나온다.
 * (lib/initiative-logo.ts logoInitial과 같은 규칙. 헤더·사이드바가 오래 쓰던
 * `name.slice(0, 1)`이 바로 그 깨진 반쪽을 내던 자리다.)
 */
export function photoInitial(name: string): string {
  const first = [...name.trim()][0]
  return first ? first.toUpperCase() : '·'
}
