# Vault 컬럼 — 0001_init에서 뺀 것

출처: `04_Data_API/03_Vault_Map` 시트, `05_Architecture 7. Vault 설계 원칙`.

원칙은 하나다. **실제 값은 외주·Dev·Staging에 내려가지 않는다.**
그래서 이 문서의 컬럼은 스키마를 만들지 않았다. 컬럼이 없으면 실수로 채울 수도 없다.

Production에서 Vault를 열 때는 별도 스키마(`vault.`)와 별도 마이그레이션으로 만들고,
접근은 `/vault` 서비스 한 곳을 통해서만 한다(05_Architecture 3번 Repository 구조).

## 만들지 않은 테이블

| 테이블 | 이유 | 언제 |
|---|---|---|
| `bom` | 표 전체가 Vault(배합비·원료). 외주는 Dummy Code만 본다. | Phase 2, `vault` 스키마 |
| `mes_records` | Layer 2. MES 연동 범위 확정 후(API-003 미해결) | Phase 2 |
| `rnd_records` | Layer 2. 일부 행이 Restricted/Vault | Phase 2 |

## 만들지 않은 컬럼

| 대상 | 컬럼 | 등급 | Production 접근 | 외주 Dev 데이터 | AI 접근 |
|---|---|---|---|---|---|
| DY — BOM Formula | `bom.raw_material_code`(실명), `bom.ratio_pct` | Vault | Chairman / R&D 지정자 | Dummy Code | R&D Agent 제한적 |
| DY — Raw Material Cost | `materials.unit_cost` | Vault | Chairman / CFO / 구매 지정자 | Dummy | Finance Agent 요약만 |
| DY — Customer Special Price | `customers.special_price` | Vault | Chairman / Sales Head | Dummy | Sales Agent 제한 |
| Group — Margin | `finance_kpis.margin_pct`, `products.margin_pct` | Restricted/Vault | Chairman / CFO | Dummy | Finance Agent |
| HOF — Core IP | `hof_ip.persona`, `hof_ip.memory_spec`, `hof_ip.robotics_spec` | Vault | Chairman / CTO 지정자 | **불가** | HOF Agent 제한 |
| M&A — Deal Terms | `deals.price`, `deals.equity_pct`, `deals.contract_terms` | Vault | Chairman / Deal team | **불가** | Deal Agent 제한 |

## 0001에 남긴 것 중 등급이 걸리는 컬럼

아래는 만들었지만 [제한] 등급이라 `0002_rls.sql`의 `can_read_restricted()` /
`finance_kpis_masked` 뷰로 가린다. Vault로 올라갈 후보이기도 하다.

- `finance_kpis.value`, `finance_kpis.target` — 금액
- `decisions.options`, `decisions.ai_recommendation` — 가격·조건이 문자열로 들어온다
- `alerts.message` — 본문에 금액·고객명이 섞인다
- `ai_night_outputs.result_summary`, `ai_night_outputs.artifact_link`
- `documents.storage_path` — 파일 위치 자체가 단서다
- `*.owner_user_id` — 인사정보

## 결정됨 — Vault 문서의 파일 실체 (2026-09-06, Chairman)

**(B) 사내 스토리지에 두고 Chairman OS는 링크만 보관한다.**

`documents.security_class = 'Vault'`인 행은 메타와 `storage_path`(사내 스토리지 링크)만 갖는다.
파일 바이트는 Supabase에 올라가지 않으므로, Supabase 쪽이 뚫려도 Vault 문서 자체는 나가지 않는다.

- `storage_path`는 사내 스토리지 URL이다. Supabase Storage 키가 아니다.
- 링크를 아는 것과 파일을 여는 것은 다른 권한이다 — 열람 판정은 사내 스토리지가 자기 인증으로 한 번 더 한다.
- Chairman OS는 서명 URL을 발급하지 않는다. 발급하는 순간 이 프로젝트가 Vault 접근 경로가 된다.
- `documents_read` 정책(0002_rls.sql 10번)은 그대로다. 링크 자체도 등급 판정을 통과해야 보인다.

검토했던 나머지 선택지: (A) Supabase Storage 비공개 버킷 + 서명 URL, (C) Chairman OS에 아예 올리지 않음.
