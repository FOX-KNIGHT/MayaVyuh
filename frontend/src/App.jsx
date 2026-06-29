import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, User, Users, Crosshair } from "lucide-react";
import { useSyncState, broadcastEvent, useEventListener } from "./useSync.js";
import { AdminDashboard, SceneWrapper, GlobalStyles, BG_IMAGES } from "./AdminComponents.jsx";
import gdgLogo from "./assets/gdg-logo.png";
const API = import.meta.env.VITE_API_URL || "https://mayavyuh.onrender.com";
const INIT_TEAMS = [];
const INIT_EVENT = { started: false, phase: "lobby" };

// ============================================================
// ANTI-CHEAT HOOK
// Runs only on the player view. Silently logs violations and
// sends them to the backend. Never alerts or disrupts gameplay.
// ============================================================
function useAntiCheat({ isPlayer, teamId, onDisqualify }) {
  const violationCountRef = useRef(0);
  const geminiWindowRef = useRef(null);
  const bannerTimerRef = useRef(null);

  // Store a ref to the gemini popup so we can track it
  // We expose a setter so RoundDisplay can register the popup
  const registerGeminiWindow = useCallback((win) => {
    geminiWindowRef.current = win;
  }, []);

  const showBanner = useCallback((msg) => {
    const banner = document.getElementById("ac-violation-banner");
    if (!banner) return;
    banner.textContent = `⚠ SECURITY ALERT: ${msg}`;
    banner.classList.add("ac-show");
    clearTimeout(bannerTimerRef.current);
    bannerTimerRef.current = setTimeout(() => {
      banner.classList.remove("ac-show");
    }, 3000);
  }, []);

  const reportViolation = useCallback((type) => {
    if (!isPlayer) return;
    violationCountRef.current += 1;
    const count = violationCountRef.current;

    // Silent report to backend — fire and forget
    fetch(`${API}/api/anticheat/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId, type, count, ts: Date.now() }),
    }).catch(() => {}); // intentionally swallow errors — never disrupt gameplay

    // Trigger instant disqualification for critical offenses
    if (type === "tab_switch" || type === "copy_attempt" || type === "screenshot_attempt") {
      if (onDisqualify) onDisqualify(type);
      return; // Stop here, no need to show a banner if they are disqualified
    }

    showBanner(
      type === "devtools"
        ? "DEVTOOLS DETECTED"
        : "UNAUTHORIZED ACTION"
    );
  }, [isPlayer, teamId, showBanner, onDisqualify]);

  useEffect(() => {
    if (!isPlayer) return;

    // ----------------------------------------------------------
    // 1. Tab / window visibility — detect switching away
    // ----------------------------------------------------------
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Only flag if NOT the Gemini popup being interacted with
        // (We can't know for sure, so we log it but don't block)
        reportViolation("tab_switch");
        document.body.classList.add("ac-focus-lost");
      } else {
        document.body.classList.remove("ac-focus-lost");
      }
    };

    // ----------------------------------------------------------
    // 2. Window blur — fires when focus moves to another window/tab
    //    We allow blur to Gemini popup by checking if our own
    //    popup is what caused it (best-effort).
    // ----------------------------------------------------------
    const handleWindowBlur = () => {
      // Short delay so the popup's focus can register first
      setTimeout(() => {
        const geminiWin = geminiWindowRef.current;
        const geminiAlive = geminiWin && !geminiWin.closed;
        // If Gemini popup is open and was just opened, don't flag
        if (!geminiAlive) {
          document.body.classList.add("ac-focus-lost");
        }
      }, 200);
    };

    const handleWindowFocus = () => {
      document.body.classList.remove("ac-focus-lost");
    };

    // ----------------------------------------------------------
    // 3. Keyboard shortcut interception
    //    Ctrl+C / Cmd+C: silently swallowed — no alert, no error
    //    Screenshot keys (PrintScreen): silently swallowed
    //    Ctrl+S, Ctrl+U, Ctrl+P, F12, Ctrl+Shift+I: blocked silently
    // ----------------------------------------------------------
    const handleKeyDown = (e) => {
      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl+C — intercept silently (player sees nothing wrong)
      if (ctrl && e.key === "c") {
        // Clear the clipboard silently so they can't paste the image
        try {
          navigator.clipboard.writeText("").catch(() => {});
        } catch (_) {}
        reportViolation("copy_attempt");
        // DO NOT call e.preventDefault() — requirement says it shouldn't fail
        // Just poison the clipboard content instead
        return;
      }

      // PrintScreen
      if (e.key === "PrintScreen") {
        // Poison clipboard after screenshot key
        try {
          navigator.clipboard.writeText("").catch(() => {});
        } catch (_) {}
        reportViolation("screenshot_attempt");
        e.preventDefault();
        return;
      }

      // Block devtools shortcuts silently
      if (
        e.key === "F12" ||
        (ctrl && e.shiftKey && (e.key === "I" || e.key === "J" || e.key === "C")) ||
        (ctrl && e.key === "U") ||
        (ctrl && e.key === "s") ||
        (ctrl && e.key === "p")
      ) {
        e.preventDefault();
        reportViolation("devtools");
        return;
      }
    };

    // ----------------------------------------------------------
    // 4. Context menu (right-click) — disable silently on images
    // ----------------------------------------------------------
    const handleContextMenu = (e) => {
      if (e.target.tagName === "IMG") {
        e.preventDefault();
      }
    };

    // ----------------------------------------------------------
    // 5. Drag prevention on images
    // ----------------------------------------------------------
    const handleDragStart = (e) => {
      if (e.target.tagName === "IMG") {
        e.preventDefault();
        reportViolation("drag_attempt");
      }
    };

    // ----------------------------------------------------------
    // 6. Paste interception — block pasting images into the page
    // ----------------------------------------------------------
    const handlePaste = (e) => {
      const items = e.clipboardData?.items || [];
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          reportViolation("paste_image_attempt");
          return;
        }
      }
      // Text paste is allowed (needed for Gemini link input)
    };

    // ----------------------------------------------------------
    // 7. DevTools size detection (heuristic — best effort)
    // ----------------------------------------------------------
    let devToolsCheckInterval = null;
    const checkDevTools = () => {
      const threshold = 160;
      if (
        window.outerWidth - window.innerWidth > threshold ||
        window.outerHeight - window.innerHeight > threshold
      ) {
        reportViolation("devtools");
      }
    };
    devToolsCheckInterval = setInterval(checkDevTools, 3000);

    // Attach all listeners
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("dragstart", handleDragStart);
    document.addEventListener("paste", handlePaste);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("keydown", handleKeyDown, true); // capture phase

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("dragstart", handleDragStart);
      document.removeEventListener("paste", handlePaste);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("keydown", handleKeyDown, true);
      clearInterval(devToolsCheckInterval);
      clearTimeout(bannerTimerRef.current);
      document.body.classList.remove("ac-focus-lost");
    };
  }, [isPlayer, reportViolation]);

  return { registerGeminiWindow };
}

// ============================================================

function usePersistentState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      return initialValue;
    }
  });

  useEffect(() => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
}

const DisqualifiedScreen = ({ teamName, reason }) => {
  const displayReason = 
    reason === "tab_switch" ? "TAB SWITCH DETECTED" :
    reason === "copy_attempt" ? "CLIPBOARD INTERCEPTED" :
    reason === "screenshot_attempt" ? "SCREENSHOT ATTEMPT DETECTED" :
    "UNAUTHORIZED ACTION";

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      transition={{ duration: 3, ease: "easeInOut" }}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "#000",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 99999,
        fontFamily: "'Cinzel', serif",
        textAlign: "center"
      }}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 4, delay: 1, ease: "easeOut" }}
        style={{
          fontSize: "4rem",
          letterSpacing: "8px",
          color: "#8a0303",
          textShadow: "0 0 20px rgba(255, 0, 0, 0.4), 0 0 40px rgba(255, 0, 0, 0.2)",
          marginBottom: "40px",
          textTransform: "uppercase"
        }}
      >
        TEAM {teamName}<br/>YOU ARE DISQUALIFIED
      </motion.div>
      
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 2, delay: 3 }}
        style={{
          fontFamily: "'Share Tech Mono', monospace",
          fontSize: "1.2rem",
          color: "rgba(255, 255, 255, 0.5)",
          letterSpacing: "4px"
        }}
      >
        Reason: {displayReason}
      </motion.div>
    </motion.div>
  );
};

const RegistrationScreen = ({ onRegister }) => {
  const [teamName, setTeamName] = useState("");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [registering, setRegistering] = useState(false);

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!teamName || !p1 || !p2) return;
    
    setRegistering(true);
    try {
      const res = await fetch(`${API}/api/game/teams/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamName, player1: p1, player2: p2, role: "observer" })
      });
      const data = await res.json();
      
      if (data.success && data.team) {
        onRegister({ 
          id: data.team._id, 
          name: data.team.name, 
          player1: data.team.observer, 
          player2: data.team.creator, 
          status: data.team.status, 
          round: data.team.round
        });
      } else {
        alert(data.error || "Registration failed on server.");
      }
    } catch (err) {
      console.error(err);
      alert("Failed to connect to backend for registration.");
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div className="imperial-bg" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", width: "150vw", height: "150vh", background: "radial-gradient(circle at 50% 50%, rgba(212, 175, 55, 0.05) 0%, transparent 50%)", animation: "pulse 4s infinite alternate" }} />
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 800, height: 800, border: "1px dashed rgba(212, 175, 55, 0.1)", borderRadius: "50%", animation: "spin-slow 30s linear infinite" }} />
      
      <div style={{ display: "flex", width: "100%", maxWidth: 1200, gap: 64, alignItems: "center", zIndex: 10, padding: 32 }}>
        <div style={{ flex: 1, paddingRight: 40, animation: "float 6s ease-in-out infinite" }}>
          <img src={gdgLogo} alt="GDG Logo" style={{ width: 120, marginBottom: 24, filter: "drop-shadow(0 0 20px rgba(212,175,55,0.4))", borderRadius: "50%", background: "rgba(255,255,255,0.05)", padding: 8 }} />
          <div style={{ fontFamily: "'Cinzel', serif", color: "#D4AF37", letterSpacing: 8, marginBottom: 16, fontSize: 14 }}>⬡ PROJECT: MAYAVYUH ⬡</div>
          <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: "5rem", lineHeight: 1.1, marginBottom: 20, color: "#fff", textShadow: "0 0 30px rgba(212,175,55,0.6)" }}>THE PROMPT WAR</div>
          <div style={{ fontFamily: "'Cinzel', serif", color: "rgba(255,255,255,0.6)", fontSize: 18, maxWidth: 500, lineHeight: 1.8, letterSpacing: 2 }}>
            Enter the labyrinth. Describe the vision. Generate the spell. Two minds, one prompt.
          </div>
        </div>

        <motion.div style={{ flex: 1, maxWidth: 450 }} initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.8 }}>
          <form onSubmit={handleRegister} className="imperial-glass imperial-panel" style={{ textAlign: "center", padding: "48px 40px", border: "1px solid rgba(212, 175, 55, 0.3)", boxShadow: "0 0 50px rgba(0,0,0,0.8), inset 0 0 20px rgba(212, 175, 55, 0.1)" }}>
            <Shield size={48} color="#D4AF37" style={{ margin: "0 auto", marginBottom: 24, filter: "drop-shadow(0 0 10px rgba(212,175,55,0.4))" }} />
            <div className="imperial-gold-text" style={{ fontFamily: "'Cinzel', serif", fontSize: 24, marginBottom: 8, letterSpacing: 4 }}>TEAM ENLISTMENT</div>
            <div style={{ color: "rgba(212, 175, 55, 0.5)", fontSize: 10, letterSpacing: 4, marginBottom: 32 }}>INITIATE DATACRON UPLINK</div>
            
            <div style={{ position: "relative", marginBottom: 24 }}>
              <Users size={16} color="#D4AF37" style={{ position: "absolute", top: 18, left: 20, opacity: 0.6 }} />
              <input 
                placeholder="TEAM DESIGNATION" 
                value={teamName} 
                onChange={e=>setTeamName(e.target.value.toUpperCase())} 
                required 
                style={{ width: "100%", background: "rgba(0,0,0,0.5)", border: "1px solid rgba(212, 175, 55, 0.3)", padding: "16px 24px 16px 54px", color: "#D4AF37", fontSize: 14, outline: "none", letterSpacing: 4, fontFamily: "'Orbitron', sans-serif", transition: "all 0.3s" }} 
                onFocus={(e) => e.target.style.borderColor = "#D4AF37"}
                onBlur={(e) => e.target.style.borderColor = "rgba(212, 175, 55, 0.3)"}
              />
            </div>
            
            <div style={{ position: "relative", marginBottom: 24 }}>
              <User size={16} color="#D4AF37" style={{ position: "absolute", top: 18, left: 20, opacity: 0.6 }} />
              <input 
                placeholder="OPERATIVE 01 NAME" 
                value={p1} 
                onChange={e=>setP1(e.target.value.toUpperCase())} 
                required 
                style={{ width: "100%", background: "rgba(0,0,0,0.5)", border: "1px solid rgba(212, 175, 55, 0.3)", padding: "16px 24px 16px 54px", color: "#D4AF37", fontSize: 14, outline: "none", letterSpacing: 4, fontFamily: "'Orbitron', sans-serif", transition: "all 0.3s" }} 
                onFocus={(e) => e.target.style.borderColor = "#D4AF37"}
                onBlur={(e) => e.target.style.borderColor = "rgba(212, 175, 55, 0.3)"}
              />
            </div>

            <div style={{ position: "relative", marginBottom: 40 }}>
              <User size={16} color="#D4AF37" style={{ position: "absolute", top: 18, left: 20, opacity: 0.6 }} />
              <input 
                placeholder="OPERATIVE 02 NAME" 
                value={p2} 
                onChange={e=>setP2(e.target.value.toUpperCase())} 
                required 
                style={{ width: "100%", background: "rgba(0,0,0,0.5)", border: "1px solid rgba(212, 175, 55, 0.3)", padding: "16px 24px 16px 54px", color: "#D4AF37", fontSize: 14, outline: "none", letterSpacing: 4, fontFamily: "'Orbitron', sans-serif", transition: "all 0.3s" }} 
                onFocus={(e) => e.target.style.borderColor = "#D4AF37"}
                onBlur={(e) => e.target.style.borderColor = "rgba(212, 175, 55, 0.3)"}
              />
            </div>

            <button type="submit" disabled={registering} className="btn-imperial" style={{ width: "100%", padding: 20, letterSpacing: 4, fontSize: 14, display: "flex", justifyContent: "center", alignItems: "center", gap: 12 }}>
              {registering ? "ENLISTING..." : "INITIALIZE CONNECTION"} <Crosshair size={16} />
            </button>
          </form>
        </motion.div>
      </div>
    </div>
  );
};

