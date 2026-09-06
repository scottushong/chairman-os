import { Icon, type IconName } from '@/components/ui/icon'

/**
 * 화면 머리. 대시보드 외의 목록 화면들이 같은 높이·같은 자리에서 시작하게 한다.
 *
 * 오른쪽 끝의 기능번호(CH-0xx)는 장식이 아니다. 이 화면이 명세의 어느 줄인지
 * 보는 사람과 만드는 사람이 같은 말로 부를 수 있어야 한다. 대시보드 패널들도 같은 표기를 쓴다.
 */
export function PageHeader({
  icon,
  title,
  code,
  description,
  children,
}: {
  icon: IconName
  title: string
  code: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-[20px] font-bold tracking-tight">
          <Icon name={icon} className="size-5 text-ink-dim" />
          {title}
          <span className="text-[9px] font-normal text-ink-muted tnum">{code}</span>
        </h1>
        <p className="mt-1 text-[12px] text-ink-muted">{description}</p>
      </div>
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
    </div>
  )
}
