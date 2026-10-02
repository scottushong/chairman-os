-- =====================================================================
-- Chairman OS — 0048_document_module_grants (문서 등록 권한 · 사람 × 회사 단위)
-- 작성: 2026-10-02 (회장 결정 ② — 문서 등록도 0047 재무처럼 사람 × 회사로 준다)
--
-- 회장 지시: 문서 등록은 0047의 재무 모듈 권한과 똑같이 **사람 × 회사**로 준다. 회장이 사용자 화면에서
-- «문서 → DY: 문서 등록»을 켜면 그 사람이 DY 문서(와 DY 폴더)를 등록 · 고친다. 다른 회사는 그대로다.
--
-- ■ 무엇이 없어서 만드나 ■
--   documents의 insert · update(0012)와 doc_folders의 insert · update · delete(0038:425-431)가 전부
--   «has_business(business_id) and can_module('/core/search', true)»를 본다. '/core/search'는 회사가 없는
--   **전역** 모듈 키라 줄 하나가 그 사람의 모든 회사 문서 쓰기를 연다 — 그래서 아무에게도 주지 않았고,
--   실제로는 회장(can_module이 무조건 참)만 문서를 등록했다. staging 리허설에서 DY 경영지원 TeamLead
--   (Normal 등급 · '/finance/biz_dy' 권한)가 DY 문서를 넣다가 42501을 받았다.
--
-- ■ 왜 이 모양인가 — 0047과 같은 표, 같은 키 모양 ■
--   새 표를 만들지 않는다. 0002 user_module_access에 키 **'/documents/<business_id>'**(예 '/documents/biz_dy')
--   한 줄이다 — 화면 경로(/documents)에 회사를 붙인, 0047 '/finance/<business_id>'와 같은 모양.
--     can_write   = 그 회사의 문서 등록(documents · doc_folders의 insert · update · delete)
--     can_approve = 쓰지 않는다(늘 false). 화면은 칸 하나만 그리고, 끄면 줄을 지운다.
--   회사를 키에 넣는 이유는 0047 리뷰 I1과 같다 — 회사 접근(user_business_access)과 문서 등록 권한은
--   다른 결정이라, 회사 접근을 하나 더 준다고 그 회사 문서 등록이 조용히 열리면 안 된다. 그래서 둘 다 요구한다.
--   **읽기는 바꾸지 않는다.** 0026 documents_read(회사 · 등급 · subtree)와 0038 doc_folders_read가 그대로다.
--   줄이 있다고 문서가 더 보이지 않는다(재무와 다른 점 — 재무는 줄이 읽기까지 열었다).
--
-- ■ 판정 함수 ■
--   document_grant(target, need_write)  '/documents/<target>' 줄이 있는가(요구한 칸까지). 0047 finance_grant와
--       같은 규칙 — 사람 역할만(AIAgent · Integration은 줄이 있어도 false) · is_active() · target이 null이면 false.
--   can_write_documents(target)  is_active() and has_business(target) and
--       (Chairman · 옛 '/core/search' 쓰기 줄 · document_grant(target, 쓰기)).
--       **옛 '/core/search' 분기를 남긴다** — 그 줄을 이미 가진 사람의 권한이 0048로 줄어들지 않게.
--       그 키는 전역이라 언젠가 걷어야 한다(DEFERRED). GroupCFO는 역할로 넣지 않았다 — 회장 결정은 «사람 × 회사»이고,
--       그룹 공통(business_id null) 문서는 지금처럼 회장(과 옛 줄)만 쓴다.
--
-- ■ 바꾸는 정책 (drop + 다시 만든다 — 이름 그대로) ■
--   documents_insert   with check (can_write_documents(business_id) and 등급 ≤ 내 열람 등급 and uploaded_by = auth.uid())
--   documents_update   using (can_write_documents(business_id) and (회장 or uploaded_by = auth.uid()))
--                      with check (같은 것 and 등급 ≤ 내 열람 등급)
--   doc_folders_insert · doc_folders_update · doc_folders_delete — «has_business and can_module('/core/search', true)»
--       자리에 can_write_documents(business_id). doc_folders_insert의 created_by = auth.uid()는 그대로,
--       update · delete에는 «회장 or created_by = auth.uid()»를 더했다(리뷰 M4).
--   documents_owner_guard (새 트리거, before update of owner_user_id, uploaded_by — security invoker)
--       회장이 아닌 세션이 주인 · 등록자 칸을 바꾸면 42501. 주인 재지정은 회장만이다.
--
--   **자기 것만(리뷰 I1 · I2).** 0048 전에는 쓰기 = 회장뿐이라 아무도 갖지 않았던 힘이 직원에게 가지 않게:
--   · insert의 uploaded_by는 본인(회장도). documents_read가 uploaded_by · owner_user_id로 보이는 범위를 정해서,
--     남의 이름으로 넣으면 보이는 범위가 바뀐다. owner_user_id는 묶지 않았다(비서 → 회장 명의, 0026 · DEFERRED).
--   · update는 자기가 올린 문서만(회장은 전부) — 남의 문서 등급 낮추기 · 링크 바꿔치기 · 주인 칸 빼앗기를 닫는다.
--     soft_delete()는 security invoker라 같은 줄을 탄다 — 직원은 자기가 올린 문서만 지운다(의도).
--   · 이 조건은 옛 '/core/search' 줄에도 걸린다(줄을 가진 실제 사람이 없다 — DEFERRED).
--   · documents update에는 DB 감사 트리거가 없다(앱만 남긴다 — DEFERRED Minor).
--   **documents_delete는 다시 만들지 않는다.** 0042 5절이 soft delete로 옮기며 documents의 permissive DELETE
--   정책을 지웠다(지우기 = soft_delete()가 deleted_at을 적는 update). 여기서 되살리면 hard delete 길이 다시 열린다.
--   남기는 것: 0013 ai_agent_no_* · 0015 integration_no_* · 0042 soft_delete_hidden(documents) ·
--   0038 ai_agent_no_* · integration_no_*(doc_folders) restrictive 정책, 0038 documents_version · doc_folders_same_business 트리거.
--
--   **등급 칸(새 조건).** 지금까지 documents insert에는 등급 검사가 없었다 — '/core/search'를 가진 사람이 회장뿐이라
--   드러나지 않았을 뿐이다. 리허설의 «Normal 직원의 Vault 문서 insert 42501»은 등급 때문이 아니라 '/core/search'
--   줄이 없어서였다(앱이 insert … returning으로 읽어 오면 documents_read도 걸리지만, returning 없는 insert는 통과한다).
--   0048로 직원이 쓰기를 받는 순간 Normal 직원이 Vault · Restricted 문서를 넣는 길이 열리므로, insert와 update의
--   with check에 class_rank(security_class) <= class_rank(max_class())를 더한다 — documents_read와 같은 식이다.
--   회장(Vault)은 그대로 Vault 링크를 등록한다. 등급을 자기 열람 등급 위로 올리는 update도 같은 줄이 막는다.
--
-- ■ 거두는 길 ■
--   ① 화면: 회장이 체크를 끄면 줄을 지운다(lib/repository/supabase.ts setModuleGrant — 감사 먼저).
--   ② 회수: 0047 finance_profile_grants()가 user_profiles.revoked_at이 채워지는 순간 그 사람의 user_module_access
--      줄을 **접두사와 무관하게 전부** 지운다('/documents/…'도 포함 — 재초대가 옛 권한을 살리지 못한다). 줄마다 감사.
--   ③ 자리 이동: 0047의 «경영지원 팀장 기본값 줄만 삭제»는 '/finance/biz_dy'만 본다. 문서 줄은 기본값이 없으니
--      (아래) 자리를 옮겨도 그대로다 — 회장이 손으로 준 것이라 손으로 거둔다.
--   기본 권한은 없다 — 0048을 작게 두려고 가입 · 자리 이동에 자동으로 붙이지 않는다. 회장이 사용자 화면에서 켠다.
--   감사 줄의 business_id: 0047 module_grant_audit()이 '/finance/'만 회사로 읽었다 — '/documents/'도 읽게 고친다(3절).
--
-- ■ 화면 ■
--   사용자 화면(조직도 · 사람 패널)의 «모듈 권한»에 «문서» 묶음 — 회사마다 «문서 등록» 칸 하나(src/types/access.ts
--   MODULE_GRANT_OPTIONS). 세션(lib/auth/session.ts)이 본인 줄을 0002 module_access_self_read로 읽어
--   SessionUser.documents를 만들고, /documents의 «링크 등록» · «+ 폴더»는 쓸 수 있는 회사가 하나도 없으면 그리지 않고
--   회사 고르기를 쓸 수 있는 회사로 줄인다. Server Action이 두 번째 문(한국어 거부), DB(이 파일)가 마지막 문이다.
--
-- 0035 규칙: force를 새로 걸지 않는다 · 0001~0047을 고치지 않는다(함수는 create or replace, 정책은
-- drop + create) · 새 audit_action 값 없음(permission_change). 판정 함수는 anon에게서 걷지 않는다 —
-- 정책이 부르는 함수에 실행 권한이 없으면 0행이 아니라 42501이 된다(0047 머리 주석 · /api/health).
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 판정 함수
-- =====================================================================