const LobbyScreen = () => (
  <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative", zIndex: 1 }}>
    <img src={gdgLogo} alt="GDG Logo" style={{ width: 80, marginBottom: 24, animation: "pulse 2s infinite" }} />
    <div style={{ fontSize: 64, animation: "pulse 2s infinite" }}>⏳</div>
    <div className="title-primary" style={{ marginTop: 24, fontSize: 32 }}>AWAITING OVERRIDE</div>
    <div style={{ fontFamily: "'Share Tech Mono'", color: "var(--text-dim)", marginTop: 16, fontSize: 18 }}>Waiting for Admin to start the event...</div>
  </div>
);

const IntervalScreen = ({ title, message, timeLeft }) => (
  <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative", zIndex: 1, padding: 24, textAlign: "center" }}>
    <img src={gdgLogo} alt="GDG Logo" style={{ width: 60, marginBottom: 20 }} />
    <div style={{ fontSize: 64, marginBottom: 24 }}>🔀</div>
    <div className="title-primary" style={{ fontSize: 40, color: "var(--neon-gold)", textShadow: "0 0 10px var(--neon-gold)" }}>{title}</div>
    <div style={{ fontFamily: "'Share Tech Mono'", color: "var(--text-main)", fontSize: 20, maxWidth: 600, margin: "24px 0", lineHeight: 1.6 }}>{message}</div>
    {timeLeft > 0 && <div style={{ fontSize: 48, fontFamily: "'Orbitron'", color: "#D4AF37", marginBottom: 32 }}>{Math.floor(timeLeft/60)}:{String(timeLeft%60).padStart(2,'0')}</div>}
    <div style={{ fontFamily: "'Cinzel', serif", color: "var(--neon-cyan)", letterSpacing: 4 }}>AWAITING PROTOCOL...</div>
  </div>
);

