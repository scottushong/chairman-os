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
  /**
   * 이 항목의 **안 바뀌는 이름**. 라벨이 아니라 이것으로 저장한다.
   *
   * 사이드바 숨김(Phase 5-E 3절)이 이 값을 키로 쓴다. 라벨로 저장하면 '기업 관리 (A,B,C)'가
   * '회사'로 바뀌는 날 회장이 숨겨 둔 항목이 조용히 되살아난다. 키는 목록이 통째로 갈리는
   * 날에도(곧 올 Phase 7 블록 E) 겹치지 않게 짓는다.
   */
  key: string
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
      { key: 'nav_dashboard', label: '대시보드', href: '/', icon: 'home', ready: true },
      {
        key: 'nav_group', label: '그룹 전체 현황',
        href: '/group',
        icon: 'layers',
        ready: false,
        waitingFor:
          '대시보드(CH-001~019)가 이미 그룹 합계를 보여 줍니다. 이 화면은 회사별 비교와 드릴다운이 붙는 자리라 Phase 2 범위입니다.',
      },
      // CH-041 전자결재. 라벨은 시안 그대로 두고 대상만 실제 화면으로 잇는다 —
      // 그 화면이 곧 대시보드 '내 결정 사항' 패널의 전체 화면 버전이다.
      { key: 'nav_decisions', label: '내 결정 사항', href: '/approvals', icon: 'check-circle', ready: true },
      // Phase 3-A. 야간 브리핑 전문. CH-044 자연어 질의는 아직 없다 — 붙으면 같은 화면에 들어온다.
      { key: 'nav_morning', label: '아침 루틴', href: '/ai', icon: 'sparkles', badge: 'NEW', ready: true },
      { key: 'nav_calendar', label: '캘린더', href: '/calendar', icon: 'calendar', ready: true },
      { key: 'nav_tasks', label: '업무 관리', href: '/tasks', icon: 'clipboard', ready: true },
      // Phase 4-A. 회사 다섯 곳 밖에서 회장이 직접 굴리는 건(딜·신사업·투자유치 등).
      { key: 'nav_initiatives', label: '이니셔티브', href: '/initiatives', icon: 'target', ready: true },
      {
        key: 'nav_projects', label: '프로젝트',
        href: '/projects',
        icon: 'folder',
        ready: false,
        waitingFor:
          '프로젝트 목록입니다. 단건 화면(/projects/[id])은 D-12로 이미 섰습니다 — ' +
          '업무 상세나 검색 결과에서 열립니다. 남은 것은 전사 프로젝트를 한 판에 보는 목록입니다.',
      },
      {
        key: 'nav_businesses', label: '기업 관리 (A,B,C)',
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
        // Phase 2-A/2-B. 그룹 재무와 회사별 재무(/finance/[business_id] · /journal · /accounts). 원천은 자체 장부.
        key: 'nav_finance', label: '재무 / 회계',
        href: '/finance',
        icon: 'coin',
        ready: true,
      },
      {
        key: 'nav_hr', label: '인사 / 조직',
        href: '/hr',
        icon: 'users',
        ready: false,
        waitingFor: 'Layer 2 기능 시스템입니다. Phase 2 범위입니다.',
      },
      { key: 'nav_documents', label: '문서 / 지식', href: '/documents', icon: 'book', ready: true },
      // Phase 6-1 블록 C-2. 문서·업무·프로젝트에 걸쳐 '나에게 지금 무엇이 열려 있나'를
      // 한 화면에서 답한다. 셋에 흩어 두면 그 질문에 아무 데서도 답할 수 없다.
      { key: 'nav_shared', label: '공유받은 것', href: '/shared', icon: 'eye', ready: true },
      {
        key: 'nav_crm', label: '영업 / CRM',
        href: '/crm',
        icon: 'target',
        ready: false,
        waitingFor: 'Layer 2 기능 시스템입니다. Phase 2 범위입니다.',
      },
      {
        key: 'nav_scm', label: '구매 / SCM',
        href: '/scm',
        icon: 'cart',
        ready: false,
        waitingFor: 'CH-052 DY ECOUNT 엑셀 업로드가 선행되어야 합니다.',
      },
      {
        key: 'nav_mes', label: '생산 / MES',
        href: '/mes',
        icon: 'factory',
        ready: false,
        waitingFor: 'CH-053 미래소프트 연동이 선행되어야 합니다.',
      },
      {
        key: 'nav_rnd', label: '연구 / R&D',
        href: '/rnd',
        icon: 'flask',
        ready: false,
        waitingFor: 'Layer 2 기능 시스템입니다. Vault 등급 자료가 섞여 있어 권한 설계가 선행됩니다.',
      },
      {
        key: 'nav_assets', label: '자산 / 설비',
        href: '/assets',
        icon: 'server',
        ready: false,
        waitingFor: 'Layer 2 기능 시스템입니다. Phase 2 범위입니다.',
      },
      {
        key: 'nav_risk', label: '리스크 / 컴플라이언스',
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
      { key: 'nav_users', label: '사용자 · 권한', href: '/settings/users', icon: 'users', ready: true },
      // Phase 3-B. 장기 프로젝트·선언문 입력. Chairman이 아니면 404다(화면이 안내, 0014 RLS가 판정).
      { key: 'nav_chairman', label: '회장 루틴', href: '/settings/chairman', icon: 'crown', ready: true },
      {
        key: 'nav_settings', label: '설정',
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

/**
 * 하단 시스템 바(Layer 2 바로가기)의 여덟 칸. NAV와 **같은 타입이되 같은 목록이 아니다** —
 * 사이드바는 이 앱의 화면 목록이고 이쪽은 '사내 다른 시스템으로 넘어가는 문'이다.
 * 섞으면 사이드바에 ERP·MES가 뜨고, /coming-soon의 '지금 쓸 수 있는 화면' 목록도 흐려진다.
 *
 * Phase 5-E 1절 전까지 이 여덟 칸은 onClick도 href도 없는 `<button>`이었다. 여덟 개가
 * 한 줄로 서서 전부 아무 일도 안 했다 — 이 저장소에서 가장 큰 죽은 버튼 덩어리였다.
 * 지금은 /coming-soon으로 간다. 주소가 생기는 날 href만 바꾸면 되고, 그때까지는
 * 화면이 "아직 연결 안 됐다"고 스스로 말한다.
 */
export const SYSTEM_LINKS: readonly NavItem[] = [
  {
    key: 'sys_erp', label: 'ERP', href: '/erp', icon: 'grid', ready: false,
    waitingFor: 'DY는 ECOUNT를 씁니다. CH-052 엑셀 업로드가 먼저 서고, 그 뒤에 이 자리가 사내 ERP 주소로 연결됩니다.',
  },
  {
    key: 'sys_mes', label: 'MES', href: '/mes-link', icon: 'cpu', ready: false,
    waitingFor: 'CH-053 미래소프트 연동이 선행되어야 합니다.',
  },
  {
    key: 'sys_groupware', label: '그룹웨어', href: '/groupware', icon: 'layers', ready: false,
    waitingFor: '사내 그룹웨어 주소와 SSO 방식이 정해지면 이 칸이 그리로 넘어갑니다.',
  },
  {
    key: 'sys_eapproval', label: '전자결재', href: '/approvals', icon: 'stamp', ready: true,
  },
  {
    key: 'sys_docs', label: '문서관리', href: '/documents', icon: 'file-text', ready: true,
  },
  {
    key: 'sys_mail', label: '메일', href: '/mail', icon: 'mail', ready: false,
    waitingFor: '사내 메일 주소가 정해지면 이 칸이 그리로 넘어갑니다.',
  },
  {
    key: 'sys_meet', label: '화상회의', href: '/meet', icon: 'video', ready: false,
    waitingFor: '화상회의 도구가 정해지면 이 칸이 그리로 넘어갑니다.',
  },
  {
    key: 'sys_chat', label: '커뮤니케이션', href: '/chat', icon: 'message', ready: false,
    waitingFor: '사내 메신저가 정해지면 이 칸이 그리로 넘어갑니다.',
  },
] as const

/** 사이드바가 실제로 거는 주소. 아직 없는 화면은 404 대신 '준비 중'으로 보낸다(D-14 선택지 B). */
export function navHref(item: NavItem): string {
  return item.ready ? item.href : `/coming-soon?menu=${encodeURIComponent(item.label)}`
}

/**
 * /coming-soon이 ?menu= 로 받은 라벨을 되찾는다. 없으면 null이다.
 * 시스템 바의 여덟 칸도 같이 본다 — 그쪽에서 눌러 온 사람에게 '사이드바에 없는 메뉴입니다'라고
 * 답하면, 방금 누른 것이 버젓이 화면 아래에 있는데 없다고 말하는 꼴이 된다.
 */
export function findNavItem(label: string): NavItem | null {
  for (const group of NAV) {
    const found = group.items.find((i) => i.label === label)
    if (found) return found
  }
  return SYSTEM_LINKS.find((i) => i.label === label) ?? null
}

/** '준비 중' 화면이 "지금 쓸 수 있는 건 이것들입니다"로 안내할 목록. */
export function readyItems(): NavItem[] {
  return NAV.flatMap((g) => g.items).filter((i) => i.ready)
}
