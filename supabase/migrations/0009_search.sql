-- =====================================================================
-- Chairman OS — 0009_search
-- 출처: 02_기능명세 CH-043 Global Search
-- 작성: Phase 1-C (2026-09-06)
--
-- 왜 한국어는 full-text가 아닌가
--   Postgres의 full-text는 '단어'를 알아야 동작한다. 그 단어를 자르는 사전(text search
--   configuration)이 영어·독일어 등에는 기본으로 있지만 한국어는 없다.
--   Supabase에도 mecab/pg_bigm 같은 형태소 확장이 올라가 있지 않다.
--
--   'simple' 설정으로 억지로 만들면 공백과 문장부호로만 자른다. 그러면
--     '매출채권'  → 토큰 하나. '매출'로는 절대 안 잡힌다.
--     '핫멜트 폴란드 수출' → 토큰 셋. '폴란드'는 잡히지만 '멜트'는 안 잡힌다.
--   회장이 검색창에 치는 말은 대개 저 '매출'이나 '멜트' 쪽이다.
--
--   그래서 두 길을 같이 깐다.
--     영문·숫자만 친 질의  → tsvector (search_tsv). 단어 단위로 정확하고 빠르다.
--     한글이 섞인 질의     → ILIKE '%…%'. 부분 문자열이라 위 두 경우를 다 잡는다.
--   판정은 앱(repository/supabase.ts)이 하고, 이 파일은 두 길에 각각 색인을 깔아 준다.
--   색인 없는 ILIKE '%…%'는 표 전체를 훑는다 — 지금은 500행이라 티가 안 나지만
--   Phase 2에서 실데이터가 붙는 순간 검색창이 화면을 멈춰 세운다.
--
-- 권한
--   여기서 하는 일은 색인뿐이다. 무엇이 검색 결과에 나오는가는 여전히 0002의 read 정책이 정한다.
--   businesses_read / projects_read / tasks_read / decisions_read / documents_read 가
--   그대로 걸리므로, 검색은 '내가 이미 볼 수 있는 것' 안에서만 찾는다.
--   documents는 거기에 보안등급(class_rank)까지 같이 본다 — 등급 밖 문서는 제목도 안 걸린다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 한글 경로 — ILIKE '%…%' 를 위한 trigram 색인
--    pg_trgm은 사전이 필요 없다. 글자 세 개씩 잘라 색인하므로 한글에도 그대로 먹는다.
--    extensions 스키마에 두는 건 Supabase 관례다 — public에 깔면 스키마 덤프가 지저분해진다.
-- ---------------------------------------------------------------------
create extension if not exists pg_trgm with schema extensions;

create index businesses_name_trgm on businesses using gin (name extensions.gin_trgm_ops);
create index projects_name_trgm   on projects   using gin (name extensions.gin_trgm_ops);
create index tasks_title_trgm     on tasks      using gin (title extensions.gin_trgm_ops);
create index decisions_title_trgm on decisions  using gin (title extensions.gin_trgm_ops);
create index documents_title_trgm on documents  using gin (title extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------
-- 2. 영문 경로 — tsvector 생성 컬럼
--    generated always as … stored 라 앱이 갱신할 것이 없다. 제목을 고치면 색인이 같이 따라간다.
--    트리거로 만들면 '트리거를 다는 걸 잊은 표'가 언젠가 하나 생긴다.
--
--    설정은 'simple'로 못 박는다. 'english'를 쓰면 어간을 잘라(deployment → deploy)
--    같은 질의가 표마다 다르게 걸릴 수 있고, 이 데이터는 영문 비중이 낮아 이득이 없다.
--    regconfig를 상수로 박아야 to_tsvector가 IMMUTABLE이 되고, 그래야 생성 컬럼에 쓸 수 있다.
-- ---------------------------------------------------------------------
alter table businesses add column search_tsv tsvector
  generated always as (
    to_tsvector('simple'::regconfig, coalesce(name, '') || ' ' || coalesce(industry, ''))
  ) stored;

alter table projects add column search_tsv tsvector
  generated always as (to_tsvector('simple'::regconfig, coalesce(name, ''))) stored;

alter table tasks add column search_tsv tsvector
  generated always as (to_tsvector('simple'::regconfig, coalesce(title, ''))) stored;

alter table decisions add column search_tsv tsvector
  generated always as (
    to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || coalesce(ai_recommendation, ''))
  ) stored;

alter table documents add column search_tsv tsvector
  generated always as (
    to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || coalesce(doc_type, ''))
  ) stored;

create index businesses_search_tsv on businesses using gin (search_tsv);
create index projects_search_tsv   on projects   using gin (search_tsv);
create index tasks_search_tsv      on tasks      using gin (search_tsv);
create index decisions_search_tsv  on decisions  using gin (search_tsv);
create index documents_search_tsv  on documents  using gin (search_tsv);

comment on column businesses.search_tsv is
  'CH-043 영문 질의용 색인. 한글 질의는 이 컬럼을 쓰지 않고 name의 trigram 색인으로 간다 — '
  'Postgres에 한국어 형태소 사전이 없어 simple 설정은 ''매출''로 ''매출채권''을 찾지 못한다.';
