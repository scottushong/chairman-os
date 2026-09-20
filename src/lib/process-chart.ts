/**
 * 프로세스차트 링크 검증 (Phase 5-D, 0021).
 *
 * **게시(pubhtml) 링크만 받는다.** 구글 시트 주소는 겉모습이 비슷한데 성격이 전혀 다르다:
 *
 *   .../spreadsheets/d/e/2PACX-.../pubhtml   '웹에 게시' — 읽기 전용 공개본. iframe에 뜬다.
 *   .../spreadsheets/d/<파일ID>/edit          편집 링크. iframe에서 로그인 화면이 뜨고,
 *                                             권한이 있는 사람에게는 **편집 가능한 시트**가 열린다.
 *   .../spreadsheets/d/<파일ID>/view          공유 링크. 역시 로그인에 걸린다.
 *
 * 편집 링크를 대시보드에 띄우면 화면을 보는 사람이 곧 편집자가 된다. 그래서 모양을 막는다.
 * 같은 규칙을 0021의 check 제약이 DB에서 한 번 더 본다 — 화면 검증만 두면 API로 들어오는 길이 남는다.
 */

/** 0021의 check 제약과 **같은 모양**이어야 한다. 한쪽만 고치면 화면과 DB가 다른 것을 받는다. */
export const PUBHTML_PATTERN =
  /^https:\/\/docs\.google\.com\/spreadsheets\/d\/e\/[A-Za-z0-9_-]+\/pubhtml/

/** iframe이 붙을 수 있는 출처. next.config.ts의 CSP frame-src와 같은 값이어야 한다. */
export const EMBED_ORIGIN = 'https://docs.google.com'

export type EmbedProblem =
  | 'empty'
  | 'not_google_sheets'
  | 'edit_link'
  | 'not_published'

export const EMBED_PROBLEM_KO: Record<EmbedProblem, string> = {
  empty: '시트 주소를 넣으세요.',
  not_google_sheets: '구글 스프레드시트 주소가 아닙니다.',
  edit_link:
    '편집 링크입니다. 시트에서 파일 → 공유 → **웹에 게시**로 만든 주소(.../pubhtml)를 넣으세요. 편집 링크를 걸면 화면을 보는 사람이 그대로 편집할 수 있습니다.',
  not_published:
    '게시 주소가 아닙니다. 시트에서 파일 → 공유 → 웹에 게시를 누르면 .../d/e/2PACX-.../pubhtml 형태의 주소가 나옵니다.',
}

/** 문제가 없으면 null. 있으면 낱말 — 화면이 EMBED_PROBLEM_KO로 사람 말을 붙인다. */
export function embedProblem(raw: string): EmbedProblem | null {
  const url = raw.trim()
  if (url === '') return 'empty'
  if (PUBHTML_PATTERN.test(url)) return null

  if (!/^https:\/\/docs\.google\.com\/spreadsheets\//.test(url)) return 'not_google_sheets'
  // 편집·공유 링크를 따로 집어내는 이유는 안내 문장이 달라야 하기 때문이다 —
  // '게시 주소가 아니다'만 말하면 무엇을 눌러야 하는지 모른다.
  if (/\/spreadsheets\/d\/[A-Za-z0-9_-]+\/(edit|view)/.test(url)) return 'edit_link'
  return 'not_published'
}

/**
 * iframe에 넣을 주소.
 *
 * 게시 링크에 `widget=true&headers=false`를 붙이면 구글 자체 머리글과 탭 바가 빠져
 * 카드 안에서 표만 보인다. 이미 쿼리가 붙어 있을 수 있으므로 구분자를 가려 쓴다.
 */
export function embedSrc(url: string): string {
  const joiner = url.includes('?') ? '&' : '?'
  return `${url}${joiner}widget=true&headers=false`
}
