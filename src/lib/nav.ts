import type { IconName } from '@/components/ui/icon'

/**
 * 좌측 네비의 메뉴 한 벌. 05_Architecture의 모듈 경로를 그대로 화면 메뉴로 편다.
 *
 * 사이드바만 쓰던 목록을 파일로 뺀 이유는 /coming-soon이 같은 목록을 봐야 하기 때문이다.
 * 그 화면은 '어느 메뉴를 눌러서 왔나'를 라벨로 되받고, 목록이 둘로 갈라지면
 * 사이드바에 있는 메뉴가 '알 수 없는 메뉴'로 뜬다.
 *
 * ready가 이 파일의 요점이다 (DEFERRED D-14 선택지 B).
 *   true   Phase 1으로 실제 화면이 서 있다. href로 그대로 간다.
 *   false  아직 없다. 누르면 404가 아니라 /coming-soon?menu=…로 간다.
 *
 * 메뉴를 지우지 않는 이유는 05_Architecture의 모듈 경로를 화면 구조로 그대로 두기로 했기
 * 때문이다. 없는 메뉴를 빼면 화면은 깔끔해지지만 전체 그림이 사라진다(선택지 C를 안 고른 이유).
 */

export interface NavItem {
  label: string
  /** 실제 화면의 주소. ready가 false면 이 값은 '언젠가 여기'라는 표시다. */
  href: string
  icon: IconName
  badge?: string
  /** 하위 화면이 더 있는 항목. 지금은 표식만 두고 펼침은 다음 단계다. */
  expandable?: boolean
  /** Phase 1으로 화면이 서 있는가. */
  ready: boolean
  /** 무엇을 기다리고 있나. /coming-soon이 이 문장을 그대로 보여 준다. */
  waitingFor?: string
}

export interface NavGroup {
  title?: string
  items: NavItem[]
}

export const NAV: readonly NavGroup[] = [
  {
    items: [
      { label: '대시보드', href: '/', icon: 'home', ready: true },
      {
        label: '그룹 전체 현황',
        href: '/group',
        icon: 'layers',
        ready: false,
        waitingFor:
          '대시보드(CH-001~019)가 이미 그룹 합계를 보여 줍니다. 이 화면은 회사별 비교와 드릴다운이 붙는 자리라 Phase 2 범위입니다.',
      },
      // CH-041 전자결재. 라벨은 시안 그대로 두고 대상만 실제 화면으로 잇는다 —
      // 그 화면이 곧 대시보드 '내 결정 사항' 패널의 전체 화면 버전이다.
      { label: '내 결정 사항', href: '/approvals', icon: 'check-circle', ready: true },
      {
        label: 'AI 인사이트',
        href: '/ai',
        icon: 'sparkles',
        badge: 'NEW',
        ready: false,
        waitingFor:
          'CH-044 자연어 질의와 CH-045~048 야간 Job의 전체 화면입니다. 지금은 대시보드의 "AI가 밤새 한 일" 패널(CH-019)만 서 있습니다.',
      },
      {
        label: '캘린더',
        href: '/calendar',
        icon: 'calendar',
        ready: false,
        waitingFor: '마감·마일스톤을 달력으로 펴는 화면입니다. Phase 2 범위입니다.',
      },
      { label: '업무 관리', href: '/tasks', icon: 'clipboard', ready: true },
      {
        label: '프로젝트',
        href: '/projects',
        icon: 'folder',
        ready: false,
        waitingFor:
          '프로젝트 목록·단건 화면입니다. DEFERRED D-12(Task·Project 단건 화면이 없다)와 같은 자리입니다.',
      },
      {
        label: '기업 관리 (A,B,C)',
        href: '/businesses',
        icon: 'building',
        expandable: true,
        ready: false,
        waitingFor:
          '회사 하나하나는 대시보드 카드의 "상세 보기"(CH-023~024)로 이미 열립니다. 이 메뉴는 회사 목록·순서·Archive(CH-057)가 붙는 자리입니다.',
      },
    ],
  },
  {
    title: '기능 시스템',
    items: [
      {
        label: '재무 / 회계',
        href: '/finance',
        icon: 'coin',
        ready: false,
        waitingFor: 'CH-052 ECOUNT 연동이 선행되어야 합니다.',
      },
      {
        label: '인사 / 조직',
        href: '/hr',
        icon: 'users',
        ready: false,
        waitingFor: 'Layer 2 기능 시스템입니다. Phase 2 범위입니다.',
      },
      { label: '문서 / 지식', href: '/documents', icon: 'book', ready: true },
      {
        label: '영업 / CRM',
        href: '/crm',
        icon: 'target',
        ready: false,
        waitingFor: 'Layer 2 기능 시스템입니다. Phase 2 범위입니다.',
      },
      {
        label: '구매 / SCM',
        href: '/scm',
        icon: 'cart',
        ready: false,
        waitingFor: 'CH-052 ECOUNT 연동이 선행되어야 합니다.',
      },
      {
        label: '생산 / MES',
        href: '/mes',
        icon: 'factory',
        ready: false,
        waitingFor: 'CH-053 미래소프트 연동이 선행되어야 합니다.',
      },
      {
        label: '연구 / R&D',
        href: '/rnd',
        icon: 'flask',
        ready: false,
        waitingFor: 'Layer 2 기능 시스템입니다. Vault 등급 자료가 섞여 있어 권한 설계가 선행됩니다.',
      },
      {
        label: '자산 / 설비',
        href: '/assets',
        icon: 'server',
        ready: false,
        waitingFor: 'Layer 2 기능 시스템입니다. Phase 2 범위입니다.',
      },
      {
        label: '리스크 / 컴플라이언스',
        href: '/risk',
        icon: 'shield',
        ready: false,
        waitingFor:
          '알림은 대시보드 상단(CH-018)에 이미 뜹니다. 이 화면은 규정·점검 이력이 붙는 자리라 Phase 2 범위입니다.',
      },
    ],
  },
  {
    items: [
      // CH-049. 설정의 하위 화면 중 이것만 먼저 섰다 — 두 번째 사람을 넣는 경로가
      // 없으면 0004_bootstrap_chairman의 "앱에서 초대한다"가 계속 빈말이 된다.
      { label: '사용자 · 권한', href: '/settings/users', icon: 'users', ready: true },
      {
        label: '설정',
        href: '/settings',
        icon: 'settings',
        expandable: true,
        ready: false,
        waitingFor:
          'CH-056 대시보드 개인화(위젯·회사·KPI 표시/숨김/위치 저장)가 붙는 자리입니다. 사용자·권한 관리(CH-049)는 바로 위 메뉴로 먼저 서 있습니다.',
      },
    ],
  },
] as const

/** 사이드바가 실제로 거는 주소. 아직 없는 화면은 404 대신 '준비 중'으로 보낸다(D-14 선택지 B). */
export function navHref(item: NavItem): string {
  return item.ready ? item.href : `/coming-soon?menu=${encodeURIComponent(item.label)}`
}

/** /coming-soon이 ?menu= 로 받은 라벨을 이 목록에서 되찾는다. 없으면 null이다. */
export function findNavItem(label: string): NavItem | null {
  for (const group of NAV) {
    const found = group.items.find((i) => i.label === label)
    if (found) return found
  }
  return null
}

/** '준비 중' 화면이 "지금 쓸 수 있는 건 이것들입니다"로 안내할 목록. */
export function readyItems(): NavItem[] {
  return NAV.flatMap((g) => g.items).filter((i) => i.ready)
}
