import type { FinanceBriefContext } from '@/lib/ledger/brief-context'
import type {
  AiBriefItem,
  AttentionLevel,
  BusinessStatus,
  ChairmanCondition,
  IsoDate,
  ProjectNote,
} from '@/types'

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

/**
 * 블록 B-2. 브리핑 맨 위에 서는 주의 한 줄. **고르는 것도 순서도 코드가 정한다** —
 * 모델에 맡기면 «맨 위»가 매일 달라지고, 그러면 그것은 맨 위가 아니다.
 * 모델에게는 요약이 이 목록과 어긋나지 않게 하려고 같이 넘긴다.
 */
export interface AttentionBriefLine {
  business_name: string
  rule_name: string
  /** RED=회장 결정 · YELLOW=회장 인지 · GREEN=CEO 처리(§19). **모델이 이것을 바꾸지 않는다.** */
  level: AttentionLevel
  /** 잰 값과 임계를 사람이 읽는 한 줄. 수동 규칙이면 null(잰 값이 없다). */
  measured: string | null
  chairman_action_required: boolean
}

export interface DailyBriefInput {
  date: IsoDate
  companies: { business_id: string; name: string; brief: AiBrief }[]
  /**
   * 열려 있는 주의 가운데 급한 것부터 최대 다섯(원문: "기존 브리핑은 attention 3~5건을
   * 맨 위에"). **비어 있으면 주의를 아예 언급하지 않는다** — 없는 것을 채우지 않는다.
   */
  attentions: AttentionBriefLine[]
  /** 요약에 실패한 회사. 그룹 브리핑이 '다섯 곳 다 괜찮다'고 말하지 않게 같이 넘긴다. */
  failed: { business_id: string; name: string }[]
  /** 읽지 못했으면 null. 그때 모델은 project_notes를 비운다. */
  chairman: ChairmanContext | null
  /** 그룹 단순 합산의 재무 해석. 회사 요약을 묶을 때 그룹 Runway·공통 원가 드라이버의 근거다. 없으면 null */
  finance: FinanceBriefContext | null
}

/**
 * 예외 하나치. §18의 세 번째 화살표(`Rule Engine → AI Analysis`)가 받는 입력이다.
 *
 * **등급(severity)을 넘기지 않는다.** 모델이 판정에 대해 의견을 낼 입력을 애초에 주지
 * 않는 것이 「AI는 결정하지 않는다」를 코드로 지키는 가장 싼 방법이다(§19). 프롬프트가
 * 금지하는 것과 입력에 아예 없는 것은 다르다 — 앞의 것은 문장이고 뒤의 것은 구조다.
 */
export interface ExceptionContext {
  date: IsoDate
  business: { business_id: string; name: string }
  rule: {
    rule_key: string
    /** 한국어 규칙 이름. 화면이 그리는 그 글자다. */
    name: string
    comparator: string
    threshold: number
    window_days: number | null
    /** `value`가 무엇인지 한 줄. 단위가 규칙마다 달라서(%·%p·개월) 같이 넘긴다. */
    value_means: string
  }
  measured: { period: string; value: number }
  /** 원인 분해의 재료. CompanyContext와 같은 모양·같은 억 단위 문자열이다. */
  kpis: CompanyContext['kpis']
  /** 원장에서 온 재무 해석. 못 읽었으면 null — 그때 모델은 재무 해석을 지어내지 않는다. */
  finance: FinanceBriefContext | null
}

/**
 * 원문이 지시한 **셋이고 그 이상이 아니다** — 원인 분해 · CEO 대응 여부 · 권고 "관찰 N일".
 *
 * **`status`·`severity`·`chairman_action_required`가 이 모양에 없다.** DB의 restrictive
 * 정책 둘이 이미 막고 있지만, 42501로 거절되는 것에 기대면 그 거절이 언제 어디서
 * 삼켜지는지에 안전이 걸린다. 모델이 그 값을 돌려줄 칸 자체를 두지 않는다.
 */
export interface ExceptionAnalysis {
  /** 원인 분해. 입력에 있는 수치로만 쓴다. */
  cause: string
  /** CEO가 이미 대응 중인지에 대한 **서술**. 판정이 아니다 — 표의 ceo_handling 칸은 코드가 넣는다. */
  ceo_response: string
  /** 권고 "관찰 N일"의 N. 이 값이 monitor_until을 정하지 않는다 — 그것은 회장의 일이다. */
  monitor_days: number
}

export interface AiAdapter {
  /** 어느 모델이 썼는지. ai_night_outputs.model 에 남는다. */
  readonly model: string
  summarizeCompany(input: CompanyContext): Promise<AiBrief>
  generateDailyBrief(input: DailyBriefInput): Promise<AiBrief>
  /**
   * §18 · 블록 B-2. 예외 하나의 분석. **분석이지 결정이 아니다.**
   * 실패하면 던진다 — 호출자가 `ai_analysis = null`로 두고 예외는 그대로 만든다.
   * 분석이 없다고 감지를 버리지 않는다(규칙이 먼저고 AI는 그 위에 얹히는 층이다).
   */
  analyzeException(input: ExceptionContext): Promise<ExceptionAnalysis>
}
