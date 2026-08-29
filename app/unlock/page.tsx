"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function UnlockForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "incorrect passcode");
        setLoading(false);
        return;
      }
      const next = searchParams.get("next") || "/";
      router.replace(next);
      router.refresh();
    } catch {
      setError("network error — try again");
      setLoading(false);
    }
  }

  return (
    <main className="unlock-main">
      <form onSubmit={submit} className="unlock-card">
        <h1>Draft Edge</h1>
        <p className="unlock-sub">Enter the passcode to continue.</p>
        <input
          type="password"
          inputMode="text"
          autoFocus
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="passcode"
          className="unlock-input"
        />
        {error && <p className="unlock-error">{error}</p>}
        <button type="submit" disabled={loading || !secret} className="unlock-button">
          {loading ? "Checking…" : "Enter"}
        </button>
      </form>
    </main>
  );
}

export default function UnlockPage() {
  return (
    <Suspense fallback={null}>
      <UnlockForm />
    </Suspense>
  );
}