// RoundDisplay now accepts registerGeminiWindow to let anti-cheat track the popup
const RoundDisplay = ({ playerLabel, targetImage, onComplete, roundLabel, storageKey, isPaused, timeLeft, isRoundEnded, teamId, registerGeminiWindow }) => {
  const [uploading, setUploading] = useState(false);
  const [uploadedImgUrl, setUploadedImgUrl] = useState(null);
  const [isGeminiLaunched, setIsGeminiLaunched] = usePersistentState(`maya_${storageKey}_launched`, false);
  const [geminiLink, setGeminiLink] = usePersistentState(`maya_${storageKey}_link`, "");
  const [verifying, setVerifying] = useState(false);
  const geminiWindowRef = useRef(null);

  useEffect(() => {
    if (isPaused) {
      window.dispatchEvent(new CustomEvent("mayavyuh_pause"));
      try {
        if (geminiWindowRef.current && !geminiWindowRef.current.closed) {
          geminiWindowRef.current.close();
        } else {
          // Attempt to close even if we lost the reference (e.g., due to refresh)
          const fallbackWin = window.open('', 'GeminiPopup');
          if (fallbackWin) fallbackWin.close();
        }
      } catch (e) {
        console.error("Could not close Gemini window", e);
      }
      setIsGeminiLaunched(false); // Reset so they have to reopen when resumed
    }
  }, [isPaused]);

  const fmtTime = (s) => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;

  const handleOpenGemini = () => {
    // Attempt to force the main app into True Fullscreen
    try {
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen();
      }
    } catch (e) {
      console.warn("Fullscreen request blocked.");
    }

    const sw = window.screen.width;
    const sh = window.screen.height;
    const half = Math.floor(sw / 2);

<<<<<<< HEAD
    // Open Gemini on the right half
    const geminiWin = window.open('https://gemini.google.com', 'GeminiPopup', `width=${half},height=${sh},left=${half},top=0`);
=======
    const url = geminiLink.trim() ? geminiLink.trim() : 'https://gemini.google.com';

    // Open Gemini on the right half (using absolute screen dimensions)
    geminiWindowRef.current = window.open(url, 'GeminiPopup', `width=${half},height=${sh},left=${half},top=0`);
>>>>>>> 1c10010 (Update anti-cheat, Gemini link persistence, locking mechanism, and admin telemetry)
    
    // Register the popup with anti-cheat so blur events aren't flagged
    if (registerGeminiWindow) registerGeminiWindow(geminiWin);

    // Attempt to resize current window to the left half
    try {
      window.resizeTo(half, sh);
      window.moveTo(0, 0);
    } catch (e) {
      console.warn("Browser blocked window resize", e);
    }
    
    setIsGeminiLaunched(true);
  };

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("image", file);
    if (teamId) formData.append("teamId", teamId);
    if (storageKey) formData.append("round", storageKey.replace('r', ''));
    try {
      const uploadRes = await fetch(`${API}/api/player/upload-submission`, { method: "POST", body: formData });
      const data = await uploadRes.json();
      if (!data.success) {
        throw new Error(data.error || data.message || "Upload failed");
      }
      setUploadedImgUrl(data.url);
    } catch (err) {
      console.error(err);
      alert(err.message || "Failed to upload image. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!geminiLink.trim()) {
      alert("SECURITY LOCK: You must paste your Gemini Chat Link to verify this spell.");
      return;
    }
    setVerifying(true);
    try {
      const res = await fetch(`${API}/api/verify-gemini`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link: geminiLink })
      });
      const data = await res.json();
      if (!res.ok) {
        alert("LOCK REJECTED: " + (data.error || "Verification failed."));
        return;
      }
      onComplete(uploadedImgUrl, geminiLink);
    } catch(err) {
      alert("Error verifying the Gemini link.");
    } finally {
      setVerifying(false);
    }
  };

  if (isGeminiLaunched) {
    return (
<<<<<<< HEAD
      <motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="ac-protected-content" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', width: "50vw", padding: "32px 40px", boxSizing: "border-box", position: "relative", zIndex: 1 }}>
=======
      <motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', width: isRoundEnded ? "100%" : "50vw", padding: "32px 40px", boxSizing: "border-box", position: "relative", zIndex: 1 }}>
>>>>>>> 1c10010 (Update anti-cheat, Gemini link persistence, locking mechanism, and admin telemetry)
        
        {/* Header Row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32, maxWidth: isRoundEnded ? 800 : "none", margin: isRoundEnded ? "0 auto 32px auto" : "0", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <div style={{ fontSize: 40, fontFamily: "'Orbitron'", color: isPaused ? "#ff2a2a" : "#D4AF37", textShadow: `0 0 10px ${isPaused ? 'rgba(255,42,42,0.5)' : 'rgba(212,175,55,0.5)'}`, letterSpacing: 2 }}>
              {fmtTime(timeLeft)}
            </div>
            <div className="title-secondary" style={{ marginBottom: 0, border: "none", fontSize: 24, letterSpacing: 2, color: "var(--neon-cyan)" }}>
              {roundLabel}
            </div>
          </div>
          
          {/* Top Right Recontinue / Link saving */}
          {!isRoundEnded && (
            <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
              <input 
                type="url" 
                placeholder="Save Gemini Link to Resume" 
                value={geminiLink} 
                onChange={e => setGeminiLink(e.target.value)} 
                readOnly={geminiLink.trim().length > 0}
                style={{ width: 250, padding: "8px 12px", background: "rgba(0,0,0,0.5)", border: "1px solid var(--neon-cyan)", color: geminiLink.trim() ? "var(--neon-cyan)" : "#fff", fontFamily: "'Share Tech Mono'", outline: "none", borderRadius: 4, fontSize: 12, opacity: geminiLink.trim() ? 0.8 : 1 }} 
              />
              <button className="btn-imperial" onClick={handleOpenGemini} style={{ padding: "8px 16px", fontSize: 12, display: "flex", alignItems: "center" }}>
                REOPEN ➔
              </button>
            </div>
          )}
        </div>
        
        {/* Main Panel */}
        <motion.div layout className="glass-panel" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "32px", width: "100%", maxWidth: "800px", margin: "0 auto", boxSizing: "border-box" }}>
           <div className="title-secondary" style={{ marginBottom: 24, fontSize: 20 }}>TARGET DATACRON</div>
           
