import type { CityLiveSources } from '@/lib/city-live'
import type { CityLayout, Initiative, IsoDate, Role } from '@/types'

/**
 * dummy 시나리오 — 직원 셋 · 팀장 하나 · AI 하나 (Phase 8 G-3 검증 원문).
 *
 * dummy에는 접속 기록도 결재 단계도 없어서, 도시가 «살아 있는지»를 볼 원천을 여기서 한 벌 만든다.
 * **시계를 따라 움직인다** — 1분 폴링마다 무엇인가 바뀌어야 애니메이션(입장 · 퇴장 · 손들기)을 눈으로 볼 수 있다:
 *
 *   · 박직원(Sticky)은 짝수 분에 들어와 있고 홀수 분에 로그아웃한다 → 입장 · 퇴장.
 *   · 이직원(VANA)의 업무는 3분 주기 중 두 분은 진행, 한 분은 완료 → 창가 자리 → 손들기 3초.
 *   · 김직원(DY)은 결재를 들고 팀장에게 간다. 최팀장(DY)은 다른 결재를 오벨리스크로 올린다.
 *   · AI Job이 돌고(로봇 순회), 오늘 브리핑은 끝났다(봉투). 회장은 보는 사람이 회장이면 점등.
 *   · 첫 번째 진행 중 이니셔티브의 다음 행동이 오늘이다 → 차량.
 *
 * 다른 화면(조직도 · 결재함)의 dummy와 섞지 않는다 — 여기 사람은 도시에만 선다.
 */
export function dummyCityLiveSources(input: {
  now: Date
  today: IsoDate
  viewerRole: Role | null
  layout: CityLayout[]
  initiatives: Initiative[]
}): CityLiveSources {
  const { now, today } = input
  const minute = Math.floor(now.getTime() / 60_000)
  const ago = (m: number) => new Date(now.getTime() - m * 60_000).toISOString()
  const day = (offset: number) => new Date(Date.parse(today) + offset * 86_400_000).toISOString().slice(0, 10)

  const parkIn = minute % 2 === 0
  const leeDone = minute % 3 === 2
  const vehicleFor = input.initiatives.find((i) => i.status === 'Active' && i.business_id !== null)

  return {
    now,
    today,
    viewerRole: input.viewerRole,
    layout: input.layout,
    people: [
      { user_id: 'dummy-city-kim', role: 'Member', name: '김직원', business_id: 'biz_dy', is_lead: false },
      { user_id: 'dummy-city-lee', role: 'Member', name: '이직원', business_id: 'biz_vana', is_lead: false },
      { user_id: 'dummy-city-park', role: 'Member', name: '박직원', business_id: 'biz_sticky', is_lead: false },
      { user_id: 'dummy-city-choi', role: 'TeamLead', name: '최팀장', business_id: 'biz_dy', is_lead: true },
      { user_id: 'dummy-city-ai', role: 'AIAgent', name: 'AI Agent', business_id: null, is_lead: false },
      { user_id: 'dummy-city-chairman', role: 'Chairman', name: '회장', business_id: null, is_lead: false },
    ],
    activity: [
      { user_id: 'dummy-city-kim', at: ago(1), kind: 'in' },
      { user_id: 'dummy-city-lee', at: ago(2), kind: 'in' },
      { user_id: 'dummy-city-choi', at: ago(1), kind: 'in' },
      { user_id: 'dummy-city-park', at: ago(3), kind: 'in' },
      ...(parkIn ? [] : [{ user_id: 'dummy-city-park', at: ago(0), kind: 'out' as const }]),
      { user_id: 'dummy-city-ai', at: ago(0), kind: 'in' },
    ],
    tasks: [
      { task_id: 'city-lee-1', owner: 'dummy-city-lee', business_id: 'biz_vana', status: leeDone ? 'Done' : 'Doing', since: day(-3), deadline: day(4) },
      { task_id: 'city-kim-1', owner: 'dummy-city-kim', business_id: 'biz_dy', status: 'Doing', since: day(-6), deadline: day(1) },
      { task_id: 'city-choi-1', owner: 'dummy-city-choi', business_id: 'biz_hof', status: 'Doing', since: day(-1), deadline: null },
    ],
    requests: [
      { id: 'city-req-1', business_id: 'biz_dy', created_by: 'dummy-city-kim', stage: 'to_lead' },
      { id: 'city-req-2', business_id: 'biz_dy', created_by: 'dummy-city-choi', stage: 'to_chairman' },
    ],
    initiatives: vehicleFor
      ? [{ initiative_id: vehicleFor.initiative_id, title: vehicleFor.title, business_id: vehicleFor.business_id, next_action_date: today }]
      : [],
    aiRunning: true,
    briefDoneToday: true,
  }
}
