-- ---------------------------------------------------------------------
-- 0036. 프로세스차트 — DY 영업, 맨 앞에 둔다.
--
-- 회장 지시 원문: "프로세스차트에 이것도 같이 올려줘. 영업 프로세스차트인데,
-- 프로세스차트 안에서 이것이 제일 먼저 보이게 해줘."
--
-- **0021을 고치지 않는다.** 0021은 이미 staging·production에 적용된 마이그레이션이라
-- 시드 블록을 손댈 수 없다 — 여기서는 앞으로만 나아간다. 표·RLS·감사 트리거는 0021이
-- 이미 다 지어 놨으므로 이 파일은 시드 한 줄만 보탠다.
--
-- **정렬은 sort_order다, id가 아니다.** 조회는 business_id, sort_order 순으로 온다
-- (src/lib/repository/supabase.ts의 listProcessCharts). 0021이 넣은 두 팀이 10·20이라
-- 그보다 작은 값이면 맨 앞에 온다 — 5로 정한다.
--
-- **기존 두 행의 sort_order는 건드리지 않는다.** 10·20을 15·25로 밀거나 하지 않는다.
-- 그 값은 /settings/process-charts에서 회장이 직접 바꾸는 값이라, 이번 작업이 남의
-- 자리를 옮기는 부작용을 만들 이유가 없다 — 앞에 5 하나를 끼워 넣는 편이 다른 두 행을
-- 다시 쓰는 것보다 싸고, 나중에 또 하나가 앞에 와야 할 때도 같은 방식(더 작은 번호를
-- 끼워 넣는다)이 반복 가능하다.
--
-- 시드 스킵도 0021과 같은 모양이다: updated_by는 auth.uid()가 비는 마이그레이션
-- 실행 시점이라 회장 계정을 찾아 넣어야 하는데, 부트스트랩(0004) 전에 이 마이그레이션이
-- 먼저 돌면 회장이 아직 없다 — 그때는 조용히 성공하는 대신 notice만 남기고 건너뛴다.
-- ---------------------------------------------------------------------
do $seed$
declare
  v_chairman uuid;
begin
  select user_id into v_chairman from user_profiles where role = 'Chairman' order by created_at limit 1;
  if v_chairman is null then
    raise notice '0036: Chairman 계정이 없어 영업 프로세스차트 시드를 건너뛴다 (0004 뒤에 손으로 넣는다).';
    return;
  end if;

  insert into process_charts (business_id, team_name, title, embed_url, sort_order, updated_by)
  values
    ('biz_dy', '영업', 'DY 영업 업무 프로세스',
     'https://docs.google.com/spreadsheets/d/e/2PACX-1vTIW44d3lfRw9wIy61BL3u0y5Nfi2fdHEyOMzSfef1BP_NLus2WPez8PDB997sFq3iQ1RbYhh2FHZ2i/pubhtml',
     5, v_chairman)
  on conflict (business_id, team_name) do nothing;
end;
$seed$;
