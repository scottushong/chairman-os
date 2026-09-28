"use client";

import { useEffect, useState } from "react";

import { tr, type Lang } from "@/lib/i18n";

/**
 * «홈 화면에 추가» 안내 (Phase 6-2 PWA). 폰에서 한 번만 — 닫으면 이 기기에서 다시 안 뜬다
 * (localStorage는 편의 기록일 뿐이라 못 읽으면 그냥 보여 준다). 이미 설치해 연 경우(standalone)는 안 뜬다.
 * 오프라인 캐시는 두지 않는다(원 명세: «오프라인 캐시 없음»).
 */
const KEY = "chairman.installHint.dismissed";

export function InstallHint({ lang }: { lang: Lang }) {
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    // 판정은 브라우저에서만 된다. 첫 갱신을 타이머 콜백에 두는 것은 world-clocks.tsx와 같은 이유다
    // (react-hooks/set-state-in-effect — 서버와 첫 렌더는 둘 다 «안 보임»이어야 하이드레이션이 맞는다).
    const t = setTimeout(() => {
      const standalone = window.matchMedia(
        "(display-mode: standalone)",
      ).matches;
      const phone = /iphone|ipad|android/i.test(navigator.userAgent);
      let dismissed = false;
      try {
        dismissed = localStorage.getItem(KEY) === "1";
      } catch {
        dismissed = false;
      }
      setIos(/iphone|ipad/i.test(navigator.userAgent));
      setShow(phone && !standalone && !dismissed);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  if (!show) return null;
  return (
    <div className="mt-2 flex items-start gap-2 rounded-xl border border-line-soft bg-raised px-3 py-2 text-[12px]">
      <span aria-hidden>📱</span>
      <p className="min-w-0 flex-1 text-ink-dim">
        {ios
          ? tr(
              lang,
              "공유 버튼 → «홈 화면에 추가»를 누르면 앱처럼 열립니다.",
              "Tap Share → “Add to Home Screen” to open it like an app.",
            )
          : tr(
              lang,
              "브라우저 메뉴(⋮) → «홈 화면에 추가»를 누르면 앱처럼 열립니다.",
              "Menu (⋮) → “Add to Home screen” to open it like an app.",
            )}
      </p>
      <button
        type="button"
        onClick={() => {
          try {
            localStorage.setItem(KEY, "1");
          } catch {
            /* 저장 못 해도 이번에는 닫는다 */
          }
          setShow(false);
        }}
        className="shrink-0 text-ink-muted hover:text-ink"
        aria-label={tr(lang, "닫기", "Dismiss")}
      >
        ✕
      </button>
    </div>
  );
}
