'use server'

import { revalidatePath } from 'next/cache'

import { getRepository } from '@/lib/repository'
import {
  mergeHiddenItems,
  readAppPrefs,
  readSidebarPrefs,
  toggleCollapsed,
  withNotifySwitch,
  THEME_CHOICE,
  type ThemeChoice,
} from '@/lib/ui-prefs'
import { NOTIFICATION_KIND, type NotificationKind } from '@/types'

/**
 * 개인 화면 설정 저장 (Phase 5-E 3·4절, 0030 user_settings.sidebar_prefs / app_prefs).
 *
 * ■ 왜 전부 '읽고 합치고 쓰기'인가 ■
 * 두 주머니는 부분 갱신이다. 화면이 가진 조각만 통째로 덮으면, 사이드바 설정을 저장할 때
 * 테마가 지워지거나 **화면에 없던 항목의 숨김 설정이 사라진다.** 뒤엣것이 이 저장소에서
 * 특히 중요하다 — 곧 올 Phase 7이 사이드바 항목을 통째로 갈아 끼우는데, 그때 화면에
 * 없던 키를 저장이 지워 버리면 목록이 되돌아와도 회장의 설정은 돌아오지 않는다.
 * 합치는 규칙은 lib/ui-prefs.ts에 한 벌만 둔다(mergeHiddenItems).
 *
 * user_id를 받지 않는다. 어느 행인지는 어댑터가 세션에서 꺼내고 0002 user_settings_own이
 * 다시 막는다(actions/settings.ts와 같은 모양).
 */

export interface UiPrefsState {
  error?: string
  saved?: boolean
}

const FAILED: UiPrefsState = { error: '설정을 저장하지 못했습니다.' }

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.every((v) => typeof v === 'string') ? (value as string[]) : null
}

/** 사이드바 그룹 하나를 접거나 편다. */
export async function saveGroupCollapsed(
  groupKey: unknown,
  collapsed: unknown,
): Promise<UiPrefsState> {
  if (typeof groupKey !== 'string' || groupKey === '' || typeof collapsed !== 'boolean') {
    return { error: '잘못된 요청입니다.' }
  }
  try {
    const repo = await getRepository()
    const current = readSidebarPrefs((await repo.getUserSettings()).sidebar_prefs)
    await repo.saveUserSettings({
      sidebar_prefs: {
        ...current,
        collapsed_groups: toggleCollapsed(current.collapsed_groups, groupKey, collapsed),
      },
    })
  } catch (e) {
    console.error('[ui-prefs]', e)
    return FAILED
  }
  // 셸 전체가 이 값을 쓴다. 접기 한 번에 화면을 통째로 다시 그리지만, 사이드바는
  // 서버가 그리는 목록이라 이 한 줄이 없으면 다음 이동 전까지 옛 모양이 남는다.
  revalidatePath('/', 'layout')
  return { saved: true }
}

/**
 * 사이드바 항목 숨김. known은 **설정 화면이 실제로 보여 준 키 전부**다 —
 * 그 목록 밖의 키는 건드리지 않는다는 약속이 mergeHiddenItems의 계약이다.
 */
export async function saveHiddenNavItems(
  known: unknown,
  checked: unknown,
  hideNotReady: unknown,
): Promise<UiPrefsState> {
  const knownKeys = stringList(known)
  const checkedKeys = stringList(checked)
  if (!knownKeys || !checkedKeys || typeof hideNotReady !== 'boolean') {
    return { error: '잘못된 요청입니다.' }
  }
  try {
    const repo = await getRepository()
    const current = readSidebarPrefs((await repo.getUserSettings()).sidebar_prefs)
    await repo.saveUserSettings({
      sidebar_prefs: {
        ...current,
        hidden_items: mergeHiddenItems(current.hidden_items, knownKeys, checkedKeys),
        hide_not_ready: hideNotReady,
      },
    })
  } catch (e) {
    console.error('[ui-prefs]', e)
    return FAILED
  }
  revalidatePath('/', 'layout')
  return { saved: true }
}

/** 테마. /ai는 이 값과 무관하게 늘 다크다 — 그 셸이 자기 트리에 직접 건다. */
export async function saveTheme(theme: unknown): Promise<UiPrefsState> {
  if (!THEME_CHOICE.includes(theme as ThemeChoice)) return { error: '잘못된 요청입니다.' }
  try {
    const repo = await getRepository()
    const current = readAppPrefs((await repo.getUserSettings()).app_prefs)
    await repo.saveUserSettings({ app_prefs: { ...current, theme: theme as ThemeChoice } })
  } catch (e) {
    console.error('[ui-prefs]', e)
    return FAILED
  }
  revalidatePath('/', 'layout')
  return { saved: true }
}

/** 그룹 시티의 강물 · 구름 흐름(Phase 8 G-2b). */
export async function saveCityMotion(on: unknown): Promise<UiPrefsState> {
  if (typeof on !== 'boolean') return { error: '잘못된 요청입니다.' }
  try {
    const repo = await getRepository()
    const current = readAppPrefs((await repo.getUserSettings()).app_prefs)
    await repo.saveUserSettings({ app_prefs: { ...current, city_motion: on } })
  } catch (e) {
    console.error('[ui-prefs]', e)
    return FAILED
  }
  revalidatePath('/', 'layout')
  return { saved: true }
}

/** 알림 종류 하나를 켜고 끈다. 끈 종류는 헤더의 뱃지와 목록에서 빠진다. */
export async function saveNotifySwitch(kind: unknown, on: unknown): Promise<UiPrefsState> {
  if (!NOTIFICATION_KIND.includes(kind as NotificationKind) || typeof on !== 'boolean') {
    return { error: '잘못된 요청입니다.' }
  }
  try {
    const repo = await getRepository()
    const current = readAppPrefs((await repo.getUserSettings()).app_prefs)
    await repo.saveUserSettings({
      app_prefs: withNotifySwitch(current, kind as NotificationKind, on),
    })
  } catch (e) {
    console.error('[ui-prefs]', e)
    return FAILED
  }
  revalidatePath('/', 'layout')
  return { saved: true }
}
