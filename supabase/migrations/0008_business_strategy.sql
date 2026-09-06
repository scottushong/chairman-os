-- =====================================================================
-- Chairman OS — 0008_business_strategy
-- 출처: 02_기능명세 CH-024 / 05_Strategic Coordinates / src/types/strategy.ts
-- 작성: Phase 1-C (2026-09-06)
--
-- 무엇이 없어서 만드나
--   0001은 05_Strategic Coordinates의 4종(CH-011~014)만 표로 폈다.
--   그건 메인 대시보드가 쓰는 '지금 무엇이 급한가'다.
--   CH-024가 요구하는 건 다른 축이다 — 회사 하나의 '어디로 가고 있고 무엇이 막고 있나'.
--
--     Mission / 1Y / 3Y      방향
--     현재 위치 / 목표 위치 / Gap   거리
--     현재 우선순위 / Bottleneck    지금 걸려 있는 것
--
--   goals 표에 억지로 넣지 않는다. goals는 '측정되는 목표'(target_value, progress_pct)고
--   여기는 문장이다. 한 표에 두면 progress_pct가 비어 있는 행이 절반이 된다.
--
-- 회사당 한 행이다. business_id가 곧 PK다 —
--   회사의 Mission이 두 개일 수 있다면 그건 Mission이 아니다.
--
-- 그룹 행(business_id IS NULL)을 두지 않는다. 그룹의 방향은 CH-011 goals의 그룹 목표가 갖고,
--   여기에 또 두면 '그룹 Mission'이 두 곳에서 서로 다르게 적히는 날이 온다.
--
-- 왜 시드가 0003이 아니라 이 파일에 있나
--   0003_seed.sql은 이미 원격에 적용됐다. 적용된 마이그레이션을 다시 써서 행을 끼워 넣으면
--   "0003을 돌렸나"가 두 가지를 뜻하게 된다 — 0005가 번호를 건너뛴 것과 같은 이유다.
--   그래서 scripts/gen-seed-sql.ts는 이 표를 내보내지 않고(그 파일 머리의 제외 목록),
--   dummy 모드용 같은 값은 src/data/strategy.json의 business_coordinates에 둔다.
-- =====================================================================

create table business_strategy (
  business_id      text primary key references businesses(business_id) on delete cascade, -- [일반]
  mission          text not null default '',              -- [일반] 이 회사가 왜 있는가
  goal_1y          text not null default '',              -- [제한] 1년 목표. 금액·점유율이 들어온다
  goal_3y          text not null default '',              -- [제한] 3년 목표
  top_kpi          text not null default '',              -- [일반] 이 회사를 한 숫자로 본다면
  current_position text not null default '',              -- [제한] 지금 어디에 있나
  target_position  text not null default '',              -- [제한] 어디로 가야 하나
  gap              text not null default '',              -- [제한] 그 차이. 위 둘에서 자동 계산하지 않는다 — 사람이 쓰는 판단이다
  current_priority text not null default '',              -- [일반] 지금 무엇부터
  bottleneck       text not null default '',              -- [제한] 무엇이 막고 있나. 사람·거래처 이름이 들어온다
  chairman_comment text not null default '',              -- [제한] 회장 메모
  created_at       timestamptz not null default now(),    -- [일반]
  updated_at       timestamptz not null default now()     -- [일반]
);
comment on table business_strategy is
  'CH-024 Business 상세의 전략 좌표. 회사당 한 행. '
  'CH-011~014(goals/monthly_priorities/critical_risks/milestones)와 축이 다르다 — '
  '저쪽은 측정되는 목표고 이쪽은 방향과 판단이다.';
comment on column business_strategy.gap is
  '현재 위치와 목표 위치의 차이를 사람이 쓴 문장. 두 칸에서 계산하지 않는다 — '
  '무엇이 차이인지는 숫자가 아니라 판단이기 때문이다.';

create trigger business_strategy_updated_at before update on business_strategy
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- RLS — 0002의 전략 좌표 4종과 같은 모양.
--   읽기는 회사 범위, 쓰기는 승인권자(Chairman / BusinessCEO)만.
--   이 표는 회장이 직접 고쳐 쓰는 칸이라 쓰기가 좁다(0002의 priorities_write와 같은 이유).
-- ---------------------------------------------------------------------
alter table business_strategy enable row level security;
alter table business_strategy force row level security;

create policy business_strategy_read on business_strategy
  for select using (has_business(business_id));

create policy business_strategy_write on business_strategy
  for all using (can_approve() and has_business(business_id))
  with check (can_approve() and has_business(business_id));

-- ---------------------------------------------------------------------
-- 시드 — src/data/strategy.json의 business_coordinates와 같은 값이다.
--   내용은 06_Dummy_Data의 목표·리스크·프로젝트에서 이어 붙인 Dummy다. 실적이 아니다.
--
--   0003과 같은 이유로 넣는 동안만 FORCE를 내린다. 마이그레이션 세션은 auth.uid()가 null이라
--   can_approve()를 통과하지 못하고, FORCE는 테이블 소유자까지 정책에 넣기 때문이다.
--   마이그레이션은 한 트랜잭션이라 중간에 실패해도 FORCE가 풀린 채로 남지 않는다.
-- ---------------------------------------------------------------------
alter table business_strategy no force row level security;

