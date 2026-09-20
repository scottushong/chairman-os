/**
 * 카카오톡 '나에게 보내기'로 나가는 문자열 (Phase 3-C).
 *
 * 카카오 텍스트 템플릿의 text는 200자다. 넘으면 카카오가 메시지를 통째로 거절한다 —
 * 그 실패는 아침 07:00에 사람 없이 일어나므로, 자르는 책임을 여기서 끝낸다.
 *
 * 이 파일의 buildKakaoBriefText()는 순수 함수다. 네트워크도 시계도 건드리지 않는다.
 * scripts/check-kakao.ts가 그 덕에 카카오 계정 없이 이 로직 전부를 잰다.
 */

/** 카카오 text 템플릿의 text 한계. 카카오가 세는 단위는 코드포인트다. */
export const KAKAO_TEXT_LIMIT = 200

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

  // 머리글과 꼬리를 먼저 확보한다. 본문이 밀려나더라도 '무슨 날이고 어디를 열면 되는가'는 남는다.
  // 긴 제목 하나로 200자를 다 먹는 경우가 있어 머리글도 자른다.
  // SCAFFOLD는 줄바꿈 넷('\n\n' 두 번)과 꼬리가 차지하는 고정 비용이다.
  const SCAFFOLD = len(`\n\n\n\n${TAIL}`)
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

  return body ? `${safeHead}\n\n${body}\n\n${TAIL}` : `${safeHead}\n\n${TAIL}`
}
