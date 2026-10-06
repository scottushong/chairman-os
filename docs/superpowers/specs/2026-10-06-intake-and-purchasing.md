# 자료 받는 입구 · 구매(원료 단가) 설계 (2026-10-06 · 설계만 — 마이그레이션 파일 없음)

대상: ① 재무제표 · 세무사 결산서 → 공식 결산 초안 ② 원료 리스트 · 단가표 · 견적서 → 구매 원료 · 단가 초안 ③ 계약서 · 공문 → 문서 ④ 그 외 → 문서.
공통: 올리기 → 읽기 → 종류 판단 → **제안(«결정 아님»)** → 사람이 확인 → 그 메뉴에 **초안** 적재. 숫자는 늘 사람이 원본과 대조한다.
«첨부»의 목적이 요약에서 **분류 · 적재**로 바뀐다. 요약은 남지만 부산물이다.

## 0. 설계를 정한 사실 · 회장 결정

1. **회장 결정(2026-10-06, 구속).** AI 읽기는 조건부로 허용 — 일반 · 제한 등급만, Vault 금지, AI 출력은 제안뿐(«결정 아님» 표시).
   예전의 일괄 «재무 원본 AI 금지»는 이 조건으로 **바뀐다.** 단 ECOUNT 업로드 원본과 전표 증빙은 계속 AI 제외.
   배합비는 원료 이름 · 단가 · 구입처만 다루고, 배합비로 보이는 것은 AI에 보내지 않고 «Vault에 두세요»로 안내한다.
2. 지금 첨부(0045)는 대상 넷(initiatives · businesses · documents · decisions)에 붙고, 올리면 바로 요약한다(summarize.ts).
   Vault는 파일을 받지 않고(링크 등록 — CLAUDE.md), 요약 경로에서도 두 번 막힌다(summarize.ts ① · DB `record_attachment_ai_send`).
   제한 등급은 «외부 AI 전송» 감사를 **파일을 열기 전에** 남긴다(0045 읽기 통행증). 이 순서를 그대로 쓴다.
3. 스캔 PDF는 feat/intake 26e0563부터 PDF 그대로 document 블록으로 읽는다(30쪽 · base64 30MB 천장, limits.ts). 사진은 base64 5MB 안으로 줄여 올린다.
   기본 모델(`claude-sonnet-4-5`, 컨텍스트 200k)의 PDF 쪽 한도는 100쪽이다 — 30쪽 천장은 비용 때문이다.
4. **master에는 «AI 제외» 표시가 없다.** ECOUNT 원본의 AI 제외는 feat/ecount-import 브랜치에만 있다 — 첨부 대상 `finance_imports`(0050)이고,
   막는 자리는 서버 액션 한 줄(«ECOUNT 업로드 원본은 AI 요약을 하지 않습니다»)이다. DB는 막지 않는다. **전표 증빙은 어느 브랜치에도 아직 없다.**
5. `official_statements`는 **확정 층**이고 그 기간의 월별 입력을 잠근다(0020 · ECOUNT 설계 0.1). ECOUNT 0050이 `basis`('accountant' | 'ecount_excel')를 더한다 —
   잠금 · 기준 문구는 accountant만 센다. 스캔 PDF 결산도 이 칸을 쓴다(아래 B①) → **ECOUNT 병합이 먼저다.**
6. 결재 양식 `purchase`(구매)는 품목 · 구입처(필수) · 수량 · 금액 · 링크를 `decisions.form`(jsonb, 0038)에 담는다(a0be722 권장 설정).
   승인되면 `decisions.status='Approved'`. 단가 이력의 «결재에서 온 후보»가 이것을 읽는다.
7. 사람 × 회사 권한은 0002 `user_module_access` 한 표로 연다 — 키 `'/finance/<biz>'`(0047) · `'/documents/<biz>'`(0048). 구매는 `'/purchasing/<biz>'`.

## A. 공통

### A1. 흐름

```
올리기 ─▶ 읽기 ─▶ 종류 판단 ─▶ 제안 ─▶ 확인 ─▶ 초안 적재 ─▶ (그 메뉴에서) 대조 · 등록
 사람      서버     AI(1회)      카드      사람       서버 RPC         사람
```

