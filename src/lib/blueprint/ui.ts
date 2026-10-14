/**
 * 0081 화면 공통 클래스(서버 화면용 — components/purchasing/shared.tsx는 'use client'라 서버 화면에서 문자열을 꺼낼 수 없다). 값은 그쪽과 같다.
 * 폰은 누를 것 44px(check:mobile).
 */
export const FIELD = 'rounded border border-line bg-panel px-2 py-1 text-t12 text-ink outline-none focus:border-accent max-lg:min-h-11'
export const LABEL = 'flex flex-col gap-1 text-t11 text-ink-muted'
export const CHIP = (on: boolean) =>
  `inline-flex min-h-11 items-center rounded-full border px-2.5 lg:min-h-0 lg:py-1 ${on ? 'border-accent bg-accent/10 font-semibold text-ink' : 'border-line-soft text-ink-dim hover:border-accent'}`
export const LINK_PILL =
  'inline-flex min-h-11 items-center rounded-md border border-line bg-panel px-2.5 text-t11h text-ink-dim hover:border-accent hover:text-ink lg:min-h-0 lg:py-1.5'
export const ALERT = 'rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-t12 text-critical'
export const TABLE_BOX = 'overflow-x-auto rounded-xl border border-line-soft bg-panel max-sm:border-0 max-sm:bg-transparent'
export const TH = 'px-3 py-2 font-normal'
export const TD = 'px-3 py-2'
