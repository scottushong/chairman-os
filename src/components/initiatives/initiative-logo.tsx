import { logoInitial } from '@/lib/initiative-logo'

/**
 * 로고 하나 (Step 1). 있으면 서명 URL의 <img>, 없으면 제목 첫 글자 원형 배지.
 *
 * next/image를 쓰지 않는다 — 서명 URL이 1시간마다 바뀌어(P5-A signInitiativeLogos) 최적화
 * 캐시가 매번 빗나가고, 그 캐시에는 비공개 이미지가 그대로 남는다. alt=""는 장식이다 —
 * 옆에 제목이 늘 글자로 함께 있어 스크린 리더가 로고를 다시 읽을 필요가 없다.
 *
 * 색이 없는 중립 배지다(회사 식별색은 business-card.tsx의 몫이지 여기가 아니다) — 색은
 * 위험·승인대기에만 쓴다는 규칙을 로고에서도 지킨다.
 */
export function InitiativeLogo({
  title,
  path,
  url,
  size = 40,
}: {
  title: string
  /** initiatives.logo_url. null이면 로고가 없다. */
  path: string | null
  /** signInitiativeLogos가 이 path에 내준 서명 URL. path가 있어도 서명이 실패하면 없을 수 있다. */
  url?: string
  size?: number
}) {
  const style = { width: size, height: size }

  if (path && url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 서명 URL은 매 시간 바뀌어 next/image 캐시와 안 맞는다.
      <img src={url} alt="" style={style} className="shrink-0 rounded-full border border-line-soft object-cover" />
    )
  }

  return (
    <span
      style={style}
      className="flex shrink-0 items-center justify-center rounded-full border border-line-soft bg-raised text-[13px] font-semibold text-ink-dim"
    >
      {logoInitial(title)}
    </span>
  )
}