1. **올리기** — 회사 화면의 «자료 받는 입구»(지금 «첨부» 칸 자리)에 파일을 놓는다. 등급(일반 · 제한)을 고른다. Vault는 «문서 화면에서 링크로 등록» 그대로.
   `intake_items` 줄 하나 + 첨부 하나(entity `intake_items`). 업로드 길은 지금 첨부와 같다(브라우저 → Storage 직접).
2. **읽기** — 서버가 추출한다(extract.ts 그대로). 글자층이 있으면 먼저 **배합비 검사(A5)** 를 서버에서 돈다 — 걸리면 AI를 부르지 않는다.
   보내기 전에 «외부 AI 전송» 감사(0045 순서 그대로). 글자층이 없는 파일(사진 · 스캔 PDF)은 올린 사람의 «배합비 아님» 확인이 있어야 보낸다(A5).
3. **종류 판단 + 뽑기** — 모델 한 번: `kind`(statement · price_list · contract · official_letter · other) · `confidence` · `reason`(한 줄) ·
   그 종류의 필드(B). 구조 출력(JSON schema). 종류를 사람이 바꾸면 그 종류로 한 번 더 뽑는다(문서 종류는 뽑을 숫자가 없어 다시 부르지 않는다).
4. **제안** — 카드: «AI 제안 — 결정 아님 · 이 파일은 [재무제표]로 보입니다(높음) — 이유: ‹표지에 ‘재무상태표’, 세무법인 직인›».
   버튼: «이 메뉴에 초안 만들기» · «종류 바꾸기» · «그냥 보관(문서)».
5. **확인** — 사람이 누른다. 그 대상 메뉴의 쓰기 권한(A3)이 있어야 누를 수 있다. 없으면 «이 메뉴에 넣을 권한이 없습니다 — ‹담당자›에게 넘기세요»(넘기기 알림은 2단계).
6. **초안 적재** — 대상별 RPC 한 트랜잭션(security invoker). 적재된 것은 **초안**이다 — 결산은 «잠정», 단가는 «초안», 문서는 바로 문서(초안 개념 없음, 되돌리기로 푼다).
   숫자 초안은 대상 메뉴에서 사람이 원본과 대조하고 «등록»을 눌러야 효력이 생긴다.

### A2. 화면

- **입구 목록** `/business/[id]` «자료 받는 입구» 탭(지금 첨부 칸 대체) — 줄마다 파일 · 등급 · 상태(읽는 중 · 제안 · 적재됨 · 실패 · AI 안 보냄) · 제안 종류 · 적재된 곳 링크.
  거르기: «확인 기다림» · «내가 올린 것» · «적재됨». 이니셔티브 · 결재 · 문서 상세의 첨부 칸은 그대로(요약만).
- **제안 카드**(줄을 펼치면) — 종류 · 확신 · 이유 · 뽑은 값 미리보기(결산: 합계 줄 몇 개, 단가: 줄 수 + 앞 5줄, 문서: 제목 · 상대방 · 날짜) · 원본 보기.
- **초안 화면은 대상 메뉴 안**에 둔다(입구가 대상 화면을 흉내 내지 않는다):
  ① `/finance/[biz]/statements/drafts/[id]` ② `/purchasing/[biz]/drafts/[id]` ③④ 바로 `/documents/[id]`.
  초안 화면 머리에 «입구에서 온 초안 · 원본 ‹파일› · AI 제안을 사람이 확인함(‹이름›, ‹시각›)».

### A3. 권한

| 할 일 | 누가 | 최종 판정 |
|---|---|---|
| 입구에 올리기 | 그 회사가 보이는 사람(`has_business`) · 본인 등급 이하 | 0045 attachments insert 규칙 그대로 + `intake_items` insert |
| 제안 보기 | 그 줄이 보이는 사람(첨부 가시성 = 대상 규칙 AND 등급) | `attachment_entity_visible`에 `intake_items` case |
| 종류 바꾸기 · 다시 읽기 | 올린 사람 · 바꿀 종류의 확인 권한자 · 회장 | intake 정책 |
| ① 결산 초안 만들기 · 잠정 등록 | `can_keep_books(biz)`(재무 입력 `'/finance/<biz>'` can_write) | RPC 안 |
| ① 세무사 확정으로 올리기 | 재무 승인(`'/finance/<biz>'` can_approve) · 회장 · GroupCFO | RPC 안 |
| ② 구매 초안 만들기 · 단가 등록 | `'/purchasing/<biz>'` can_write | RPC 안 |
| ③④ 문서 만들기 | `'/documents/<biz>'` 쓰기(0048 `document_grant`) | RPC 안 |
| 되돌리기 | 적재한 사람 · 그 대상의 승인 권한자 · 회장 | RPC 안 |