insert into business_strategy (
  business_id, mission, goal_1y, goal_3y, top_kpi,
  current_position, target_position, gap, current_priority, bottleneck, chairman_comment
) values
  (
    'biz_dy',
    '접착 소재로 국내 제조 공정의 기준을 만든다.',
    'EVA 자동화 라인 가동률 90% · 연매출 1,100억',
    '핫멜트 국내 1위 · 해외 매출 비중 30%',
    'EVA 자동화 라인 가동률',
    '가동률 89.1% · 수작업 전환 구간 2곳 잔존',
    '가동률 90% 안정 · 전 구간 자동화',
    '0.9%p. 숫자는 코앞이지만 남은 두 구간이 가장 어려운 구간이다.',
    'Hot-melt 판매가 조정 확정 — 원료 단가 +12%를 언제 반영하는가',
    '60일 이상 매출채권. 회수가 밀리면 자동화 2차 투자 시점이 같이 밀린다.',
    '가동률은 이미 목표 근처다. 올해 남은 문제는 라인이 아니라 회수다.'
  ),
  (
    'biz_vana',
    '중견 제조사가 자기 데이터로 의사결정하게 만든다.',
    '북미 ARR 50억 · 캐나다 파일럿 3곳 계약 전환',
    '북미 vertical 3개 · ARR 300억',
    '북미 ARR',
    'ARR 24억 · 캐나다 파일럿 배포 중',
    'ARR 50억 · 첫 vertical에서 레퍼런스 3곳',
    '26억. 파일럿을 계약으로 바꾸지 못하면 숫자가 아니라 방식이 문제다.',
    '첫 North America vertical 확정 — 9월을 넘기면 계약이 4분기로 밀린다',
    'vertical 미확정. 영업·제품·채용이 전부 이 결정 하나를 기다리고 있다.',
    '고를 수 있을 때 고르는 게 낫다. 완벽한 vertical을 기다리다 분기를 잃는다.'
  ),
  (
    'biz_sticky',
    '국내 화학 소재를 유럽 유통망에 얹는다.',
    '폴란드 1차 선적 완료 · 유럽 거래처 5곳',
    '유럽 매출 비중 40% · 현지 물류 거점 확보',
    '유럽 거래처 수',
    '폴란드 1차 선적 준비 · 거래처 2곳',
    '거래처 5곳 · 반복 주문 구조',
    '3곳. 첫 선적이 늦어지면 나머지 협상 카드가 전부 약해진다.',
    '폴란드 통관 서류 최종 확인 — 선적일이 협상 일정 전체를 잡고 있다',
    '폴란드 경쟁사 신규 진입에 따른 판가 압박. 가격으로 맞서면 마진이 남지 않는다.',
    '가격이 아니라 납기로 이긴다. 첫 선적을 날짜에 맞추는 것이 이번 분기의 전부다.'
  ),
  (
    'biz_hof',
    '사람과 눈을 맞추는 로봇을 만든다.',
    'Alpha Face 프로토타입 완성 · 시연 3회',
    '양산 1호기 출하 · 파트너 2곳',
    '프로토타입 진행률',
    '진행률 32% · actuator 후보 미확정',
    '프로토타입 완성 · 시연 가능한 상태',
    '68%p. 일정보다 부품 결정이 앞서야 하는데 그 결정이 서 있다.',
    'Face actuator 후보 비교 — 여기서 막히면 뒤 일정이 통째로 밀린다',
    '핵심 부품 공급 지연 가능성. 후보를 하나로 좁히기 전에는 대안도 세울 수 없다.',
    '육성 단계다. 일정보다 부품 결정의 질을 먼저 본다.'
  ),
  (
    'biz_boram',
    '생활 소비재를 자체 브랜드로 세운다.',
    '시리즈 A 유치 완료 · 자체 브랜드 매출 비중 50%',
    '연매출 300억 · 오프라인 채널 확대',
    '자체 브랜드 매출 비중',
    '브랜드 비중 31% · 시리즈 A 협상 중',
    '브랜드 비중 50% · 투자 유치 완료',
    '19%p와 투자 한 건. 둘 중 투자가 먼저 정리돼야 나머지가 움직인다.',
    '시리즈 A 투자자 제안 검토 — 수용 / 조건 재협상 / 보류',
    '제안 조건이 브랜드 지분 구조를 건드린다. 급하다고 그대로 받으면 3년 목표가 흔들린다.',
    '자금이 급한 것과 조건이 나쁜 것은 다른 문제다. 재협상 여지를 먼저 본다.'
  );

alter table business_strategy force row level security;

-- 확인: 5개사 전부 한 행씩 있는지, 그리고 FORCE가 돌아왔는지.
--   select business_id, left(mission, 20) from business_strategy order by business_id;
--   select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = 'business_strategy';
