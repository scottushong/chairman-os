import type { ReactElement, ReactNode } from 'react'

/**
 * 글래스 카드 하나. Phase 5부터 이 앱의 카드 면은 전부 이것을 지난다.
 *
 * 면·흐림·그림자는 globals.css의 .glass가 갖는다. 여기서 유틸리티로 풀지 않는 이유는
 * backdrop-filter가 벤더 접두사와 @supports 폴백을 같이 끌고 다니기 때문이다 —
 * 흐림을 모르는 브라우저에서는 배경이 반투명한 채로 남아 글자가 안 읽히고,
 * 그때는 불투명도로 버텨야 한다. 그 분기를 클래스 이름 하나 뒤에 감춘다.
 *
 * 테두리 색만 여기서 정한다. 톤은 세 가지뿐이고, 셋 다 '무엇을 알리는가'가 다르다.
 */
export function GlassCard({
  children,
  as: Tag = 'div',
  tone = 'plain',
  padding = 'p-5',
  className = '',
  id,
}: {
  children: ReactNode
  /** 기본 div. 의미가 있으면 article/section/aside로. */
  as?: 'div' | 'article' | 'section' | 'aside'
  /** 'plain' 기본 | 'accent' 골드 테두리(그룹 브리핑 등) | 'danger' 위험 테두리 */
  tone?: 'plain' | 'accent' | 'danger'
  /** Tailwind 패딩 클래스. 기본 'p-5'. */
  padding?: string
  className?: string
  id?: string
}): ReactElement {
  /**
   * accent는 강조지 상태가 아니다(골드 규칙). danger만 상태다.
   * 테두리를 반투명으로 두는 것은 의도다 — 유리 모서리에 색이 스며야 하고,
   * 불투명한 선을 두르면 카드가 유리가 아니라 색 테두리 상자가 된다.
   */
  const toneClass =
    tone === 'accent' ? 'border-accent/35' : tone === 'danger' ? 'border-critical/40' : 'border-line-soft'

  return (
    <Tag id={id} className={`glass rounded-glass border ${toneClass} ${padding} ${className}`}>
      {children}
    </Tag>
  )
}
