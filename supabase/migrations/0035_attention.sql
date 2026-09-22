-- =====================================================================
-- Chairman OS — 0035_attention (Phase 7 블록 B-1 · 주의)
-- 바인딩 권위: docs/chairman-architecture-v1.md §18 · §19 (§4 · §5는 화면 쪽)
-- 블록 지시 원문: docs/superpowers/specs/2026-09-20-incoming.md `B. ATTENTION 엔진`
-- 작성: 2026-09-22
--
-- 이 파일이 답하려는 질문은 하나다: **"오늘 회장이 어디를 볼 것인가."**
-- §19가 그 경계를 한 줄로 못 박았다 — *"AI가 CEO를 대신하지 않는다. AI는 Chairman에게
-- «어디를 볼 것인가»를 알려준다."* 그래서 이 파일의 절반은 '무엇을 재는가'를 정하는
-- 것이고, 나머지 절반은 **'재지 못한 것을 재지 못했다고 말할 칸을 두는 것'**이다.
--
-- ■ 이 파일은 표와 시드와 RLS까지다 ■
--   규칙 평가 엔진과 야간 Job 단계(B-2) · 화면(B-3) · `check:attention`(B-4)은 뒤따르는
--   별개 작업이다. 여기서 짓지 않고, 짓는 척하는 빈 껍데기도 두지 않는다 — 점수를
--   계산하는 문장이 이 파일에 하나도 없는 것이 그 경계다(6절).
--
-- ■ B-2가 제자리에서 고친 것 — `exceptions.period`와 중복 방지 유니크 ■
--   이 파일은 **아직 staging에 적용되지 않았다.** 그래서 앞으로 나아가는 대신 제자리에서
--   고쳤다(0001~0034는 한 글자도 건드리지 않았다). 더한 것은 칸 하나와 제약 둘이고,
--   이유는 «앱에서만 막으면 두 틱이 겹치는 날 뚫린다»다 — 4절의 긴 주석에 적었다.
--   B-2가 이 파일에서 한 일은 그것이 전부다. 점수를 계산하는 문장은 여전히 없다.
--
-- ■ 가장 위험한 자리 — AI가 축을 지어내는 것 ■
--   §19의 축은 여섯인데(재무 영향·전략 영향·긴급도·확률·CEO 해결 능력·자본 필요)
--   이 저장소에 그 여섯을 **재어 줄 원천이 다 있지는 않다.** 수치가 있는 것은
--   `finance_kpis`(0001:102)뿐이고 그 어휘는 여덟이다. 그래서 축마다 «출처» 칸을 두고,
--   출처가 없는 축은 null로 남기고, **몇 개가 비었는지를 행이 스스로 말한다**(6절).
--   0033이 `decided_by_kind`가 닿지 않은 행을 null로 두고 `unknown_count`로 따로 낸 것과
--   같은 규율이다. AI가 축을 지어내서 RED를 만들면 **회장이 없는 근거로 회사를 흔들게 된다.**
--
-- ■ 하지 않는 것 ■
--   * **`alerts`(0001:275)를 건드리지 않는다.** 겹쳐 보이지만 그 표에는 **생산자가 없다** —
--     0003 시드가 넣은 행이 전부고 앱에서 insert하는 코드가 없다(`supabase.ts:1272`는 읽기뿐).
--     대체가 아니라 빈 자리를 처음 채우는 일이다. 둘을 합치는 것은 블록 E가 HOME을 다시
--     지을 때 정한다 — 지금 합치면 쓰이는 표와 안 쓰이는 표를 같이 옮기는 일이 된다.
--   * **`severity` enum(Info/Warning/Critical)을 재사용하지 않는다.** RED/YELLOW/GREEN은
--     '얼마나 나쁜가'가 아니라 **'누가 손대는가'**다(§19). 같은 낱말이 두 뜻을 갖는 순간이
--     이 저장소가 반복해서 피해 온 '두 벌'이고, 새 enum 이름에 그 차이를 넣었다(1절).
--   * **판정을 새로 «만들지» 않는다 — 있는 것을 조합한다.** 회장 액션은 `can_approve()`,
--     회사 판정은 `has_business()`, 등급 판정은 `can_read_restricted()`다 — 셋 다 0002에
--     있다. 새로 짓는 함수는 쓰기 문 **둘**(`can_write_attention` · `can_score_attention`,
--     7절)뿐이고, 둘 다 그 기존 함수들을 합치는 껍데기이며 뒤의 것은 앞의 것을 부른다
--     (역할 목록이 두 벌이 되지 않게).
--     읽기는 그 회사 안에서 **갈래가 둘**이다:
--       `has_business(target)` **and** ( `can_read_restricted()` **or** «그 표에 쓰는 사람» )
--     앞 갈래가 등급을 지킨다 — `exceptions.value`에 들어오는 숫자가 `finance_kpis`가
--     잠가 둔 바로 그 숫자다(7절에 길게 적었다). 뒤 갈래가 없으면 **야간 Job이 자기가
--     방금 넣은 줄을 못 읽어** 점수를 붙일 id를 알 수 없다(7절 `exceptions_read` 주석).
--     그래서 읽기가 `can_read_restricted()`를 **언제나** 요구하지는 않는다.
--   * **예외 행을 한 건도 시드로 넣지 않는다.** 예외는 규칙이 실제로 걸려야 생기는 것이고,
--     시드로 넣으면 화면이 첫날부터 **있지도 않은 위험을 빨갛게 그린다.** 회장이 그 빨강을
--     한 번 열어 보고 아무것도 없는 것을 확인하면, 그 뒤로 진짜 빨강도 안 열어 본다.
--   * **`force row level security`를 새로 걸지 않는다.** 이 저장소가 네 번 밟은 함정이다
--     (0023 · 0027 · 0029 · 0034). 자물쇠는 **revoke**다(0023 3절 ①) — Supabase는 public
--     스키마의 새 표를 만들자마자 anon/authenticated에게 여므로 걷고 필요한 것만 다시 준다.
--   * **`audit_log_read`를 넓히지 않는다. `service_role`은 없다**(CLAUDE.md).
--     `current_date`도 없다 — 달·날짜 경계는 `at time zone 'Asia/Seoul'`이다(0019 3절).
--   * **0001~0034를 한 글자도 고치지 않는다.** 0034는 이미 staging에 적용됐다. 고칠 것은
--     **앞으로 나아가며** 고친다(0024:19~23 · 0027 · 0029가 같은 자리에서 같은 판단을 했다).
--     8절이 0034의 트리거 함수를 `create or replace`로 다시 쓴다.
--
-- ■ 이 파일이 §7 지표를 움직인다 — 고장이 아니다 ■
--   회장이 예외를 처리하면 `audit_log`에 승인·반려·수정·위임·**관찰** 한 줄이 남고,
--   0034의 트리거가 그것을 `intervention_counts`에 센다. 즉 **블록 B가 출시되는 날
--   §7의 개입 수가 눈에 보이게 뛴다.** 0034의 뷰를 그대로 두는 것이 이 파일의 판단이다 —
--   예외 처리는 회장이 그 건을 **손댄** 것이고, 빼면 개입이 실제보다 적어 보인다.
--   **그 점프는 사실이지 고장이 아니다.** DEFERRED에 같은 문장을 적어 둔다(다음 사람이
--   지표가 깨졌다고 오해하는 것을 막는 유일한 장치가 그 글이다).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. 어휘 둘
--
--    ① `attention_level` — RED/YELLOW/GREEN. **`severity`와 다른 축이다.**
--       §19: RED = Chairman decision · YELLOW = Chairman awareness · GREEN = CEO handles.
--       세 값이 답하는 것은 '얼마나 나쁜가'가 아니라 **'누가 손대는가'**다. 0001의
--       `severity`(Info/Warning/Critical)를 재사용하면 한 낱말이 두 뜻을 갖고, 그 뒤로는
--       어느 화면이 어느 뜻으로 쓰는지 읽는 사람이 매번 추측해야 한다.
--       enum으로 두는 이유: 이 셋은 **문서가 준 고정 목록**이다(§19 OUTPUT 세 줄).
--       규칙의 비교자(3절)를 text + check로 둔 것과 반대인 자리이고, 그 차이는 '문서가
--       못 박았는가'다. 이 트랜잭션 안에서 새로 만든 타입이므로 리터럴로 써도 55P04가
--       나지 않는다(그 함정은 `alter type ... add value` 쪽이다 — 아래 ②).
--
--    ② `audit_action`에 `monitor`를 더한다 (0013 · 0015 · 0023의 관례).
--       회장의 «관찰 N일»이 감사 기록에 남을 이름이 없었다. 원문이 회장 액션 셋을
--       "승인 / 관찰 14일 / CEO에게 위임"으로 적었고, 앞뒤 둘은 0001에 이미 있다.
--       `modify`로 접지 않은 이유: 관찰은 그 건을 **고치는 것이 아니라 그대로 두기로
--       정하는 것**이다. 그 둘을 한 낱말로 세면 §7의 유형별 집계에서 '회장이 무엇을
--       했는가'가 사라진다.
--       **같은 트랜잭션에서 이 새 리터럴을 쓸 수 없다(55P04 — 0022가 production에서
--       밟았다).** 그래서 8절의 비교는 전부 `action::text`다(0022 · 0023 · 0024와 같은 모양).
--       이 파일 안에 `'monitor'::audit_action`은 한 번도 등장하지 않는다.
-- ---------------------------------------------------------------------
create type attention_level as enum ('RED', 'YELLOW', 'GREEN');