AIAgent · Integration은 입구 · 구매 표에 쓰지 않는다(0045와 같은 restrictive 세 짝).

### A4. 감사

| 순간 | 기록 | 비고 |
|---|---|---|
| 올리기 | 0045 upload 그대로 | |
| AI에 보냄 | 0045 ai_external_send(파일 열기 **전**) | 제한 등급은 note로 가름 |
| AI 안 보냄(배합비 · 제외 대상) | audit «AI 제외 — 배합비로 보임(규칙 ‹이름›)» | 사람이 «배합비 아님»을 눌러 풀면 그것도 한 줄 |
| 제안 | `intake_items.proposal` + ai_usage_log(feature `intake_classify`) | 감사 줄은 남기지 않는다(제안은 효력 없음) |
| 종류 바꾸기 | audit update(before/after kind) | 사람의 오분류 교정 기록 = 다음 프롬프트 손질 재료 |
| 확인 → 적재 | 대상 RPC 안에서 같은 트랜잭션 | note «입구 ‹item›에서 — AI 제안, ‹역할› 확인» |
| 잠정 등록 · 확정 올리기 · 되돌리기 · 초안 삭제 | 대상 RPC 안 | |

새 감사 낱말은 만들지 않는다 — 기존 create · update · delete_request · ai_external_send + note(0045의 방식).

### A5. AI 데이터 정책

1. **등급**: 일반 → 보냄. 제한 → 보냄 + 외부 AI 전송 감사(먼저). Vault → 파일 자체가 없다(링크만) · DB 함수가 한 번 더 던진다.
2. **제외 대상(등급과 무관하게 보내지 않음)**: ECOUNT 업로드 원본(`finance_imports` 첨부) · 전표 증빙(생기면 그 첨부 대상).
   지금은 서버 액션 한 줄뿐(사실 0.4) → **DB에서 막는다**: `record_attachment_ai_send`가 entity_table이 제외 목록이면 42501.
   읽기 통행증이 이 줄을 보므로, 감사를 못 남기면 Storage가 파일을 내주지 않는다 — 앱이 실수해도 AI로 못 간다. 입구는 이 둘을 받지 않는다(입구로 끌어오면 «AI 제외 자료입니다»).
3. **출력은 제안뿐.** 모델 출력은 `intake_items.proposal`(jsonb)에만 앉는다. 대상 표에 쓰는 것은 사람의 확인 RPC다. 화면 · 저장 모두 «AI 제안 — 결정 아님».
4. **원문은 저장하지 않는다**(0045 원칙 그대로). 뽑은 숫자는 제안 jsonb에 남는다 — 그 등급(일반 · 제한)으로 보인다.
5. **배합비 감지(보내기 전, 서버, 결정적)** — 걸리면 AI를 부르지 않고 «이 파일은 배합비로 보입니다 — AI에 보내지 않았습니다. Vault에 두세요(문서 › 링크로 등록). 올린 파일은 지우세요.»
   - 글자층 있는 파일(xlsx · docx · pptx · 글자 PDF): ⓐ 낱말 — 배합 · 배합비 · 배합표 · 처방 · 레시피 · formula · formulation · recipe · 투입비 · 함량비 · w/w · wt% · phr ·
     ⓑ 모양 — 한 표(시트 · 표 블록)에서 **퍼센트 열이 있고 그 합이 99~101** 이거나, «부(parts)» 열의 합이 100 · 1000 · ⓒ 원료명 열 + 비율 열이 같이 있는 표.
     ⓐ 하나만으로는 걸지 않는다(«배합 사료 단가표» 같은 말이 흔하다) — **ⓑ 또는 ⓐ+ⓒ**일 때 건다.
   - 글자층 없는 파일(사진 · 스캔 PDF): 보내기 전에 읽을 수 없다 → 올린 사람이 «배합비 · 레시피가 아닙니다» 칸을 눌러야 AI에 보낸다(안 누르면 «AI 안 보냄», 수기 분류는 된다).
     2차 문: 프롬프트가 배합 비율 표를 보면 `kind='mix_ratio'`로 답하고 숫자를 뽑지 않게 한다 → 서버가 제안을 버리고 위 안내로 바꾼다(이미 보낸 것은 되돌릴 수 없다 — 그래서 1차 문이 사람이다).
   - 단가 뽑기 스키마(B②)에는 **비율 · 투입량 칸이 없다.** 표에 퍼센트 열이 있어도 옮기지 않는다.
   - **한계(화면에 그대로 적는다)**: 낱말 · 합계 규칙은 비율을 무게(kg/배치)로 적은 표, 암호 같은 코드 이름, 여러 시트에 흩어 놓은 표, 그림 속 표를 놓친다.
     거꾸로 성분표(영양성분 %) · 지분표 · 할인율 표를 잘못 걸 수 있다(그때는 «배합비 아님»으로 풀 수 있는 사람 — F3). 감지는 **안전망이지 보증이 아니다** —
     배합비는 처음부터 Vault에 두는 것이 규칙이다.