/** '/documents/<target>' 모듈 줄이 있는가. 사람 역할만. need_write는 그 칸까지 요구한다. */
create or replace function document_grant(target text, need_write boolean default false)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active()
     and target is not null
     and auth_role()::text not in ('AIAgent', 'Integration')
     and exists (
       select 1 from user_module_access
        where user_id = auth.uid()
          and module = '/documents/' || target
          and (not need_write or can_write)
     );
$fn$;

comment on function document_grant(text, boolean) is
  '0048. 사람 × 회사 단위 문서 모듈 권한(user_module_access ''/documents/<business_id>''). AIAgent · Integration은 줄이 있어도 false.';

/** 이 회사의 문서 · 폴더를 등록 · 고칠 수 있는가. 회사 범위 AND (회장 · 옛 전역 줄 · 그 회사의 문서 줄). */
create or replace function can_write_documents(target text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and has_business(target) and (
    auth_role() = 'Chairman'
    or can_module('/core/search', true)
    or document_grant(target, true)
  );
$fn$;

comment on function can_write_documents(text) is
  '0048. 문서 · 폴더 쓰기의 문. has_business(target) AND (Chairman OR 옛 ''/core/search'' 쓰기 OR ''/documents/<target>'' can_write).';

-- =====================================================================
-- 2절. documents · doc_folders 쓰기 정책
-- =====================================================================
-- 등록자 칸은 본인이다(회장도). documents_read가 uploaded_by로 보이는 범위를 정하므로, 남의 이름으로 넣으면
-- 그 사람(과 그 위 subtree)에게 문서가 보이는 범위가 바뀐다(리뷰 I1). owner_user_id는 묶지 않는다 — 비서가 회장
-- 명의로 등록하는 길(0026 머리 주석)이 그 칸이다(DEFERRED).
drop policy if exists documents_insert on documents;
create policy documents_insert on documents
  for insert with check (
    can_write_documents(business_id)
    and class_rank(security_class) <= class_rank(max_class())
    and uploaded_by = auth.uid()
  );

-- 고치기(soft delete 포함)는 **자기가 올린 문서만** — 회장은 전부(리뷰 I2). 0048 전에는 쓰기 = 회장뿐이라 남의 문서의
-- 등급 낮추기(Restricted → Public = 회사 전체 공개) · 링크 바꿔치기 · 주인 칸 고쳐 쓰기가 아무에게도 열려 있지 않았다.
drop policy if exists documents_update on documents;
create policy documents_update on documents
  for update using (
    can_write_documents(business_id)
    and (auth_role() = 'Chairman' or uploaded_by = auth.uid())
  )
  with check (
    can_write_documents(business_id)
    and class_rank(security_class) <= class_rank(max_class())
    and (auth_role() = 'Chairman' or uploaded_by = auth.uid())
  );

/**
 * 주인 칸(owner_user_id · uploaded_by)은 회장만 바꾼다. 정책의 with check는 «새 줄의 uploaded_by = 나»만 보므로
 * 자기 문서의 owner_user_id를 남에게(또는 남의 문서를 자기에게 — using이 막지만) 돌리는 길이 남는다. 그 칸이
 * documents_read의 subtree 판정 입력이라 트리거로 닫는다. **security invoker** — 권한을 새로 주지 않고 거부만 한다.
 * 세션 없는 수정(auth.uid() null — 마이그레이션 · SQL 편집기 백필)은 막지 않는다(0026 백필과 같은 길).
 */
create or replace function documents_owner_guard() returns trigger
language plpgsql security invoker set search_path = public as $fn$
begin
  if auth.uid() is not null
     and coalesce(auth_role()::text, '') <> 'Chairman'
     and (new.owner_user_id is distinct from old.owner_user_id
          or new.uploaded_by is distinct from old.uploaded_by) then
    raise exception using errcode = '42501', message = 'document_owner_change_forbidden',
      detail = '문서의 주인 · 등록자 칸은 회장만 바꾼다(0048).';
  end if;
  return new;
end;
$fn$;

drop trigger if exists documents_owner_guard_trigger on documents;
create trigger documents_owner_guard_trigger
  before update of owner_user_id, uploaded_by on documents
  for each row execute function documents_owner_guard();

-- 0042가 지운 정책이다. 이미 없으면 아무 일도 없고, 혹시 남아 있는 DB에서는 soft delete 설계대로 걷는다.
drop policy if exists documents_delete on documents;

drop policy if exists doc_folders_insert on doc_folders;
create policy doc_folders_insert on doc_folders
  for insert with check (can_write_documents(business_id) and created_by = auth.uid());

-- 폴더 고치기 · 지우기는 만든 사람 또는 회장(리뷰 M4). 남의 폴더를 지우면 안의 문서가 회사 바로 밑으로 쏟아진다.
drop policy if exists doc_folders_update on doc_folders;
create policy doc_folders_update on doc_folders
  for update using (can_write_documents(business_id) and (auth_role() = 'Chairman' or created_by = auth.uid()))
  with check (can_write_documents(business_id) and (auth_role() = 'Chairman' or created_by = auth.uid()));

drop policy if exists doc_folders_delete on doc_folders;
create policy doc_folders_delete on doc_folders
  for delete using (can_write_documents(business_id) and (auth_role() = 'Chairman' or created_by = auth.uid()));

-- =====================================================================
-- 3절. 감사 줄의 회사 — '/documents/<biz>'도 회사로 읽는다
--
--   0047 4절의 module_grant_audit() 본문 그대로이고, business_id 식만 '/finance/'에서
--   '/finance/' · '/documents/' 둘로 넓혔다. 회수 트리거(finance_profile_grants)가 문서 줄을 지울 때 감사가
--   그 회사로 걸리게. 권한(revoke)은 create or replace가 지키지만 같은 줄을 한 번 더 적는다.
-- =====================================================================
create or replace function module_grant_audit(p_user uuid, p_module text, p_before jsonb, p_after jsonb, p_note text)
returns void
language plpgsql security definer set search_path = public as $fn$
begin
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('permission_change', 'user_module_access', p_user::text,
          substring(p_module from '^/(?:finance|documents)/([a-z0-9_]+)$'),
          auth.uid(), auth_role()::text, p_before, p_after, p_note);
exception when others then
  raise warning 'module_grant_audit 실패 (%, %): %', p_user, p_module, sqlerrm;
end;
$fn$;

revoke all on function module_grant_audit(uuid, text, jsonb, jsonb, text) from public, anon, authenticated;

commit;
