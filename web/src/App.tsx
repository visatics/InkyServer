import { useEffect, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/api";
import { AuthPage } from "./pages/Auth";
import { DevicesPage } from "./pages/Devices";
import { DevicePage } from "./pages/Device";
import { PreviewPage } from "./pages/Preview";

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return <div className="loading">Loading…</div>;

  // The app is unreachable when logged out (criterion 8): every route below
  // this point only mounts once a session exists.
  if (!session) return <AuthPage />;

  return (
    <BrowserRouter basename="/app">
      <header className="topbar">
        <Link to="/" className="brand">
          InkyServer
        </Link>
        <div className="spacer" />
        <span className="muted">{session.user.email}</span>
        <button className="ghost" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<DevicesPage />} />
          <Route path="/devices/:id" element={<DevicePage />} />
          <Route path="/devices/:id/preview" element={<PreviewPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
