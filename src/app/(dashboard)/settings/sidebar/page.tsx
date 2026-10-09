import Link from 'next/link'

import { PageHeader } from '@/components/layout/page-header'
import { SidebarMenuForm, type MenuRow } from '@/components/settings/sidebar-menu-form'
import { currentUser } from '@/lib/auth/session'
import { navFor } from '@/lib/nav'
import { loadUiPrefs } from '@/lib/ui-prefs-server'

/**
 * /settings/sidebar — 사이드바 메뉴 설정 (Phase 5-E 3절).
 *
 * 전 사용자 공통이다. 무엇을 보느냐는 권한이 정하지만 **무엇을 화면에 두느냐**는
 * 그 사람의 화면이라 역할로 가리지 않는다(user_settings가 남의 것을 아무도 못 읽는 표인 것과 같은 선).
 *
 * 목록은 NAV에서 여기서 한 번만 펴서 내려 준다. 폼이 NAV를 다시 import 하면
 * 화면과 판정이 두 벌이 되고, Phase 7이 목록을 갈아 끼울 때 한쪽만 따라간다.
 */
export default async function SidebarSettingsPage() {
  const [prefs, user] = await Promise.all([loadUiPrefs(), currentUser()])

  // 사이드바와 같은 목록 — 회장이 아니면 회장 전용 메뉴는 여기에도 없다(lib/nav.ts navFor).
  const rows: MenuRow[] = navFor(user?.role, user?.ledger).flatMap((group) =>
    group.items.map((item) => ({
      key: item.key,
      label: item.label,
      icon: item.icon,
      ready: item.ready,
      group: group.title ?? '',
    })),
  )

  return (
    <div className="mx-auto max-w-[760px] px-6 py-5">
      <PageHeader
        icon="settings"
        title="사이드바 메뉴"
        code="Phase 5-E"
        description="왼쪽 메뉴에 무엇을 둘지 고릅니다. 감춰도 주소로는 그대로 들어갈 수 있습니다 — 여기서 정하는 것은 권한이 아니라 화면입니다."
      >
        <Link
          href="/settings"
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-t11h text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          설정으로
        </Link>
      </PageHeader>

      <section className="mt-4 mb-6 rounded-xl border border-line-soft bg-panel p-3.5">
        <SidebarMenuForm
          rows={rows}
          hidden={prefs.sidebar.hidden_items}
          hideNotReady={prefs.sidebar.hide_not_ready}
        />
      </section>
    </div>
  )
}
