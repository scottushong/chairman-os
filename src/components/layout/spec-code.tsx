import { currentUser } from '@/lib/auth/session'
import { isChairman } from '@/lib/boss'

/**
 * 기능번호(CH-0xx · Phase · §) 표기. 회장에게만 그린다.
 *
 * 이 번호는 회장과 만드는 사람이 명세의 같은 줄을 부르는 말이다. 직원에게는 뜻 없는 암호이고,
 * «Phase 8 · Group City»처럼 회장 전용 기능의 이름까지 실어 나른다 — 직원 화면 용어 원칙(CLAUDE.md).
 * currentUser()는 요청당 한 번이라(cache) 화면마다 여러 번 불러도 왕복이 늘지 않는다.
 */
export async function SpecCode({ code, className }: { code: string; className: string }) {
  const me = await currentUser()
  if (!isChairman(me?.role)) return null
  return <span className={className}>{code}</span>
}
