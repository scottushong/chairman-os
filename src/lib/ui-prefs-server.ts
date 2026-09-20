import 'server-only'

import { connection } from 'next/server'
import { cache } from 'react'

import { getRepository } from '@/lib/repository'
import { readAppPrefs, readSidebarPrefs, type AppPrefs, type SidebarPrefs } from '@/lib/ui-prefs'

/**
 * 개인 화면 설정을 **요청 하나에 한 번만** 읽는다 (Phase 5-E, 0030).
 *
 * 셸이 이 값을 세 곳에서 본다: 사이드바(숨김·접힘) · 헤더(알림 스위치) · 셸의 테마.
 * 각자 읽게 두면 live 모드에서 한 화면에 user_settings 왕복이 세 번 생긴다.
 * currentUser()가 같은 이유로 cache()를 쓰고 있고, 여기도 같은 고리다.
 *
 * 'server-only'가 맨 위에 있다. 이 파일이 클라이언트 번들에 닿으면 빌드가 그 자리에서
 * 멈춘다 — getRepository()가 서버 전용이고, 조용히 끌려 들어가면 읽기 어려운 오류로만 드러난다.
 */
export interface UiPrefs {
  sidebar: SidebarPrefs
  app: AppPrefs
}

export const loadUiPrefs = cache(async function loadUiPrefs(): Promise<UiPrefs> {
  /**
   * **try 앞에 서야 한다.** 이 함수는 아래에서 쿠키를 읽고(live 어댑터), Next는 그 사실을
   * 빌드 때 예외를 던져 알린다 — '이 라우트는 정적으로 못 그린다'는 신호다.
   * 그 예외가 아래 catch에 잡히면 신호가 삼켜지고, 빌드 로그가 그 오류로 가득 찬다.
   * connection()을 먼저 부르면 그 판정이 여기서 끝나 예외 자체가 안 난다
   * (lib/auth/session.ts currentUser()가 같은 이유로 같은 줄을 갖고 있다).
   */
  await connection()
  try {
    const repo = await getRepository()
    const settings = await repo.getUserSettings()
    return {
      sidebar: readSidebarPrefs(settings.sidebar_prefs),
      app: readAppPrefs(settings.app_prefs),
    }
  } catch (e) {
    // 설정을 못 읽는다고 셸이 서지 못하면 안 된다. 기본값으로 떨어지고 화면은 그대로 뜬다 —
    // 개인 설정은 '이 사람의 화면'이지 데이터가 아니라서, 없으면 기본 화면이 맞다.
    console.error('[ui-prefs]', e)
    return { sidebar: readSidebarPrefs(null), app: readAppPrefs(null) }
  }
})
