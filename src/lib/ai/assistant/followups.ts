import { isChairman } from '@/lib/boss'
import type { PersonAccess, Role } from '@/types'

import type { ScreenKind } from './screen'

/**
 * «이어서 물어볼 만한 질문» 3개(회장 결정 3, 2026-10-12). 모든 답 아래 버튼 — 누르면 바로 그 질문을 보낸다.
 *
 * ■ 고르는 순서 ■ ① 모델이 답 끝에 적은 [이어서] 줄(있으면) ② 규칙 답이 준 후보 ③ 화면 · 역할 기본 묶음.
 *   어느 쪽이든 **코드의 거름망**을 지난다 — 모델이 친절하게 권한 밖 질문을 권하는 길을 막는다:
 *   · 직원(대표 아닌 사람): «회장 · Chairman» · 원가 · BOM · 배합 · 단가 · 시세 · 마진 낱말이 든 질문은 버린다.
 *   · 재무 권한 없음: 재무 낱말(run.ts FINANCE_INTENT와 같은 식) 질문은 버린다 — 눌러도 «권한 없음»만 온다.
 *   · 이니셔티브를 못 읽는 역할: 이니셔티브 질문을 버린다. 대표 전용(주의 · 의존 · 방향 · 아침)은 대표에게만.
 *   · 화면 · 코드 바꾸기(«개발 세션에서 처리합니다»로 끝나는 말) · 방금 질문과 같은 말 · 서로 겹치는 말은 버린다.
 * ■ 셋이 서로 다르다 ■ 띄어쓰기 · 문장부호를 뺀 글이 같거나 한쪽이 다른 쪽을 품으면 겹친 것으로 본다.
 */

const STAFF_BANNED = /회장|chairman|원가|bom|배합|레시피|단가|시세|시장가|구매가|마진|투입\s*비율/i
const FINANCE_WORDS = /매출|ebitda|재무|현금|이익|원가|손익|런웨이|runway|revenue|profit|cash|finance|p&l|영업이익|순이익|비용 합계|전표|장부|결산/i
const INITIATIVE_WORDS = /이니셔티브|initiative/i
const CHAIRMAN_ONLY_WORDS = /주의\s*항목|의존도|아침\s*루틴|회장\s*방향|attention/i
const APP_CHANGE = /(그래프|차트|위젯|메뉴|버튼|레이아웃|디자인|사이드바|기능)[^?]{0,20}(추가|넣어|만들어|바꿔|변경)/

export interface FollowupContext {
  role: Role
  financeAllowed: boolean
  initiativeAllowed: boolean
  screen: ScreenKind
  question: string
}

const key = (s: string) => s.toLowerCase().replace(/[\s?？.!,·«»"']/g, '')

export function followupAllowed(q: string, c: FollowupContext): boolean {
  const t = q.trim()
  if (t.length < 3 || t.length > 60) return false
  if (!isChairman(c.role) && STAFF_BANNED.test(t)) return false
  if (!c.financeAllowed && FINANCE_WORDS.test(t)) return false
  if (!c.initiativeAllowed && INITIATIVE_WORDS.test(t)) return false
  if (!isChairman(c.role) && CHAIRMAN_ONLY_WORDS.test(t)) return false
  if (APP_CHANGE.test(t)) return false
  return true
}

/** 화면 · 역할 기본 묶음 — 이 대화창의 도구로 실제로 답이 나오는 질문만. */
export function defaultPool(c: FollowupContext): string[] {
  const chair = isChairman(c.role)
  const byScreen: Partial<Record<ScreenKind, string[]>> = {
    approval: ['이 결재 결재선은 어떻게 돼?', '내가 처리할 결재 있어?', '이 결재에 첨부 있어?'],
    approvals: ['내가 처리할 결재 있어?', '내가 올린 결재 상태는?', '결재 양식 뭐 있어?'],
    finance: ['이번 달 마감 상태는?', '전표 입력은 어떻게 해?', '지난달 손익 알려줘'],
    finance_business: ['이번 달 마감 상태는?', '전표 입력은 어떻게 해?', '지난달 손익 알려줘'],
    calendar: ['이번 주 일정 알려줘', '오늘 일정 있어?', '내 업무 보여줘'],
    task: ['내 업무 보여줘', '내가 처리할 결재 있어?', '내 권한은?'],
    documents: ['최근 올라온 문서 보여줘', '문서 등록은 누가 할 수 있어?', '내 권한은?'],
    initiative: ['이 이니셔티브 다음 행동은?', '이 화면에 틀린 것 있어?', '기한 없는 이니셔티브 보여줘'],
    business: ['이 회사 이번 주 일정은?', '이 회사 대기 중인 결재 있어?', '이 화면에 틀린 것 있어?'],
  }
  const general = chair
    ? ['대기 중인 결재 보여줘', '이번 주 일정 알려줘', '기한 없는 이니셔티브 보여줘', '이 화면에 틀린 것 있어?']
    : ['내 업무 보여줘', '내가 처리할 결재 있어?', '결재 양식 뭐 있어?', '이번 달 마감 상태는?', '내 권한은?']
  return [...(byScreen[c.screen] ?? []), ...general]
}

/** 권한 답 뒤의 후보 — 그 사람 · 그 팀 · 바꾸는 법. 본인 답이면 본인 일. */
export function accessFollowups(people: PersonAccess[], role: Role): string[] {
  const chair = isChairman(role)
  const p = people[0]
  if (!p) return chair ? ['영업팀 사람들 권한은?', '대기 중인 결재 보여줘', '내 권한은?'] : ['내 권한은?', '결재 양식 뭐 있어?', '내 업무 보여줘']
  if (p.self && !chair) return ['결재 양식 뭐 있어?', '내가 처리할 결재 있어?', '내 업무 보여줘']
  const out: string[] = []
  if (p.team) out.push(`${p.team.name}팀 사람들 권한은?`)
  const r = p.reports_to
  if (chair && r && !('top' in r) && r.role !== 'Chairman') out.push(`${r.name} 권한은?`)
  out.push(chair ? '대기 중인 결재 보여줘' : '내 권한은?')
  out.push(chair ? '내가 처리할 결재 있어?' : '결재 양식 뭐 있어?')
  return out
}

/** 모델 답 끝의 «[이어서] 질문 | 질문 | 질문» 줄을 떼어 낸다. 글 본문에서는 지운다. */
export function splitFollowups(text: string): { body: string; picks: string[] } {
  const re = /\n*\[이어서\]\s*(.+)\s*$/
  const m = re.exec(text)
  if (!m) return { body: text, picks: [] }
  const picks = m[1]
    .split(/\s*\|\s*/)
    .map((s) => s.trim().replace(/^[-·•\d.)\s]+/, ''))
    .filter(Boolean)
  return { body: text.slice(0, m.index).trimEnd(), picks }
}

/** 셋을 고른다 — 거름망 · 겹침 제거 · 모자라면 기본 묶음으로 채운다. */
export function pickFollowups(c: FollowupContext, ...sources: string[][]): string[] {
  const seen: string[] = [key(c.question)]
  const out: string[] = []
  for (const q of [...sources.flat(), ...defaultPool(c)]) {
    if (out.length === 3) break
    const t = q.trim().replace(/\s+/g, ' ')
    const k = key(t)
    if (!k || seen.some((s) => s === k || (s.length >= 4 && k.includes(s)) || (k.length >= 4 && s.includes(k)))) continue
    if (!followupAllowed(t, c)) continue
    seen.push(k)
    out.push(t)
  }
  return out
}