### A6. 실패 · 오분류

- **읽기 실패**: «이 파일은 아직 읽을 수 없습니다 — ‹이유›. 파일은 올라갔습니다.»(26e0563의 문장 그대로) + «직접 종류 고르기». AI 없이도 끝까지 갈 수 있다 —
  사람이 종류를 고르면 빈 초안이 생기고 손으로 채운다.
- **오분류**: «종류 바꾸기» → 이전 제안은 `proposal_history`에 남고(무엇을 틀렸는지), 새 종류로 다시 뽑는다. 아직 적재 전이면 다른 일 없음.
- **적재 뒤 되돌리기**: ① 잠정 결산 → supersede(0020 장치, 지우지 않음) ② 단가 초안 → 초안 삭제 · 등록된 단가 → `voided_at`(지우지 않음, 이유 필수)
  ③④ 문서 → 문서 soft delete(첨부는 입구 줄로 돌아온다). 되돌리면 입구 줄이 «제안» 상태로 돌아가 종류를 바꿔 다시 넣을 수 있다.
- **초안 삭제**: 초안(효력 없는 줄)은 만든 사람 · 회장이 지운다(hard delete — 기록이 아니다, check-soft-delete 허용 목록). 입구 줄은 «보관만»으로.
- **이중 적재 막기**: 입구 줄 하나는 활성 적재 하나(`intake_items.loaded_*` unique). 같은 파일(sha256)이 또 오면 «이미 ‹날짜›에 ‹메뉴›로 넣은 파일입니다».

## B. 대상별

### ① 재무제표 · 세무사 결산서 → 공식 결산 초안

- **뽑기**: 기간(연 · 분기) · 회사 이름 · 작성자(세무법인 이름) · 단위(원 · 천원 · 백만원) · 줄[{과목명, 당기, 전기?, 원본 쪽}] · 합계 줄(자산총계 · 부채총계 · 자본총계 ·
  매출액 · 매출총이익 · 영업이익 · 당기순이익)을 **적힌 그대로**.
- **초안 화면**(`statements/drafts/[id]`): 과목명 → 그 회사 활성 계정(정확 일치 먼저, 모호하면 사람이 고름 — ECOUNT ②와 같은 매칭 함수), 부호는 원장 규약으로 뒤집기,
  단위 곱하기. 줄마다 «원본 p.N» 링크.
- **자동 합계 검사(늘 보인다)**: 자산총계 = 부채총계 + 자본총계(1원 차이도 — balance.ts `balanceCheck`) · 유동 + 비유동 = 자산총계 ·
  매출액 − 매출원가 = 매출총이익 · 매출총이익 − 판관비 = 영업이익 · 줄 합 = 문서에 적힌 합계(차액 표시). 하나라도 어긋나면 «등록»이 잠긴다.
- **사람 대조**: 섹션마다 «원본과 대조함» 칸(재무상태표 · 손익계산서). 둘 다 눌러야 등록. 누가 · 언제 눌렀는지 초안에 남는다.
- **등록 = 잠정**: `official_statements.basis='intake_scan'` — 표시 «스캔 PDF(잠정)». ECOUNT 잠정과 같은 층: 월별을 잠그지 않고 기준 문구에 안 쓴다.
  evidence_url = 원본 첨부의 앱 링크, memo «입구 ‹item› · ‹세무법인› · 대조 ‹이름›».
