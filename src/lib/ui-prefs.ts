import {
  NOTIFICATION_KIND,
  NOTIFICATION_SWITCHES_DEFAULT,
  type NotificationKind,
  type NotificationSwitches,
} from '@/types'

/**
 * 개인 화면 설정의 **읽는 쪽 한 곳** (Phase 5-E 3·4절, 0030 user_settings.sidebar_prefs / app_prefs).
 *
 * ■ 왜 항목 목록과 분리되어 있나 ■
 *
 * 곧 올 Phase 7 블록 E가 사이드바를 10개 항목으로 통째로 갈아 끼운다. 숨김 상태가 항목
 * 목록의 **모양**(배열의 자리, 라벨 문자열)에 묶여 있으면 그날 회장의 설정이 통째로 깨진다.
 * 그래서 이 파일이 다루는 것은 **키의 주머니**뿐이다:
 *
 *   - 저장은 항목의 `key`(lib/nav.ts NavItem.key)로만 한다. 라벨도 순서도 저장하지 않는다.
 *   - **모르는 키는 조용히 무시한다.** 목록에 없는 키가 주머니에 남아 있어도 아무 일이 없다.
 *   - **모르는 키를 지우지도 않는다.** 저장할 때 화면에 없던 키는 그대로 두고 온다
 *     (mergeHiddenItems). 목록이 갈렸다가 되돌아오는 날 그 설정이 살아 있어야 한다.
 *
 * DB가 키를 검사하지 않는 것도 같은 이유다(0030 5절). 표가 항목 이름을 알기 시작하면
 * 목록을 갈아 끼울 때마다 마이그레이션이 따라와야 한다.
 *
 * ■ 두 주머니를 나눈 이유 ■
 *   sidebar_prefs  사이드바에만 쓰는 것(접힘·숨김·준비 중 기본 숨김)
 *   app_prefs      화면 전체에 쓰는 것(테마·알림 종류별 on/off)
 * 한 칸에 섞으면 한쪽을 저장할 때 다른 쪽을 덮는 경로가 생긴다 — 둘 다 부분 갱신이라
 * '읽고 합치고 쓰기'가 필요하고, 그 합치기를 두 화면이 각자 하면 언젠가 한쪽이 진다.
 */

/* ------------------------------------------------------------------ 사이드바 */

export interface SidebarPrefs {
  /** 접어 둔 그룹의 키. 그룹 제목이 있는 그룹만 접힌다. */
  collapsed_groups: string[]
  /** 숨긴 항목의 키. 모르는 키가 섞여 있어도 된다. */
  hidden_items: string[]
  /** '준비 중' 항목을 기본으로 숨길 것인가. 항목 하나하나를 체크하지 않아도 되는 지름길이다. */
  hide_not_ready: boolean
}

// 기본값은 readSidebarPrefs(빈 주머니)가 낸다 — 상수를 따로 두면 두 곳이 갈라진다.
// 기본이 '전부 보인다'인 이유: 준비 중 메뉴를 남겨 둔 것이 05_Architecture의 전체 그림을
// 보여 주기 위해서라(DEFERRED D-14 선택지 B), 기본으로 감추면 그 판단을 조용히 뒤집는 셈이 된다.

/* ------------------------------------------------------------------ 화면 전체 */

export const THEME_CHOICE = ['light', 'dark', 'auto'] as const
export type ThemeChoice = (typeof THEME_CHOICE)[number]

export const THEME_LABEL_KO: Record<ThemeChoice, string> = {
  light: '라이트',
  dark: '다크',
  auto: '자동 (기기 설정)',
}

export interface AppPrefs {
  /**
   * 관제 셸의 테마. 아침 루틴(`/ai`)은 **이 값과 무관하게 언제나 다크다** —
   * (morning)/layout.tsx가 자기 트리에 data-theme="dark"를 직접 건다.
   * 회장 지시 원문의 "테마(라이트/다크/자동 — /ai는 항상 다크)" 그대로다.
   */
  theme: ThemeChoice
  /** 종류별 알림 on/off. 꺼 둔 종류는 헤더의 뱃지와 목록에서 빠진다. */
  notify: NotificationSwitches
}

export const APP_PREFS_DEFAULT: AppPrefs = {
  theme: 'light',
  notify: NOTIFICATION_SWITCHES_DEFAULT,
}

/* ------------------------------------------------------------------ 읽기 */

/** DB에서 온 jsonb. 무엇이든 올 수 있다 — 그래서 unknown이고, 아래가 전부 방어한다. */
export type PrefsBag = unknown

function bag(raw: PrefsBag): Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}
}

/** 문자열만 남긴다. 중복도 턴다 — 같은 키가 두 번 있어도 뜻은 하나다. */
function keyList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((v): v is string => typeof v === 'string' && v.length > 0))]
}

