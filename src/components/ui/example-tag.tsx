/**
 * 0072 시드 정리 A안 — 0003 예시 줄의 «예시» 꼬리표. 예시 줄은 대표 세션에만 온다(직원 세션은 DB가 거른다).
 * 지우지 않는다 — 대표 홈의 «예시 숨기기»(?examples=hide)로 가린다.
 */
export function ExampleTag({ on }: { on?: boolean }) {
  if (!on) return null
  return (
    <span
      className="ml-1 inline-flex shrink-0 items-center rounded border border-line px-1 py-px align-middle text-t9 font-semibold text-ink-muted"
      title="처음 넣어 둔 예시 줄입니다 — 실제 업무가 아닙니다"
      data-example-tag
    >
      예시
    </span>
  )
}