<<<<<<< HEAD
           {targetImage ? (
              <motion.div layout style={{ width: "100%", flex: 1, minHeight: 300, display: "flex", justifyContent: "center", alignItems: "center", background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: 16, border: "1px solid rgba(255,255,255,0.1)", marginBottom: 24 }}>
                {/* ac-protected-content blurs this on focus loss */}
                <motion.img layoutId="target-image" src={targetImage} alt="target" style={{ maxWidth: "100%", maxHeight: "50vh", objectFit: "contain", borderRadius: 4, boxShadow: "0 0 20px rgba(0,0,0,0.5)" }} />
              </motion.div>
=======
           {isPaused ? (
             <div style={{ textAlign: "center", padding: 40, flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{ fontSize: 64, marginBottom: 16 }}>⏸️</div>
                <div style={{ fontFamily: "'Orbitron'", fontSize: 24, color: "#ff2a2a" }}>DATACRON PAUSED</div>
                <div style={{ color: "var(--text-dim)", marginTop: 16 }}>Target image hidden. Awaiting Admin...</div>
             </div>
           ) : isRoundEnded && !uploadedImgUrl ? (
             <div style={{ textAlign: "center", padding: 20, width: "100%" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
                <div style={{ fontFamily: "'Orbitron'", fontSize: 20, color: "var(--neon-red)", marginBottom: 16 }}>PHASE SEALED</div>
                <div style={{ color: "var(--text-dim)", marginBottom: 24 }}>Time is up. Submit your final artifact immediately.</div>
                
                <motion.label layout style={{ width: "100%", cursor: uploading ? "not-allowed" : "pointer" }}>
                  <div style={{ width: "100%", padding: "16px", border: "1px solid rgba(255, 42, 42, 0.5)", borderRadius: 8, background: "rgba(255,0,0,0.1)", textAlign: "center", transition: "all 0.3s" }}>
                    <span style={{ color: uploading ? "var(--text-dim)" : "var(--neon-red)", fontSize: 16, letterSpacing: 2, fontFamily: "'Orbitron'", fontWeight: "bold" }}>
                      {uploading ? "UPLOADING ARTIFACT..." : "UPLOAD FINAL IMAGE"}
                    </span>
                    <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleUpload} disabled={uploading} />
                  </div>
                </motion.label>
             </div>
>>>>>>> 1c10010 (Update anti-cheat, Gemini link persistence, locking mechanism, and admin telemetry)
           ) : (
             <>
               {targetImage && !isRoundEnded ? (
                  <motion.div layout style={{ width: "100%", flex: 1, minHeight: 300, display: "flex", justifyContent: "center", alignItems: "center", background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: 16, border: "1px solid rgba(255,255,255,0.1)", marginBottom: 24 }}>
                    <motion.img layoutId="target-image" src={targetImage} alt="target" style={{ maxWidth: "100%", maxHeight: "50vh", objectFit: "contain", borderRadius: 4, boxShadow: "0 0 20px rgba(0,0,0,0.5)" }} />
                  </motion.div>
               ) : !isRoundEnded && (
                  <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", color: "var(--text-dim)", fontFamily: "'Orbitron'", minHeight: 300 }}>NO TARGET</div>
               )}

               {!uploadedImgUrl ? (
                  <motion.label layout style={{ width: "100%", cursor: uploading ? "not-allowed" : "pointer" }}>
                    <div style={{ width: "100%", padding: "16px", border: "1px solid rgba(0, 255, 255, 0.3)", borderRadius: 8, background: "rgba(0,0,0,0.6)", textAlign: "center", transition: "all 0.3s", boxShadow: "inset 0 0 10px rgba(0, 255, 255, 0.05)" }}>
                      <span style={{ color: uploading ? "var(--text-dim)" : "var(--neon-cyan)", fontSize: 16, letterSpacing: 2, fontFamily: "'Orbitron'", fontWeight: "bold" }}>
                        {uploading ? "UPLOADING ARTIFACT..." : "UPLOAD GENERATED IMAGE"}
                      </span>
                      <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleUpload} disabled={uploading} />
                    </div>
                  </motion.label>
               ) : (
                  <motion.div layout style={{ width: "100%" }}>
                    <div className="title-secondary" style={{ marginBottom: 16, fontSize: 16 }}>REVIEW SPELL</div>
                    <div style={{ width: "100%", display: "flex", justifyContent: "center", alignItems: "center", background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: 16, border: "1px solid rgba(212, 175, 55, 0.4)", marginBottom: 24 }}>
                      <img src={uploadedImgUrl} alt="generated preview" style={{ maxWidth: "100%", maxHeight: "30vh", objectFit: "contain", borderRadius: 4 }} />
                    </div>
                    
                    <div style={{ width: "100%", marginBottom: 16 }}>
                      <div style={{ color: "var(--neon-cyan)", fontSize: 12, marginBottom: 8, letterSpacing: 2 }}>GEMINI CHAT LINK:</div>
                      <input 
                        type="url" 
                        placeholder="https://gemini.google.com/app/6c03e86xxxxxxxx3" 
                        value={geminiLink} 
                        onChange={e=>setGeminiLink(e.target.value)} 
                        readOnly={geminiLink.trim().length > 0}
                        style={{ width: "100%", padding: "16px", background: "rgba(0,0,0,0.5)", border: "1px solid var(--neon-cyan)", color: geminiLink.trim() ? "var(--neon-cyan)" : "#fff", fontFamily: "'Share Tech Mono'", outline: "none", borderRadius: 4, opacity: geminiLink.trim() ? 0.8 : 1 }} 
                      />
                    </div>
                    
                    <div style={{ display: "flex", gap: 16 }}>
                      <button className="btn-imperial-danger" style={{ flex: 1, padding: 16 }} onClick={() => setUploadedImgUrl(null)}>RETRY</button>
                      <button className="btn-imperial" style={{ flex: 2, padding: 16, borderColor: "var(--neon-green)", color: "var(--neon-green)", opacity: verifying ? 0.5 : 1 }} onClick={handleSubmit} disabled={verifying}>
                        {verifying ? "VERIFYING..." : "SUBMIT TO DATACRON ➔"}
                      </button>
                    </div>
                  </motion.div>
               )}
             </>
           )}
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div layout className="chat-layout" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {/* Sidebar */}
      <div className="chat-sidebar">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <img src={gdgLogo} alt="GDG Logo" style={{ width: 40 }} />
          <div className="title-secondary" style={{ marginBottom: 0, border: "none" }}>{roundLabel}</div>
        </div>
        <div style={{ fontFamily: "'Share Tech Mono'", color: "var(--neon-cyan)", marginBottom: 24, fontSize: 14 }}>{playerLabel} IS AT THE TERMINAL</div>
        
        <div style={{ textAlign: "center", marginBottom: 24, background: "rgba(0,0,0,0.5)", padding: 16, border: "1px solid rgba(212,175,55,0.2)" }}>
          <div style={{ fontSize: 32, fontFamily: "'Orbitron'", color: isPaused ? "#ff2a2a" : "#D4AF37", textShadow: `0 0 10px ${isPaused ? 'rgba(255,42,42,0.5)' : 'rgba(212,175,55,0.5)'}` }}>
            {fmtTime(timeLeft)}
          </div>
          <div style={{ fontSize: 10, letterSpacing: 4, color: isPaused ? "#ff2a2a" : "rgba(212,175,55,0.6)" }}>
            {isPaused ? "TEMPORAL HALT" : "TIME REMAINING"}
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ color: "var(--text-dim)", marginBottom: 8, fontSize: 14 }}>TARGET DATACRON:</div>
<<<<<<< HEAD
          {/* ac-protected-content: blurs on focus loss */}
          <motion.div layout className="glass-panel ac-protected-content" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 0, maxHeight: 400, overflow: "hidden" }}>
            {targetImage ? <motion.img layoutId="target-image" src={targetImage} alt="target" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <div style={{ color: "var(--text-dim)", fontFamily: "'Orbitron'" }}>NO TARGET</div>}
