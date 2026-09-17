@AGENTS.md

# 데이터 원칙

VANA EBITDA는 시트값 +2.8억 유지.
06_Dummy_Data = 숫자 원천, 03_UX_UI PNG = 레이아웃 참고. 숫자 충돌 시 항상 시트가 이긴다.

회계 원천은 자체 장부다(전표 입력 → 월 마감, 0016). ECOUNT는 DY 엑셀 업로드로만 유입된다 — ECOUNT API 연동은 없다.
마감된 달은 고치지 않는다. 바꿀 것이 있으면 당월에 정정 전표(역분개 + 정정분개)로 넣는다.

야간 AI Job은 권한 매트릭스의 AI Agent 역할로 인증해서 RLS 안에서 돈다. 이 프로젝트에 service_role은 없다.

Vault 문서의 파일 실체는 사내 스토리지에 두고 Chairman OS는 링크만 보관한다(vault_columns.md 선택지 B).
