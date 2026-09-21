import type { FinanceBriefContext } from '@/lib/ledger/brief-context'
import type { AiBriefItem, BusinessStatus, ChairmanCondition, IsoDate, ProjectNote } from '@/types'

/**
 * AI Adapter — 야간 Job과 모델 사이의 유일한 계약(Port).
 *
 * repository와 같은 이유로 인터페이스를 먼저 둔다. Job은 뒤에 어느 회사의 어느 모델이 있는지
 * 알 필요가 없고, 테스트나 모델 교체 때 이 두 함수만 맞추면 된다.
 *
 * 입력은 이미 RLS를 통과해 읽힌 값이다. 어댑터가 DB를 직접 읽지 않는다 —
 * 읽는 자리가 둘이 되면 Agent가 무엇을 볼 수 있는지 판정하는 자리도 둘이 된다.
 */

/** 모델 출력의 모양. Structured Outputs로 강제하고 brief-schema.ts가 한 번 더 검사한다. */
export interface AiBrief {
  summary: string
  /** 0~1. 모델이 스스로 매긴 값이다 — 0.7 미만은 화면이 흐리게 그린다(ai-night-panel). */
  confidence: number
  items: AiBriefItem[]
  /** 그룹 브리핑에만 있다(daily-brief.md). 장기 프로젝트마다 이번 주 행동 하나. */
  project_notes?: ProjectNote[]
}

/** 회사 하나의 하루치 상태. 금액은 lib/format.ts로 억 단위 문자열까지 만들어 넘긴다. */
export interface CompanyContext {
  date: IsoDate
  business: { business_id: string; name: string; industry: string; status: BusinessStatus }
  kpis: { metric: string; period: string; value: string; target: string | null }[]
  decisions: { decision_id: string; title: string; impact: string; deadline: string; status: string }[]
  alerts: { alert_id: string; category: string; severity: string; status: string; message: string }[]
  tasks: {
    task_id: string
    title: string
    status: string
    priority: string
    deadline: string | null
    blocked_since: string
    chairman_needed: boolean
  }[]
  projects: { project_id: string; name: string; status: string; progress_pct: number; deadline: string | null }[]
  /**
   * Phase 2-A 원장에서 만든 재무 해석(원가 드라이버 · 잠정-확정 차이 · Runway).
   * 원장을 못 읽었으면(0015 적용 전, 권한 부족) null — 모델은 그때 재무 해석을 지어내지 않는다.
   */
  finance: FinanceBriefContext | null
}

/**
 * 회장 루틴(0014). 그룹 브리핑이 우선순위를 매기는 기준이다 — 요약·인용 대상이 아니다.
 * D-day·경과율은 저장값이 없어 Job이 run_date 기준으로 계산해 넣는다.
 */
export interface ChairmanContext {
  projects: {
    title: string
    start_date: IsoDate
    target_date: IsoDate
    /** 'D-780' */
    d_day: string
    elapsed_days: number
    total_days: number
    progress_pct: number
    note: string
    this_month_action: string
  }[]
  /**
   * 진행 중인 이니셔티브. d_day와 stale_days는 오늘 기준으로 이미 계산된 값이다.
   * 회장 메모(initiative_notes)는 넘기지 않는다 — AIAgent는 그것을 읽지 못한다(0017).
   */
  initiatives: {
    initiative_id: string
    title: string
    kind: string
    stage: string
    business_id: string | null
    next_action: string
    next_action_date: IsoDate | null
    /** 'D-3' / 'D+2'. next_action_date가 없으면 null */
    d_day: string | null
    stale_days: number
    blocker: string
  }[]
  /** 선언문 전문. 아직 안 썼으면 null */
  manifesto: string | null
  /**
   * 0023 chairman_recent_condition()이 준 값. condition 하나와 그것이 **어느 날** 값인가.
   * as_of가 오늘이 아니면 회장이 아직 아침 체크인을 하기 전이라는 뜻이다 —
   * 야간 Job이 07:00 KST로 옮겨 간 뒤로는 그쪽이 기본이다.
   */
  checkin: { condition: ChairmanCondition; as_of: IsoDate } | null
  /**
   * 블록 7. 이번 주 접속 기록의 **한 줄 요약**. 읽지 못했으면 null.
   *
   * **요약이지 명단이 아니다.** 누가 무엇을 언제 봤는지는 이 줄에 없고, 브리핑에도
   * 들어가지 않는다. 0031의 activity_digest는 숫자 넷(주 시작·건수·문서 열람·사람 수)뿐인
   * 표이고, 야간 Job은 audit_log의 개별 줄을 **읽을 수 없다**(FORCE RLS). 그것이
   * 이 칸이 문자열 하나인 이유다 — 모델에게 더 줄 것이 없어서가 아니라 주면 안 돼서다.
   *
   * 이상 징후 건수는 여기 없다. 그 판정은 사람마다의 30일 기준선을 가로질러 봐야 하는데,
   * 그 가로지르기는 회장 세션에서만 가능하다(/settings/activity). 야간 Job에게 그 문을
   * 열어 주는 것이 이 기능이 막으려는 일 그 자체다.
   */
  activity: string | null
}

export interface DailyBriefInput {
  date: IsoDate
  companies: { business_id: string; name: string; brief: AiBrief }[]
  /** 요약에 실패한 회사. 그룹 브리핑이 '다섯 곳 다 괜찮다'고 말하지 않게 같이 넘긴다. */
  failed: { business_id: string; name: string }[]
  /** 읽지 못했으면 null. 그때 모델은 project_notes를 비운다. */
  chairman: ChairmanContext | null
  /** 그룹 단순 합산의 재무 해석. 회사 요약을 묶을 때 그룹 Runway·공통 원가 드라이버의 근거다. 없으면 null */
  finance: FinanceBriefContext | null
}

export interface AiAdapter {
  /** 어느 모델이 썼는지. ai_night_outputs.model 에 남는다. */
  readonly model: string
  summarizeCompany(input: CompanyContext): Promise<AiBrief>
  generateDailyBrief(input: DailyBriefInput): Promise<AiBrief>
}
