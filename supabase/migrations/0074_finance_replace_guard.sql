-- =====================================================================
-- Chairman OS — 0074_finance_replace_guard (원료 출고 · 재고 «바꾸기» · «되돌리기»는 대표 · CFO만)
-- 작성: 2026-10-12 · 대표 결정(같은 날, 8시간 자율 블록 PHASE 2)
--
-- ■ 왜 ■
--   0072 리뷰 I2의 남은 위험: 이미 넣은 달의 원료 출고(material_issue)나 재고(inventory)를 «바꾸기»로 다시 넣으면
--   전후 요약 합계의 차이로 바뀐 원료 하나의 kg를 짐작할 수 있다. 바꾸기를 대표 · CFO만 하게 해서 그 길을 좁힌다.
--   리뷰(같은 날): 되돌리기도 같은 차분을 만든다(대표가 바꾼 것을 직원이 되돌리면 옛 값이 살아나고,
--   하나뿐인 올리기를 되돌린 뒤 «처음 넣기»를 하면 사실상 바꾸기다) — 그래서 applied → reverted도 대표 · CFO만.
--   (처음 넣기 · «기존 값 유지» · 다른 종류는 그대로다.)
--
-- ■ 어떻게 ■
--   fin_upload_apply(0072)는 고치지 않는다. 바꾸기는 언제나 옛 올리기 줄을 applied → replaced로 바꾸므로
--   fin_uploads에 before update 트리거 하나를 건다. 그 두 종류에서 applied → replaced는 대표 · 그룹 CFO 세션만.
--   거부되면 넣기 트랜잭션 전체가 되돌아간다(새 줄 · 무효 표시 · 감사 모두).
--   auth_role()은 호출한 사람의 역할이다(정의자 함수 안에서도 JWT를 본다).
--
-- 0035 규칙: 0001~0073을 고치지 않는다 · force를 새로 걸지 않는다. 함수는 public · anon에서 회수.
-- =====================================================================

begin;

create or replace function fin_upload_replace_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if old.status = 'applied' and new.status in ('replaced', 'reverted')
     and old.kind in ('material_issue', 'inventory')
     and auth_role() is distinct from 'Chairman' and auth_role() is distinct from 'GroupCFO' then
    raise exception 'fin_replace_restricted' using errcode = '42501',
      hint = '원료 출고 · 재고 자료의 바꾸기 · 되돌리기는 대표 · CFO만 합니다(원료 하나의 양이 드러나지 않게).';
  end if;
  return new;
end;
$fn$;

comment on function fin_upload_replace_guard() is
  '0074. 원료 출고 · 재고 올리기의 «바꾸기»(applied → replaced) · «되돌리기»(applied → reverted)는 대표 · 그룹 CFO만. 0072 리뷰 I2의 합계 차분 위험을 좁힌다.';

drop trigger if exists fin_upload_replace_guard_trigger on fin_uploads;
create trigger fin_upload_replace_guard_trigger
  before update of status on fin_uploads
  for each row execute function fin_upload_replace_guard();

revoke all on function fin_upload_replace_guard() from public, anon, authenticated;

commit;
