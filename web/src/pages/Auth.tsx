import { useState } from "react";
import { supabase } from "../lib/api";

type Mode = "login" | "register" | "reset";

/**
 * Auth talks to Supabase directly (PRD §6) — the backend never sees a password.
 * Registration may require email confirmation depending on project settings, so
 * a successful sign-up shows the "check your inbox" state rather than assuming
 * an immediate session.
 */
export function AuthPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "register") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setNotice(
          data.session
            ? "Account created."
            : "Account created — check your inbox to confirm the address, then sign in."
        );
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
        setNotice("If that address has an account, a reset link is on its way.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="card auth" onSubmit={submit}>
        <h1>InkyServer</h1>
        <p className="muted">
          {mode === "login" && "Sign in to manage your devices."}
          {mode === "register" && "Create an account."}
          {mode === "reset" && "We'll email you a reset link."}
        </p>

        <label>
          Email
          <input
            type="email"
            required
            value={email}
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        {mode !== "reset" && (
          <label>
            Password
            <input
              type="password"
              required
              minLength={8}
              value={password}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}

        {error && <p className="error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}

        <button type="submit" disabled={busy}>
          {busy ? "Working…" : mode === "login" ? "Sign in" : mode === "register" ? "Register" : "Send reset link"}
        </button>

        <div className="auth-links">
          {mode !== "login" && (
            <button type="button" className="link" onClick={() => setMode("login")}>
              Sign in
            </button>
          )}
          {mode !== "register" && (
            <button type="button" className="link" onClick={() => setMode("register")}>
              Create an account
            </button>
          )}
          {mode !== "reset" && (
            <button type="button" className="link" onClick={() => setMode("reset")}>
              Forgot password
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