- **«세무사 확정» 후보**: 작성자가 세무법인으로 읽힌 잠정은 «세무사 확정으로 올리기» 버튼이 보인다(A3 승인 권한자). 누르면 같은 줄로 `basis='accountant'` 행을
  `official_statement_save`로 만든다(그 기간 accountant 활성이 있으면 거부 — supersede는 세무사 저장 화면에서만). 잠정 행은 남는다(대조용).
- **ECOUNT 잠정과 같은 기간**: 둘 다 서도 된다(basis가 다르다). 화면은 «ECOUNT 엑셀(잠정)» · «스캔 PDF(잠정)» · «확정»을 나란히 보이고 차이를 표시한다.

### ② 원료 리스트 · 단가표 · 견적서 → 구매 원료 · 단가 초안

- **뽑기(이것만)**: 줄[{원료명, 규격?, 단가, 단위, 통화}] · 구입처(견적서의 발행처) · 날짜(견적일 · 유효기간) · 링크(문서에 있으면). 수량 · 비율 · 투입량은 뽑지 않는다.
- **초안 화면**(`/purchasing/[biz]/drafts/[id]`): 원료명 → 기존 품목(정규화 이름 일치) 또는 «새 품목». 단위가 다른 같은 품목은 경고(kg vs 톤 — 환산하지 않음, 사람이 고침).
  지난 단가와 ±30% 넘게 다르면 노란 표시(읽기 실수인 일이 많다). 줄마다 «대조함» 또는 «전부 대조함».
- **등록**: 줄마다 단가 이력 한 줄(source='intake', 출처 입구 줄). 새 품목은 같은 트랜잭션에서 만든다.

### ③ 계약서 · 공문 → 문서 / ④ 그 외 → 문서

- **뽑기**: 제목 · 상대방 · 날짜 · (계약) 기간 · 만료일 · 금액이 있으면 금액(본문 숫자 그대로) · doc_type(Contract · Letter · Other).
- **확인 = 바로 문서**: `documents` 줄을 만들고 첨부를 그 문서로 옮긴다(RPC가 entity를 `intake_items → documents`로 바꾸는 한 길만 연다 — 다른 재지정은 계속 금지).
  등급은 첨부 등급 그대로. 만료일이 있으면 문서의 만료 알림(있다면)에 넣는 것은 2단계.

## C. 구매 모듈(최소)

- **화면** `/purchasing/[business_id]` — 사이드바 «구매»(그 회사 `'/purchasing/<biz>'` 줄이 있거나 회장 · GroupCFO일 때만).
  탭: «원료 품목»(이름 · 단위 · 최근 단가 · 최근 구입처 · 날짜) · «단가 이력»(품목별 표 + 작은 선 그래프) · «후보»(결재 · 입구에서 온 것) · «수기 입력».
- **원료 품목** — 회사별. 이름 · 규격 · 기본 단위 · 사용 여부. 배합 정보 칸은 **없다**.
- **단가 이력** — 날짜 · 구입처 · 링크 · 단위 · 단가 · 통화 · 출처(결재 · 입구 · 수기) + 출처 참조. 고치지 않는다 — 틀리면 무효(이유) + 새 줄.
- **결재 → 후보**: 승인된 `purchase` 결재(그 회사)의 품목 · 구입처 · 링크 · 금액 ÷ 수량 = 단가 후보(단위는 사람이 채움, 통화 KRW). «넣기»(품목 고르기/새로) · «무시».
  `expense` 결재는 품목 칸이 없어 후보로 만들지 않는다.
- **권한** — `'/purchasing/<biz>'`: can_write = 품목 · 단가 입력 · 후보 처리 · 입구 적재. 줄은 회장만 준다(0047 `module_grant` 함수에 `'/purchasing/%'` 한 갈래).
  읽기 = 그 줄이 있는 사람 · 회장 · GroupCFO · 그 회사 BusinessCEO(단가는 거래 조건이라 회사 안 전원에게 열지 않는다 — F5).
- **배합비 제외** — 표에도 화면에도 자리가 없다. 수기 입력 메모 칸 아래 «배합 · 투입 비율은 여기 적지 않습니다 — Vault»(A5와 같은 문장).

## D. DB 변경(의사 DDL — 파일은 만들지 않는다 · 번호는 병합 시점에 확정)

