import type { ElementType, HTMLAttributes, ReactElement, ReactNode } from 'react'

/**
 * 글래스 카드 하나. Phase 5부터 이 앱의 카드 면은 전부 이것을 지난다.
 *
 * 면·흐림·그림자는 globals.css의 .glass가 갖는다. 여기서 유틸리티로 풀지 않는 이유는
 * backdrop-filter가 벤더 접두사와 @supports 폴백을 같이 끌고 다니기 때문이다 —
 * 흐림을 모르는 브라우저에서는 배경이 반투명한 채로 남아 글자가 안 읽히고,
 * 그때는 불투명도로 버텨야 한다. 그 분기를 클래스 이름 하나 뒤에 감춘다.
 *
 * 테두리 색만 여기서 정한다. 톤은 세 가지뿐이고, 셋 다 '무엇을 알리는가'가 다르다.
 *
 * 나머지 HTML 속성은 그대로 내려보낸다. 카드는 문단이 아니라 영역이라
 * aria-labelledby·role·data-*가 붙는 자리가 생기는데, 그때마다 이 파일을 열어
 * prop을 하나씩 더하게 만들면 소비하는 쪽(P5-2·3·5c)이 여기서 막힌다.
 */
export function GlassCard({
  children,
  as = 'div',
  tone = 'plain',
  padding = 'p-5',
  className = '',
  ...rest
}: {
  children: ReactNode
  /** 기본 div. 의미가 있으면 article/section/aside로. */
  as?: 'div' | 'article' | 'section' | 'aside'
  /** 'plain' 기본 | 'accent' 골드 테두리(그룹 브리핑 등) | 'danger' 위험 테두리 */
  tone?: 'plain' | 'accent' | 'danger'
  /** Tailwind 패딩 클래스. 기본 'p-5'. */
  padding?: string
} & Omit<HTMLAttributes<HTMLElement>, 'children'>): ReactElement {
  /**
   * accent는 강조지 상태가 아니다(골드 규칙). danger만 상태다.
   * 테두리를 반투명으로 두는 것은 의도다 — 유리 모서리에 색이 스며야 하고,
   * 불투명한 선을 두르면 카드가 유리가 아니라 색 테두리 상자가 된다.
   */
  const toneClass =
    tone === 'accent' ? 'border-accent/35' : tone === 'danger' ? 'border-critical/40' : 'border-line-soft'

  /**
   * as는 네 태그로 좁혀 두었지만 JSX는 유니언 태그에 스프레드를 붙이면 props를 합집합으로
   * 검사하려 든다. 넷 다 HTMLAttributes<HTMLElement>를 쓰는 평범한 블록 요소라
   * 여기서만 ElementType으로 넓힌다 — 밖에서 보이는 계약은 위 네 값 그대로다.
   */
  const Tag = as as ElementType

  return (
    // className을 스프레드 뒤에 두어 호출부가 .glass를 실수로 덮지 못하게 한다.
    <Tag {...rest} className={`glass rounded-glass border ${toneClass} ${padding} ${className}`}>
      {children}
    </Tag>
  )
}
