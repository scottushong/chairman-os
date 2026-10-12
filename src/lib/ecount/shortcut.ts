import { canImportEcount } from '@/lib/auth/roles'
import type { SessionUser } from '@/types'

/**
 * 재무 화면 머리글의 «ECOUNT 업로드» 바로가기(그룹 재무 · 회사 재무) — 누구에게 어느 회사 것을 보이나.
 *
 * 보이는 사람 = 업로드 화면(/finance/<회사>/import)에 들어가 등록할 수 있는 사람. 판정은 canImportEcount 하나다
 * (ECOUNT 코드 회사 + 그 회사 재무 쓰기 — 역할: Chairman · GroupCFO · 그 회사 BusinessCEO, 사람: '/finance/<회사>' 쓰기 줄).
 * 재무 읽기만 받은 직원 · 다른 회사 사람 · 시스템 계정에게는 없다(바로가기의 존재 자체를 숨긴다).
 * **볼 수 있는 회사만** — 역할로 쓰기가 되는 BusinessCEO도 남의 회사 바로가기는 안 받는다(화면은 회사 범위를 흉내 내지 않으므로
 * 목록(RLS가 거른 회사)을 같이 받는다). 판정은 여전히 DB(0050 can_keep_books)다 — 이것은 안내다.
 *
 * 글자는 «ECOUNT 업로드»뿐이다 — 직원 화면에도 서므로 «회장»이 들어가지 않는다(CLAUDE.md 직원 화면 용어 원칙).
 */
export interface EcountShortcut {
  business_id: string
  /** 그룹 재무에서는 회사 이름을 붙인다(«DY ECOUNT 업로드») — 회사 화면에서는 붙이지 않는다 */
  label: string
  href: string
}

export function ecountUploadShortcuts(
  user: SessionUser | null,
  visible: readonly { business_id: string; name: string }[],
  opts: { withName: boolean },
): EcountShortcut[] {
  return visible
    .filter((b) => canImportEcount(user, b.business_id))
    .map((b) => ({
      business_id: b.business_id,
      label: opts.withName ? `${b.name} 회계 · 재무 자료 올리기` : '회계 · 재무 자료 올리기',
      href: `/finance/${encodeURIComponent(b.business_id)}/upload`,
    }))
}
