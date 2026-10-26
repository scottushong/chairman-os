/**
 * 0098 디자인 토큰 — JS 쪽 이름표. 색 값의 정본은 app/globals.css 하나다(새 모양 @theme · 예전 모양 [data-ui='classic']).
 *
 * 화면(className · style · SVG)은 CSS 변수를 그대로 쓴다 — 아래 tok()가 'var(--color-x)'를 돌려준다. 모양이 바뀌면 변수 값이
 * 바뀌므로 코드는 모양을 모른다. 값 자체가 필요한 자리(WebGL · 캔버스 · 이미지 처리 · PWA manifest)만
 * 이 폴더(src/lib/design/)에 리터럴을 둔다 — npm run check:design이 이 폴더와 globals.css 밖의 색 리터럴을 0건으로 지킨다.
 */

/** globals.css의 색 토큰 이름(--color-<name>). */
export type ColorToken =
  | 'app' | 'nav' | 'panel' | 'raised' | 'card' | 'line' | 'line-soft'
  | 'ink' | 'ink-dim' | 'ink-muted'
  | 'accent' | 'accent-soft' | 'accent-ink' | 'on-accent' | 'gold' | 'gold-ink' | 'on-gold' | 'link'
  | 'critical' | 'warning' | 'ok' | 'info' | 'on-status' | 'critical-ink' | 'warning-ink' | 'ok-ink' | 'gold-tone-ink'
  | 'positive' | 'negative'
  | 'biz-dy' | 'biz-vana' | 'biz-sticky' | 'biz-hof' | 'biz-boram'
  | 'chart-1' | 'chart-2' | 'chart-3' | 'chart-4' | 'chart-5' | 'chart-6'
  | 'scrim' | 'on-dark' | 'glass-shadow' | 'nav-active' | 'nav-active-ink'

/** 'var(--color-x)' — SVG fill/stroke(style로) · 인라인 style에 그대로 넣는다. */
export const tok = (name: ColorToken): string => `var(--color-${name})`

/** 투명도를 붙인 토큰 색(Tailwind의 bg-x/40과 같은 계산). */
export const tokAlpha = (name: ColorToken, alpha: number): string =>
  `color-mix(in srgb, var(--color-${name}) ${Math.round(alpha * 100)}%, transparent)`

/** 차트 계열색 — 순서가 곧 계열(globals.css --color-chart-1~6). */
export const CHART_SERIES: readonly string[] = [1, 2, 3, 4, 5, 6].map((i) => `var(--color-chart-${i})`)

/**
 * 값이 필요한 자리. CSS 변수를 읽을 수 없는 곳이라 리터럴이다.
 *   pwa     홈 화면 앱의 바탕 · 상태 막대 색(manifest) — 새 모양 사이드바의 진녹.
 *   paper   스캔 이미지를 펴서 붙일 때의 종이 흰색(sharp flatten · rotate) — 화면 색이 아니라 이미지 처리 재료.
 */
export const LITERAL = {
  pwaBackground: '#1f3a2e',
  pwaTheme: '#1f3a2e',
  paper: '#ffffff',
} as const