=======
          <motion.div layout className="glass-panel" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 0, maxHeight: 400, overflow: "hidden" }}>
            {isPaused || isRoundEnded ? (
              <div style={{ color: "var(--text-dim)", fontFamily: "'Orbitron'", textAlign: "center", padding: 16 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>{isPaused ? "⏸️" : "🔒"}</div>
                {isPaused ? "TARGET HIDDEN" : "PHASE SEALED"}
              </div>
            ) : targetImage ? (
              <motion.img layoutId="target-image" src={targetImage} alt="target" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            ) : (
              <div style={{ color: "var(--text-dim)", fontFamily: "'Orbitron'", textAlign: "center", padding: 16 }}>
                <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.5 }}>👁️‍🗨️</div>
                BLIND RECREATION<br/>NO TARGET
              </div>
            )}
>>>>>>> 1c10010 (Update anti-cheat, Gemini link persistence, locking mechanism, and admin telemetry)
          </motion.div>
        </div>
      </div>

      {/* Main Action Area */}
      <motion.div layout className="chat-main" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40 }}>
        {isRoundEnded ? (
          <div className="glass-panel" style={{ width: "100%", maxWidth: 600, textAlign: "center", padding: 48 }}>
             <div style={{ fontSize: 64, marginBottom: 16 }}>🔒</div>
             <div style={{ fontFamily: "'Orbitron'", fontSize: 24, color: "var(--neon-red)" }}>PHASE SEALED</div>
             <div style={{ color: "var(--text-dim)", marginTop: 16, marginBottom: 32 }}>This phase has been closed by the Admin. You must submit your final result.</div>
             
             <button className="btn-imperial-danger" onClick={() => setIsGeminiLaunched(true)} style={{ width: "100%", padding: 20, fontSize: 16, display: "flex", justifyContent: "center", gap: 12 }}>
               OPEN FINAL SUBMISSION PANEL ➔
             </button>
          </div>
        ) : isPaused ? (
          <div style={{ textAlign: "center" }}>
             <div style={{ fontSize: 64, marginBottom: 16 }}>⏸️</div>
             <div style={{ fontFamily: "'Orbitron'", fontSize: 24, color: "#ff2a2a" }}>DATACRON PAUSED</div>
             <div style={{ color: "var(--text-dim)", marginTop: 16 }}>Wait for the Admin to resume the phase.</div>
          </div>
        ) : (
          <div className="glass-panel" style={{ width: "100%", maxWidth: 600, textAlign: "center", padding: 48 }}>
            <div style={{ fontSize: 48, marginBottom: 24 }}>✨</div>
            <div style={{ fontFamily: "'Orbitron'", fontSize: 24, color: "var(--neon-gold)", marginBottom: 16 }}>SPELL GENERATION</div>
            <div style={{ color: "var(--text-dim)", marginBottom: 32, lineHeight: 1.6 }}>
              Launch Gemini in Split-Screen Mode to generate your spell.<br/>
              Your target image will remain visible here.
            </div>

            <div style={{ marginBottom: 24 }}>
              <input 
                type="url" 
                placeholder="Paste Gemini Chat Link to Resume (Optional)" 
                value={geminiLink} 
                onChange={e => setGeminiLink(e.target.value)} 
                readOnly={geminiLink.trim().length > 0}
                style={{ width: "100%", padding: "16px", background: "rgba(0,0,0,0.5)", border: "1px solid var(--neon-cyan)", color: geminiLink.trim() ? "var(--neon-cyan)" : "#fff", fontFamily: "'Share Tech Mono'", outline: "none", borderRadius: 4, textAlign: "center", opacity: geminiLink.trim() ? 0.8 : 1 }} 
              />
            </div>
            
            <button className="btn-imperial" onClick={handleOpenGemini} style={{ width: "100%", padding: 20, fontSize: 16, display: "flex", justifyContent: "center", gap: 12 }}>
              {geminiLink.trim() ? "RECONTINUE GEMINI ➔" : "LAUNCH GEMINI (SPLIT SCREEN) ➔"}
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};

const SelectionScreen = ({ imgR2, imgR3, onSelect }) => (
  <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40, position: "relative", zIndex: 1 }}>
    <img src={gdgLogo} alt="GDG Logo" style={{ width: 60, marginBottom: 20 }} />
    <div className="title-primary" style={{ marginBottom: 16 }}>FINAL SELECTION</div>
    <div style={{ fontFamily: "'Share Tech Mono'", color: "var(--text-dim)", marginBottom: 40, fontSize: 18 }}>CHOOSE THE IMAGE THAT BEST MATCHES THE TARGET</div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, width: "100%", maxWidth: 1000 }}>
      <div className="glass-panel" style={{ textAlign: "center" }}>
        <div className="title-secondary">ROUND 2 OUTPUT</div>
        <img src={imgR2} alt="R2" style={{ width: "100%", aspectRatio: "1/1", objectFit: "contain", marginBottom: 24, borderRadius: 6 }} />
        <button className="btn" onClick={() => onSelect(imgR2)}>SELECT THIS</button>
      </div>
      <div className="glass-panel" style={{ textAlign: "center" }}>
        <div className="title-secondary">ROUND 3 OUTPUT</div>
        <img src={imgR3} alt="R3" style={{ width: "100%", aspectRatio: "1/1", objectFit: "contain", marginBottom: 24, borderRadius: 6 }} />
        <button className="btn" onClick={() => onSelect(imgR3)}>SELECT THIS</button>
      </div>
    </div>
  </div>
);

