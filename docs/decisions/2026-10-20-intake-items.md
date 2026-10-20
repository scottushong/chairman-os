# 2026-10-20 PHASE E — «받을 것» 카드 넷 · staging 비밀값 분리

- **표 이름 `owner_inputs`(지시문의 `intake_items` 아님)**: `intake_items`는 0058 «자료 받는 입구»가 이미 쓰는 표다. 같은 이름은 마이그레이션이 깨진다. 검사 이름은 지시대로 `npm run check:intake-items`.
- **0089 안 5절로**: 새 번호를 쓰지 말라는 제약(0086 홈 · 0088 메모리 · 0089 재무 보강) — «받을 것» 넷 중 셋(진짜 BOM · 재고평가방법 · 원가 권한자)이 재무 · 원가 보강이라 0089 묶음에 넣었다. 앞 번호 파일은 고치지 않았다. staging DRYRUN(0086 0089 --skip=0087) 다시 PASS.
- **진짜 BOM**: 기존 길(`/costs/<회사>/bom/import` · 0068 넣기 · 0063 암호문 · exceljs 코드 읽기 · AI 없음)이 있으므로 새 올리기 칸을 만들지 않고 카드에서 그 화면으로 잇는다. «받음»은 진짜 BOM 등록이 성공하면 `commitCostImportAction`이 판 수만 적는다(실패해도 넣기는 그대로). 비공개 버킷 보관 길은 만들지 않았다(필요 없음).
- **재고평가방법**: 0075 `fin_pl_settings.method`(monthly_wa · statement)를 바꾸지 않고 «세무사 확인값»을 나란히 저장(덜 바꾸는 쪽). 다르면 카드에 경고 — 총평균 ≈ 월 가중평균 = 같음, 이동평균 · 선입선출 + monthly_wa = 다름, statement(명세서 금액 그대로) = 같음.
- **구글 서비스 계정**: 이 프로젝트의 비밀 저장은 Supabase Vault(0063 `cost_bom_key`와 같은 방식 · 동적 SQL). 정의자 함수 `owner_input_google_sa_save`가 대표 · 활성 · 스위치를 보고 JSON 모양(type=service_account · private_key · …gserviceaccount.com · project_id)을 검사한 뒤 Vault `google_sheets_sa`에 넣는다(있으면 바꾸기). 표 · 응답 · 오류에는 이메일 · 프로젝트 id만. JSON 해석 · Vault 오류는 삼켜 낱말 하나로. **시트 동기화는 아직 env `GOOGLE_SHEETS_SA_JSON`을 읽는다** — Vault에서 읽게 바꾸는 것은 DEFERRED(동기화 계정이 키를 읽는 좁은 문을 따로 설계해야 함).
- **원가 관리 권한자**: 기존 원가 권한(`user_module_access '/costing/<회사>'` 쓰기 · 0061 회사마다 셋)을 `setModuleGrant`로 주고, `owner_input_mark`가 그 줄이 있을 때만 «받음»을 적는다. 빼는 것은 /settings/users 그대로.
- **보이는 사람**: 대표(Chairman)만 — 화면(/settings는 `isChairman && ownerOn`일 때만 읽고 그림) · 액션 · DB 정책 셋 다. 기능 스위치 `owner_inputs` 기본 대표만.
- **staging 비밀값**: 조사 결과 · 단계는 `docs/onboarding/staging-secrets.md`. 값은 만들지 않았다.
