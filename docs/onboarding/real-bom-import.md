# 진짜 BOM 넣기 (R2 → Chairman OS)

회장 혼자 하는 일이다. 화면: `/costs/<회사>/bom/import` (예: `https://chairman-os-eosin.vercel.app/costs/biz_dy/bom/import`).
미리보기는 **제품 코드 · 줄 수**만 보여 준다 — 원료 · 비율은 화면에 펼치지 않는다. 저장은 0063 암호문(키 없으면 멈춘다).

## 0. 먼저

- BOM 암호 키가 있어야 한다 — 없으면 `docs/onboarding/bom-key-setup.md`.
- «진짜 BOM 받기» 스위치를 켠다 — `/costs/<회사>/bom` 화면 위쪽 스위치. 꺼져 있으면 가짜 판으로만 들어간다(넣기 화면 위에 상태가 보인다).

## 1. R2에서 엑셀 뽑기

R2 배합표를 엑셀로 내보낸다. 칸: 제품 · 시작일 · 수율(%) · 원료 · 원료 kg/제품 kg · 메모(선택).
빈 양식은 넣기 칸의 «빈 양식 받기»로 받는다. 제품 · 원료 이름은 Chairman OS에 넣은 이름과 같아야 한다.

## 2. 이 화면 열기

```
https://chairman-os-eosin.vercel.app/costs/biz_dy/bom/import
```

## 3. 올리기 → 미리보기

파일을 끌어 놓는다 → 칸 지정 확인 → «이 칸 지정으로 미리보기».
표에 **제품 코드 · 줄 수 · 상태(새 줄 · 같은 줄 · 충돌 · 중복 의심 · 오류)**만 나온다.
오류 · 충돌이 있으면 등록이 잠긴다 — 엑셀을 고쳐 다시 올리거나 `/costs/<회사>/bom` 화면의 넣기 칸에서 줄마다 처리한다.

## 4. 등록

«진짜 BOM으로 넣기»를 체크하고 «등록». 한 번에 한 트랜잭션(0068) — 중간에 실패하면 아무것도 들어가지 않는다.

## 5. 확인 (SQL Editor 한 줄 — 값 없이 개수만)

`cost_bom_versions('<회사>')`는 로그인한 대표 세션에서만 돈다(SQL Editor는 로그인이 없어 거부). 그래서 표를 직접 센다:

```
select count(*) from cost_secret.bom_versions b join cost_products p on p.product_id = b.product_id where p.business_id = 'biz_dy' and b.voided_at is null and not b.is_fake;
```

숫자 = 넣은 진짜 판 수(제품 · 시작일 묶음 수). 미리보기의 «새 줄» 제품 수와 맞으면 끝.

## 6. 되돌리기

판마다 무효: `/costs/<회사>/bom` 화면의 판 이력에서 «무효»(이유 필수 — 0062 cost_bom_void). SQL Editor에서는 돌지 않는다(대표 세션 필요).

더 받지 않기: 같은 화면의 «진짜 BOM 받기» 스위치를 끈다.

```
https://chairman-os-eosin.vercel.app/costs/biz_dy/bom
```
