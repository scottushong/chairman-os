-- =====================================================================
-- Chairman OS — 0018_initiative_logos
-- 출처: Phase 4-A 다듬기 4-a (회장 첫 사용 피드백, 2026-09-19)
--
-- 무엇이 없어서 만드나
--   이니셔티브가 열네 건을 넘어가면 제목만으로는 목록에서 건을 못 찾는다. 회장이 아는 것은
--   상대 회사의 로고다. 카드 그리드(다듬기 4-b)의 왼쪽 자리가 그것을 위한 칸이다.
--
-- 왜 Storage인가 — CLAUDE.md는 '링크만 보관한다'고 했는데
--   그 원칙은 Vault 문서(계약서·실사 자료)의 **파일 실체**에 대한 것이다. 사내 스토리지에
--   두고 Chairman OS는 링크만 든다. 로고는 Vault 문서가 아니다 — 수십 KB짜리 상표 이미지고,
--   사내 스토리지에 올려 링크를 손으로 붙여 넣으라고 하면 회장이 로고를 넣지 않는다.
--   그 대신 비공개 버킷 + RLS로 가둔다. 판단이 바뀌면 이 마이그레이션 하나만 되돌린다.
--
-- 왜 비공개인가
--   어느 회사 로고가 여기 있는지가 곧 '회장이 지금 누구와 협상 중인가'다. 0017이 시드를
--   git에 안 넣은 것과 같은 이유다. 공개 버킷은 경로만 알면 로그인 없이 열린다.
--   화면은 볼 때마다 요청자 세션으로 서명 URL을 발급해 쓴다(만료 1시간).
--
-- 권한 — 0017과 다르다
--   Chairman · GroupCFO   읽기 · 쓰기
--   AIAgent               없음. 0017의 다른 표는 AIAgent에게 읽기를 주지만(야간 브리핑이
--                          멈춘 건을 집어내야 하므로), 여기는 아니다 — 브리핑은 텍스트
--                          요약이고 이미지를 그리지 않는다. 그래서 읽기 정책도
--                          can_read_initiatives()가 아니라 can_write_initiatives()를 쓴다.
--   그 외 역할             없음
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. 로고 경로 칸
--    이름은 logo_url이지만 들어가는 값은 'ini_001/logo' 꼴의 **버킷 내 객체 경로**다.
--    비공개 버킷이라 영구 URL이라는 것이 없다. 칸 이름을 documents.storage_url과 맞췄다.
--    한 건에 객체 하나다(경로가 id로 정해진다) — 다시 올리면 덮어쓰고 고아 객체가 안 생긴다.
-- ---------------------------------------------------------------------
alter table initiatives
  add column if not exists logo_url text;                     -- [일반] null = 로고 없음

comment on column initiatives.logo_url is
  'initiative-logos 버킷 안의 객체 경로(ini_001/logo). 공개 URL이 아니다 — 비공개 버킷이라 볼 때마다 서명 URL을 발급한다. null이면 제목 첫 글자 배지로 떨어진다.';

-- ---------------------------------------------------------------------
-- 2. 비공개 버킷
--    이미 있으면 건드리지 않는다. public을 true로 되돌리지도 않는다 —
--    누가 콘솔에서 공개로 바꿔 뒀다면 그건 사람이 내린 결정이고, 이 파일이
--    조용히 뒤집으면 왜 바뀌었는지 아무도 모른다. 대신 아래 do 블록이 소리를 낸다.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('initiative-logos', 'initiative-logos', false)
on conflict (id) do nothing;

do $$
begin
  if exists (select 1 from storage.buckets where id = 'initiative-logos' and public) then
    raise warning 'initiative-logos 버킷이 공개로 설정되어 있다. 0018의 전제가 깨진다 — 콘솔에서 비공개로 되돌린다.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. 정책
--    bucket_id로 범위를 끊는다. storage.objects에는 다른 버킷의 정책도 함께 산다 —
--    permissive라 이 두 줄은 이 버킷에만 권한을 **더한다**.
--
--    읽기에 can_read_initiatives()가 아니라 can_write_initiatives()를 쓴다.
--    저쪽에는 AIAgent가 들어 있는데 야간 브리핑은 이미지를 읽지 않는다.
--    원 지시도 'Chairman·GroupCFO만 읽기/쓰기'다.
--
--    함수 이름을 public.can_write_initiatives()로 스키마를 붙여 쓴다. 함수는 public
--    스키마(0017)에 있지만 정책은 storage.objects에 붙는다 — 실제 Supabase에서 Storage
--    쿼리는 search_path에 public이 없는 컨텍스트로 평가될 수 있다. 스키마를 안 붙이면
--    그 경우 함수를 못 찾아 전체 거부로 조용히 새거나 예측 불가능하게 행동할 수 있다.
--    PGlite는 search_path가 느슨해 이 문제를 안 잡아낸다 — check:migrations는 통과해도
--    스테이징에서 깨질 수 있으므로 여기서 미리 못 박는다.
-- ---------------------------------------------------------------------
create policy initiative_logos_read on storage.objects for select
  using (bucket_id = 'initiative-logos' and public.can_write_initiatives());

create policy initiative_logos_write on storage.objects for all
  using (bucket_id = 'initiative-logos' and public.can_write_initiatives())
  with check (bucket_id = 'initiative-logos' and public.can_write_initiatives());

commit;
