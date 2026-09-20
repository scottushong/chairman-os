import Link from 'next/link'

import { Icon } from '@/components/ui/icon'
import { SYSTEM_LINKS, navHref } from '@/lib/nav'

/**
 * 하단 시스템 바. Layer 2(Functional System) 바로가기다.
 * 사이드바 메뉴가 '관제 화면'이라면 이쪽은 '실제 업무 시스템'으로 넘어가는 문이라 자리를 나눠 뒀다.
 *
 * **Phase 5-E 1절에서 여덟 칸이 전부 링크가 됐다.** 그 전에는 onClick도 href도 없는
 * `<button>` 여덟 개였다 — 이 저장소에서 가장 큰 죽은 버튼 덩어리였고, 화면 맨 아래에서
 * 여덟 번 연속으로 "눌러도 아무 일 없음"을 가르치고 있었다.
 *
 * 목록은 lib/nav.ts의 SYSTEM_LINKS에 있다. /coming-soon이 같은 목록을 봐야 하기 때문이다
 * (NAV를 파일로 뺀 것과 같은 이유). 전자결재·문서관리는 이미 이 앱 안에 화면이 있어
 * 바로 그리로 가고, 나머지 여섯은 '무엇을 기다리는가'를 말하는 화면으로 간다.
 */
export function SystemBar() {
  return (
    // glass-nav = --color-nav 면 + backdrop-blur. 사이드바·헤더와 같은 면이라 같은 클래스를 쓴다.
    <footer className="glass-nav flex h-12 shrink-0 items-center justify-center gap-1 border-t border-line-soft px-5">
      {SYSTEM_LINKS.map((s) => (
        <Link
          key={s.key}
          href={navHref(s)}
          className={[
            'flex items-center gap-2 rounded-md px-3.5 py-1.5 text-[12px] transition-colors hover:bg-raised hover:text-ink',
            // 아직 주소가 없는 칸은 글자를 한 단계 죽인다. 사이드바의 준비 중 항목과 같은 규칙이다.
            s.ready ? 'text-ink-dim' : 'text-ink-dim opacity-60',
          ].join(' ')}
        >
          <Icon name={s.icon} className="size-4" />
          {s.label}
        </Link>
      ))}
    </footer>
  )
}