/**
 * 주머니를 화면이 쓰는 모양으로 편다.
 *
 * **여기서 키를 걸러 내지 않는다.** 모르는 키는 `isHidden()`이 어차피 아무 항목과도
 * 맞지 않아 조용히 무시되고, 걸러 버리면 저장할 때 그 키를 잃는다.
 */
export function readSidebarPrefs(raw: PrefsBag): SidebarPrefs {
  const b = bag(raw)
  return {
    collapsed_groups: keyList(b.collapsed_groups),
    hidden_items: keyList(b.hidden_items),
    hide_not_ready: b.hide_not_ready === true,
  }
}

export function readAppPrefs(raw: PrefsBag): AppPrefs {
  const b = bag(raw)
  const theme = THEME_CHOICE.find((t) => t === b.theme) ?? APP_PREFS_DEFAULT.theme
  const rawNotify = bag(b.notify)
  // 없는 종류는 켜짐으로 떨어진다. 새 종류가 생긴 날 아무도 그 알림을 못 받는 것보다,
  // 켜져 있다가 회장이 끄는 쪽이 낫다.
  const notify = Object.fromEntries(
    NOTIFICATION_KIND.map((k) => [k, rawNotify[k] !== false]),
  ) as NotificationSwitches
  return { theme, notify }
}

/* ------------------------------------------------------------------ 판정 */

/**
 * 이 항목을 사이드바에서 감출 것인가.
 *
 * 규칙은 둘이고 **더해진다(OR)**.
 *   ① hidden_items에 이 키가 있다        — 사람이 직접 감췄다
 *   ② hide_not_ready이고 이 항목이 준비 중 — 한 번에 감추는 지름길
 *
 * ②가 켜져 있는 동안 준비 중 항목은 ①과 무관하게 감춰진다. '이 항목만 예외로 보이게'라는
 * 세 번째 상태를 두지 않았다 — 주머니에 '숨긴 키'와 '보이게 한 키' 두 목록이 생기고,
 * 둘이 충돌할 때 무엇이 이기는지를 화면과 서버가 각자 판정하게 된다. 지름길을 끄면
 * ①만 남아 직접 고른 설정이 그대로 살아난다.
 *
 * 예외는 하나, **지금 보고 있는 화면**이다(active). 감춰 둔 메뉴로 어쩌다 들어왔을 때
 * 사이드바에 그 자리가 없으면 어디에 있는지 알 수 없다.
 */
export function isHidden(
  item: { key: string; ready: boolean },
  prefs: SidebarPrefs,
  /** 지금 이 항목에 있는가. 여기 있으면 감추지 않는다 — 길을 잃지 않게. */
  active = false,
): boolean {
  if (active) return false
  if (prefs.hidden_items.includes(item.key)) return true
  return prefs.hide_not_ready && !item.ready
}

/** 이 그룹이 접혀 있는가. 제목 없는 그룹은 접히지 않는다(접을 손잡이가 없다). */
export function isCollapsed(groupKey: string | null, prefs: SidebarPrefs): boolean {
  return groupKey !== null && prefs.collapsed_groups.includes(groupKey)
}

/* ------------------------------------------------------------------ 저장 */

/**
 * 화면이 보낸 체크 결과를 **모르는 키를 잃지 않고** 합친다.
 *
 * 설정 화면은 지금 목록에 있는 항목만 체크박스로 보여 준다. 그 결과를 그대로 저장하면
 * 목록에 없던 키가 통째로 지워지고, Phase 7이 사이드바를 갈아 끼웠다가 되돌리는 날
 * (혹은 항목 하나가 잠시 빠졌다 돌아오는 날) 회장의 설정이 조용히 사라진다.
 *
 *   known    지금 화면이 다룬 키 전부(체크됐든 아니든)
 *   checked  그중 숨기기로 한 키
 *
 * 결과는 `(기존 − known) ∪ checked`다. 화면이 다루지 않은 키는 건드리지 않는다.
 */
export function mergeHiddenItems(
  existing: string[],
  known: readonly string[],
  checked: readonly string[],
): string[] {
  const knownSet = new Set(known)
  const kept = existing.filter((k) => !knownSet.has(k))
  return [...new Set([...kept, ...checked.filter((k) => knownSet.has(k))])]
}

/** 그룹 하나를 접거나 편다. 같은 합치기 규칙이지만 여기서는 키가 하나뿐이라 단순하다. */
export function toggleCollapsed(existing: string[], groupKey: string, collapsed: boolean): string[] {
  const without = existing.filter((k) => k !== groupKey)
  return collapsed ? [...without, groupKey] : without
}

/** 알림 종류 하나를 켜거나 끈다. 모르는 키는 들어오지 못한다 — 타입이 막는다. */
export function withNotifySwitch(prefs: AppPrefs, kind: NotificationKind, on: boolean): AppPrefs {
  return { ...prefs, notify: { ...prefs.notify, [kind]: on } }
}
