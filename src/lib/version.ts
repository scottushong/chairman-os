import 'server-only'

/**
 * '이 웹에 대해' 절이 답하는 것 (Phase 5-E 4절).
 *
 * 회장 지시 원문: "버전(git 커밋 해시·배포 일시·환경), 마이그레이션 번호,
 * 개인정보 처리방침(/privacy)·이용약관 링크, 오픈소스 라이선스, 문의".
 *
 * **못 가져오는 값은 null이고 화면은 '—'를 그린다.** 로컬 `next dev`에는 Vercel 환경변수가
 * 없어서 커밋 해시와 환경이 비는 것이 정상이다 — 그 자리에 'local'이라고 적어 두면
 * 배포된 화면에서도 그 글자가 뜨는 날 아무도 이상하게 여기지 않는다.
 */

/** 마지막으로 만든 마이그레이션. 새 번호를 더할 때 이 줄도 같이 고친다. */
export const LATEST_MIGRATION = '0035_attention'

export interface AppVersion {
  /** 배포된 커밋. 짧은 해시로 자른다 — 전체 40자는 읽을 사람이 없다. */
  commit: string | null
  /** 전체 해시. 링크나 복사용이 필요해지면 이 값을 쓴다. */
  commitFull: string | null
  /** 'production' | 'preview' | 'development'. Vercel 밖에서는 null. */
  environment: string | null
  /** 빌드 시각(next.config.ts가 구워 넣는다). */
  builtAt: string | null
  /** 배포된 브랜치. */
  branch: string | null
  /** 지금 코드가 전제하는 마지막 마이그레이션. DB에 실제로 적용됐는지는 여기서 모른다. */
  migration: string
}

function env(name: string): string | null {
  const v = process.env[name]?.trim()
  return v ? v : null
}

export function appVersion(): AppVersion {
  const full = env('VERCEL_GIT_COMMIT_SHA')
  return {
    commit: full ? full.slice(0, 7) : null,
    commitFull: full,
    environment: env('VERCEL_ENV'),
    builtAt: env('APP_BUILD_TIME'),
    branch: env('VERCEL_GIT_COMMIT_REF'),
    migration: LATEST_MIGRATION,
  }
}
