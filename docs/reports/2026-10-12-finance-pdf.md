# 회계 · 재무 자료 올리기 2차 — PDF · 사진(jpg · png) — C 보고

- 날짜: 2026-10-12
- 브랜치: `feat/finance-pdf` (워크트리 `C:\Users\Edison Hong\projects\chairman-os-next`, `feat/finance-v21` 69f8762 위)
- 화면: `/finance/<회사>/upload`(예: dummy `http://localhost:3105/finance/biz_dy/upload`) — 놓는 칸 하나에 엑셀 · PDF · 사진을 함께 놓는다.
- **마이그레이션 없음**(0073 안 씀). push 없음 · staging · 운영 반영 없음 · 진짜 AI 호출 0회 · 진짜 회사 파일 없음(가짜 파일은 전부 코드로 만듦).

## 결과

| 항목 | 결과 |
|---|---|
| 1. 열기 | PDF: unpdf(PDF.js)로 쪽마다 글 조각을 받아 줄(같은 높이) · 칸(틈, x 위치)으로 다시 세운다. 쪽당 글이 20자 미만이면 스캔. **스캔은 쪽 그림으로 바꾸지 않고 PDF 그대로 모델에 document 블록으로** 보낸다 — 쪽 그림을 만들려면 canvas 같은 새 의존성이 필요해서(Claude는 스캔 PDF를 쪽 그림으로 읽는다). 10쪽까지. 사진: sharp `rotate()`로 EXIF 방향대로 바로 세우고, **작은 기울기(±10°)는 새 의존성 없이 펼친다** — 600px 회색 그림의 어두운 점을 0.25° 걸음으로 돌려 가로 막대그림 제곱합이 가장 큰 각도(표 줄 · 글줄이 수평일 때 최대)를 찾아 반대로 돌림. 긴 변 1,568px JPEG. `src/lib/finance-upload/doc-open.ts` |
| 2. 읽기(AI) | AI는 JSON만: 종류 · 회사 · 기간 · 제목 · 머리글 · 줄 · 합계/소계 줄(덮는 줄 번호) · 믿음 · 이유. 글 PDF는 **카드번호를 가린 글만** 보내고(그림 안 보냄), 스캔은 PDF, 사진은 JPEG. 한 파일 = 한 번 호출. 구조화 출력(json_schema) · 프롬프트 캐시. **AI는 DB에 쓰지 않는다** — 받은 표를 앱 코드가 시트로 바꿔 0070 길(버리기 → 분류 → 읽기 → 검증 → 다섯 조건 → 사람 세션의 `fin_upload_*` RPC)로 보낸다. 코드 판단과 AI 종류가 같아야 «높음». `ai-doc.ts` · 프롬프트 `src/lib/ai/prompts/finance-upload-read.md` |
| 3. 검증(코드) | 합계 · 소계 줄 = 줄의 합(칸마다, 1원까지) — 다르면 «합계가 맞지 않습니다 — «합계» 이용금액 칸: 줄의 합 42,000 · 표의 합계 45,000» → 확인 필요. 글 PDF는 AI가 적은 숫자가 PDF 글에 정말 있는지 대조(없으면 확인 필요). 문서의 회사 이름이 다르면 경고. 0070 · 0072 다섯 조건 그대로. **사진 · 스캔 PDF는 믿음 «높음»이어도 2027-01-12 전까지 미리보기** — 시작일 상수 `DOC_REVIEW_START = 2026-10-12` + 3개월, env `FINANCE_UPLOAD_DOC_REVIEW_UNTIL=YYYY-MM-DD`로 바꿈(`doc-read.ts`). 글 PDF는 이 규칙 밖(다섯 조건을 넘으면 자동) |
| 4. 막기 | AI 전에 코드가(파일 이름 + 뽑은 글, 스캔으로 본 PDF도 조금 있는 글은 본다): 급여대장 PDF · 사진 → «급여대장은 엑셀로 올려 주세요»(이름 · 주민번호 모양 · 급여대장 낱말) · 제조지시명세서 → «제조지시명세서는 엑셀로 올려 주세요» · 원료 출고명세 → «엑셀로»(0072 kg 노출 금지와 같은 자리). 배합비 · 구성표 · 레시피로 보이는 파일(엑셀 포함 — 이름 · 시트 이름 · 앞 8줄 낱말, 글 PDF는 입구 0058의 표 모양 감지 `detectMixRatio`도 — 결산서는 구성비 % 열 때문에 뺌) → «이 파일은 받을 수 없습니다», **fin_uploads 기록 줄도 없음 · AI 없음**. 급여 · 제조지시 거부는 실패 기록(파일 이름 · 해시 · 문구만, 내용 없음). 이름이 평범한 스캔을 AI가 급여 · 제조지시 · 출고명세로 읽으면 결과를 버리고 같은 문구로 막는다. 막는 목록은 `src/lib/finance-upload/doc-guard.ts`(AI 경로 밖 — check:cost-import 규칙) |
| 5. 세무사 결산 | «표준재무제표 · 재무제표 · 재무상태표 · 손익계산서 · 결산서 · 세무조정»(이름) 또는 글에 재무상태표 + 손익계산서 → **자료 표(fin_*)에 넣지 않고 «공식 결산» 미리보기**: 계정과목 맞추기(이름 · 괄호 무시, 못 맞추면 줄마다 고름) · 원장 부호(매출 · 부채 · 자본 · 영업외수익 · 누계액 음수) · 균형(자산 = 부채 + 자본) · 연도 · 증빙 링크 · 메모. «확인하고 공식 결산으로 저장»은 기존 `saveOfficialStatement` → 0020 `official_statement_save`(can_keep_books · 균형 · 감사는 DB). 자동 없음. 미리보기는 저장하지 않는다(화면을 떠나면 다시 올림). fin_uploads에는 «공식 결산으로 보냄» 실패 줄 하나(내용 없음 — AI 사용 수를 하루 한도에 셈) |
| 6. 입구 스위치 | `intakeOpenFor(user)`(INTAKE_OPEN_TO_STAFF=false → 대표만). 직원이 PDF · 사진을 놓으면 카드 «준비 중» + «PDF · 사진은 준비 중입니다 — …(엑셀은 그대로 받습니다)», 엑셀은 그대로 자동 넣기. 서버 액션이 판정(화면 문구는 안내만) |
| 7. 비용 · 한도 | 0070 env 그대로: `FINANCE_UPLOAD_AI_PER_FILE` · `FINANCE_UPLOAD_AI_PER_DAY`(하루 = 그 회사 오늘 fin_uploads.ai_used 합 — 공식 결산 줄 포함). 넘거나 env 없음 → 글 PDF는 코드가 칸 위치로 세운 표로 **미리보기**(«AI 한도(파일당 · 하루)를 넘었습니다 — AI 없이 칸 위치로 세운 표라 사람이 봅니다»), 사진 · 스캔은 읽을 수 없어 실패 카드(저장 없음 — «내일 다시 올리거나 엑셀로»). 호출마다 `ai_usage_log`(feature `finance_upload_read`, 0070처럼 `estimateCostUsd`). 아래 쪽당 비용 |
| 8. DB | **마이그레이션 없음.** «처음 3개월» 규칙은 앱이 자동/미리보기를 정하는 자리(RPC 부르기 전)에서만 쓰여 형식 칸이 필요 없다 — DB로 강제해도 같은 권한자는 미리보기 길로 같은 줄을 넣을 수 있어 보안이 늘지 않는다. 형식은 대기 줄 `pending.meta.source_format`(pdf_text · pdf_scan · image)과 파일 이름 확장자에 남는다. 0073은 비워 둠 |

