import React, { useState, useEffect, useRef } from "react";
import "./App.css";
import ChatWidget from "./ChatWidget";
import FullChat from "./FullChat";
import Dashboard from "./Dashboard";
import Auth from "./Auth";
import { supabase } from "./supabaseClient";

function App() {
  const [showFullChat, setShowFullChat] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [session, setSession] = useState(null);
  const [sessionStart, setSessionStart] = useState(null);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) setSessionStart(new Date().toISOString());
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) setSessionStart(new Date().toISOString());
    });

    return () => subscription.unsubscribe();
  }, []);

  const idleTimerRef = useRef(null);

  useEffect(() => {
    if (!session) return;

    const resetTimer = () => {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(handleLogout, 120000);
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(e => window.addEventListener(e, resetTimer));
    resetTimer();

    return () => {
      clearTimeout(idleTimerRef.current);
      events.forEach(e => window.removeEventListener(e, resetTimer));
    };
  }, [session]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setShowFullChat(false);
    setShowDashboard(false);
  };

  if (!session) {
    return <Auth onAuthSuccess={() => { }} />; // Session handled by listener
  }

  return (
    <div className="home-container">
      {/* Navigation */}
      <nav className="navbar">
        <div className="nav-content">
          <div className="logo-section">
            <img src="/logo_a.png" alt="Logo" className="logo-img" />
            <h1>AlphaWave</h1>
          </div>
          <div className="nav-links">
            <span className="user-badge">
              {session.user.user_metadata?.full_name || session.user.email}
            </span>
            <button className="nav-link-btn" onClick={() => setShowDashboard(true)}>Dashboard</button>
            <button className="nav-link-btn" onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="hero">
        <div className="hero-content">
          <span className="badge">Welcome back, {session.user.user_metadata?.full_name || 'Innovat'}</span>
          <h2>Empowering Your Business with AI</h2>
          <p>
            Secure, private, and production-ready RAG solutions tailored for your enterprise needs.
            Experience the power of AlphaWave AI.
          </p>
          <div className="hero-actions">
            <button className="cta-btn">Get Started</button>
            <button className="secondary-btn">Request Demo</button>
          </div>
        </div>
      </main>

      {/* Conditional Full UI */}
      {showFullChat && <FullChat onClose={() => setShowFullChat(false)} sessionStart={sessionStart} />}

      {/* Dashboard Overlay */}
      {showDashboard && <Dashboard onClose={() => setShowDashboard(false)} />}

      {/* Floating Chat Widget (Always available unless full UI is open) */}
      {!showFullChat && <ChatWidget onExpand={() => setShowFullChat(true)} sessionStart={sessionStart} />}
    </div>
  );
}

export default App;