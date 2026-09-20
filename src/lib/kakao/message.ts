/**
 * 카카오톡 '나에게 보내기'로 나가는 문자열 (Phase 3-C).
 *
 * 카카오 텍스트 템플릿의 text는 200자다. 넘으면 카카오가 메시지를 통째로 거절한다 —
 * 그 실패는 아침 07:00에 사람 없이 일어나므로, 자르는 책임을 여기서 끝낸다.
 *
 * **이 파일에는 순수 함수만 둔다.** import가 하나도 없는 것이 의도다 —
 * scripts/check-kakao.ts가 tsx에서 경로 별칭(@/) 해석 없이 이 파일만 읽어 돌 수 있어야 한다.
 * 그래서 `server-only`도 붙이지 못한다. 붙이지 못한다면 client component가 실수로 import 해도
 * 막을 장치가 없다는 뜻이므로, **막을 것을 여기 두지 않는다** — 실제로 카카오를 부르는
 * sendKakaoMemo()는 server-only가 붙은 send-brief.ts에 산다.
 */

/** 카카오 text 템플릿의 text 한계. 카카오가 세는 단위는 코드포인트다. */
export const KAKAO_TEXT_LIMIT = 200

/** 월요일 아침에만 맨 앞에 붙는 줄. Phase 4-C 주간 행동 리뷰가 들어올 자리다. */
export const MONDAY_REVIEW_LINE = '지난주 행동 리뷰 하세요 ▶'

/** 요약에서 끌어올 문장 수. 이보다 길면 알림이 아니라 본문이 된다. */
const MAX_SENTENCES = 3

const HEAD_FALLBACK = '☀️ 오늘의 브리핑'
const TAIL = '▶ 전문 보기'
const EMPTY_SUMMARY = '요약을 만들지 못했습니다. 전문에서 확인하세요.'

export interface BriefTextInput {
  /** 'D-780' / 'D-DAY' / 'D+3'. 진행 중인 장기 프로젝트가 없으면 null. */
  dDay: string | null
  /** 그 프로젝트의 제목. dDay가 null이면 같이 null이다. */
  projectTitle: string | null
  /** 그룹 브리핑 summary 전문. 여기서 앞 2~3문장만 뽑아 쓴다. */
  summary: string
  /** 'YYYY-MM-DD', KST 기준. 월요일이면 맨 앞에 MONDAY_REVIEW_LINE이 붙는다. */
  runDate: string
}

/** 코드포인트 기준 길이. '☀️'처럼 surrogate pair인 글자를 2로 세지 않는다. */
function len(s: string): number {
  return [...s].length
}

/** 코드포인트 기준 자르기. 문자 중간에서 끊어 깨진 글자를 만들지 않는다. */
function cut(s: string, max: number): string {
  const cp = [...s]
  return cp.length <= max ? s : cp.slice(0, max).join('')
}

/**
 * runDate가 월요일인가.
 *
 * runDate는 이미 KST 기준 날짜다(night-brief.ts의
 * `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' })` 산출). 그래서 여기서 시간대를
 * 다시 계산하지 않는다 — 날짜 세 토막을 그대로 읽어 요일만 본다.
 *
 * Date.UTC로 직접 만드는 이유: `new Date('2026-09-21')`은 UTC로 읽히지만
 * `new Date('2026/09/21')`은 실행 환경의 시간대로 읽혀 요일이 하루 어긋난다. Vercel은 UTC,
 * 개발 기계는 KST라 그 차이가 로컬에서만 맞고 production에서 틀리는 모양으로 나온다.
 * 형식이 맞지 않으면 false — 월요일이 아닌 쪽이 안전한 기본값이다(줄이 빠질 뿐 발송은 간다).
 */
export function isMonday(runDate: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(runDate)
  if (!m) return false
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay() === 1
}

/**
 * 한국어 문장 끝에서 자른다. '다.', '요.', '!', '?'가 경계다.
 * 소수점("2.8억")에서 끊기지 않게 마침표 뒤에 공백이나 끝이 오는 자리만 경계로 본다.
 */
function sentences(summary: string): string[] {
  return summary
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])(?=\s)/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function buildKakaoBriefText(input: BriefTextInput): string {
  const head =
    input.dDay && input.projectTitle ? `☀️ ${input.dDay} · ${input.projectTitle}` : HEAD_FALLBACK

  // 월요일이면 리뷰 줄이 맨 앞에 선다. 본문보다 먼저 자리를 잡는다 —
  // 그 줄이 밀려나면 월요일 메시지는 평일 메시지와 구별되지 않는다.
  const prefix = isMonday(input.runDate) ? `${MONDAY_REVIEW_LINE}\n\n` : ''

  // 머리글과 꼬리를 먼저 확보한다. 본문이 밀려나더라도 '무슨 날이고 어디를 열면 되는가'는 남는다.
  // 긴 제목 하나로 200자를 다 먹는 경우가 있어 머리글도 자른다.
  // SCAFFOLD는 줄바꿈 넷('\n\n' 두 번)과 꼬리, 그리고 월요일이면 리뷰 줄이 차지하는 고정 비용이다.
  const SCAFFOLD = len(`${prefix}\n\n\n\n${TAIL}`)
  const safeHead = cut(head, Math.max(0, KAKAO_TEXT_LIMIT - SCAFFOLD))
  const budget = KAKAO_TEXT_LIMIT - SCAFFOLD - len(safeHead)

  const parts = sentences(input.summary)
  let body = ''
  if (parts.length === 0) {
    // 요약이 비어도 보낸다. 이 메시지의 목적은 요약이 아니라 /ai를 여는 것이다.
    body = cut(EMPTY_SUMMARY, budget)
  } else {
    for (const s of parts.slice(0, MAX_SENTENCES)) {
      const next = body ? `${body} ${s}` : s
      if (len(next) > budget) break
      body = next
    }
    // 첫 문장조차 예산을 넘으면 그 문장을 잘라서라도 넣는다. 빈 본문보다는 반 문장이 낫다.
    if (!body) body = budget > 1 ? `${cut(parts[0], budget - 1)}…` : ''
  }

  return body ? `${prefix}${safeHead}\n\n${body}\n\n${TAIL}` : `${prefix}${safeHead}\n\n${TAIL}`
}