const JudgmentScreen = ({ originalImg, finalImg, score, onFinish }) => {
  const [timeLeft, setTimeLeft] = useState(50);
  
  useEffect(() => {
    if (timeLeft <= 0) {
      onFinish();
      return;
    }
    const t = setTimeout(() => setTimeLeft(prev => prev - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft, onFinish]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40, position: "relative", zIndex: 1 }}>
      <img src={gdgLogo} alt="GDG Logo" style={{ width: 80, marginBottom: 20 }} />
      <div className="title-primary" style={{ marginBottom: 20, color: "var(--neon-gold)", textShadow: "0 0 20px var(--neon-gold)", animation: "pulse 2s infinite" }}>SIMILARITY RESULTS</div>
      <div style={{ fontFamily: "'Orbitron'", color: "var(--neon-cyan)", fontSize: 24, marginBottom: 40, letterSpacing: 4 }}>
        PROCEEDING IN {timeLeft}S
      </div>
      
      <div style={{ display: "flex", gap: 60, alignItems: "center", width: "100%", maxWidth: 1200, perspective: 1000 }}>
        <div className="glass-panel cinematic-card" style={{ flex: 1, textAlign: "center", transform: "rotateY(10deg)" }}>
          <div className="title-secondary">TARGET DATACRON</div>
          <img src={originalImg} alt="orig" style={{ width: "100%", aspectRatio: "1/1", objectFit: "contain", borderRadius: 8, boxShadow: "0 0 30px rgba(0,0,0,0.8)" }} />
        </div>
        <div style={{ width: 260, textAlign: "center", animation: "float 4s infinite" }}>
          <div style={{ fontSize: 80, fontFamily: "'Orbitron'", color: "var(--neon-gold)", textShadow: "0 0 30px var(--neon-gold)", fontWeight: 900 }}>{score ? `${score.toFixed(1)}%` : "..."}</div>
          <div style={{ fontFamily: "'Share Tech Mono'", color: "var(--text-dim)", letterSpacing: 8, fontSize: 18 }}>SYNCHRONIZATION</div>
        </div>
        <div className="glass-panel cinematic-card" style={{ flex: 1, textAlign: "center", transform: "rotateY(-10deg)" }}>
          <div className="title-secondary">GENERATED SPELL</div>
          <img src={finalImg} alt="final" style={{ width: "100%", aspectRatio: "1/1", objectFit: "contain", borderRadius: 8, boxShadow: "0 0 30px rgba(0,0,0,0.8)" }} />
        </div>
      </div>
    </div>
  );
};

const LeaderboardRedirect = ({ teams }) => {
  const sorted = [...teams].filter(t => t.score).sort((a,b) => b.score - a.score).slice(0, 3);
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative", zIndex: 1 }}>
      <img src={gdgLogo} alt="GDG Logo" style={{ width: 80, marginBottom: 20 }} />
      <div className="title-primary" style={{ marginBottom: 40 }}>FINAL LEADERBOARD</div>
      <div className="glass-panel" style={{ width: 600 }}>
        {sorted.map((t, i) => (
          <div key={t.id} style={{ display: "flex", justifyContent: "space-between", padding: "16px 0", borderBottom: i < 2 ? "1px solid var(--glass-border)" : "none", fontSize: 24, fontFamily: "'Orbitron'" }}>
            <div style={{ color: i===0 ? "var(--neon-gold)" : i===1 ? "silver" : "#cd7f32" }}>#{i+1} {t.name}</div>
            <div style={{ color: "var(--neon-cyan)" }}>{t.score ? t.score.toFixed(1) : 0}%</div>
          </div>
        ))}
        {sorted.length === 0 && <div style={{ textAlign: "center", color: "var(--text-dim)", fontFamily: "'Share Tech Mono'" }}>NO TEAMS HAVE COMPLETED THE TRIAL YET</div>}
      </div>
    </div>
  );
};

