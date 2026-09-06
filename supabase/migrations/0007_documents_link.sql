-- =====================================================================
-- Chairman OS — 0007_documents_link
-- 출처: 02_기능명세 CH-042 문서관리 / CLAUDE.md 데이터 원칙 / supabase/vault_columns.md
-- 작성: Phase 1-C (2026-09-06)
--
-- 표 자체는 0001에 이미 있다. 여기서 고치는 건 세 가지다.
--
-- 1) storage_path → storage_url
--    0001은 이 칸을 'Storage 경로'라고 불렀다. 그런데 이 프로젝트는 파일 실체를 갖지 않는다 —
--    사내 스토리지에 두고 링크만 보관한다(CLAUDE.md 데이터 원칙, vault_columns.md 선택지 B).
--    '경로'라는 이름은 언젠가 여기에 버킷 키를 넣어도 되는 것처럼 읽힌다. 이름이 사실을 말해야 한다.
--    0003_seed는 documents에 한 행도 넣지 않으므로(그 파일 머리의 '넣지 않는 테이블') 옮길 값이 없다.
--
-- 2) uploaded_by 추가
--    0001의 owner_user_id는 '문서의 주인'이다. CH-042가 필요로 하는 건 '이 링크를 여기 등록한 사람'이고
--    둘은 다르다 — 비서가 회장 명의 계약서를 등록하면 주인과 등록자가 갈린다.
--    한 칸으로 합치면 감사할 때 둘 중 어느 뜻이었는지 알 수 없다.
--
-- 3) document_id 자동 발급
--    doc_001, doc_002 … 를 DB가 준다. 앱이 max+1을 계산하면 동시에 두 사람이 올릴 때 같은 번호가 난다.
--    시퀀스는 트랜잭션 안에서도 겹치지 않는다. 형식은 시드의 prj_001 / tsk_001 / dec_001과 같은 모양이다.
--
-- RLS는 손대지 않는다. documents_read(0002)가 회사 범위와 보안등급을 이미 같이 본다 —
-- 등급이 모자란 사람에게는 이 표의 행이 존재하지 않는 것처럼 보인다.
-- =====================================================================

alter table documents rename column storage_path to storage_url;

comment on column documents.storage_url is
  'CH-042. 사내 스토리지 링크만 둔다. 파일 실체는 Chairman OS에 없다(CLAUDE.md 데이터 원칙). '
  'Vault 등급 문서도 같은 규칙이다 — 여기 있는 것은 주소지, 내용이 아니다.';

alter table documents
  add column uploaded_by uuid;                            -- [제한] 이 링크를 등록한 사람. owner_user_id(문서의 주인)와 다르다

comment on column documents.uploaded_by is
  'CH-042 등록자. owner_user_id는 문서의 주인이고 이 칸은 링크를 여기 넣은 사람이다. '
  '둘을 한 칸으로 합치면 감사 기록에서 어느 뜻이었는지 구분할 수 없다.';

-- ---------------------------------------------------------------------
-- document_id 자동 발급
--   owned by 를 걸어 두면 표를 지울 때 시퀀스도 같이 사라진다. 남겨 두면 다음 사람이
--   "이 시퀀스는 누가 쓰나"를 다시 조사해야 한다.
-- ---------------------------------------------------------------------
create sequence documents_doc_seq owned by documents.document_id;

alter table documents
  alter column document_id set default 'doc_' || to_char(nextval('documents_doc_seq'), 'FM000');

-- 시퀀스를 못 돌리면 default가 무용지물이고, 그때 나는 오류는 INSERT 지점에서 난다.
-- authenticated 에게 usage 를 준다. 값을 직접 읽는 경로는 없고 default 안에서만 쓰인다.
grant usage on sequence documents_doc_seq to authenticated;
