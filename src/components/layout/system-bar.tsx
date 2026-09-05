import { Icon, type IconName } from '@/components/ui/icon'

/**
 * 하단 시스템 바. Layer 2(Functional System) 바로가기다.
 * 사이드바 메뉴가 '관제 화면'이라면 이쪽은 '실제 업무 시스템'으로 넘어가는 문이라 자리를 나눠 뒀다.
 */
const SYSTEMS: { label: string; icon: IconName }[] = [
  { label: 'ERP', icon: 'grid' },
  { label: 'MES', icon: 'cpu' },
  { label: '그룹웨어', icon: 'layers' },
  { label: '전자결재', icon: 'stamp' },
  { label: '문서관리', icon: 'file-text' },
  { label: '메일', icon: 'mail' },
  { label: '화상회의', icon: 'video' },
  { label: '커뮤니케이션', icon: 'message' },
]

export function SystemBar() {
  return (
    <footer className="flex h-12 shrink-0 items-center justify-center gap-1 border-t border-line-soft bg-nav px-5">
      {SYSTEMS.map((s) => (
        <button
          key={s.label}
          type="button"
          className="flex items-center gap-2 rounded-md px-3.5 py-1.5 text-[12px] text-ink-dim transition-colors hover:bg-raised hover:text-ink"
        >
          <Icon name={s.icon} className="size-4" />
          {s.label}
        </button>
      ))}
    </footer>
  )
}