const PlayerSection = ({ globalTeams, setGlobalTeams, eventState }) => {
  const [myTeam, setMyTeam] = useState(() => {
    try { const t = localStorage.getItem("maya_my_team"); return t ? JSON.parse(t) : null; } catch { return null; }
  });
  useEffect(() => {
    if (myTeam) localStorage.setItem("maya_my_team", JSON.stringify(myTeam));
  }, [myTeam]);

  const [disqualifiedReason, setDisqualifiedReason] = usePersistentState("maya_disqualified", null);
  const [phase, setPhase] = usePersistentState("maya_phase", "register");
  const [targetImage, setTargetImage] = usePersistentState("maya_targetImage", null);
  const [r1Img, setR1Img] = usePersistentState("maya_r1Img", null);
  const [r2Img, setR2Img] = usePersistentState("maya_r2Img", null);
  const [r3Img, setR3Img] = usePersistentState("maya_r3Img", null);
  const [finalImg, setFinalImg] = usePersistentState("maya_finalImg", null);
  const [score, setScore] = usePersistentState("maya_score", null);

  const [session, setSession] = useState(null);

  const handleDisqualify = useCallback((reason) => {
    if (!myTeam) return;
    setDisqualifiedReason(reason);
    
    // Broadcast ban to admin instantly
    setGlobalTeams(prev => prev.map(t => t.id === myTeam.id ? { ...t, status: "banned" } : t));
    
    // Try to update backend if endpoint exists (fire and forget)
    fetch(`${API}/api/game/teams/${myTeam.id}/ban`, { method: "POST" }).catch(() => {});
  }, [myTeam, setDisqualifiedReason, setGlobalTeams]);

  // Anti-cheat hook — active only for player view
  const { registerGeminiWindow } = useAntiCheat({
    isPlayer: true,
    teamId: myTeam?.id || null,
    onDisqualify: handleDisqualify
  });
  
  const [isBannedLocally, setIsBannedLocally] = usePersistentState("maya_banned", false);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // If they hide the tab (switch tabs or minimize), ban them!
        setIsBannedLocally(true);
        if (myTeam?.id) {
          fetch("http://localhost:5001/api/game/teams/update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ teamId: myTeam.id, updates: { status: "banned" } })
          }).catch(console.error);
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [myTeam, setIsBannedLocally]);
  useEffect(() => {
    if (!myTeam) return;
    const fetchSession = async () => {
      try {
        const res = await fetch(`${API}/api/game/status`);
        const data = await res.json();
        if (data.session) setSession(data.session);
      } catch (err) {}
    };
    fetchSession();
    const interval = setInterval(fetchSession, 3000);
    return () => clearInterval(interval);
  }, [myTeam]);

  useEffect(() => {
    if (!session || !myTeam) return;
    const s = session.status;
    
    if (s === 'waiting' && phase !== 'lobby' && phase !== 'register') {
      setPhase("lobby");
    }
    else if (s === 'round1_active' && phase === 'lobby') {
      fetch(`${API}/api/target-image`)
        .then(r=>r.json())
        .then(d=>{ setTargetImage(d.url); setPhase("r1"); })
        .catch(e=>setPhase("r1"));
    }
    else if (s === 'round2_active' && phase === 'interval1') {
      setPhase("r2");
    }
    else if (s === 'round3_active' && (phase === 'interval1' || phase === 'r2' || phase === 'wait_for_r3')) {
      setPhase("r3");
    }
    else if (s === 'finished' && phase !== 'leaderboard') {
      setPhase("leaderboard");
    }
  }, [session?.status, myTeam, phase, setPhase, setTargetImage]);

  const [timeLeft, setTimeLeft] = useState(0);
  useEffect(() => {
    if (!session?.roundEndTime) { setTimeLeft(0); return; }
    const tick = () => {
      if (session.isPaused && session.timeRemainingAtPause != null) {
        setTimeLeft(Math.floor(session.timeRemainingAtPause / 1000));
      } else {
        setTimeLeft(Math.max(0, Math.floor((new Date(session.roundEndTime) - Date.now()) / 1000)));
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [session?.roundEndTime, session?.isPaused, session?.timeRemainingAtPause]);

  useEffect(() => {
    if (myTeam && phase === "register") {
      setPhase("lobby");
    }
  }, [myTeam, phase, setPhase]);

  useEventListener((eventType) => {
    if (eventType === "GLOBAL_RESET") {
      localStorage.removeItem("maya_my_team");
      localStorage.removeItem("maya_phase");
      localStorage.removeItem("maya_targetImage");
      localStorage.removeItem("maya_r1Img");
      localStorage.removeItem("maya_r2Img");
      localStorage.removeItem("maya_r3Img");
      localStorage.removeItem("maya_finalImg");
      localStorage.removeItem("maya_score");
      window.location.reload();
    }
  });

  const handleRegister = async (t) => {
    setTargetImage(null);
    setR1Img(null);
    setR2Img(null);
    setR3Img(null);
    setFinalImg(null);
    setScore(null);
    setDisqualifiedReason(null);
    
    try {
      const res = await fetch("http://localhost:5001/api/game/teams/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamName: t.name, player1: t.player1, player2: t.player2, role: 'creator' })
      });
      const data = await res.json();
      if (data.success && data.team) {
        t.id = data.team._id;
        setMyTeam(t);
        setGlobalTeams(prev => [...prev.filter(x => x.id !== t.id), t]);
        setPhase("lobby");
      } else {
        alert("Server rejected registration. Is the backend running?");
      }
    } catch(err) { 
      console.error("Registration sync failed", err);
      alert("Registration failed! Could not connect to backend server.");
    }
  };

  const updateTeamStatus = async (updates) => {
    setGlobalTeams(prev => prev.map(t => t.id === myTeam.id ? { ...t, ...updates } : t));
    try {
      await fetch("http://localhost:5001/api/game/teams/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: myTeam.id, updates })
      });
    } catch(err) { console.error("Status update sync failed", err); }
  };

  const currentTeamState = globalTeams.find(t => t.id === myTeam?.id);

  // Auto-unban if backend says we are active, or close Gemini if banned!
  useEffect(() => {
    if (isBannedLocally && currentTeamState?.status === "active") {
      setIsBannedLocally(false);
      localStorage.removeItem("maya_banned");
    }
    if (isBannedLocally || currentTeamState?.status === "banned") {
      window.dispatchEvent(new CustomEvent("mayavyuh_pause"));
    }
  }, [currentTeamState?.status, isBannedLocally, setIsBannedLocally]);

  if (!myTeam) return <RegistrationScreen onRegister={handleRegister} />;
<<<<<<< HEAD
  
  if (disqualifiedReason) {
    return <DisqualifiedScreen teamName={myTeam.name} reason={disqualifiedReason} />;
  }
  
  const currentTeamState = globalTeams.find(t => t.id === myTeam?.id);
  if (currentTeamState?.status === "banned") {
=======

  if (currentTeamState?.status === "banned" || isBannedLocally) {
>>>>>>> 1c10010 (Update anti-cheat, Gemini link persistence, locking mechanism, and admin telemetry)
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative", zIndex: 1, background: "rgba(255, 0, 0, 0.1)" }}>
        <div style={{ fontSize: 64, marginBottom: 20 }}>☠️</div>
        <div className="title-primary" style={{ color: "var(--neon-red)", textShadow: "0 0 20px rgba(255, 0, 0, 0.5)" }}>BANNED</div>
        <div style={{ fontFamily: "'Share Tech Mono'", color: "var(--text-dim)", marginTop: 16, maxWidth: 600, textAlign: "center", lineHeight: 1.5 }}>
          <strong style={{ color: "var(--neon-red)" }}>VIOLATION DETECTED:</strong> YOUR TEAM HAS BEEN DISQUALIFIED FOR SWITCHING TABS OR MINIMIZING THE ASSESSENT WINDOW.
        </div>
        
        {/* TEMPORARY UNBAN BUTTON FOR TESTING */}
        <button 
          className="btn" 
          style={{ marginTop: 40, border: "1px solid rgba(255, 255, 255, 0.2)", background: "rgba(255,255,255,0.05)" }}
          onClick={() => {
            localStorage.removeItem("maya_banned");
            setIsBannedLocally(false);
            if (currentTeamState?.status === "banned") {
              updateTeamStatus({ status: "active" });
            }
            setTimeout(() => window.location.reload(), 500);
          }}
        >
          [TESTING] UNBAN ME
        </button>
      </div>
    );
  }

  const isPaused = session?.isPaused || false;
  const status = session?.status || 'waiting';

  if (currentTeamState?.status === "banned" || isBannedLocally) {
  const renderPhase = () => {
    // Common props passed to all RoundDisplay instances
    const roundProps = { teamId: myTeam.id, isPaused, timeLeft, registerGeminiWindow };

    if (phase === "lobby") return <LobbyScreen />;
    if (phase === "r1") return <RoundDisplay {...roundProps} storageKey="r1" playerLabel={`PLAYER 1 (${myTeam.player1})`} targetImage={targetImage} roundLabel="ROUND 1: INITIAL CREATION" onComplete={(img, link) => { setR1Img(img); updateTeamStatus({ round: 1, r1Link: link }); setPhase("interval1"); }} isRoundEnded={status === 'round1_ended'} />;
    if (phase === "interval1") return <IntervalScreen title="VERBAL TRANSFER" message={`PLAYER 1 (${myTeam.player1}), describe the target image to PLAYER 2 (${myTeam.player2}) verbally. Do not show them the screen!`} timeLeft={timeLeft} />;
    if (phase === "r2") return <RoundDisplay {...roundProps} storageKey="r2" playerLabel={`PLAYER 2 (${myTeam.player2})`} targetImage={r1Img} roundLabel="ROUND 2: BLIND RECREATION" onComplete={(img, link) => { setR2Img(img); updateTeamStatus({ round: 2, r2Link: link }); setPhase("wait_for_r3"); }} isRoundEnded={status === 'round2_ended'} />;
    if (phase === "wait_for_r3") return <IntervalScreen title="HOLD POSITION" message="AWAITING ADMIN PROTOCOL FOR ROUND 3" timeLeft={timeLeft} />;
    if (phase === "r3") return <RoundDisplay {...roundProps} storageKey="r3" playerLabel={`PLAYER 1 (${myTeam.player1})`} targetImage={r2Img} roundLabel="ROUND 3: REFINEMENT" onComplete={(img, link) => { setR3Img(img); updateTeamStatus({ r3Link: link }); setPhase("select"); }} isRoundEnded={status === 'round3_ended'} />;
    if (phase === "select") return <SelectionScreen imgR2={r2Img} imgR3={r3Img} onSelect={async (img) => { 
      setFinalImg(img); 
      setPhase("judgment"); 
      try {
        const res = await fetch(`${API}/api/similarity`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ original_url: targetImage, submitted_url: img })
        });
        const data = await res.json();
        const s = data.similarity_score || 0;
        setScore(s);
        updateTeamStatus({ round: 3, score: s, finalImage: img });
      } catch(e) {
        console.error(e);
        setScore(0);
        updateTeamStatus({ round: 3, score: 0, finalImage: img });
      }
    }} />;
    if (phase === "judgment") return <JudgmentScreen originalImg={targetImage} finalImg={finalImg} score={score} onFinish={() => setPhase("leaderboard")} />;
    if (phase === "leaderboard") return <LeaderboardRedirect teams={globalTeams} />;
    return null;
  };

  return (
    <>
      {renderPhase()}
      <button 
        onClick={() => { localStorage.clear(); window.location.reload(); }} 
        className="btn" 
        style={{ position: "fixed", bottom: 20, right: 20, zIndex: 9999, fontSize: 10, padding: "8px 16px", background: "rgba(255,42,42,0.1)", border: "1px solid rgba(255,42,42,0.3)", color: "rgba(255,255,255,0.5)" }}
      >
        [TESTING] CLEAR CACHE & LEAVE TEAM
      </button>
    </>
  );
};

