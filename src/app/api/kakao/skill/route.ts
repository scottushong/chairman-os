import { after, NextResponse, type NextRequest } from 'next/server'

import { answerFromKakao, kakaoSkillConfig, kakaoSkillResponse, secretMatches, type KakaoSkillRequest } from '@/lib/kakao/assistant'

/**
 * /api/kakao/skill?key=… — 카카오 i 오픈빌더 스킬 서버(Phase 11 AI 어시스턴트의 카카오 창구).
 *
 * 꺼져 있으면(기본) 404 — 이 주소가 있다는 것도 말하지 않는다. 켜는 법은 docs/OPERATIONS.md «카카오 어시스턴트».
 * 허용 목록 밖의 카카오 사용자에게는 «연결되지 않은 계정»이라고만 답한다(회장 한 사람의 창구다).
 * 읽기만 한다 — 판단 · 권한 설명은 lib/kakao/assistant.ts 머리 주석.
 */
export const dynamic = 'force-dynamic'
/** 콜백 모드에서 after()가 모델 왕복을 끝낼 시간. 오픈빌더 콜백은 1분까지 기다린다. */
export const maxDuration = 60

const say = (text: string) => ({ version: '2.0', template: { outputs: [{ simpleText: { text } }] } })

export async function POST(req: NextRequest) {
  const config = kakaoSkillConfig()
  if (!config) return new NextResponse('Not Found', { status: 404 })
  if (!secretMatches(req.nextUrl.searchParams.get('key') ?? '', config.secret)) {
    return new NextResponse('Not Found', { status: 404 })
  }

  let body: KakaoSkillRequest
  try {
    body = (await req.json()) as KakaoSkillRequest
  } catch {
    return NextResponse.json(say('요청을 읽지 못했습니다.'))
  }
  const who = body.userRequest?.user?.id ?? ''
  const question = (body.userRequest?.utterance ?? '').trim()
  if (!config.users.has(who)) return NextResponse.json(say('이 카카오 계정은 Chairman OS 어시스턴트에 연결되어 있지 않습니다.'))
  if (!question) return NextResponse.json(say('무엇을 물어볼까요?'))

  const callbackUrl = body.userRequest?.callbackUrl
  // 콜백을 켠 스킬: 먼저 «생각 중»으로 답하고, 결과는 응답을 보낸 뒤 callbackUrl로 보낸다(5초 제한을 피한다).
  if (callbackUrl && /^https:\/\/[a-z0-9.-]+\.kakao(enterprise)?\.com\//i.test(callbackUrl)) {
    after(async () => {
      let payload: unknown
      try {
        payload = kakaoSkillResponse(await answerFromKakao(question), config.appBaseUrl)
      } catch (e) {
        console.error('[kakao skill] 답 실패', e)
        payload = say('답을 만들지 못했습니다. 앱에서 다시 물어 주세요.')
      }
      await fetch(callbackUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }).catch((e) =>
        console.error('[kakao skill] 콜백 실패', e),
      )
    })
    return NextResponse.json({ version: '2.0', useCallback: true, data: { text: '읽고 있습니다… 잠시만요.' } })
  }

  try {
    return NextResponse.json(kakaoSkillResponse(await answerFromKakao(question), config.appBaseUrl))
  } catch (e) {
    console.error('[kakao skill] 답 실패', e)
    return NextResponse.json(say('답을 만들지 못했습니다. 앱에서 다시 물어 주세요.'))
  }
}
