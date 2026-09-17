/**
 * 선언문 전문. 접지 않는다 — 회장이 매일 아침 처음부터 끝까지 읽는 글이다.
 * 줄바꿈·빈 줄(문단)은 저장된 그대로 그린다(whitespace-pre-wrap). 명조 15px, 폭 720px.
 *
 * 글꼴 클래스를 따로 주지 않는다. 앱의 font-sans가 곧 Noto Serif KR이다(layout.tsx) —
 * Tailwind의 font-serif를 쓰면 오히려 Georgia 계열로 바뀐다.
 */
export function Manifesto({ body }: { body: string }) {
  if (!body) return null
  return (
    <article
      aria-label="선언문"
      className="mx-auto max-w-[720px] text-[15px] leading-[1.95] break-keep whitespace-pre-wrap text-ink"
    >
      {body}
    </article>
  )
}
