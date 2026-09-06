import type { Business, BusinessId } from '@/types'

/**
 * CH-004 핀이 실제로 어디에서 오는가.
 *
 * 두 군데다.
 *   businesses.pinned                조직이 정한 기본 핀
 *   user_settings.pinned_businesses  이 사람이 정한 핀
 *
 * 개인 설정이 있으면 그쪽이 통째로 이긴다. 합집합으로 두면 기본 핀을 뗄 방법이 없어진다.
 * 그래서 null('아직 정한 적 없음')과 빈 배열('전부 해제했다')을 구분해야 한다 —
 * 그 구분이 왜 필요한지는 supabase/migrations/0005_user_settings_pins.sql에 적어 두었다.
 */
export function effectivePinned(
  businesses: Business[],
  saved: BusinessId[] | null,
): BusinessId[] {
  if (saved !== null) return saved
  return businesses.filter((b) => b.pinned).map((b) => b.business_id)
}