## 쪽당 비용 추정(진짜 호출 없이 — 추정)

- 모델: `DEFAULT_AI_MODEL = claude-sonnet-4-5`(`src/lib/ai/anthropic.ts`, env `AI_MODEL`로 바꿈). 단가는 `src/lib/ai/pricing.ts`의 `claude-sonnet-4` 줄 = 입력 $3 · 출력 $15 / 100만 토큰, 캐시 읽기 0.1배 · 쓰기 1.25배.
- 가정(추정치): 지시문 + 종류 목록 약 1,500토큰(두 번째부터 캐시) · 출력(표 JSON) 약 1,500토큰/쪽.
  - 글 PDF 1쪽: 글 약 1,000토큰 → 입력 2,500 · 출력 1,500 ≈ **$0.030**(캐시 뒤 ≈ $0.026)
  - 스캔 PDF 1쪽: 쪽 그림 + 글 약 2,500토큰 → 입력 4,000 · 출력 1,500 ≈ **$0.035**
  - 사진 1장(1,568 × 1,176px ≈ 2,500토큰): ≈ **$0.035**
- 대략 **쪽당 3~4센트(약 40~55원, $1 = 1,400원)**. 10쪽 스캔 한 파일(한 번 호출) ≈ $0.30. 하루 상한은 `FINANCE_UPLOAD_AI_PER_DAY` × 파일당 비용으로 묶인다.