comment on type attention_level is
  '§19 ATTENTION SCORE의 출력 셋. RED=회장 결정 · YELLOW=회장 인지 · GREEN=CEO 처리. **0001의 severity(Info/Warning/Critical)와 다른 축이다** — severity는 얼마나 나쁜가이고 이것은 누가 손대는가다.';

alter type audit_action add value if not exists 'monitor';

-- ---------------------------------------------------------------------
-- 2. exception_rules — 규칙 사전 (§18 TRIGGER EXAMPLES 13개)
--
--    원문이 못 박은 칸: rule_key · name · scope · metric · comparator · threshold ·
--    window_days · severity_base · enabled. 여기에 둘을 더했다.
--
--    ■ `kind` (metric / manual) — 더한 이유 ■
--      §18의 13개 중 이 저장소가 수치로 잴 수 있는 것은 셋뿐이다. `finance_kpis`(0001:102)의
--      `finance_metric` 어휘가 여덟(Revenue · Cost · EBITDA · Cash · AR · AP ·
--      OperatingProfit · NetIncome)이고, 부채 약정·거래처 이탈·생산 중단·품질·이직률·
--      법적·부정·보안에는 **원천이 없다.** 원문이 이미 답을 줬다 — "수치 없는 것은
--      **수동 플래그 규칙**으로".
--      이 칸이 없으면 `metric`·`comparator`·`threshold`가 null인 행이 '설정이 덜 된 규칙'
--      인지 '원래 수동인 규칙'인지 **구분되지 않는다.** 그 구분이 없으면 /attention/rules가
--      열 개의 규칙 옆에 빈 칸을 그려 놓고 회장에게 채우라고 말하게 된다.
--
--    ■ `sort_order` — 더한 이유 ■
--      원문의 13개는 순서가 있는 목록이다(§18이 적은 그 순서). insert 순서에 기대면
--      select가 그 순서를 돌려준다는 보장이 없고, 화면이 이름순으로 그리면 문서와
--      대조가 안 된다. 0033의 `dependency_areas.sort_order`와 같은 자리다.
--      **default가 0이 아니라 999인 이유**: 0이면 나중에 값을 안 주고 넣은 규칙이
--      §18의 1번 **앞**에 선다. '아직 자리를 안 정했다'가 '제일 먼저'라는 값으로
--      채워지는 것이고, 이 파일이 여러 문단에 걸쳐 막는 것이 바로 그 모양이다.
--      999면 자리를 안 정한 규칙은 목록 끝에 붙고, 회장이 /attention/rules에서 옮긴다.
--      버린 선택지: default 없이 not null — 시드가 값을 다 주므로 오늘은 같지만,
--      B-2가 규칙을 하나 넣을 때마다 순서를 강제로 정하게 만든다.
--
--    ■ 네 칸이 nullable인 것이 이 표의 요점이다 ■
--      `metric` · `comparator` · `threshold` · `window_days`. `manual` 규칙에는 그 칸들이
--      **없는 것**이지 0인 것이 아니다. `not null default`를 걸면 없는 사실이 0이라는
--      **값으로** 채워지고, 0은 그럴듯해서 아무도 의심하지 않는다(0033이
--      `dependency_areas.level`에서 내린 것과 같은 판단).
--      check 제약이 그 둘을 묶는다: `metric`이면 셋이 전부 있어야 하고, `manual`이면
--      네 칸이 전부 null이어야 한다. `window_days`를 `metric` 쪽에서 요구하지 않은 이유:
--      창이 필요 없는 수치 규칙(어느 시점의 값 하나로 판정하는 것)이 있을 수 있고,
--      그것을 미리 금지하면 B-2가 마이그레이션을 들고 와야 한다.
--
--    ■ `comparator`는 enum이 아니라 check가 걸린 text다 ■
--      enum을 만들면 B-2가 비교자를 하나 더 쓰고 싶은 날 마이그레이션이 필요해지고,
--      그 마이그레이션은 55P04를 안고 온다(0022). 1절 ①의 `attention_level`과 반대로
--      가른 기준은 '문서가 못 박았는가'다 — RED/YELLOW/GREEN은 문서의 셋이고,
--      비교자 목록은 이 저장소가 스스로 고른 다섯이다.
--
--    ■ `threshold`의 단위는 규칙마다 다르다 ■ %(매출 변동) · %p(마진 하락) · 개월(런웨이).
--      단위 칸을 두지 않았다. 규칙 13개가 고정 사전이라 단위는 규칙 하나에 붙은 사실이고,
--      화면은 규칙 이름과 같이 그린다. **대가**: /attention/rules에서 회장이 '20'을 고칠 때
--      그것이 %인지 개월인지를 표가 말해 주지 않는다 — B-3이 화면을 세울 때 그 라벨이
--      필요하면 칸을 하나 더 두는 것이 낫고, 그 판단은 B-3에 남긴다(DEFERRED에 적었다).
-- ---------------------------------------------------------------------
create table exception_rules (
  rule_key      text primary key,                    -- [일반] 안정된 영문 소문자 스네이크. 화면·코드·시드가 같은 글자를 쓴다
  name          text not null,                       -- [일반] 한국어. 화면이 그대로 그린다
  scope         text not null default 'company',     -- [일반] company/group
  kind          text not null,                       -- [일반] metric(수치 자동)/manual(사람이 플래그)
  metric        finance_metric,                      -- [일반] manual이면 null. finance_kpis의 어휘 여덟
  comparator    text,                                -- [일반] >·<·>=·<=·abs>. manual이면 null
  threshold     numeric,                             -- [일반] manual이면 null. 단위는 규칙마다 다르다(위 주석)
  window_days   integer,                             -- [일반] 재는 창. manual이면 null
  severity_base attention_level not null,            -- [일반] exceptions.severity의 첫 값이 된다(§19)
  enabled       boolean not null default true,       -- [일반]
  sort_order    integer not null default 999,        -- [일반] §18 목록 순서. default가 999인 이유는 아래
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint exception_rules_scope_check
    check (scope in ('company', 'group')),
  constraint exception_rules_kind_check
    check (kind in ('metric', 'manual')),
  constraint exception_rules_comparator_check
    check (comparator is null or comparator in ('>', '<', '>=', '<=', 'abs>')),
  constraint exception_rules_window_check
    check (window_days is null or window_days > 0),
  -- 수치 규칙과 수동 규칙을 이 한 줄이 가른다. 없는 것을 0으로 채우는 길을 막는다.
  constraint exception_rules_kind_shape_check check (
    (kind = 'metric' and metric is not null and comparator is not null and threshold is not null)
    or
    (kind = 'manual' and metric is null and comparator is null and threshold is null
                     and window_days is null)
  )
);

comment on table exception_rules is
  '§18 EXCEPTION MANAGEMENT ENGINE의 규칙 사전. 시드 13종은 §18의 TRIGGER EXAMPLES 그대로이고 순서까지 같다. **kind가 metric인 셋만 수치로 자동 판정된다** — 나머지 열은 원문대로 수동 플래그이고, 그 열에는 metric·comparator·threshold·window_days가 없다(0이 아니라 없다). 임계값은 /attention/rules에서 회장이 고친다.';
comment on column exception_rules.kind is
  'metric(수치 자동 판정) / manual(사람이 플래그를 세운다). **이 칸이 없으면 임계가 빈 행이 «설정이 덜 된 규칙»인지 «원래 수동인 규칙»인지 구분되지 않는다.**';
comment on column exception_rules.threshold is
  '임계값. **단위는 규칙마다 다르다** — %(매출 변동) · %p(EBITDA 마진 하락) · 개월(현금 런웨이). manual 규칙에는 이 칸이 없다(null). 값은 /attention/rules에서 회장이 고친다.';
comment on column exception_rules.severity_base is
  '이 규칙이 걸렸을 때 **exceptions.severity의 첫 값**이 되는 등급(§19). 순서는 하나뿐이다: severity_base → exceptions.severity(지금 등급) ← attention_scores.level(축이 나온 뒤 B-2가 갱신한다). 이 칸은 «축이 아직 없을 때의 출발점»이고, 이 칸 자체는 예외가 생긴 뒤로는 그 예외의 등급을 더 이상 따라가지 않는다 — 회장이 /attention/rules에서 이것을 고쳐도 이미 생긴 예외의 색은 바뀌지 않는다.';
comment on column exception_rules.scope is
  'company/group. 시드 13종은 전부 company다 — §18의 13개가 모두 회사 하나에서 걸리는 것이라, group 규칙(예: 그룹 현금 총액)은 칸만 두고 시드에는 없다. 없는 규칙을 미리 넣지 않는다.';