쓰는 중(2026-10-06 블록 끝): 0050–0052 · 0056 ECOUNT(0053 비움) · 0054–0055 결재 · 온보딩 · **0057은 ECOUNT 전표 증빙 제안**(DEFERRED «전표 증빙 — 0057 제안»). **제안: 0058 입구 · 0059 구매 · 0060 결산 잠정** — 번호는 병합 시점에 확정.

**0058_intake** (입구)
```
intake_items(
  item_id text pk, business_id text not null → businesses,
  attachment_id text not null unique → attachments,           -- 원본 하나 = 줄 하나
  status text check in ('uploaded','reading','proposed','no_ai','failed','loaded','kept','discarded'),
  no_ai_reason text,                                           -- 'mix_ratio' | 'excluded_entity' | 'not_attested'
  mix_attested_by uuid, mix_attested_at timestamptz,           -- 사진 · 스캔본 «배합비 아님» 확인
  proposal jsonb, proposal_history jsonb[] default '{}',        -- AI 제안(결정 아님)
  kind text check in ('statement','price_list','contract','official_letter','other'),  -- 사람이 확인한 종류
  kind_confirmed_by uuid, kind_confirmed_at timestamptz,
  loaded_table text check in ('statement_drafts','purchase_drafts','documents'), loaded_id text,
  file_sha256 text, created_by uuid not null default auth.uid(), created_at, updated_at)
RLS: 읽기 = has_business AND 첨부 등급 규칙(attachment_class_ok) · insert = 본인 · 회사 · update = 칸 단위 grant(status · kind · proposal 등)
     + 정책(올린 사람 · 확인 권한자 · 회장) · delete 없음 · AIAgent/Integration restrictive.
attachments: entity check · attachment_entity_visible · attachments_stamp에 'intake_items' case.
record_attachment_ai_send: entity_table in ('finance_imports', <전표 증빙 대상>) → 42501 'ai_excluded'.
intake_move_to_document(item_id, …) RPC: documents insert + 첨부 entity 재지정(이 한 길만) + 감사.
```

**0059_purchasing** (구매)
```
purchase_items(item_id text pk, business_id, name, name_norm, spec, default_unit, active, created_by, created_at,
  unique(business_id, name_norm))
purchase_prices(price_id bigint identity pk, business_id, item_id → purchase_items,
  observed_on date not null, supplier text not null, link text check (link ~* '^https?://'),
  unit text not null, unit_price numeric(20,4) not null check (> 0), currency char(3) not null default 'KRW',
  source text check in ('approval','intake','manual'), source_ref text,          -- decision_id | intake item_id
  note text, created_by, created_at, voided_at, voided_by, void_reason,
  check ((source = 'manual') = (source_ref is null)), check (voided_at is null or void_reason is not null))
purchase_candidate_dismissals(decision_id pk → decisions, dismissed_by, dismissed_at)
view purchase_price_candidates (security_invoker):
  decisions where template_key='purchase' and status='Approved'
    and decision_id not in (prices.source_ref where source='approval') and not dismissed
  → item · vendor · link · amount/quantity
purchase_drafts(draft_id, business_id, item_id(intake) , lines jsonb, checked_by, checked_at, created_by)  -- 초안, hard delete 허용
purchasing_grant(target, need_write) — 0047 finance_grant와 같은 모양, 키 '/purchasing/<target>'
RLS: 읽기 = has_business AND (Chairman · GroupCFO · 그 회사 BusinessCEO · purchasing_grant(biz,false))
     쓰기 = purchasing_grant(biz,true) · prices update는 void 칸만 · delete 없음(초안 제외) · AIAgent/Integration restrictive.
module_grant 함수: '/purchasing/%' 허용(회장만).
```

**0060_statement_intake** (결산 잠정 — ECOUNT 0050 뒤)
```
official_statements.basis check에 'intake_scan' 추가 · import 칸 옆 intake_item_id text.
statement_drafts(draft_id, business_id, item_id, period_kind, period_key, unit, lines jsonb, totals jsonb,
  bs_checked_by/at, pl_checked_by/at, created_by)   -- 초안
official_statement_import_intake(draft_id) RPC: 균형 · 합계 검사 → 대조 두 칸 확인 → basis='intake_scan' 행 → 감사.
official_statement_promote(statement_id) RPC: 승인 권한 → 같은 줄로 basis='accountant' 행(official_statement_save 경유) → 감사.
```