export default function App() {
  const getView = () => { const h=window.location.hash; if(h==="#admin")return"admin"; return"player"; };
  const [view, setView] = useState(getView);
  useEffect(() => { const h=()=>setView(getView()); window.addEventListener("hashchange",h); return()=>window.removeEventListener("hashchange",h); },[]);

  const [teams, setTeams] = useSyncState("maya_teams", INIT_TEAMS);
  const [eventState, setEventState] = useSyncState("maya_event", INIT_EVENT);

  useEffect(() => {
    const fetchTeams = async () => {
      try {
        const res = await fetch("http://localhost:5001/api/game/admin/teams");
        const data = await res.json();
        if (data.success && data.teams) {
          const formattedTeams = data.teams.map(t => ({
             id: t._id,
             name: t.name,
             player1: t.observer,
             player2: t.creator,
             status: t.status,
             score: t.score || 0,
             round: t.round || 0,
             r1Link: t.r1Link || null,
             r2Link: t.r2Link || null,
             r3Link: t.r3Link || null,
             finalImage: t.finalImage || null
          }));
          setTeams(prev => JSON.stringify(prev) === JSON.stringify(formattedTeams) ? prev : formattedTeams);
        }
      } catch(err) {}
    };
    fetchTeams();
    const int = setInterval(fetchTeams, 3000);
    return () => clearInterval(int);
  }, [setTeams]);

  return (
    <>
      <GlobalStyles/>
      {/* Anti-cheat violation banner — rendered once at root, shown by JS */}
      <div id="ac-violation-banner" className="ac-violation-banner" aria-hidden="true" />
      <SceneWrapper>
        {view==="admin"   && <AdminDashboard teams={teams} setTeams={setTeams} eventState={eventState} setEventState={setEventState} />}
        {view==="player"  && <PlayerSection globalTeams={teams} setGlobalTeams={setTeams} eventState={eventState} />}
      </SceneWrapper>
    </>
  );
}