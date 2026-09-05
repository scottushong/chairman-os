import { isDummyData } from '@/lib/env'

/**
 * 화면에 떠 있는 숫자가 실적이 아니라는 표식.
 * src/data 시드는 06_Dummy_Data를 12개월·5개사로 확장한 값이라
 * 실데이터로 오인되면 그대로 잘못된 의사결정이 된다.
 * NEXT_PUBLIC_DATA_MODE=live 가 되는 순간 이 컴포넌트는 아무것도 그리지 않는다.
 */
export function DataModeBadge() {
  if (!isDummyData) return null

  return (
    <span
      title="개발용 더미 데이터입니다. 실적이 아닙니다."
      className="flex shrink-0 items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1 text-[10px] font-bold tracking-[0.08em] text-warning"
    >
      <span className="size-1.5 rounded-full bg-warning" />
      DUMMY DATA
    </span>
  )
}