## 검사(한 번에 하나씩, 모두 PASS)

typecheck · lint · check:db-safety · check:migrations · check:finance-upload · **check:finance-pdf(새로)** · check:cost-import · check:intake · check:cost-engine. build는 지시대로 돌리지 않음. 마이그레이션이 없어 check:staging-sql-cost는 해당 없음.

`check:finance-pdf`(`scripts/check-finance-pdf.ts`, 가짜 파일 `scripts/fixtures/finance-pdf.ts`): 글 PDF(칸 읽기 · 자동 넣기 · 글만 보냄) · 스캔 PDF(document 블록 · 처음 3개월 미리보기) · 기운 사진(EXIF 6 + 4° → 편 뒤 0.5° 미만 · JPEG) · 합계 틀림 → 확인 필요 · 소계 대조 · 카드번호 AI에 뒤 4자리만 · 급여대장 PDF · 사진 거부(AI 0) · AI가 급여로 읽으면 버림 · 제조지시 사진 거부(AI 0) · 배합비 · 구성표(이름 · 글 낱말 · 표 모양 · 사진 · 엑셀 6가지) 거부 — 기록 0 · AI 0 · 결산서 PDF → 공식 결산 미리보기(계정 10줄 · 균형 · 부호 · 자료 표 0줄) · 사람이 0020 저장 · 직원 «준비 중» + 엑셀 자동 · AI 한도 넘음 · 꺼짐 → 미리보기 · 3개월 규칙 · env · **진짜 AI 0회(가짜 읽기 6회 · 네트워크 호출 0 — fetch를 막아 셈)**.

## 스크린숏 (dummy · 가짜 읽기 `FINANCE_UPLOAD_AI_MOCK=1`)

- `C:\Users\Edison Hong\projects\chairman-os-next\.screenshots\finance-pdf\chair-1-upload-pdf-pc.png` — 대표: 합계 틀린 PDF · 급여 · 배합비 거부 · 결산서를 한 번에
- `C:\Users\Edison Hong\projects\chairman-os-next\.screenshots\finance-pdf\chair-1-upload-pdf-phone.png`
- `C:\Users\Edison Hong\projects\chairman-os-next\.screenshots\finance-pdf\chair-2-cards-refused-official-pc.png` — 카드: «받지 않음»(급여대장 · 배합비) · «공식 결산»
- `C:\Users\Edison Hong\projects\chairman-os-next\.screenshots\finance-pdf\chair-2-cards-refused-official-phone.png`
- `C:\Users\Edison Hong\projects\chairman-os-next\.screenshots\finance-pdf\chair-3-official-panel-pc.png` — 공식 결산 미리보기(계정 맞춤 · 균형 «닫힘» · 증빙 링크 없으면 저장 버튼 꺼짐)
- `C:\Users\Edison Hong\projects\chairman-os-next\.screenshots\finance-pdf\chair-4-pdf-preview-total-mismatch-pc.png` — PDF 미리보기 «확인 필요»(합계 42,000 ≠ 45,000)
- `C:\Users\Edison Hong\projects\chairman-os-next\.screenshots\finance-pdf\chair-4-pdf-preview-total-mismatch-phone.png`
- `C:\Users\Edison Hong\projects\chairman-os-next\.screenshots\finance-pdf\staff-1-pdf-later-pc.png` — 직원(경영지원 팀장): PDF «준비 중» · 엑셀 자동 넣기
- `C:\Users\Edison Hong\projects\chairman-os-next\.screenshots\finance-pdf\staff-2-cards-pc.png`
- `C:\Users\Edison Hong\projects\chairman-os-next\.screenshots\finance-pdf\staff-1-pdf-later-phone.png`
- `C:\Users\Edison Hong\projects\chairman-os-next\.screenshots\finance-pdf\staff-2-cards-phone.png`

