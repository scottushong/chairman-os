-- =====================================================================
-- Chairman OS — 0006_decision_attachment
-- 출처: 02_기능명세 CH-041 전자결재 / CLAUDE.md 데이터 원칙(Vault)
-- 작성: Phase 1-C (2026-09-06)
--
-- 왜 이 컬럼이 필요한가
--   CH-041 상세 패널은 '내용 · 첨부 · 이력' 셋을 보여 준다. 0001의 decisions에는
--   앞의 둘 중 첨부가 없다. 결재를 올린 사람이 근거 문서를 같이 걸지 못하면
--   회장은 제목 한 줄과 선택안 세 개만 보고 승인을 눌러야 한다.
--
-- 왜 파일이 아니라 링크인가
--   CLAUDE.md 데이터 원칙: 문서의 파일 실체는 사내 스토리지에 두고 Chairman OS는 링크만
--   보관한다(supabase/vault_columns.md 선택지 B). ai_night_outputs.artifact_link이 이미 같은 모양이고,
--   CH-042 문서관리도 같은 규칙을 쓴다. 여기만 파일을 들고 있으면 Vault 판정이 두 곳으로 갈라진다.
--
-- 권한은 손대지 않는다. decisions_read/decisions_decide(0002)가 그대로 이 컬럼까지 덮는다 —
-- 행을 못 보는 사람은 링크도 못 본다.
-- =====================================================================

alter table decisions
  add column attachment_url text;                        -- [제한] 사내 스토리지 링크. 파일 실체는 여기 없다

comment on column decisions.attachment_url is
  'CH-041 첨부. 사내 스토리지 링크만 둔다(CLAUDE.md 데이터 원칙). '
  '파일을 이 DB에 넣지 않는다 — Vault 등급 문서가 섞여 들어오는 경로가 되기 때문이다.';
