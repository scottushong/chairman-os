# src/data — 개발용 시드

출처: `06_Reference/06_Dummy_Data_v1.0.xlsx` (10개 시트).
실제 BOM/Formula/원가/고객특가/Margin은 Vault라 여기 들어오지 않는다. 이 폴더의 값은 전부 Dummy다.

## 시트 → 파일

| 시트 | 파일 | 행 |
|---|---|---|
| Businesses | `businesses.json` | 5 |
| Finance_KPI | `finance-kpi.json` | 480 |
| Projects | `projects.json` | 5 |
| Tasks | `tasks.json` | 5 |
| Decisions | `decisions.json` | 4 |
| Alerts | `alerts.json` | 4 |
| MES_Dummy | `mes.json` | 2 |
| R&D_Dummy | `rnd.json` | 2 |
| BOM_Dummy | `bom.json` | 3 |
| AI_Night_Output | `ai-night-output.json` | 5 |
| (시트 없음 — CH-011~014용) | `strategy.json` | — |

## 시트와 달라진 점

원본을 그대로 쓰면 화면이 비어서, 다음 세 가지만 손을 댔다. 되돌릴 때는 이 목록만 보면 된다.

1. **Business ID를 실제 5개사로 치환.** 업종이 그대로 맞아떨어진다.
   `biz_a→biz_dy`(제조/화학), `biz_b→biz_vana`(AI/SaaS), `biz_c→biz_hof`(Robotics),
   `biz_d→biz_boram`(Consumer). 시트에 없던 `biz_sticky`(글로벌 유통/화학)를 5번째로 추가했다.
   `biz_d`는 시트에서 `Hold`/`visible=False`였지만 Reference 대시보드에 5개사가 모두 떠 있어
   `Active`/`visible=true`로 두었다.
2. **Finance_KPI 확장.** 시트는 2026-08의 DY/VANA Revenue·Cost·EBITDA 6행뿐이다.
   그 6개 값을 앵커로 고정한 채 12개월(2025-09~2026-08) 이력과
   Cash/AR/AP/OperatingProfit/NetIncome, 나머지 3개사를 같은 자릿수로 채웠다.
   생성 규칙은 `scratchpad/seed.py` 참조(시드 고정이라 재실행해도 값이 같다).
3. **Sticky/Boram 행 보강.** Project 2건, Task 2건, Decision 2건, Alert 2건, AI 야간작업 2건.
   Reference 대시보드(`03_UX_UI/01_Chairman_OS_메인_대시보드_한글.png`)의 항목명을 따랐다.

Phase 2에서 실데이터가 붙으면 이 폴더는 통째로 Route Handler 뒤로 들어간다.