create trigger exception_rules_updated_at before update on exception_rules
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 3. 규칙 13종 시드 — §18의 목록 순서 그대로
--
--    ■ 임계값은 문서에 없다. 그래서 어느 숫자가 어디서 왔는지 여기 적는다 ■
--      §18은 "> threshold"라고만 쓰고 구체값을 주지 않는다. 원문이 그 자리를 미리
--      정리해 뒀다 — **"규칙 임계값은 /attention/rules에서 회장 편집"**. 즉 이 시드는
--      최종값이 아니라 **회장이 처음 보게 되는 출발점**이고, 아래 셋 중 하나는 문서값이고
--      둘은 내 판단이다. 판단은 판단이라고 적는다.
--
--      ① revenue_variance  threshold 20 · window 30일 · abs> · YELLOW   ← **판단**
--         한 달 매출이 ±20% 흔들리면 그것은 계절성이 아니라 사건이다. `abs>`인 이유:
--         **오르는 것도 예외다** — 한 달에 40% 늘면 다음 달 재고와 현금이 따라 흔들린다.
--         YELLOW에서 시작한다(회장 인지). 회장이 결정할 것이 아직 없다.
--      ② ebitda_margin_drop  threshold -5 · window 90일 · <= · YELLOW    ← **판단**
--         `value`는 «직전 창 대비 마진 변화(%p)»다. 임계가 음수이고 비교자가 `<=`인 이유:
--         마진이 **오르는** 것은 예외가 아니다. `abs>`로 두면 좋아진 분기에도 회장을 부른다.
--         90일은 분기다 — 한 달만 보면 대금 결제가 몰린 달이 곧 마진 붕괴로 보인다.
--      ③ cash_runway  threshold 6 · window 90일 · < · RED
--         **6은 문서값이다.** 원문이 "현금<임계(**Runway<6개월**)"이라고 명시했다.
--         `value`는 개월 수다. window 90일과 RED는 **판단**이다 — 월평균 소진을 재는 창이
--         한 달이면 결제가 몰린 달이 곧 위기로 보이고, 런웨이 6개월 미만은 회장이 자본을
--         움직여야 하는 일이라 §19의 RED(Chairman decision)에 해당한다.
--
--    ■ 수동 열 개에는 임계가 아예 없다 ■ metric·comparator·threshold·window_days가 전부
--      null이다. 0으로 채우면 "임계 0"이라는 없는 규칙이 생긴다.
--
--    ■ severity_base는 열세 줄 전부 내 판단이다 ■ 문서에 규칙별 등급표가 없다.
--      가른 축은 §19 그대로 **'누가 손대는가'**다:
--        RED(회장 결정)  — 돈줄·계약·법·신뢰가 걸린 것: 현금 런웨이 · 부채 약정 ·
--                          주요 거래처 이탈 · 법적 이슈 · 부정 신호 · 보안 이슈
--        YELLOW(회장 인지) — 회사가 대응하지만 회장이 알아야 하는 것: 매출 변동 ·
--                          마진 하락 · 생산 중단 · CEO 예측 미스 · 자본 프로젝트 지연
--        GREEN(CEO 처리) — 품질 이슈 · 이직률 초과
--      GREEN 둘을 둔 것이 망설인 자리다. GREEN으로 시작하면 그 예외는 회장 화면에
--      **오르지 않는다**(§4가 GREEN 회사를 숨긴다). 그래도 둔 이유: 전부 빨개지면 어디가
--      급한지 안 보이고, 그것이 요구사항서 2번이 금지한 모양이다. 품질과 이직은 CEO가
--      처리하는 일이고, 회장이 봐야 할 만큼 커지면 점수 여섯 축이 등급을 올린다(6절).
--
--    `on conflict do nothing`이다. 이 마이그레이션이 두 번 도는 일은 없지만, 시드가
--    **회장이 고친 값을 덮는 경로**는 만들지 않는다(0033 11절 · 0034 6절과 같은 규율).
--    바로 이 표가 "회장 편집"을 전제한 표라 그 규율이 여기서 가장 중요하다.
-- ---------------------------------------------------------------------
insert into exception_rules
  (rule_key, name, scope, kind, metric, comparator, threshold, window_days, severity_base, sort_order)
values
  ('revenue_variance',      '매출 변동',                     'company', 'metric', 'Revenue', 'abs>',  20,  30, 'YELLOW',  1),
  ('ebitda_margin_drop',    'EBITDA 마진 하락',              'company', 'metric', 'EBITDA',  '<=',    -5,  90, 'YELLOW',  2),
  ('cash_runway',           '현금 부족 (Runway 6개월 미만)', 'company', 'metric', 'Cash',    '<',      6,  90, 'RED',     3),
  ('debt_covenant',         '부채 약정',                     'company', 'manual', null,      null,  null, null, 'RED',    4),
  ('major_customer_loss',   '주요 거래처 이탈',              'company', 'manual', null,      null,  null, null, 'RED',    5),
  ('production_stop',       '생산 중단',                     'company', 'manual', null,      null,  null, null, 'YELLOW', 6),
  ('quality_issue',         '품질 이슈',                     'company', 'manual', null,      null,  null, null, 'GREEN',  7),
  ('ceo_forecast_miss',     'CEO 예측 미스',                 'company', 'manual', null,      null,  null, null, 'YELLOW', 8),
  ('turnover_high',         '이직률 초과',                   'company', 'manual', null,      null,  null, null, 'GREEN',  9),
  ('capital_project_delay', '자본 프로젝트 지연',            'company', 'manual', null,      null,  null, null, 'YELLOW', 10),
  ('legal_issue',           '법적 이슈',                     'company', 'manual', null,      null,  null, null, 'RED',    11),
  ('fraud_signal',          '부정 신호',                     'company', 'manual', null,      null,  null, null, 'RED',    12),
  ('security_issue',        '보안 이슈',                     'company', 'manual', null,      null,  null, null, 'RED',    13)
on conflict (rule_key) do nothing;

