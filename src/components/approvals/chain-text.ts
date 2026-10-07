import { bossText, isChairman } from '@/lib/boss'
import type { Role } from '@/types'

/**
 * 0059 단계 결재가 적는 문구(결재선 why · 대표 칸 이름 · 규칙 판정)를 보는 사람에 맞춘다.
 *
 * DB는 «대표»로 적는다(0049). bossText는 회장 화면에서 «대표 결재 · 대표 확인 …» 같은 정해진 낱말만 되돌리는데,
 * 0059 문구(«대표 최종 승인» · «직속 상사(대표)» · «결재할 상사가 없어 대표»)는 그 목록에 없다.
 * 이 문구들은 사람이 쓴 글이 아니라 트리거가 쓴 글이라, 회장 화면에서는 «대표»를 전부 «회장»으로 되돌려도 거짓말이 없다.
 * 사람 이름(상사 칸의 name)에는 쓰지 않는다.
 */
export function chainText(text: string, viewer: Role | null | undefined): string {
  return isChairman(viewer) ? text.replace(/대표/g, '회장') : bossText(text, viewer)
}
