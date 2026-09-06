import Link from 'next/link'

/**
 * 목록 화면 위의 필터 줄. 회사·등급·상태가 전부 같은 모양을 쓴다.
 *
 * 버튼이 아니라 링크다. 필터가 URL에 있으니(lib/query.ts) 누르는 동작이 곧 이동이고,
 * 그래야 뒤로 가기가 필터를 되돌린다. onClick 핸들러로 만들면 그 둘이 어긋난다.
 */

export interface FilterOption {
  label: string
  href: string
  active: boolean
  /** 이 필터를 골랐을 때 남는 줄 수. 누르기 전에 빈 화면인지 알 수 있어야 한다. */
  count?: number
}

export function FilterChips({ label, options }: { label: string; options: FilterOption[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-semibold tracking-[0.08em] text-ink-muted">{label}</span>
      {options.map((o) => (
        <Link
          key={o.href}
          href={o.href}
          aria-current={o.active ? 'true' : undefined}
          className={[
            'rounded-md border px-2.5 py-1 text-[11px] transition-colors',
            o.active
              ? 'border-accent bg-accent/15 font-semibold text-ink'
              : 'border-line text-ink-muted hover:text-ink-dim',
          ].join(' ')}
        >
          {o.label}
          {o.count === undefined ? null : (
            <span className="ml-1 text-ink-muted tnum">{o.count}</span>
          )}
        </Link>
      ))}
    </div>
  )
}