-- ---------------------------------------------------------------------
-- 4. exceptions — 감지된 예외
--
--    원문이 못 박은 칸: business_id · rule_key · detected_at · value · threshold ·
--    severity · ai_analysis · ceo_handling · chairman_action_required · status · monitor_until.
--
--    ■ `rule_key`에는 FK를 건다 — 0034가 FK를 **뺀** 자리와 반대다 ■
--      0034 4절은 `intervention_counts`에 `businesses` FK를 걸지 않았다. 원천인
--      `audit_log.business_id`가 **제약 없는 자유 문자열**이고 거기에는 실제로 없는 회사
--      id가 들어오기 때문이다(화면 URL에서 딴 값). `rule_key`는 반대다 — **이 저장소가
--      스스로 만든 값**이고 3절의 열세 줄이 전부다. 없는 규칙을 가리키는 예외는 "왜
--      yellow인가"에 답할 수 없는 행이고, 그 행은 만들어지는 순간 화면에서 설명되지 않는다.
--      그래서 여기서는 FK가 옳다. `on delete restrict`(기본값)로 둔다 — 규칙을 지우는 것이
--      아니라 `enabled = false`로 끄는 것이 이 표의 사용법이다.
--      `business_id`에도 FK를 건다. 예외는 규칙 엔진이 `businesses`를 돌며 만드는 것이라
--      원천이 이미 그 표다(0033이 승계 표 넷에 건 것과 같은 자리다).
--
--    ■ `value`·`threshold`는 manual 규칙에서 null이다 ■ 잰 값이 없다. 이것을 표가
--      강제하려면 규칙 표를 읽는 트리거가 필요하고, 그 트리거는 B-2의 몫이다 —
--      여기서는 칸을 nullable로 두고 사실을 주석에 적는다. **0으로 채우면 "임계 0을
--      넘겼다"는 없는 사실이 화면에 그려진다.**
--
--    ■ `ai_analysis`는 분석이지 결정이 아니다 ■ 화면의 «결정 아님» 라벨(B-3)이 이 칸에서
--      나온다. §19: "AI가 CEO를 대신하지 않는다." 이 칸에 무엇이 적혀 있어도 `status`를
--      바꾸는 것은 사람이고, 7절의 restrictive 정책이 그것을 DB에서 막는다.
--
--    ■ `status='monitoring'`이면 `monitor_until`을 요구한다 ■ 없으면 '언제까지'가 없는
--      관찰이 된다. 그것은 관찰이 아니라 **조용히 잊는 것**이고, 원문의 회장 액션은
--      "관찰 **14일**"이었다. check 제약으로 묶는다.
--      `monitor_until`이 timestamptz인 이유: date로 두면 '언제까지'의 경계가 어느
--      시간대인지가 칸에 없다. 이 저장소의 '오늘'은 KST이고(0019 3절) `current_date`를
--      쓰지 않는다 — timestamptz + now()면 경계를 코드가 고를 필요가 없다.
--
--    ■ `unique (id, business_id)` ■ 6절의 `attention_scores`가 회사 칸을 **복사해서** 갖고
--      (그 이유는 6절에 있다) 복사가 원본과 어긋나지 못하게 복합 FK로 묶는다. 이 unique는
--      그 FK가 가리킬 자리다. `id`가 이미 PK라 행을 더 좁히지는 않는다 — 인덱스 한 개의
--      비용으로 '두 표의 회사가 다른 행'을 구조적으로 불가능하게 만든다.
--
--    ■ `period`와 중복 방지 — **B-2가 제자리에서 더했다**(0035는 아직 staging에 없다) ■
--      야간 Job은 하루에 한 번이 아니라 **틱으로 여러 번 돈다**(0029 — 회장 현지 06:00을
--      맞추려고 매시 정각에 깨어난다). 같은 회사·같은 규칙·같은 기간을 두 틱이 연달아
--      평가하면 같은 사실이 예외 두 건이 되고, 화면은 "현금 부족"을 두 줄로 그린다.
--      **앱에서만 막으면 두 틱이 겹치는 날 뚫린다** — 조회와 insert 사이가 비어 있고,
--      이 Job은 회사 다섯을 `Promise.all`로 동시에 돈다(night-brief.ts). 그래서 제약을 건다.
--
--      **칸이 하나 필요했다.** 처음에는 `detected_at`의 날짜로 묶으려 했지만 그것은
--      «언제 감지했나»이지 «무엇을 쟀나»가 아니다. 자정을 넘긴 두 틱이 같은 8월 수치를
--      두 번 올리게 되고, 그 반대(같은 날 두 번 도는 월초)도 막지 못한다. 그래서
--      **잰 기간**(`finance_kpis.period`와 같은 눈금의 'YYYY-MM')을 칸으로 둔다.
--      이 값은 시계가 아니라 **데이터**에서 나온다 — 서버의 '오늘'에 기대지 않는다는
--      이 저장소의 규율과 같은 자리다(0019 3절).
--
--      **manual 규칙에서는 null이다.** 잰 기간이 없기 때문이고, Postgres의 unique는 null을
--      서로 다른 값으로 보므로 **사람이 올리는 플래그는 이 제약에 걸리지 않는다.**
--      그것이 맞다 — 같은 달에 거래처가 둘 이탈하면 그것은 예외 두 건이다.
--
--      **status를 조건에 넣지 않았다**(부분 유니크 인덱스로 «열린 것만» 묶는 길을 버렸다).
--      그러면 회장이 닫은 예외를 그날 밤 Job이 **다시 올린다** — 닫은 사람에게는 닫기가
--      되돌려진 것으로 보이고, 두 번째로 닫을 때는 그 버튼을 믿지 않게 된다.
--      **대가**: 한 기간에 한 건이라 같은 달에 다시 나빠진 것을 새 예외로 올리지 못한다.
--      그 자리를 메우는 것이 회장의 '관찰 N일'(`monitor_until`)이고, 다음 달 수치가 오면
--      기간이 달라져 새 예외가 선다.
-- ---------------------------------------------------------------------
create table exceptions (
  id                       bigint generated always as identity primary key,
  business_id              text not null references businesses(business_id) on delete cascade, -- [일반]
  rule_key                 text not null references exception_rules(rule_key),                 -- [일반] FK가 옳은 자리(위 주석)
  detected_at              timestamptz not null default now(),   -- [일반]
  period                   text,                                 -- [일반] 잰 기간(YYYY-MM). manual 규칙에서는 null. 중복 방지의 키
  value                    numeric,                              -- [제한] 잰 값. manual 규칙에서는 null
  threshold                numeric,                              -- [제한] 걸린 순간의 임계. 규칙이 나중에 바뀌어도 그때의 값이 남는다
  severity                 attention_level not null,             -- [일반] §19. 누가 손대는가
  ai_analysis              text,                                 -- [제한] **분석이지 결정이 아니다**
  ceo_handling             boolean not null default false,       -- [일반] CEO가 이미 대응 중인가
  chairman_action_required boolean not null default false,       -- [일반] 회장 액션이 필요한가
  status                   text not null default 'open',         -- [일반] open/monitoring/closed
  monitor_until            timestamptz,                          -- [일반] 관찰 종료 시점. monitoring이면 필수
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint exceptions_status_check
    check (status in ('open', 'monitoring', 'closed')),
  -- '언제까지'가 없는 관찰은 관찰이 아니라 조용히 잊는 것이다.
  constraint exceptions_monitor_until_check
    check (status <> 'monitoring' or monitor_until is not null),
  constraint exceptions_id_business_unique unique (id, business_id),
  -- 'YYYY-MM'. 모양만 묶는다 — 어느 달이 유효한가는 데이터가 답할 질문이지 제약이 아니다.
  constraint exceptions_period_shape_check
    check (period is null or period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  -- 같은 회사·같은 규칙·같은 기간은 한 건이다(위 주석). 두 틱이 겹쳐도 DB가 막는다.
  constraint exceptions_dedupe_unique unique (business_id, rule_key, period)
);

comment on table exceptions is
  '§18. 규칙이 실제로 걸려서 생긴 예외. **시드 행이 한 건도 없다** — 예외는 규칙이 걸려야 생기는 것이고, 시드로 넣으면 화면이 첫날부터 있지도 않은 위험을 빨갛게 그린다. value·threshold는 manual 규칙에서 null이다(잰 값이 없다). status=monitoring이면 monitor_until이 반드시 있다. **(business_id, rule_key, period)가 유일하다** — 야간 Job이 틱으로 여러 번 도는 날 같은 사실이 두 건이 되는 것을 DB가 막는다(period 칸 주석).';
comment on column exceptions.severity is
  '§19. **이 예외의 «지금» 등급이고, 화면이 색을 고를 때 읽는 칸은 이것 하나다.** 등급이 세 칸에 나오므로 순서를 못 박는다: ① exception_rules.severity_base가 첫 값을 준다(축이 아직 없을 때의 출발점) ② 점수가 나오면 attention_scores.level이 나오고 **B-2가 그 값으로 이 칸을 갱신한다** ③ 화면은 attention_scores를 색 때문에 읽지 않는다 — 점수 표는 «왜 그 색인가»를 설명할 때 읽는다. 둘이 어긋난 행이 있으면 갱신이 아직 안 된 것이지, 화면이 고를 문제가 아니다.';
comment on column exceptions.ai_analysis is
  '§19. AI의 원인 분해·권고. **분석이지 결정이 아니다** — 화면의 «결정 아님» 라벨이 이 칸에서 나온다. 이 칸에 무엇이 적혀 있어도 status를 바꾸는 것은 사람이고, ai_agent_no_update가 그것을 DB에서 막는다.';
comment on column exceptions.value is
  '잰 값. **manual 규칙에서는 null이다 — 0이 아니라 없다.** 0으로 채우면 "임계 0을 넘겼다"는 없는 사실이 화면에 그려진다.';
comment on column exceptions.threshold is
  '걸린 순간의 임계값. 규칙 표의 값을 **복사해 둔다** — /attention/rules에서 회장이 임계를 고쳐도 지난 예외가 "왜 걸렸나"를 계속 설명할 수 있어야 한다. manual 규칙에서는 null이다.';
comment on column exceptions.period is
  '이 예외가 **잰 기간**(YYYY-MM · finance_kpis.period와 같은 눈금). 「언제 감지했나」(detected_at)가 아니라 「무엇을 쟀나」다. **중복 방지의 키다** — (business_id, rule_key, period)에 unique가 걸려 있고, 야간 Job이 틱으로 여러 번 도는 날(0029) 같은 사실이 예외 두 건이 되는 것을 DB가 막는다. 앱에서만 막으면 조회와 insert 사이에서 두 틱이 겹친다. **manual 규칙에서는 null이다** — 잰 기간이 없고, unique가 null을 서로 다른 값으로 보므로 사람이 올리는 플래그는 이 제약에 걸리지 않는다(같은 달에 거래처가 둘 이탈하면 그것은 두 건이다). status를 조건에 넣지 않은 이유는 4절 주석에 있다 — 넣으면 회장이 닫은 예외를 그날 밤 Job이 다시 올린다.';
comment on column exceptions.monitor_until is
  '관찰 종료 시점(원문의 "관찰 14일"). timestamptz다 — date로 두면 경계가 어느 시간대인지가 칸에 없고, 이 저장소는 서버의 «오늘»에 기대지 않는다(0019 3절). 비교는 now()로 한다.';

create trigger exceptions_updated_at before update on exceptions
  for each row execute function set_updated_at();

-- 화면이 매번 묻는 질문이 (이 회사 · 열린 것 · 최신순)이다(원문: "/attention 전체 목록:
-- 열림/관찰 중/종료, 규칙별·회사별 필터"). 규칙별 필터는 두 번째 인덱스가 받는다 —
-- FK는 참조하는 쪽에 인덱스를 만들어 주지 않는다.
create index exceptions_by_business_status on exceptions (business_id, status, detected_at desc);
create index exceptions_by_rule on exceptions (rule_key, detected_at desc);

-- ---------------------------------------------------------------------
-- 5. attention_scores — §19의 축 여섯. **그리고 몇 개가 비었는지.**
--
--    ■ 이 표의 존재 이유는 축이 아니라 «출처» 칸 여섯이다 ■
--      §19는 축 여섯을 말하지만 이 저장소에 그 여섯을 재어 줄 원천이 다 있지는 않다.
--      수치가 있는 것은 `finance_kpis`뿐이고, 전략 영향·CEO 해결 능력 같은 축은 **사람이나
--      AI의 판단**이다. 그래서 축마다 출처를 요구한다:
--        · 축이 있으면 출처가 있어야 하고, 출처가 있으면 축이 있어야 한다(check 제약).
--        · 출처가 없는 축은 **null**이다 — 0이 아니다. 0은 "영향 없음"이라는 값이고,
--          null은 "재지 못했다"는 사실이다. 0033의 `decided_by_kind`가 역산이 닿지 않은
--          행을 null로 두고 `unknown_count`로 따로 낸 것과 같은 규율이다.
--      **AI가 축을 지어내서 RED를 만들면 회장이 없는 근거로 회사를 흔들게 된다.**
--      출처 칸이 그것을 막는 유일한 자리다.
--
--    ■ `unknown_axes` — 빈 축의 개수를 행이 스스로 센다 ■
--      check 제약이 이 숫자를 실제 null 개수에 묶는다. 칸만 두면 그 숫자가 조용히 틀릴 수
--      있고, 틀린 방향은 늘 하나다 — **적게 적는 쪽**(축이 다 있는 것처럼 보인다).
--      화면이 이 숫자를 그대로 적는다("여섯 축 중 N개가 비었습니다").
--
--    ■ 눈금 · 가중치 · 경계는 문서에 없다. 전부 내 판단이고, 여기 적는다 ■
--      · **눈금: 축마다 0~10 정수다.** 1~5로 두면 RED/YELLOW 경계가 한 칸에 뒤집히고,
--        0~100으로 두면 AI가 73과 76을 구별하는 척하게 된다. 0~10이 «근거를 대며 말할 수
--        있는» 폭이다.
--      · **가중치(합 100): 재무 25 · 전략 20 · 긴급도 20 · 확률 15 · CEO 해결 능력 10 ·
--        자본 필요 10.** 재무가 가장 무거운 이유는 §18의 13개 중 넷이 돈이고 회장이
--        결정하는 것도 돈이기 때문이다. 확률을 영향보다 낮게 둔 이유: **확률이 낮아도
--        영향이 크면 회장은 본다**(그 반대는 CEO가 처리한다).
--      · **`ceo_ability`는 역방향이다.** 문서의 이름은 "CEO Ability to Resolve"이고, 그 축이
--        높으면 회장이 볼 이유가 **줄어든다**(§19가 GREEN을 "CEO handles"로 정의했다).
--        그래서 식에서 `10 - ceo_ability`로 들어간다. 이름을 뒤집지 않은 이유: 문서의 낱말을
--        그대로 두고 방향을 글로 적는 쪽이, 이름을 바꿔 두고 문서와 대조하지 못하게 되는
--        쪽보다 낫다.
--      · **없는 축을 0으로 채우지 않는다. 있는 축의 가중치 합으로 나눈다.**
--          score = round( Σ(w_i × v_i) / Σ(w_i) × 10 , 1 )   — i는 «값이 있는» 축만
--        0으로 채우면 축 넷이 빈 행이 조용히 낮은 점수를 받아 GREEN으로 내려가고, 회장은
--        그것을 "정상"으로 읽는다. 이 표에서 금지된 거짓이 그 방향이다.
--        **대가는 반대쪽이다**: 축 하나만 있는 행도 100점이 될 수 있다. 그래서
--        `unknown_axes`를 같이 내고, 화면이 그 숫자를 점수 옆에 적는다(B-3).
--      · **경계: score >= 70 → RED · 40 <= score < 70 → YELLOW · < 40 → GREEN.**
--        RED는 "회장이 결정한다"이므로 아껴 써야 한다 — 전부 빨개지면 어디가 급한지 안
--        보이고(요구사항서 2번), §4가 GREEN 회사를 숨기는 이유와 같다. 70은 여섯 축 중
--        넷 남짓이 높을 때 닿는 값이다.
--
--    ■ **이 표는 점수를 계산하지 않는다** ■ `score`와 `level`은 평범한 칸이고, 위 식을
--      쓰는 것은 B-2다. generated column이나 트리거로 박지 않은 이유가 둘 있다:
--        ① 식을 DB에 박으면 그것이 곧 «규칙 평가 엔진»이고, 이 작업의 경계 밖이다.
--        ② 경계(70/40)를 check 제약으로 묶으면 **화면에서 경계를 고치는 순간 마이그레이션이
--           필요해진다.** 그것을 고칠 수 있어야 하는지는 B-3이 정한다(브리프 2절 ③).
--      대신 «둘 다 있거나 둘 다 없다»만 묶는다 — 점수는 있는데 등급이 없는 행은 화면이
--      그릴 수 없고, 등급만 있는 행은 근거 없는 색이다.
--
--    ■ 한 예외에 한 줄이다(`exception_id`가 PK) ■ 야간 Job이 다시 매기면 그 줄을 update
--      한다. 이력을 표로 쌓지 않는 것은 0001부터의 원칙이다 — 이력은 `audit_log`가 갖는다
--      (0033 `chairman_directions`가 같은 판단을 했다). **대가**: "어제는 RED였는데 오늘
--      YELLOW"를 이 표만 보고는 말할 수 없다. 그 질문이 필요해지면 감사 기록에서 낸다.
--
--    ■ `business_id`를 복사해 두는 이유 ■ 읽기 범위가 `exceptions`와 같아야 하는데,
--      정책 안에서 `exceptions`를 서브쿼리로 읽으면 그 표의 RLS가 **한 겹 더** 걸린다.
--      답은 같아도 문이 둘이 되고, 둘이 되면 언젠가 한쪽만 고쳐진다. 그래서 회사 칸을
--      복사하고 **복합 FK로 어긋나지 못하게 묶는다**(4절의 unique가 그 자리다).
--      복사한 칸이 원본과 다른 행은 DB가 받지 않는다 — 복사의 유일한 위험이 그것이다.
-- ---------------------------------------------------------------------
create table attention_scores (
  exception_id              bigint primary key references exceptions(id) on delete cascade, -- [일반] 한 예외에 한 줄
  business_id               text not null,                     -- [일반] exceptions의 것을 복사. 복합 FK가 묶는다
  financial_impact          smallint,                          -- [일반] 0~10. null=재지 못했다
  financial_impact_source   text,                              -- [일반] 이 축이 어디서 나왔나
  strategic_impact          smallint,                          -- [일반] 0~10
  strategic_impact_source   text,                              -- [일반]
  urgency                   smallint,                          -- [일반] 0~10
  urgency_source            text,                              -- [일반]
  probability               smallint,                          -- [일반] 0~10
  probability_source        text,                              -- [일반]
  ceo_ability               smallint,                          -- [일반] 0~10. **역방향**(높으면 회장이 볼 이유가 줄어든다)
  ceo_ability_source        text,                              -- [일반]
  capital_requirement       smallint,                          -- [일반] 0~10
  capital_requirement_source text,                             -- [일반]
  score                     numeric(4, 1),                     -- [일반] 0~100. B-2가 계산해 넣는다
  level                     attention_level,                   -- [일반] 그 점수가 낸 등급
  unknown_axes              smallint not null,                 -- [일반] 여섯 축 중 빈 칸 수. check가 실제 개수에 묶는다
  scored_at                 timestamptz not null default now(),-- [일반] 언제 매긴 점수인가
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint attention_scores_business_fk
    foreign key (exception_id, business_id) references exceptions (id, business_id) on delete cascade,

  -- 축은 0~10이다. 범위를 안 걸면 'AI가 87을 넣었다'가 조용히 들어온다.
  constraint attention_axes_range_check check (
    (financial_impact    is null or financial_impact    between 0 and 10) and
    (strategic_impact    is null or strategic_impact    between 0 and 10) and
    (urgency             is null or urgency             between 0 and 10) and
    (probability         is null or probability         between 0 and 10) and
    (ceo_ability         is null or ceo_ability         between 0 and 10) and
    (capital_requirement is null or capital_requirement between 0 and 10)
  ),

  -- **축과 출처는 같이 있거나 같이 없다.** 출처 없는 축이 이 표에서 가장 위험한 행이다.
  constraint attention_axes_source_check check (
    (financial_impact    is null) = (btrim(coalesce(financial_impact_source,    '')) = '') and
    (strategic_impact    is null) = (btrim(coalesce(strategic_impact_source,    '')) = '') and
    (urgency             is null) = (btrim(coalesce(urgency_source,             '')) = '') and
    (probability         is null) = (btrim(coalesce(probability_source,         '')) = '') and
    (ceo_ability         is null) = (btrim(coalesce(ceo_ability_source,         '')) = '') and
    (capital_requirement is null) = (btrim(coalesce(capital_requirement_source, '')) = '')
  ),

  -- 빈 축의 수를 행이 스스로 센다. 칸만 두면 조용히 «적게» 적힌다.
  constraint attention_unknown_axes_check check (
    unknown_axes =
      (case when financial_impact    is null then 1 else 0 end) +
      (case when strategic_impact    is null then 1 else 0 end) +
      (case when urgency             is null then 1 else 0 end) +
      (case when probability         is null then 1 else 0 end) +
      (case when ceo_ability         is null then 1 else 0 end) +
      (case when capital_requirement is null then 1 else 0 end)
  ),

  constraint attention_score_range_check
    check (score is null or score between 0 and 100),
  -- 점수와 등급은 같이 있거나 같이 없다. **경계(70/40)는 묶지 않는다** — 화면에서
  -- 경계를 고칠 수 있어야 하는지는 B-3이 정한다(위 주석).
  constraint attention_score_level_check
    check ((score is null) = (level is null))
);

comment on table attention_scores is
  '§19 ATTENTION SCORE. 예외 하나에 한 줄. **여섯 축 전부 nullable이고 축마다 출처 칸이 있다** — 출처가 없는 축은 null이고(0이 아니다), 몇 개가 비었는지는 unknown_axes가 센다(check 제약이 실제 개수에 묶는다). AI가 축을 지어내서 RED를 만들면 회장이 없는 근거로 회사를 흔들게 된다. 눈금 0~10 · 가중치(재무25·전략20·긴급20·확률15·CEO능력10·자본10) · 경계(70/40)는 문서에 없는 판단이고 0035 5절과 DEFERRED에 적혀 있다. **이 표는 점수를 계산하지 않는다 — 식은 B-2에 있다.**';
comment on column attention_scores.ceo_ability is
  '§19 "CEO Ability to Resolve". 0~10. **역방향이다** — 이 축이 높으면 회장이 볼 이유가 줄어든다(§19의 GREEN=CEO handles). 식에서는 10 - ceo_ability로 들어간다. 이름은 문서의 낱말을 그대로 두었다.';
comment on column attention_scores.unknown_axes is
  '여섯 축 중 값이 없는 칸의 수. check 제약이 이 숫자를 실제 null 개수에 묶는다 — 칸만 두면 조용히 «적게» 적히고, 그 방향의 거짓은 축이 다 있는 것처럼 보이게 한다. 화면이 이 숫자를 점수 옆에 그대로 적는다.';
comment on column attention_scores.score is
  '0~100. 있는 축만으로 가중 평균을 내고 100점으로 환산한 값(없는 축을 0으로 채우지 않는다 — 채우면 축이 빈 행이 조용히 GREEN으로 내려간다). **DB가 계산하지 않는다** — 식은 B-2가 갖고, 이 칸은 그 결과를 받는다.';
comment on column attention_scores.level is
  '§19. 이 점수가 낸 등급. **화면이 색을 고를 때 읽는 칸이 아니다** — 그것은 exceptions.severity 하나다. 이 칸은 «왜 그 색인가»의 근거이고, B-2가 이 값으로 exceptions.severity를 갱신한다. 순서: severity_base(출발점) → level(축이 나온 뒤) → exceptions.severity(지금 등급).';
comment on column attention_scores.business_id is
  'exceptions의 회사 칸을 복사한 것이다. 복합 FK(exception_id, business_id)가 원본과 어긋나지 못하게 묶는다. 복사하는 이유는 RLS다 — 정책에서 exceptions를 서브쿼리로 읽으면 그 표의 RLS가 한 겹 더 걸리고, 문이 둘이 되면 언젠가 한쪽만 고쳐진다.';

create trigger attention_scores_updated_at before update on attention_scores
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 6. 권한 — 자물쇠는 revoke다
--
--    Supabase는 public 스키마의 새 표를 만들자마자 anon/authenticated에게 열어 버린다
--    (postgres 역할의 default privileges). 먼저 **걷고** 필요한 것만 다시 준다
--    (0023 3절 ① · 0033 8절 · 0034 4절).
--
--    **force row level security는 걸지 않는다.** 이 저장소가 네 번 밟은 함정이다.
--    오늘 이 표들을 읽는 definer 함수는 없지만, 예외를 **만드는** 문이 B-2에서 온다 —
--    그때 force가 남아 있으면 그 함수가 소유자 권한으로 돌면서도 정책 아래로 내려가
--    조용히 0행을 준다(0030이 `notifications`에 같은 판단을 했다).
--
--    **delete는 아무에게도 주지 않는다.** 예외는 지우는 것이 아니라 닫는 것이다
--    (`status = 'closed'`). grant가 없고 정책도 없어 두 겹이다 — 그래서 AIAgent에게
--    restrictive delete 정책을 따로 걸지 않았다(0034 4절과 같은 판단: 잴 것이 없다).
--    `exception_rules`도 같다 — 규칙은 지우는 것이 아니라 `enabled = false`로 끈다.
-- ---------------------------------------------------------------------
revoke all on table exception_rules   from anon, authenticated;
revoke all on table exceptions        from anon, authenticated;
revoke all on table attention_scores  from anon, authenticated;

grant select, insert, update on table exception_rules  to authenticated;
grant select, insert, update on table exceptions       to authenticated;
grant select, insert, update on table attention_scores to authenticated;

alter table exception_rules  enable row level security;
alter table exceptions       enable row level security;
alter table attention_scores enable row level security;

-- ---------------------------------------------------------------------
-- 7. RLS — 원문 B에는 RLS 한 줄이 없다. 그래서 이 저장소의 기존 모양을 따른다.
--
--    ■ 읽기: `has_business(business_id) and can_read_restricted()` ■
--      **`alerts_read`(0002:307)보다 한 겹 좁다. 그 차이가 이 절에서 가장 중요한 줄이라
--      이유를 적는다.**
--
--      처음에는 `alerts_read`를 그대로 본떠 `has_business()` 하나로 두었다. 그러면
--      `exceptions.value`가 새어 나간다 — `cash_runway`·`revenue_variance`·
--      `ebitda_margin_drop` 세 규칙에서 그 칸에 들어오는 값은 **현금 잔액·매출·EBITDA
--      마진**이고, 그것은 `finance_kpis_read`(0002)가 `can_read_restricted()` 뒤에
--      잠가 둔 바로 그 숫자다. DY의 팀장은 `finance_kpis`를 한 줄도 못 읽는데
--      `exceptions`에서는 "현금 런웨이 2.1개월"을 읽게 된다. **같은 사실이 표에 따라
--      다른 등급으로 잠기면 낮은 쪽이 그 표의 실제 등급이 된다.**
--      칸에 붙인 `[제한]` 꼬리표와 정책이 어긋난 채로 두지 않는다.
--
--      마스킹 뷰(`finance_kpis_masked`, 0002:358)를 본뜨는 길은 택하지 않았다. 그 뷰는
--      `security_invoker = true`이고 아래 표의 정책이 이미 `can_read_restricted()`를
--      요구하므로, 그 안의 `case when`은 **한 번도 돌지 않는 죽은 가지**다. 돌지 않는
--      것을 베끼면 검사가 초록인 채 아무것도 막지 않는 겹이 하나 늘 뿐이다.
--
--      좁힌 뒤의 독자는 **다섯**이다: `can_read_restricted()`(0002:142)의 넷 —
--      Chairman · GroupCFO · BusinessCEO · Executive — 에 **AIAgent**가 더해진다.
--      §19가 예외를 «분류하는» 사람으로 상정한 것이 앞의 넷이고(GREEN이 "CEO handles"인
--      모델에서 팀원이 예외를 분류하지 않는다), AIAgent는 분류하는 쪽이 아니라
--      **자기가 넣은 줄을 도로 읽어야 하는** 쪽이다 — 그 갈래의 이유는 아래
--      `exceptions_read` 바로 위에 적었다(`returning`과 `attention_scores.exception_id`).
--      TeamLead·Member는 0행이고, 화면은 그들에게 "0건"이라고 말하지 않는다.
--      `has_business()`가 `is_active()`를 먼저 보므로 `revoked_at`이 찍힌 계정은 한 줄도
--      못 읽는다(0002 원칙 8).
--
--      **`exception_rules`는 반대로 넓게 둔다** — 임계값은 회사 데이터가 아니라 그룹의
--      정책 상수다. 화면이 "왜 DY가 yellow인가"를 설명하려면 그 회사 사람도 규칙을 봐야
--      하고, "매출 ±20%가 임계다"를 아는 것은 그 회사의 매출을 아는 것이 아니다.
--      그래서 그 표의 `threshold`에는 `[제한]` 꼬리표를 붙이지 않았다.
--
--      승계 표의 `can_read_succession()`(0033:412)은 쓰지 않는다. 그것은 역할만 보고
--      회사를 `has_business()`로 다시 보는 승계 전용 문이고, 여기서 필요한 겹은
--      '회사'와 '등급' 둘이다.
--
--    ■ 회장 액션(status · monitor_until): `can_approve()` ■ 0002:149. 승인권자
--      (Chairman · BusinessCEO)다. `decisions_decide`와 **같은 모양**으로 회사 판정을
--      같이 걸어, VANA 대표가 DY의 예외를 닫는 길을 열지 않는다.
--      GroupCFO는 이 문을 통과하지 못한다 — 예외를 만들 수는 있지만(아래) 닫지는 못한다.
--      그것이 `can_approve()`가 정의하는 경계이고, 새 역할 목록을 여기서 만들지 않는다.
--
--    ■ insert: 규칙 엔진(AIAgent)과 Chairman · GroupCFO ■
--      야간 Job은 사람이 아니라 Agent가 쓴다 — 이 프로젝트에 `service_role`은 없고
--      Agent도 로그인해서 RLS 안에서 돈다(CLAUDE.md · 0002 night_outputs_write).
--      **`has_business()`를 AIAgent에게도 요구한다.** 0002의 `night_outputs_write`는
--      역할만 봤지만, 0002 원칙 3이 "Business Isolation은 이 함수 하나로만 판정한다"고
--      못 박았다. 대가를 적는다: 야간 Job 계정에 `user_business_access` 행이 없으면
--      insert가 **거부된다.** 그것은 42501로 시끄럽게 실패하므로(조용한 0행이 아니다)
--      B-2가 그 계정을 세우는 날 곧바로 드러난다.
--
--    ■ 점수를 쓰는 쪽은 한 역할 더 좁다 — `can_score_attention()` ■
--      원문은 `attention_scores`의 쓰기를 "규칙 엔진과 Chairman"이라고 적었다.
--      예외를 **올리는** 것과 점수를 **매기는** 것은 다른 일이다: 전자는 "이 회사에 이런
--      일이 있다"는 보고라 GroupCFO도 할 수 있고, 후자는 §19의 여섯 축으로 **회장이
--      무엇을 볼지 정하는 일**이다. 그래서 함수를 둘로 둔다 — 하나로 합치면 원문에 없던
--      역할 하나가 조용히 얹힌다(처음에 실제로 그렇게 썼다가 되돌렸다).
--      대가: 역할 목록이 두 곳에 있다. 둘이 갈라지는 것을 막으려고 뒤의 함수가 앞의
--      함수를 **부른다** — 점수를 쓸 수 있으면 예외도 쓸 수 있다는 것이 그 포함 관계다.
--
--    ■ AIAgent는 insert만 한다 — restrictive 두 줄로 못 박는다 ■
--      0013이 `decisions`에 `ai_agent_no_update`를 건 것과 같은 모양이다.
--      **오늘 이 줄은 잴 것이 없다**: 위의 update 정책이 `can_approve()`를 요구하고 그
--      함수는 Chairman · BusinessCEO뿐이라, AIAgent는 이미 못 바꾼다. 0034 4절은 같은
--      상황에서 restrictive를 **두지 않기로** 했는데 여기서는 둔다. 차이가 하나 있다:
--      0033 1절이 **그 길이 열릴 날을 미리 적어 두었다** — "'rule' 값은 블록 B가 규칙
--      자동 종결을 들고 올 때 채워진다." 그날 누군가 이 표의 update를 규칙 엔진에게
--      열면, 그 사람이 **의식적으로 지워야 하는 한 줄**이 이 restrictive다. 그것이 §19의
--      "AI가 CEO를 대신하지 않는다"가 코드로 남는 자리다.
--      **insert 쪽에도 한 줄 건다.** update만 막으면 AIAgent가 처음부터
--      `status = 'closed'`인 예외를 넣는 길이 남는다 — 그것은 "만들고 닫지 않는다"를
--      글자로만 지키고 뜻으로는 어기는 경로다(예외를 닫는 것은 결정이고, 결정은 AI가
--      하지 않는다). AIAgent가 넣는 줄은 `status = 'open'`이어야 한다.
--      `monitoring`도 막힌다 — '언제까지 두고 본다'를 정하는 것도 회장의 일이다.
--
--    ■ `exception_rules` 읽기는 로그인한 활성 사용자 전부다 ■ 임계를 아는 것이 위험하지
--      않다 — 화면이 "왜 yellow인가"를 설명하려면 그 회사 사람도 규칙을 봐야 한다.
--      **쓰기는 Chairman만**이다(원문: "규칙 임계값은 /attention/rules에서 회장 편집").
--      BusinessCEO가 자기 회사 예외를 닫을 수는 있지만 규칙을 고칠 수는 없다 — 규칙은
--      그룹의 기준이고, 잴 대상이 잣대를 고치면 지표가 지표가 아니게 된다.
--
--    ■ 정책이 없는 동작은 전부 거부다(0002 원칙 1). 역할을 열거한다(원칙 2). ■
-- ---------------------------------------------------------------------

/**
 * 예외를 **올리는** 쪽의 판정. Chairman · GroupCFO · AIAgent.
 * 기존 함수 셋(`is_active` · `auth_role` · `has_business`)을 합치는 껍데기이고,
 * 새 판정을 만들지 않는다.
 */
create or replace function can_write_attention(target text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select case
    when not is_active() then false
    when auth_role() in ('Chairman', 'GroupCFO', 'AIAgent') then has_business(target)
    else false
  end;
$fn$;

comment on function can_write_attention(text) is
  '§18. 예외를 «올리는» 쪽의 판정. Chairman·GroupCFO·AIAgent이고 회사 판정은 has_business()에 맡긴다(0002 원칙 3 — Business Isolation은 그 함수 하나로만 판정한다). **닫는 것도 점수를 매기는 것도 이 함수가 아니다** — status·monitor_until 변경은 can_approve()이고, 점수는 can_score_attention()이다.';

/**
 * 점수를 **매기는** 쪽의 판정. 원문이 "규칙 엔진과 Chairman"이라고 적었다 — GroupCFO는
 * 예외를 올릴 수는 있어도 §19의 여섯 축으로 «회장이 무엇을 볼지»를 정하지는 않는다.
 *
 * 역할을 다시 열거하지 않고 `can_write_attention()`을 **부른다**. 점수를 쓸 수 있으면
 * 예외도 쓸 수 있다는 포함 관계가 참이라 그렇게 쓸 수 있고, 두 목록이 각자 적혀 있으면
 * 언젠가 한쪽만 고쳐진다.
 */
create or replace function can_score_attention(target text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select can_write_attention(target) and auth_role() in ('Chairman', 'AIAgent');
$fn$;

comment on function can_score_attention(text) is
  '§19. attention_scores의 쓰기 판정. **Chairman과 AIAgent뿐이다**(원문: "규칙 엔진과 Chairman"). GroupCFO는 예외를 올릴 수는 있어도 점수는 매기지 않는다 — 예외를 올리는 것은 "이런 일이 있다"는 보고이고, 점수는 회장이 무엇을 볼지 정하는 일이다. 역할 목록이 두 벌이 되지 않게 can_write_attention()을 부른다.';

-- 0019 3절이 그 이유를 적어 뒀다: Postgres는 새 함수의 execute를 public에 기본으로 주고,
-- security definer 함수에서 그 기본값은 곧 "anon도 RPC로 부를 수 있다"는 뜻이다.
-- 몸통이 is_active()로 걸러 anon에게는 false지만, 기본 권한을 남겨 두지 않는다.
revoke all on function can_write_attention(text) from public;
grant execute on function can_write_attention(text) to authenticated;
revoke all on function can_score_attention(text) from public;
grant execute on function can_score_attention(text) to authenticated;

-- ① exception_rules — 읽기는 활성 사용자 전부, 쓰기는 Chairman뿐
create policy exception_rules_read on exception_rules
  for select using (is_active());
create policy exception_rules_write on exception_rules
  for all using (is_active() and auth_role() = 'Chairman')
  with check (is_active() and auth_role() = 'Chairman');

-- ② exceptions — 읽기는 그 회사의 [제한] 독자, 처리는 승인권자, 올리는 것은 규칙 엔진과
--    Chairman·GroupCFO. 읽기가 `alerts_read`보다 한 겹 좁은 이유는 위 주석에 있다.
-- 읽기 = «그 회사의 [제한] 독자» **또는** «그 표에 쓰는 사람».
--
-- 뒤의 갈래가 없으면 **야간 Job이 자기가 방금 넣은 줄을 못 읽는다.** Postgres는 INSERT의
-- `returning`에도 SELECT 정책을 건다(supabase-js의 `.insert().select()`가 내는 문장이
-- 정확히 그것이다). `exceptions.id`는 `generated always as identity`라 그 값을 알 방법이
-- 그 하나뿐이고, 그것을 못 읽으면 AIAgent는 `attention_scores.exception_id`를 채울 수
-- 없다 — 점수를 매길 예외를 가리키지 못한다. 중복 방지 조회(같은 규칙이 오늘 이미
-- 걸렸는가)도 같은 이유로 막힌다.
--
-- **이 갈래가 새로 내주는 것은 없다.** `can_write_attention()`을 통과하는 역할은 바로 그
-- 값들을 **집어넣는** 쪽이다. 그리고 실제로 늘어나는 독자는 AIAgent 하나뿐이다 —
-- Chairman·GroupCFO는 이미 `can_read_restricted()` 안에 있다.
create policy exceptions_read on exceptions
  for select using (
    has_business(business_id)
    and (can_read_restricted() or can_write_attention(business_id))
  );
create policy exceptions_triage on exceptions
  for update using (can_approve() and has_business(business_id))
  with check (can_approve() and has_business(business_id));
create policy exceptions_create on exceptions
  for insert with check (can_write_attention(business_id));

-- AI는 결정하지 않는다(§19). 위 update 정책이 이미 막지만, 그 정책이 넓어지는 날
-- 이 한 줄이 마지막 문이 된다(위 주석 참조 — 0013과 같은 모양, 0034와 다른 판단).
--
-- 이름에 표 이름을 붙이지 않는다. 정책 이름은 표 안에서만 유일하면 되고, 0013이 표 열일곱에
-- 건 것이 전부 맨이름 `ai_agent_no_<op>`다. **그 관례를 지키는 것이 검사 한 줄을 산다** —
-- `check-migrations.ts`의 restrictive 카탈로그가 `policyname like 'ai_agent_no_%'`로 긁는다.
-- (긁기만 해서는 아무것도 재지 않는다. 그 카탈로그는 표 이름 목록을 따로 들고 키로 찾으므로,
--  `exceptions` 두 줄을 실제로 재는 단언을 같은 파일에 더했다 — 그 주석에 이유가 있다.)
create policy ai_agent_no_update on exceptions
  as restrictive for update
  using (auth_role() is distinct from 'AIAgent')
  with check (auth_role() is distinct from 'AIAgent');

-- 그리고 insert 쪽. AIAgent가 넣는 예외는 `status = 'open'`이어야 한다 — 닫힌 채로
-- 들어오는 예외는 "만들되 닫지 않는다"를 글자로만 지킨 것이고, `monitoring`으로
-- 들어오는 예외는 '언제까지 두고 볼지'를 AI가 정한 것이 된다. 둘 다 결정이다.
-- restrictive라 `exceptions_create`의 회사·역할 판정 **위에** 겹으로 걸린다.
create policy ai_agent_no_closed_insert on exceptions
  as restrictive for insert
  with check (auth_role() is distinct from 'AIAgent' or status = 'open');

-- ③ attention_scores — 읽기는 `exceptions`와 **같은 모양이고 같은 사람들**이다.
--    모양: «그 회사의 [제한] 독자» 또는 «그 표에 쓰는 사람». 표마다 쓰는 사람이 다르므로
--    뒤의 갈래가 부르는 함수도 다르다(`can_write_attention` ↔ `can_score_attention`).
--    **그런데 결과 집합은 같다**: 두 갈래가 더해 주는 것은 어느 쪽이나 AIAgent 하나뿐이고
--    (Chairman·GroupCFO는 이미 `can_read_restricted()` 안에 있다), 그래서 두 표의 독자는
--    Chairman · GroupCFO · BusinessCEO · Executive · AIAgent로 **정확히 같다.**
--    이 갈래가 없으면 아래 `for all` 정책의 `using`이 AIAgent에게 select를 주는 바람에
--    "두 표의 읽기 범위가 같다"는 말이 조용히 거짓이 된다 — 리뷰가 잡은 자리다.
--
--    쓰기는 Chairman과 규칙 엔진뿐이다 — 점수를 매기는 것은 «분석»이라 AIAgent가
--    update까지 한다(야간 Job이 다시 매긴다). 바꾸지 못하는 것은 `exceptions.status` —
--    그것이 결정이다.
create policy attention_scores_read on attention_scores
  for select using (
    has_business(business_id)
    and (can_read_restricted() or can_score_attention(business_id))
  );
create policy attention_scores_write on attention_scores
  for all using (can_score_attention(business_id))
  with check (can_score_attention(business_id));

-- ---------------------------------------------------------------------
-- 8. 0034의 트리거 함수를 다시 쓴다 — `monitor`를 다섯 번째로 센다
--
--    근거는 블록 A가 위임을 넣은 것과 **같다**: *"위임도 회장이 그 건을 손댄 것이고,
--    빼면 개입이 실제보다 적어 보인다."* 관찰은 회장이 그 건을 보고 **'지금은 두고
--    본다'고 정한 것**이라 손댄 것이 맞다. 지표를 좋아 보이게 만드는 방향의 누락은
--    이 블록에서 가장 조심하는 것이다.
--
--    **`0034` 파일은 건드리지 않는다 — 이미 staging에 적용됐다.** 이미 적용된
--    마이그레이션을 고치면 체크섬이 드리프트된다(OPERATIONS 9 · 0022가 겪은 일).
--    앞으로 나아가며 고친다(0024:19~23 · 0027 · 0029가 같은 자리에서 같은 판단을 했다).
--    `create or replace function`이므로 `audit_log_interventions` 트리거는 그대로다 —
--    트리거는 이름으로 함수를 가리키고, 몸통만 갈린다. 트리거를 다시 만들면 `audit_log`에
--    SHARE ROW EXCLUSIVE 락을 또 잡아야 하고(0034 6절), 그럴 이유가 없다.
--
--    **과거분은 다시 세지 않는다.** `monitor` 줄은 0035 이전에 **존재할 수 없다** —
--    이 파일의 1절이 그 enum 값을 처음 만든다. 그래서 backfill이 필요 없고, 0034 6절이
--    열었던 창(`audit_log`의 force를 잠깐 내리는)을 이 파일은 열지 않는다. 그 표의
--    force는 여기서 한 글자도 건드리지 않는다.
--
--    **`monitor`를 리터럴 enum으로 쓰지 않는다.** 같은 트랜잭션에서 새 enum 값을 쓰면
--    55P04다(0022가 production에서 밟았다). 비교는 `action::text`이고, 0034가 이미 그
--    모양이었다 — 바뀐 것은 목록에 한 낱말이 더 들어간 것뿐이다.
--
--    나머지는 0034 5절 그대로다. **감사 줄의 insert를 절대 실패시키지 않는다**(기록이
--    먼저, 집계는 나중 — HANDOVER 2절 ③), 판정 세 줄도 예외 블록 **안**에 두고,
--    잃은 것은 `raise warning`으로 회사·유형·SQLSTATE·메시지를 남긴다. 그 셋은 0034의
--    리뷰가 잡아서 고친 자리라 여기서 한 글자도 되돌리지 않는다.
--
--    § 이 한 줄이 §7의 숫자를 올린다 § 블록 B가 출시되는 날 개입 수가 뛴다 —
--    예외를 처리하는 것이 회장이 그 건을 손댄 것이기 때문이다. **사실이지 고장이 아니다.**
-- ---------------------------------------------------------------------
create or replace function interventions_bump() returns trigger
language plpgsql volatile security definer set search_path = public as $fn$
begin
  begin
    if new.actor_role = 'Chairman'
       and new.action::text in ('approve', 'reject', 'modify', 'delegate', 'monitor')
       and new.business_id is not null
    then
      insert into intervention_counts (business_id, period, kind, count, updated_at)
      values (
        new.business_id,
        to_char(new.occurred_at at time zone 'Asia/Seoul', 'YYYY-MM'),
        new.action::text,
        1,
        now()
      )
      on conflict (business_id, period, kind) do update
        set count = intervention_counts.count + 1,
            updated_at = now();
    end if;
  exception when others then
    -- 기록이 먼저, 집계는 나중(HANDOVER 2절 ③). 집계 실패로 감사 줄을 잃지 않는다.
    -- 삼키지는 않는다 — 빠진 건수가 어디에도 흔적이 없으면 아무도 다시 세지 않는다.
    raise warning
      '0035 interventions_bump: 개입 집계 실패 — business_id=% action=% sqlstate=% %',
      new.business_id, new.action, sqlstate, sqlerrm;
  end;
  return null;
end;
$fn$;

comment on function interventions_bump() is
  '§7·§34. audit_log의 after-insert 트리거. 회장의 승인·반려·수정·위임·**관찰** 한 줄이 남을 때 intervention_counts의 건수 하나를 올린다(0035부터 다섯이다 — 관찰도 회장이 그 건을 손댄 것이고, 빼면 개입이 실제보다 적어 보인다). **감사 줄의 insert를 절대 실패시키지 않는다** — 판정과 집계가 전부 예외 블록 안에서 돌고, 터지면 raise warning으로 회사·유형·SQLSTATE를 로그에 남긴 뒤 포기한다. 과거분 backfill은 없다: monitor 줄은 0035 이전에 존재할 수 없다.';

-- 0034가 걷은 그대로 둔다. 사람이 부를 자리가 없는 함수다(0019 3절과 같은 이유).
revoke all on function interventions_bump() from public;

-- 0034:`kind` 칸 옆의 줄 주석이 "approve·reject·modify·delegate" 넷으로 남아 있다.
-- 그 파일은 이미 적용돼서 못 고치므로, 다섯이 됐다는 사실을 **앞으로 나아가며** 적는다.
-- DB에 올라간 주석이 파일의 줄 주석보다 뒤에 읽히는 자리라, 이 한 문장이 0034의 낡은
-- 줄을 덮는다(`\d+ intervention_counts`가 이것을 보여 준다).
comment on column intervention_counts.kind is
  '§7·§34. audit_log.action의 텍스트. **0035부터 다섯이다: approve · reject · modify · delegate · monitor.** 0034 파일의 줄 주석에는 넷만 적혀 있다 — 그 파일은 이미 적용돼 고치지 않고 여기서 앞으로 나아가며 고친다. read·login 같은 열람 기록은 이 표에 들어오지 않는다(트리거가 회장의 처리 줄만 센다).';

comment on view interventions is
  '§7·§34. 회장이 실제로 손댄 횟수. 회사 × 월(KST) × 유형. **0035부터 관찰(monitor)도 센다** — 회장이 그 건을 보고 "지금은 두고 본다"고 정한 것이라 손댄 것이 맞고, 빼면 개입이 실제보다 적게 보인다(위임을 넣은 것과 같은 논리). 그래서 **블록 B 출시일에 개입 수가 뛴다 — 사실이지 고장이 아니다.** audit_log가 아니라 intervention_counts를 읽는다: audit_log의 FORCE를 내리지 않고 원문의 가시성(Chairman·GroupCFO 전체 / CEO 자기 회사)을 주려고 집계 전용 표를 두었다. Executive·TeamLead·Member는 여전히 0행이고, 화면은 그것을 "0건"이라고 말하지 않는다.';

commit;