폰(390) 가로 넘침 없음 · 직원 화면 «회장» · «ECOUNT 올리기» 0은 스크립트(`scripts/shot-finance-upload.ts` SHOT_KIND=pdf-chair · pdf-staff)가 확인했다.

## 하지 못한 것

- 진짜 모델로 읽어 보기 — 돈 · 비밀값이 들어 이번엔 가짜 읽기만. 진짜 스캔 · 사진을 얼마나 잘 읽는지는 대표가 키 · 한도를 넣고 가짜 파일로 한 번 봐야 한다(아래 표).
- 이름이 평범한 스캔 · 사진의 급여 · 제조지시 · 배합비 판정 — 글이 없어 AI 전에는 이름만 본다. AI가 읽은 뒤 종류가 급여 · 제조지시 · 출고명세면 버리지만, **그때 모델은 이미 그림을 봤다**(남은 위험, DEFERRED). 배합비는 AI가 «구성표로 보임»(unknown · 빈 줄)으로 답하게 지시만 했다.
- 스캔 PDF를 쪽 그림으로 나눠 보내기 — canvas 의존성이 없어 PDF 그대로 보냄(10쪽까지, 한 번 호출).
- 공식 결산 미리보기 저장 — 미리보기는 저장하지 않는다(화면을 떠나면 다시 올림). 분기 결산은 «공식 결산» 화면에서 손으로.
- 글 PDF를 AI 없이 칸 위치로 세우는 것은 칸이 겹치거나 오른쪽 정렬이 심한 PDF에서 틀릴 수 있다(그래서 늘 미리보기).

## 대표가 할 일

| 순서 | 담당 | 상태 | 방법 |
|---|---|---|---|
| 1 | 대표 | 대기 | 브랜치 `feat/finance-pdf` 확인 — 합치는 순서는 0069 → 0070 → 0071 → 0072(B) → 이 C. 마이그레이션이 없어 DB 반영은 필요 없다 |
| 2 | 대표 | 대기(돈 · 비밀값) | 진짜 읽기를 켜려면 운영 env에 `ANTHROPIC_API_KEY`(이미 있으면 그대로) · `FINANCE_UPLOAD_AI_PER_FILE`(권장 1) · `FINANCE_UPLOAD_AI_PER_DAY`(권장 20 ≈ 하루 최대 약 $0.7~6, 쪽 수에 따라). 없으면 PDF · 사진은 미리보기 · 실패로만 간다 |
| 3 | 대표 | 선택 | 사진 · 스캔 «처음 3개월»을 줄이거나 늘리려면 env `FINANCE_UPLOAD_DOC_REVIEW_UNTIL=YYYY-MM-DD`(기본 2027-01-12) |
| 4 | 대표 | 선택 | 직원에게 PDF · 사진을 열려면 `src/lib/intake/switch.ts`의 `INTAKE_OPEN_TO_STAFF`를 true로(자료 받는 입구 0058과 같이 열린다) |
