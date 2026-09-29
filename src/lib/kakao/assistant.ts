import 'server-only'

import { timingSafeEqual } from 'node:crypto'

import { runAssistant, type AssistantAnswer } from '@/lib/ai/assistant/run'
import { DATA_MODE } from '@/lib/env'
import { dummyRepository } from '@/lib/repository/dummy'
import { createSupabaseRepository } from '@/lib/repository/supabase'
import { signInServiceAccount } from '@/lib/supabase/service-account'
import type { SessionUser } from '@/types'

/**
 * 카카오톡에서 같은 어시스턴트에게 묻기 (Phase 11) — 카카오 i 오픈빌더 «스킬» 서버의 공통 처리.
 *
 * **꺼져 있는 것이 기본이다.** 셋이 다 있어야 선다(docs/OPERATIONS.md «카카오 어시스턴트»):
 *   KAKAO_SKILL_ENABLED=true · KAKAO_SKILL_SECRET(스킬 URL의 ?key=) · KAKAO_SKILL_USER_IDS(허용할 봇 사용자 키, 쉼표).
 * 채널 · 오픈빌더 스킬 등록은 외부 계정이 필요한 일이라 코드가 못 한다(DEFERRED Phase 11).
 *
 * ■ 누구의 권한으로 읽나 ■ 카카오 요청에는 앱 세션(쿠키)이 없다. service_role이 없는 프로젝트라
 *   야간 Job과 같은 AI Agent 계정(RLS 안, 쓰기 없음)으로 읽는다. 그래서 창구를 좁힌다:
 *   · 허용 목록의 사람(회장)만 · **읽기만**(제안 · 확인 없음 — 확인 버튼을 누를 화면이 없다)
 *   · [제한] 등급(재무 · 첨부 요약 · 주의 금액) 도구를 주지 않는다 — AI Agent 세션의 열람은 0031 감사에
 *     «사람의 열람»으로 남지 않으므로, 감사가 붙는 앱 화면에서 보게 한다. 답에는 앱 링크가 붙는다.
 * ■ 5초 ■ 오픈빌더는 스킬 응답을 5초 기다린다. 요청에 callbackUrl이 오면(AI 챗봇 콜백을 켠 경우)
 *   바로 «생각 중»으로 답하고 결과는 callbackUrl로 보낸다(route.ts가 after()로 돈다).
 */

export interface KakaoSkillRequest {
  userRequest?: { utterance?: string; callbackUrl?: string; user?: { id?: string } }
}

export function kakaoSkillConfig(): { secret: string; users: Set<string>; appBaseUrl: string } | null {
  if (process.env.KAKAO_SKILL_ENABLED !== 'true') return null
  const secret = process.env.KAKAO_SKILL_SECRET ?? ''
  const users = new Set((process.env.KAKAO_SKILL_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean))
  if (secret.length < 16 || users.size === 0) return null
  return { secret, users, appBaseUrl: (process.env.APP_BASE_URL ?? '').replace(/\/+$/, '') }
}

/** 비밀 대조는 길이와 무관한 시간으로(타이밍으로 한 글자씩 맞히지 못하게). */
export function secretMatches(given: string, secret: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** 카카오 쪽 질문자는 회장 한 사람으로 본다(허용 목록이 그 판정이다). 읽기는 AI Agent 세션. */
const KAKAO_ASKER: SessionUser = {
  user_id: 'kakao',
  name: '회장(카카오)',
  role: 'Chairman',
  title_ko: '',
  display_name_en: null,
  language: 'ko',
  // 회장은 역할로 이미 재무를 다 한다(0016). 모듈 줄은 보지 않는다.
  finance: {},
}

export async function answerFromKakao(question: string): Promise<AssistantAnswer> {
  const repo = DATA_MODE === 'dummy'
    ? dummyRepository
    : createSupabaseRepository((await signInServiceAccount({ emailEnv: 'AI_AGENT_EMAIL', passwordEnv: 'AI_AGENT_PASSWORD', role: 'AIAgent' })).sb)
  return runAssistant({ question: question.slice(0, 1000), repo, user: KAKAO_ASKER, path: '/', chatId: null, history: [], channel: 'kakao' })
}

/** 오픈빌더 스킬 응답(v2.0) — 글 한 칸 + «앱에서 보기» 버튼. 카카오 글 칸은 1000자에서 자른다. */
export function kakaoSkillResponse(answer: AssistantAnswer, appBaseUrl: string) {
  const href = answer.sources[0]?.href ?? '/'
  const link = appBaseUrl ? `${appBaseUrl}${href}` : null
  const text = `${answer.answer}\n\n(결정 아님 · 참고용)`.slice(0, 990)
  return {
    version: '2.0',
    template: {
      outputs: link
        ? [{ textCard: { text, buttons: [{ action: 'webLink', label: '앱에서 보기', webLinkUrl: link }] } }]
        : [{ simpleText: { text } }],
    },
  }
}