check-migrations에 셋 다 검사(RLS 역할별 · 제외 대상 42501 · void만 update · 승격 권한).

## E. 구현 블록 · 크기(대략)

| # | 블록 | 시간 | 리뷰 루프 |
|---|---|---|---|
| 0 | 첨부 읽기 고침(스캔 PDF · 사진) — **끝남 26e0563** | 3h | 아니오 |
| 1 | 0058 입구 DB + 제외 대상 DB 문 + check-migrations | 6h | 예(스키마 · RLS) |
| 2 | 입구 화면 · 읽기 · 분류 프롬프트 · 제안 카드 · 종류 바꾸기 · 실패 · 배합비 감지(+검사 스크립트) | 10h | 아니오 |
| 3 | ③④ 문서 적재 · 되돌리기 | 4h | 아니오 |
| 4 | 0059 구매 DB + 모듈 권한 + check-migrations | 6h | 예(스키마 · RLS) |
| 5 | 구매 화면(품목 · 단가 이력 · 수기 · 결재 후보) | 8h | 아니오 |
| 6 | ② 입구 → 단가 초안 → 등록 | 5h | 예(돈 — 단가) |
| 7 | 0060 결산 잠정 basis · 승격 RPC(ECOUNT 병합 뒤) | 4h | 예(돈 · DB) |
| 8 | ① 입구 → 결산 초안 · 매칭 · 합계 검사 · 대조 · 잠정 등록 · 확정 올리기 | 10h | 예(돈) |
| 9 | 감사 문구 · 이중 적재 · 초안 삭제 · 끝 점검(staging 리허설) | 4h | 아니오 |

합 ≈ 60h. 순서: 1 → 2 → 3(입구가 문서로만 먼저 쓸모 있다) → 4 → 5 → 6 → (ECOUNT 병합) → 7 → 8 → 9.
1~3만으로 «올리면 AI가 메뉴를 제안하고 문서로 들어간다»가 선다. 7~8은 ECOUNT 0050이 production에 간 뒤.

## F. 회장이 정할 것

1. **스캔본 비용 천장** — 스캔 PDF 30쪽(1회 ≈ 0.2~0.3달러, 기본 모델)과 «종류 바꾸기 = 한 번 더 읽기»를 그대로 둘지. (권장: 그대로, 30쪽 넘으면 나눠 올림)
2. **세무사 확정으로 올리는 사람** — 재무 승인 권한(`'/finance/<biz>'` can_approve) · 회장 · GroupCFO. (권장) / 다른 안: 회장만.
3. **배합비 감지 해제(«배합비 아님»)를 누가 누르나** — 사진 · 스캔본의 사전 확인은 올린 사람. 글자 파일에서 규칙이 건 것을 푸는 것은 회장만. (권장) / 다른 안: 그 회사 BusinessCEO까지.
4. **사진 · 스캔본은 «배합비 아님» 확인을 늘 받을지** — 한 번 더 누르는 수고 대신 1차 문이 생긴다. (권장: 받는다)
5. **단가 열람 범위** — 구매 입력 권한자 · 회장 · GroupCFO · 그 회사 BusinessCEO. (권장) / 다른 안: 그 회사가 보이는 사람 전원.
6. **원료 품목을 회사별로 둘지 그룹 공통으로 둘지.** (권장: 회사별 — 같은 원료라도 규격 · 거래처가 다르다)
7. **결재 후보의 단가 = 금액 ÷ 수량** 자동 계산을 쓸지(부가세 · 배송비가 섞일 수 있다). (권장: 쓰되 «후보»로만, 사람이 고쳐 넣음)
8. **통화** — KRW 외(USD · CNY 등)를 받고 환산은 하지 않는다. (권장)
9. **회사 화면의 «첨부» 칸을 «자료 받는 입구»로 바꿀지**(이니셔티브 · 결재 · 문서의 첨부 칸은 요약만 그대로). (권장: 바꾼다)
10. **«재무 원본 AI 금지» 문구 개정** — 정책 문서 · 화면 안내를 «일반 · 제한만 · Vault 금지 · 제안뿐 · ECOUNT 원본 · 전표 증빙 제외»로 바꾸는 것을 확인.
