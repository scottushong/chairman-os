/**
 * ko/en 두 벌 (Phase 9 원칙 "ko/en").
 *
 * **새 i18n 체계를 만들지 않는다.** 이 저장소는 지금까지 한글을 박아 두고(`*_LABEL_KO`)
 * 영문이 필요한 자리만 두 문단을 나란히 두었다(/login 고지). Phase 9의 새 화면은 그 사이에서
 * 한 걸음만 간다 — 문장 옆에 영문을 같이 적고, 세션의 language(0028)로 하나를 고른다.
 * 사전 파일 · 키 체계 · 라이브러리를 들이지 않는다: 문장이 쓰인 자리에서 두 벌이 같이 보여야
 * 한쪽만 고쳐지는 일이 줄어든다.
 */
export type Lang = 'ko' | 'en'

export function tr(lang: Lang | undefined, ko: string, en: string): string {
  return lang === 'en' ? en : ko
}

/** 영문 칸이 비어 있으면 한글을 그린다 — 음차하거나 지어내지 않는다(0017의 판단). */
export function pickText(lang: Lang | undefined, ko: string, en: string | null | undefined): string {
  return lang === 'en' && en && en.trim() ? en : ko
}
