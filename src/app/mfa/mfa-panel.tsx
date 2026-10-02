"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { STAFF_BRAND } from "@/lib/brand";
import { supabaseConfig } from "@/lib/supabase/config";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * TOTP 등록 · 확인. 이미 확인된 요소가 있으면 코드만 묻고(challenge → verify), 없으면 QR을 보여 준 뒤
 * 첫 코드로 등록을 끝낸다. 성공하면 세션이 aal2가 되고 proxy가 더 이상 여기로 보내지 않는다.
 * 비밀(secret)은 QR과 함께 한 번만 보인다 — 저장하지 않는다.
 */
type Mode =
  | { kind: "loading" }
  | { kind: "verify"; factorId: string }
  | { kind: "enroll"; factorId: string; qr: string; secret: string }
  | { kind: "off" };

export function MfaPanel({ next }: { next: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sb = supabaseConfig() ? createSupabaseBrowserClient() : null;
    void (async () => {
      if (!sb) {
        setMode({ kind: "off" });
        return;
      }
      const { data } = await sb.auth.mfa.listFactors();
      const verified = data?.totp?.find((f) => f.status === "verified");
      if (verified) {
        setMode({ kind: "verify", factorId: verified.id });
        return;
      }
      // 끝내지 못한 등록이 남아 있으면 지우고 새로(같은 이름으로 두 번 등록하지 못한다).
      for (const f of data?.all ?? [])
        if (f.status === "unverified")
          await sb.auth.mfa.unenroll({ factorId: f.id });
      const { data: en, error: enError } = await sb.auth.mfa.enroll({
        factorType: "totp",
        // 인증 앱에는 보이지 않는 요소 이름이다(앱의 발급자 칸은 Supabase Site URL 호스트). 그래도 직원 이름으로 둔다(lib/brand.ts).
        friendlyName: STAFF_BRAND,
      });
      if (enError || !en) {
        setError(
          "2단계 인증을 시작하지 못했습니다. 관리자에게 문의하세요(Supabase MFA 설정).",
        );
        return;
      }
      setMode({
        kind: "enroll",
        factorId: en.id,
        qr: en.totp.qr_code,
        secret: en.totp.secret,
      });
    })();
  }, []);

  async function submit() {
    if (mode.kind !== "verify" && mode.kind !== "enroll") return;
    setBusy(true);
    setError(null);
    const sb = createSupabaseBrowserClient();
    const { data: ch, error: chError } = await sb.auth.mfa.challenge({
      factorId: mode.factorId,
    });
    if (chError || !ch) {
      setBusy(false);
      setError("확인을 시작하지 못했습니다. 다시 시도하세요.");
      return;
    }
    const { error: vError } = await sb.auth.mfa.verify({
      factorId: mode.factorId,
      challengeId: ch.id,
      code: code.trim(),
    });
    setBusy(false);
    if (vError) {
      setError("코드가 맞지 않습니다. 앱에 지금 보이는 6자리를 넣으세요.");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  if (mode.kind === "off")
    return (
      <p className="mt-4 text-t12 text-ink-muted">
        이 환경(dummy)에는 로그인이 없어 2단계 인증도 없습니다.
      </p>
    );
  if (mode.kind === "loading")
    return (
      <p className="mt-4 text-t12 text-ink-muted">{error ?? "준비 중…"}</p>
    );

  return (
    <div className="mt-4 space-y-3">
      {mode.kind === "enroll" ? (
        <div className="space-y-2 text-center">
          <p className="text-t12 text-ink-dim">인증 앱으로 QR을 찍으세요.</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- Supabase가 준 data: URL(SVG) 한 장. */}
          <img
            src={mode.qr}
            alt="2단계 인증 QR 코드"
            className="mx-auto size-44 rounded-lg bg-white p-2"
          />
          <p className="text-t10h text-ink-muted">
            QR을 못 찍으면 이 키를 직접 넣으세요:{" "}
            <code className="break-all">{mode.secret}</code>
          </p>
        </div>
      ) : null}
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="6자리 코드"
        className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-center text-t18 tracking-[0.3em] tnum"
      />
      {error ? (
        <p role="alert" className="text-t12 text-critical">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={submit}
        disabled={busy || code.length !== 6}
        className="w-full rounded-lg bg-accent px-3 py-2 text-t13 font-semibold text-white disabled:opacity-40"
      >
        {busy ? "확인 중…" : mode.kind === "enroll" ? "등록하고 계속" : "확인"}
      </button>
    </div>
  );
}
