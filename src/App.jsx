import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSyncState, broadcastEvent, useEventListener } from "./useSync.js";
import {
  AdminDashboard, LandingPage, SceneWrapper, GlobalStyles, OraclesLockGame, BG_IMAGES,
} from "./AdminComponents.jsx";

import bg1 from "./assets/bg-1.jpg";
import bg2 from "./assets/bg-2.jpg";
import bg3 from "./assets/bg-3.jpg";
import bg4 from "./assets/bg-4.jpg";
import bg5 from "./assets/bg-5.jpg";

const INIT_TEAMS       = [];
const INIT_WORDS       = ["dragon", "ancient", "fire"];
const INIT_TIMERS      = { round1: 300, round2: 300, round3: 300, discussion: 120, swap: 60 };
const INIT_EVENT       = { started: false };
const INIT_TEAM_CODES  = {}; // { "ABC123": { teamId, teamName, player1, player2, p1role, p2role, status } }

// ─── SESSION STORAGE (per-tab, not shared) ────────────────────────────────────
// Each browser tab has completely isolated sessionStorage.
// This is what makes two tabs on the same machine act as two different players.
const SS_KEY = "maya_tab_identity";
function saveTabIdentity(data) {
  try { sessionStorage.setItem(SS_KEY, JSON.stringify(data)); } catch {}
}
function loadTabIdentity() {
  try { const d = sessionStorage.getItem(SS_KEY); return d ? JSON.parse(d) : null; } catch { return null; }
}
function clearTabIdentity() {
  try { sessionStorage.removeItem(SS_KEY); } catch {}
}

// ─── GAME STATE RECOVERY (per-tab) ───────────────────────────────────────────
const RS_KEY = "maya_recovery_";
function saveRecovery(tabId, data) {
  try { sessionStorage.setItem(RS_KEY + tabId, JSON.stringify(data)); } catch {}
}
function loadRecovery(tabId) {
  try { const d = sessionStorage.getItem(RS_KEY + tabId); return d ? JSON.parse(d) : null; } catch { return null; }
}
function clearRecovery(tabId) {
  try { sessionStorage.removeItem(RS_KEY + tabId); } catch {}
}

// ─── GENERATE 6-DIGIT CODE ────────────────────────────────────────────────────
function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I confusion
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ─── ANTI-CHEAT HOOK ──────────────────────────────────────────────────────────
const SAFE_PHASES = ["lobby", "waiting", "interval1", "interval2", "r3select", "submission", "judgment", "code_entry"];
const useAntiCheat = (enabled, phase, onViolation) => {
  const vc        = useRef(0);
  const blurTimer = useRef(null);
  useEffect(() => {
    if (!enabled) return;
    const onVis = () => {
      if (document.hidden) { vc.current++; onViolation("TAB_SWITCH", `Tab switched — violation #${vc.current}`, vc.current); }
    };
    const onBlur = () => {
      if (SAFE_PHASES.includes(phase)) return;
      blurTimer.current = setTimeout(() => onViolation("WINDOW_BLUR", "Window blurred >1.5s during active round", vc.current), 1500);
    };
    const onFocus = () => { if (blurTimer.current) { clearTimeout(blurTimer.current); blurTimer.current = null; } };
    const onBef   = (e) => { onViolation("PAGE_LEAVE", "Attempted to leave page", vc.current); e.preventDefault(); e.returnValue = "The Oracle is watching."; return e.returnValue; };
    const onCtx   = (e) => e.preventDefault();
    const onKey   = (e) => {
      if (e.ctrlKey && (e.key==="t"||e.key==="n"||e.key==="w")) { e.preventDefault(); onViolation("HOTKEY","Ctrl+"+e.key+" blocked",vc.current); }
      if (e.key==="F12"||(e.ctrlKey&&e.shiftKey&&(e.key==="I"||e.key==="J"))) { e.preventDefault(); onViolation("DEVTOOLS","DevTools blocked",vc.current); }
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("beforeunload", onBef);
    document.addEventListener("contextmenu", onCtx);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("beforeunload", onBef);
      document.removeEventListener("contextmenu", onCtx);
      document.removeEventListener("keydown", onKey);
      if (blurTimer.current) clearTimeout(blurTimer.current);
    };
  }, [enabled, phase, onViolation]);
};

// ─── STYLES ───────────────────────────────────────────────────────────────────
const PlayerStyles = () => (
  <style>{`
    /* ── Entry screen ── */
    .entry-cards { display:grid; grid-template-columns:1fr 1fr; gap:28px; max-width:700px; width:100%; }
    .entry-card { border:1px solid var(--border-rune); border-radius:8px; padding:40px 28px; cursor:pointer; position:relative; overflow:hidden; transition:all 0.4s; background:rgba(8,12,20,0.88); text-align:center; }
    .entry-card::before { content:''; position:absolute; inset:0; opacity:0; transition:opacity 0.4s; }
    .entry-card.register::before { background:radial-gradient(circle at 50% 0%,rgba(200,146,10,0.14),transparent 70%); }
    .entry-card.join::before { background:radial-gradient(circle at 50% 0%,rgba(0,212,255,0.14),transparent 70%); }
    .entry-card:hover::before { opacity:1; }
    .entry-card.register:hover { border-color:var(--rune-gold); box-shadow:0 0 50px rgba(200,146,10,0.18); transform:translateY(-6px); }
    .entry-card.join:hover { border-color:var(--oracle-blue); box-shadow:0 0 50px rgba(0,212,255,0.18); transform:translateY(-6px); }

    /* ── Code display ── */
    .code-display { display:flex; align-items:center; justify-content:center; gap:10px; flex-wrap:wrap; }
    .code-digit { width:52px; height:64px; background:rgba(8,12,20,0.9); border:2px solid var(--rune-gold); border-radius:6px; display:flex; align-items:center; justify-content:center; font-family:'Cinzel Decorative',serif; font-size:26px; color:var(--rune-gold); box-shadow:0 0 16px rgba(200,146,10,0.3); animation:goldPulse 3s infinite; }
    .code-input-row { display:flex; gap:10px; align-items:center; justify-content:center; flex-wrap:wrap; }
    .code-char-input { width:48px; height:60px; background:var(--abyss); border:2px solid var(--border-rune); border-radius:5px; text-align:center; font-family:'Cinzel Decorative',serif; font-size:22px; color:var(--text-bright); outline:none; transition:border-color 0.25s; text-transform:uppercase; }
    .code-char-input:focus { border-color:var(--oracle-blue); box-shadow:0 0 12px rgba(0,212,255,0.25); }

    /* ── Role selection ── */
    .role-pair { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:28px; }
    .role-tile { border:1px solid rgba(200,146,10,0.2); border-radius:6px; padding:28px 20px; cursor:pointer; position:relative; overflow:hidden; transition:all 0.4s; background:rgba(8,12,20,0.85); text-align:center; }
    .role-tile.taken { opacity:0.38; cursor:not-allowed; pointer-events:none; }
    .role-tile.taken::after { content:'TAKEN'; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-15deg); font-family:'Cinzel',serif; font-size:20px; color:var(--blood-glow); letter-spacing:3px; border:2px solid var(--blood-glow); padding:4px 12px; border-radius:3px; }
    .role-tile.observer:hover,.role-tile.selected.observer { border-color:var(--oracle-blue); box-shadow:0 0 36px rgba(0,212,255,0.22); transform:translateY(-4px); }
    .role-tile.creator:hover,.role-tile.selected.creator { border-color:var(--spirit-purple); box-shadow:0 0 36px rgba(139,92,246,0.22); transform:translateY(-4px); }

    /* ── Waiting for partner ── */
    .waiting-partner { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:20px; min-height:100vh; padding:32px; text-align:center; position:relative; z-index:2; }
    .partner-status-row { display:flex; gap:20px; justify-content:center; flex-wrap:wrap; margin-top:8px; }
    .partner-status-card { border:1px solid var(--border-rune); border-radius:5px; padding:16px 24px; background:rgba(8,12,20,0.85); min-width:160px; }
    .partner-status-card.you { border-color:var(--rune-gold); }
    .partner-status-card.them { border-color:var(--border-rune); }
    .partner-status-card.them.joined { border-color:#00ff88; }

    /* ── Active player banner ── */
    .active-player-banner { background:rgba(139,92,246,0.12); border:1px solid rgba(139,92,246,0.35); border-radius:4px; padding:8px 16px; font-family:'Share Tech Mono',monospace; font-size:12px; color:var(--spirit-purple); letter-spacing:2px; text-align:center; }
    .waiting-banner { background:rgba(0,212,255,0.06); border:1px solid rgba(0,212,255,0.25); border-radius:4px; padding:8px 16px; font-family:'Share Tech Mono',monospace; font-size:12px; color:var(--oracle-blue); letter-spacing:2px; text-align:center; }

    /* ── Copy button ── */
    .copy-btn { background:rgba(200,146,10,0.12); border:1px solid rgba(200,146,10,0.4); color:var(--rune-gold); padding:8px 20px; border-radius:3px; cursor:pointer; font-family:'Cinzel',serif; font-size:12px; letter-spacing:2px; transition:all 0.25s; display:inline-flex; align-items:center; gap:8px; }
    .copy-btn:hover { background:rgba(200,146,10,0.2); }
    .copy-btn.copied { border-color:#00ff88; color:#00ff88; background:rgba(0,255,136,0.1); }

    /* Mobile */
    @media(max-width:600px){
      .entry-cards { grid-template-columns:1fr; }
      .role-pair { grid-template-columns:1fr; }
      .code-digit { width:42px; height:54px; font-size:20px; }
      .code-char-input { width:40px; height:52px; font-size:18px; }
      .entry-card { padding:28px 18px; }
    }
  `}</style>
);

// ─── ENTRY SCREEN — Register or Join ─────────────────────────────────────────
const EntryScreen = ({ onRegister, onJoin }) => (
  <div className="lobby-wrap" style={{ position:"relative" }}>
    <div style={{ position:"absolute", inset:0, backgroundImage:`url(${bg1})`, backgroundSize:"cover", backgroundPosition:"center", opacity:0.08, filter:"sepia(0.7) brightness(0.6)", zIndex:0 }}/>
    <div style={{ textAlign:"center", maxWidth:800, width:"100%", animation:"fadeInUp 0.8s ease-out", position:"relative", zIndex:1 }}>
      <div style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:13, color:"var(--oracle-blue)", letterSpacing:4, marginBottom:12 }}>⬡ THE PROMPT WAR ⬡</div>
      <div className="lobby-title">MayaVyuh</div>
      <div style={{ fontFamily:"'IM Fell English',serif", fontSize:18, color:"var(--parchment-dim)", fontStyle:"italic", marginBottom:52, letterSpacing:2 }}>Two warriors. One vision. Enter your sanctum.</div>
      <div className="entry-cards">
        <div className="entry-card register" onClick={onRegister}>
          <div style={{ fontSize:52, marginBottom:16 }}>📜</div>
          <div style={{ fontFamily:"'Cinzel Decorative',serif", fontSize:19, color:"var(--rune-gold)", marginBottom:12, animation:"goldPulse 3s infinite" }}>Register Your Team</div>
          <p style={{ fontFamily:"'IM Fell English',serif", color:"var(--parchment-dim)", fontStyle:"italic", lineHeight:1.6, marginBottom:24, fontSize:14 }}>
            "I am the captain. I will create my team, set our name, and receive the sacred code to share with my teammate."
          </p>
          <button className="btn btn-gold" style={{ width:"100%", justifyContent:"center" }}>Create Team →</button>
        </div>
        <div className="entry-card join" onClick={onJoin}>
          <div style={{ fontSize:52, marginBottom:16 }}>🔮</div>
          <div style={{ fontFamily:"'Cinzel Decorative',serif", fontSize:19, color:"var(--oracle-blue)", marginBottom:12 }}>Enter Game Code</div>
          <p style={{ fontFamily:"'IM Fell English',serif", color:"var(--parchment-dim)", fontStyle:"italic", lineHeight:1.6, marginBottom:24, fontSize:14 }}>
            "My teammate already registered. I have the 6-digit code they shared with me."
          </p>
          <button className="btn btn-oracle" style={{ width:"100%", justifyContent:"center" }}>Join Team →</button>
        </div>
      </div>
    </div>
  </div>
);

// ─── REGISTER SCREEN ─────────────────────────────────────────────────────────
const RegisterScreen = ({ onBack, onRegistered, teamCodes, setTeamCodes, setTeams }) => {
  const [teamName, setTeamName] = useState("");
  const [myName,   setMyName]   = useState("");
  const [loading,  setLoading]  = useState(false);

  const handleRegister = () => {
    if (!teamName.trim() || !myName.trim()) return;
    setLoading(true);
    const code   = generateCode();
    const teamId = Date.now();
    const entry  = {
      teamId, teamName: teamName.trim(),
      player1: myName.trim(), player2: null,
      p1role: null, p2role: null,
      status: "waiting_for_partner",
      createdAt: Date.now(),
    };
    // Write to shared state so joining tab can find it
    setTeamCodes(prev => ({ ...prev, [code]: entry }));
    // Also add a skeleton team to the roster so admin can see it forming
    setTeams(prev => {
      const cleaned = prev.filter(t => t.name !== teamName.trim());
      return [...cleaned, {
        id: teamId, name: teamName.trim(),
        observer: null, creator: null,
        round: 0, score: 0, status: "pending",
        timeLeft: 300, totalTime: 300,
        observerText: "", creatorText: "",
      }];
    });
    // Save this tab's identity to sessionStorage
    saveTabIdentity({ role:"captain", code, teamId, teamName: teamName.trim(), playerName: myName.trim(), myRole: null });
    setLoading(false);
    onRegistered({ code, teamId, teamName: teamName.trim(), playerName: myName.trim() });
  };

  return (
    <div className="lobby-wrap" style={{ position:"relative" }}>
      <div style={{ position:"absolute", inset:0, backgroundImage:`url(${bg1})`, backgroundSize:"cover", backgroundPosition:"center", opacity:0.07, filter:"sepia(0.7) brightness(0.6)", zIndex:0 }}/>
      <div style={{ maxWidth:520, width:"100%", animation:"fadeInUp 0.6s ease-out", position:"relative", zIndex:1 }}>
        <button className="btn btn-ghost" style={{ fontSize:11, padding:"5px 14px", marginBottom:24 }} onClick={onBack}>← BACK</button>
        <div className="card">
          <div className="card-title">📜 Register Your Team</div>
          <div className="form-group">
            <label className="form-label">Team Name</label>
            <input className="form-input" value={teamName} onChange={e=>setTeamName(e.target.value)} placeholder="Name your fellowship..."/>
          </div>
          <div className="form-group" style={{ marginBottom:0 }}>
            <label className="form-label">Your Name (Captain)</label>
            <input className="form-input" value={myName} onChange={e=>setMyName(e.target.value)} placeholder="Your name..."/>
          </div>
          <div style={{ fontFamily:"'IM Fell English',serif", color:"var(--parchment-dim)", fontStyle:"italic", fontSize:13, marginTop:14, lineHeight:1.6 }}>
            "After registering, you'll receive a 6-digit code. Share it with your teammate so they can join on their own tab."
          </div>
        </div>
        <button className="btn btn-gold" style={{ width:"100%", justifyContent:"center", marginTop:16, fontSize:14, padding:"13px" }}
          onClick={handleRegister} disabled={!teamName.trim()||!myName.trim()||loading}>
          {loading ? "Creating..." : "⚡ CREATE TEAM & GET CODE"}
        </button>
      </div>
    </div>
  );
};

// ─── CODE DISPLAY (after registration) ───────────────────────────────────────
const CodeDisplay = ({ code, teamName, partnerJoined, partnerName, partnerRole, onPickRole, myRole }) => {
  const [copied, setCopied] = useState(false);

  const copyCode = () => {
    navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  return (
    <div className="lobby-wrap" style={{ position:"relative", flexDirection:"column" }}>
      <div style={{ position:"absolute", inset:0, backgroundImage:`url(${bg2})`, backgroundSize:"cover", backgroundPosition:"center", opacity:0.09, filter:"sepia(0.5) brightness(0.6)", zIndex:0 }}/>
      <div style={{ maxWidth:640, width:"100%", animation:"fadeInUp 0.6s ease-out", position:"relative", zIndex:1 }}>
        {/* Code */}
        <div style={{ textAlign:"center", marginBottom:36 }}>
          <div style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:12, color:"var(--oracle-blue)", letterSpacing:4, marginBottom:16 }}>⬡ YOUR TEAM CODE ⬡</div>
          <div className="code-display" style={{ marginBottom:20 }}>
            {code.split("").map((ch, i) => <div key={i} className="code-digit">{ch}</div>)}
          </div>
          <button className={`copy-btn ${copied?"copied":""}`} onClick={copyCode}>
            {copied ? "✓ COPIED!" : "📋 COPY CODE"}
          </button>
          <div style={{ fontFamily:"'IM Fell English',serif", color:"var(--parchment-dim)", fontStyle:"italic", fontSize:14, marginTop:14, lineHeight:1.7 }}>
            "Share this code with your teammate. They open <strong style={{color:'var(--oracle-blue)'}}>/MayaVyuh/#player</strong> and click <em>Enter Game Code</em>."
          </div>
        </div>

        {/* Partner status */}
        <div className="card" style={{ marginBottom:24 }}>
          <div className="card-title">⬡ TEAM STATUS — {teamName}</div>
          <div className="partner-status-row">
            <div className="partner-status-card you">
              <div style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:10, color:"var(--rune-gold)", letterSpacing:2, marginBottom:6 }}>YOU</div>
              <div style={{ fontFamily:"'Cinzel',serif", fontSize:15, color:"var(--text-bright)", marginBottom:4 }}>Captain</div>
              {myRole
                ? <span className="status-badge badge-approved">● {myRole.toUpperCase()}</span>
                : <span className="status-badge badge-pending">● PICK ROLE</span>}
            </div>
            <div style={{ display:"flex", alignItems:"center", fontSize:24, color:"var(--parchment-dim)", opacity:0.5 }}>⚔</div>
            <div className={`partner-status-card them ${partnerJoined?"joined":""}`}>
              <div style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:10, color:partnerJoined?"#00ff88":"var(--parchment-dim)", letterSpacing:2, marginBottom:6 }}>
                {partnerJoined ? "PARTNER JOINED ✓" : "WAITING FOR PARTNER..."}
              </div>
              {partnerJoined
                ? <><div style={{ fontFamily:"'Cinzel',serif", fontSize:15, color:"var(--text-bright)", marginBottom:4 }}>{partnerName}</div>
                    {partnerRole ? <span className="status-badge badge-approved">● {partnerRole.toUpperCase()}</span> : <span className="status-badge badge-pending">● PICK ROLE</span>}</>
                : <div style={{ fontFamily:"'IM Fell English',serif", color:"var(--parchment-dim)", fontStyle:"italic", fontSize:13 }}>Share the code above</div>}
            </div>
          </div>
        </div>

        {/* Role selection for captain */}
        {!myRole && (
          <div className="card">
            <div className="card-title">⬡ CHOOSE YOUR ROLE</div>
            <div className="role-pair">
              <div className={`role-tile observer ${partnerRole==="observer"?"taken":""}`} onClick={() => partnerRole!=="observer" && onPickRole("observer")}>
                <div style={{ fontSize:40, marginBottom:12 }}>👁️</div>
                <div style={{ fontFamily:"'Cinzel Decorative',serif", fontSize:17, color:"var(--oracle-blue)", marginBottom:6 }}>Observer</div>
                <p style={{ fontFamily:"'IM Fell English',serif", fontSize:13, color:"var(--parchment-dim)", fontStyle:"italic" }}>Round 1 & 3 — Describe the image</p>
              </div>
              <div className={`role-tile creator ${partnerRole==="creator"?"taken":""}`} onClick={() => partnerRole!=="creator" && onPickRole("creator")}>
                <div style={{ fontSize:40, marginBottom:12 }}>✨</div>
                <div style={{ fontFamily:"'Cinzel Decorative',serif", fontSize:17, color:"var(--spirit-purple)", marginBottom:6 }}>Creator</div>
                <p style={{ fontFamily:"'IM Fell English',serif", fontSize:13, color:"var(--parchment-dim)", fontStyle:"italic" }}>Round 2 — Generate the image</p>
              </div>
            </div>
          </div>
        )}

        {myRole && partnerRole && (
          <div style={{ textAlign:"center", marginTop:8 }}>
            <div style={{ fontFamily:"'IM Fell English',serif", color:"#00ff88", fontSize:15, fontStyle:"italic", marginBottom:12 }}>
              "Both roles assigned — awaiting Admin approval to begin..."
            </div>
            <div style={{ opacity:0.4, margin:"0 auto" }}>
              <svg viewBox="0 0 60 60" width={60} height={60} fill="none" stroke="var(--rune-gold)" strokeWidth="1.5" style={{ animation:"runeFloat 3s ease-in-out infinite" }}>
                <circle cx="30" cy="30" r="28" opacity="0.4"/>
                <circle cx="30" cy="30" r="4" fill="var(--rune-gold)"/>
              </svg>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── JOIN SCREEN (enter code) ─────────────────────────────────────────────────
const JoinScreen = ({ onBack, onJoined, teamCodes, setTeamCodes, setTeams }) => {
  const [chars,    setChars]   = useState(["","","","","",""]);
  const [error,    setError]   = useState("");
  const [myName,   setMyName]  = useState("");
  const [loading,  setLoading] = useState(false);
  const inputRefs = useRef([]);

  const handleChar = (i, val) => {
    const v = val.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(-1);
    const next = [...chars]; next[i] = v; setChars(next);
    if (v && i < 5) inputRefs.current[i+1]?.focus();
    if (!v && i > 0) inputRefs.current[i-1]?.focus();
    setError("");
  };

  const handlePaste = (e) => {
    const pasted = e.clipboardData.getData("text").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6);
    const next = ["","","","","",""];
    pasted.split("").forEach((c,i) => { if(i<6) next[i]=c; });
    setChars(next);
    inputRefs.current[Math.min(pasted.length, 5)]?.focus();
    e.preventDefault();
  };

  const handleJoin = () => {
    const code = chars.join("").trim();
    if (code.length < 6) { setError("Enter the full 6-digit code"); return; }
    if (!myName.trim()) { setError("Enter your name first"); return; }
    setLoading(true);

    const entry = teamCodes[code];
    if (!entry) { setError("Code not found — check with your teammate"); setLoading(false); return; }
    if (entry.status === "full") { setError("This code has already been used by two players"); setLoading(false); return; }
    if (entry.player2) { setError("This team already has two members"); setLoading(false); return; }

    // Mark entry as having a second player
    const updated = { ...entry, player2: myName.trim(), status: "full" };
    setTeamCodes(prev => ({ ...prev, [code]: updated }));

    // Update roster entry to show player 2
    setTeams(prev => prev.map(t => t.id === entry.teamId ? { ...t, player2joined: true } : t));

    saveTabIdentity({ role:"joiner", code, teamId: entry.teamId, teamName: entry.teamName, playerName: myName.trim(), myRole: null });
    setLoading(false);
    onJoined({ code, teamId: entry.teamId, teamName: entry.teamName, playerName: myName.trim(), captainName: entry.player1 });
  };

  return (
    <div className="lobby-wrap" style={{ position:"relative" }}>
      <div style={{ position:"absolute", inset:0, backgroundImage:`url(${bg3})`, backgroundSize:"cover", backgroundPosition:"center", opacity:0.07, filter:"sepia(0.6) brightness(0.6)", zIndex:0 }}/>
      <div style={{ maxWidth:520, width:"100%", animation:"fadeInUp 0.6s ease-out", position:"relative", zIndex:1 }}>
        <button className="btn btn-ghost" style={{ fontSize:11, padding:"5px 14px", marginBottom:24 }} onClick={onBack}>← BACK</button>
        <div className="card">
          <div className="card-title">🔮 Enter Game Code</div>
          <div className="form-group">
            <label className="form-label">Your Name</label>
            <input className="form-input" value={myName} onChange={e=>setMyName(e.target.value)} placeholder="Your name..."/>
          </div>
          <label className="form-label">6-Digit Code from Your Teammate</label>
          <div className="code-input-row" style={{ marginBottom:20 }}>
            {chars.map((ch, i) => (
              <input key={i} ref={el=>inputRefs.current[i]=el}
                className="code-char-input"
                value={ch} maxLength={1}
                onChange={e=>handleChar(i, e.target.value)}
                onKeyDown={e=>{ if(e.key==="Backspace"&&!ch&&i>0){ inputRefs.current[i-1]?.focus(); } }}
                onPaste={i===0 ? handlePaste : undefined}
                placeholder="·"
              />
            ))}
          </div>
          {error && <div style={{ color:"var(--blood-glow)", fontFamily:"'Share Tech Mono',monospace", fontSize:12, letterSpacing:2, marginBottom:12 }}>⚠ {error}</div>}
          <div style={{ fontFamily:"'IM Fell English',serif", color:"var(--parchment-dim)", fontStyle:"italic", fontSize:13, lineHeight:1.6, marginTop:4 }}>
            "Your teammate registered and received a code. Enter it here to join their team on your own tab."
          </div>
        </div>
        <button className="btn btn-oracle" style={{ width:"100%", justifyContent:"center", marginTop:16, fontSize:14, padding:"13px" }}
          onClick={handleJoin} disabled={chars.join("").length<6||!myName.trim()||loading}>
          {loading ? "Joining..." : "🔮 JOIN TEAM"}
        </button>
      </div>
    </div>
  );
};

// ─── ROLE PICKER (for joiner after entering code) ─────────────────────────────
const RolePicker = ({ captainName, captainRole, teamName, onPickRole, myRole }) => (
  <div className="lobby-wrap" style={{ position:"relative", flexDirection:"column" }}>
    <div style={{ position:"absolute", inset:0, backgroundImage:`url(${bg4})`, backgroundSize:"cover", backgroundPosition:"center", opacity:0.08, filter:"sepia(0.5) brightness(0.6)", zIndex:0 }}/>
    <div style={{ maxWidth:620, width:"100%", animation:"fadeInUp 0.6s ease-out", position:"relative", zIndex:1 }}>
      <div style={{ textAlign:"center", marginBottom:28 }}>
        <div style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:12, color:"var(--oracle-blue)", letterSpacing:4, marginBottom:8 }}>⬡ TEAM: {teamName} ⬡</div>
        <div style={{ fontFamily:"'Cinzel Decorative',serif", fontSize:21, color:"var(--rune-gold)", animation:"goldPulse 3s infinite", marginBottom:8 }}>Choose Your Role</div>
        {captainRole && (
          <div style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:13, color:"var(--parchment-dim)" }}>
            {captainName} has taken <span style={{ color:"var(--rune-gold)" }}>{captainRole.toUpperCase()}</span>
          </div>
        )}
      </div>
      {!myRole ? (
        <div className="role-pair">
          <div className={`role-tile observer ${captainRole==="observer"?"taken":""}`} onClick={() => captainRole!=="observer" && onPickRole("observer")}>
            <div style={{ fontSize:44, marginBottom:14 }}>👁️</div>
            <div style={{ fontFamily:"'Cinzel Decorative',serif", fontSize:18, color:"var(--oracle-blue)", marginBottom:8 }}>The Observer</div>
            <p style={{ fontFamily:"'IM Fell English',serif", fontSize:13, color:"var(--parchment-dim)", fontStyle:"italic", lineHeight:1.5 }}>
              "Study the sacred image and transmit its essence through words alone. Rounds 1 & 3."
            </p>
          </div>
          <div className={`role-tile creator ${captainRole==="creator"?"taken":""}`} onClick={() => captainRole!=="creator" && onPickRole("creator")}>
            <div style={{ fontSize:44, marginBottom:14 }}>✨</div>
            <div style={{ fontFamily:"'Cinzel Decorative',serif", fontSize:18, color:"var(--spirit-purple)", marginBottom:8 }}>The Creator</div>
            <p style={{ fontFamily:"'IM Fell English',serif", fontSize:13, color:"var(--parchment-dim)", fontStyle:"italic", lineHeight:1.5 }}>
              "Receive the Observer's transmission and manifest the vision through AI. Round 2."
            </p>
          </div>
        </div>
      ) : (
        <div style={{ textAlign:"center", padding:28 }}>
          <div style={{ fontSize:48, marginBottom:12 }}>{myRole==="observer"?"👁️":"✨"}</div>
          <div style={{ fontFamily:"'Cinzel Decorative',serif", fontSize:22, color:myRole==="observer"?"var(--oracle-blue)":"var(--spirit-purple)", marginBottom:8 }}>
            {myRole==="observer" ? "The Observer" : "The Creator"}
          </div>
          <div style={{ fontFamily:"'IM Fell English',serif", color:"var(--parchment-dim)", fontStyle:"italic", fontSize:15, marginBottom:20 }}>
            "Role confirmed. Awaiting Admin approval and your teammate..."
          </div>
          <div style={{ opacity:0.35, margin:"0 auto" }}>
            <svg viewBox="0 0 60 60" width={60} height={60} fill="none" stroke="var(--rune-gold)" strokeWidth="1.5" style={{ animation:"runeFloat 3s ease-in-out infinite" }}>
              <circle cx="30" cy="30" r="28" opacity="0.4"/>
              <circle cx="30" cy="30" r="4" fill="var(--rune-gold)"/>
            </svg>
          </div>
        </div>
      )}
    </div>
  </div>
);

// ─── WAITING LOBBY ────────────────────────────────────────────────────────────
const WaitingLobby = ({ teamName, myName, myRole, partnerName, partnerPhase, allTeams, observerTimeLeft, observerTimerMax, observerText, winners }) => {
  const pct  = observerTimerMax > 0 ? (Math.max(0,observerTimeLeft) / observerTimerMax) * 100 : 100;
  const mins = Math.floor(Math.max(0, observerTimeLeft) / 60);
  const secs = Math.max(0, observerTimeLeft) % 60;
  const observerName = myRole === "creator" ? myName : partnerName;
  const creatorName  = myRole === "creator" ? partnerName : myName;

  if (winners && winners.length > 0) return <VictoryScreen winners={winners} teamName={teamName} myName={myName}/>;

  return (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 300px", minHeight:"calc(100vh - 44px)", overflow:"hidden", position:"relative" }}>
      <div style={{ position:"absolute", inset:0, backgroundImage:`url(${bg2})`, backgroundSize:"cover", backgroundPosition:"center", opacity:0.07, filter:"sepia(0.4) brightness(0.6)", zIndex:0, pointerEvents:"none" }}/>

      <div style={{ padding:"28px 24px", display:"flex", flexDirection:"column", gap:18, overflowY:"auto", borderRight:"1px solid var(--border-rune)", position:"relative", zIndex:1 }}>
        <div>
          <div className="phase-label">⬡ {myRole.toUpperCase()}'S WAITING CHAMBER</div>
          <div className="phase-title">Hello {myName} — Standby</div>
          <div style={{ fontFamily:"'IM Fell English',serif", fontSize:15, color:"var(--parchment-dim)", fontStyle:"italic", lineHeight:1.7 }}>
            "{partnerName} ({myRole==="creator"?"Observer":"Creator"}) is at the keyboard. Your turn comes next."
          </div>
        </div>

        {/* Who's active */}
        <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
          <div className="active-player-banner" style={{ flex:1 }}>
            ⚔️ ACTIVE: {partnerName} ({myRole==="creator"?"Observer":"Creator"})
          </div>
          <div className="waiting-banner" style={{ flex:1 }}>
            ⏸ WAITING: {myName} ({myRole})
          </div>
        </div>

        {/* Partner progress */}
        <div className="card">
          <div className="card-title">📡 {myRole==="creator"?"Observer":"Creator"}'s Progress — {partnerName}</div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8, flexWrap:"wrap", gap:8 }}>
            <div style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:12, color:"var(--oracle-blue)" }}>
              <span className="live-dot"/>TRANSMITTING...
            </div>
            <div className={`timer-display ${pct<20?"danger":""}`} style={{ fontSize:"clamp(20px,4vw,30px)" }}>
              {String(mins).padStart(2,"0")}:{String(secs).padStart(2,"0")}
            </div>
          </div>
          <div className="timer-bar"><div className={`timer-fill ${pct<20?"danger":""}`} style={{ width:`${pct}%` }}/></div>
          {observerText && (
            <div style={{ marginTop:12, fontFamily:"'IM Fell English',serif", fontSize:14, color:"var(--parchment-dim)", fontStyle:"italic", lineHeight:1.7, padding:12, background:"rgba(0,212,255,0.04)", border:"1px solid var(--border-oracle)", borderRadius:4 }}>
              <span style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:10, color:"var(--oracle-blue)", letterSpacing:2, display:"block", marginBottom:5 }}>LIVE TEXT</span>
              {observerText}
            </div>
          )}
        </div>

        {/* Oracle's Lock game */}
        <div className="card" style={{ flex:1 }}>
          <div className="card-title">🔮 Oracle's Lock — Stay Sharp</div>
          <div style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:11, color:"var(--parchment-dim)", letterSpacing:2, marginBottom:10 }}>
            Align all rune rings to the apex ↑ while you wait
          </div>
          <OraclesLockGame/>
        </div>
      </div>

      {/* Sidebar */}
      <div style={{ padding:"22px 16px", display:"flex", flexDirection:"column", gap:16, overflowY:"auto", background:"rgba(4,5,10,0.78)", position:"relative", zIndex:1 }}>
        <div style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:11, color:"var(--rune-gold)", letterSpacing:3, marginBottom:4 }}>⬡ OTHER TEAMS</div>
        {(allTeams||[]).map((t,i)=>(
          <div key={i} style={{ background:"rgba(8,12,20,0.85)", border:`1px solid ${t.name===teamName?"var(--rune-gold)":"var(--border-rune)"}`, borderRadius:4, padding:"10px 12px", transition:"all 0.3s" }}>
            <div style={{ fontFamily:"'Cinzel',serif", fontSize:13, color:t.name===teamName?"var(--rune-gold)":"var(--text-bright)", marginBottom:4 }}>{t.name}{t.name===teamName&&" (You)"}</div>
            <div style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:11, color:"var(--parchment-dim)", marginBottom:5 }}>R{t.round||0}</div>
            <div className="timer-bar" style={{ margin:0 }}><div className="timer-fill" style={{ width:`${t.timeLeft&&t.totalTime?Math.max(0,(t.timeLeft/t.totalTime)*100):50}%` }}/></div>
          </div>
        ))}
        <div style={{ background:"rgba(8,12,20,0.85)", border:"1px solid var(--border-oracle)", borderRadius:4, padding:14, marginTop:8 }}>
          <div style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:10, color:"var(--oracle-blue)", letterSpacing:2, marginBottom:7 }}>🔮 ORACLE BROADCAST</div>
          <div style={{ fontFamily:"'IM Fell English',serif", fontSize:13, color:"var(--parchment-dim)", fontStyle:"italic", lineHeight:1.6 }}>
            "The vision travels between minds. Be ready — when your teammate finishes, your trial begins."
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── GEMINI UI ────────────────────────────────────────────────────────────────
const GEN_PHRASES = ["Invoking the Oracle...","Weaving light and shadow...","Manifesting the vision...","Almost there...","Sealing the spell..."];

const GeminiUI = ({ forbiddenWords, onSelect, timerDuration, isRefining, imagesToRefine, roundLabel, onTextChange, myName, myRole, bgImage }) => {
  const [prompt,setPrompt]               = useState("");
  const [gallery,setGallery]             = useState([]);
  const [generating,setGenerating]       = useState(false);
  const [timeLeft,setTimeLeft]           = useState(timerDuration||300);
  const [selectedImage,setSelectedImage] = useState(null);
  const [forbidden,setForbidden]         = useState(false);
  const [showTooltip,setShowTooltip]     = useState(false);
  const [rejectedWord,setRejectedWord]   = useState("");
  const [genPhrase,setGenPhrase]         = useState(0);
  const autoFired = useRef(false);
  const selectedRef = useRef(null);
  const galleryRef  = useRef([]);
  useEffect(()=>{ selectedRef.current=selectedImage; },[selectedImage]);
  useEffect(()=>{ galleryRef.current=gallery; },[gallery]);

  useEffect(()=>{
    const t=setInterval(()=>setTimeLeft(tl=>{
      if(tl<=1){
        clearInterval(t);
        if(!autoFired.current){
          autoFired.current=true;
          const img=selectedRef.current||galleryRef.current[0]||"https://picsum.photos/seed/fallback/400/400";
          onSelect(img);
        }
        return 0;
      }
      return tl-1;
    }),1000);
    return()=>clearInterval(t);
  },[]);

  // Full scan forbidden word check
  const handleChange=(e)=>{
    const text=e.target.value;
    const words=text.toLowerCase().replace(/[^a-z\s]/g,"").split(/\s+/).filter(Boolean);
    const fw=(forbiddenWords||[]).map(w=>w.toLowerCase());
    const found=words.find(w=>fw.includes(w));
    if(found){
      const cleaned=text.replace(new RegExp(`\\b${found}\\b`,"gi"),"").replace(/\s{2,}/g," ");
      setRejectedWord(found.toUpperCase()); setForbidden(true); setShowTooltip(true);
      setPrompt(cleaned); onTextChange?.(cleaned);
      setTimeout(()=>{setForbidden(false);setShowTooltip(false);},2500);
    } else {
      setForbidden(false); setPrompt(text); onTextChange?.(text);
    }
  };

  const handleGenerate=()=>{
    if(!prompt||generating) return;
    setGenerating(true);
    let pi=0;
    const pt=setInterval(()=>{pi=(pi+1)%GEN_PHRASES.length;setGenPhrase(pi);},600);
    setTimeout(()=>{
      clearInterval(pt);
      const seed=Date.now();
      const imgs=[`https://picsum.photos/seed/${seed}/400/400`,`https://picsum.photos/seed/${seed+1}/400/400`,`https://picsum.photos/seed/${seed+2}/400/400`];
      setGallery(imgs); setSelectedImage(imgs[0]); setGenerating(false);
    },2500);
  };

  const pct=Math.max(0,(timeLeft/(timerDuration||300))*100);
  const mins=Math.floor(timeLeft/60),secs=timeLeft%60;

  return (
    <div className="creator-wrap" style={{ animation:"fadeInUp 0.5s ease-out", position:"relative" }}>
      <div style={{ position:"absolute", inset:0, backgroundImage:`url(${bgImage||bg3})`, backgroundSize:"cover", backgroundPosition:"center", opacity:0.06, filter:"sepia(0.5) brightness(0.6)", zIndex:0, pointerEvents:"none" }}/>
      {showTooltip&&<div className="word-rejected-tooltip">🚫 FORBIDDEN: "{rejectedWord}" — REMOVED BY THE ORACLE</div>}

      {/* Left pane */}
      <div className="transmission-pane" style={{ position:"relative", zIndex:1 }}>
        <div style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:11, color:"var(--oracle-blue)", letterSpacing:3, marginBottom:10 }}>{isRefining?"📡 REFINE TARGET":"🎯 TARGET VISION"}</div>
        <div style={{ fontFamily:"'Cinzel Decorative',serif", fontSize:13, color:"var(--rune-gold)", marginBottom:12, animation:"goldPulse 3s infinite" }}>{roundLabel}</div>
        <div style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:11, color:"var(--spirit-purple)", letterSpacing:2, marginBottom:12, padding:"6px 10px", background:"rgba(139,92,246,0.1)", border:"1px solid rgba(139,92,246,0.3)", borderRadius:3 }}>
          ⚔️ PLAYING: {myName} ({myRole?.toUpperCase()})
        </div>
        {isRefining
          ? (imagesToRefine||[]).map((img,i)=><div key={i} style={{ border:"1px solid var(--border-oracle)", padding:4, borderRadius:4, overflow:"hidden", marginBottom:8 }}><img src={img} alt="ref" style={{ width:"100%", borderRadius:3, display:"block" }}/></div>)
          : <div style={{ border:"1px solid var(--border-oracle)", padding:4, borderRadius:4, overflow:"hidden" }}><img src="https://picsum.photos/seed/mayatarget/400/400" alt="target" style={{ width:"100%", borderRadius:3, display:"block" }}/></div>}
        {isRefining&&(forbiddenWords||[]).length>0&&(
          <div style={{ marginTop:14, padding:10, background:"rgba(204,34,0,0.06)", border:"1px solid rgba(204,34,0,0.25)", borderRadius:4 }}>
            <div style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:10, color:"var(--blood-glow)", letterSpacing:2, marginBottom:6 }}>FORBIDDEN WORDS</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>{(forbiddenWords||[]).map((w,i)=><span key={i} style={{ background:"rgba(204,34,0,0.1)", border:"1px solid rgba(204,34,0,0.25)", color:"var(--blood-glow)", padding:"2px 7px", borderRadius:2, fontFamily:"'Share Tech Mono',monospace", fontSize:11 }}>{w}</span>)}</div>
          </div>
        )}
        <div style={{ marginTop:16 }}>
          <div className={`timer-display ${timeLeft<60?"danger":""}`}>{String(mins).padStart(2,"0")}:{String(secs).padStart(2,"0")}</div>
          <div className="timer-bar"><div className={`timer-fill ${timeLeft<60?"danger":""}`} style={{ width:`${pct}%` }}/></div>
          {timeLeft<60&&<div style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:11, color:"var(--blood-glow)", textAlign:"center", marginTop:5, letterSpacing:2 }}>AUTO-SUBMIT IN {timeLeft}s</div>}
        </div>
      </div>

      {/* Right pane */}
      <div style={{ display:"flex", flexDirection:"column", minHeight:0, position:"relative", zIndex:1 }}>
        <div style={{ padding:"22px 22px 0", display:"flex", flexDirection:"column", gap:13, flex:1, overflowY:"auto" }}>
          <div>
            <div className="phase-label">⬡ YOUR SPELL</div>
            <textarea className={`prompt-box ${forbidden?"forbidden":""}`} value={prompt} onChange={handleChange}
              placeholder="Craft your generation prompt... Avoid the forbidden words." style={{ minHeight:130 }}/>
          </div>
          <button className="generate-btn" onClick={handleGenerate} disabled={generating||!prompt} style={{ position:"relative", overflow:"hidden" }}>
            {generating?<span style={{ display:"flex", alignItems:"center", gap:10, justifyContent:"center" }}><span style={{ animation:"runeFloat 1s ease-in-out infinite", display:"inline-block" }}>⚗️</span>{GEN_PHRASES[genPhrase]}</span>:"✨ GENERATE VISION"}
            {generating&&<div style={{ position:"absolute", bottom:0, left:0, height:3, background:"var(--oracle-blue)", boxShadow:"0 0 12px var(--oracle-blue)", animation:"growBar 2.5s linear forwards" }}/>}
          </button>
          {gallery.length>0&&(
            <div>
              <div style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:11, color:"var(--oracle-blue)", letterSpacing:2, marginBottom:8 }}>⬡ SELECT YOUR BEST VISION</div>
              <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                {gallery.map((img,idx)=>(
                  <div key={idx} onClick={()=>setSelectedImage(img)} style={{ flex:"1 1 90px", minWidth:80, border:selectedImage===img?"2px solid var(--rune-gold)":"2px solid transparent", cursor:"pointer", borderRadius:4, overflow:"hidden", boxShadow:selectedImage===img?"0 0 20px rgba(200,146,10,0.4)":"none", transition:"all 0.3s" }}>
                    <img src={img} alt="gen" style={{ width:"100%", display:"block" }}/>
                  </div>
                ))}
              </div>
            </div>
          )}
          <button className="submit-btn" onClick={()=>{if(selectedImage&&!autoFired.current){autoFired.current=true;onSelect(selectedImage);}}} disabled={!selectedImage} style={{ position:"relative", overflow:"hidden" }}>
            <div style={{ position:"absolute", inset:0, background:"rgba(139,92,246,0.25)", transformOrigin:"left", width:`${100-pct}%`, transition:"width 1s linear" }}/>
            <span style={{ position:"relative", zIndex:1 }}>⚡ SUBMIT FINAL SPELL</span>
          </button>
        </div>
        <div style={{ height:8 }}/>
      </div>
      <style>{`@keyframes growBar{from{width:0}to{width:100%}}`}</style>
    </div>
  );
};

// ─── INTERVAL SCREENS ─────────────────────────────────────────────────────────
const DiscussionInterval = ({ onComplete, duration }) => {
  const [tl,setTl]=useState(duration||120);
  useEffect(()=>{const t=setInterval(()=>setTl(x=>{if(x<=1){clearInterval(t);onComplete();return 0;}return x-1;}),1000);return()=>clearInterval(t);},[]);
  const m=Math.floor(tl/60),s=tl%60;
  return (
    <div className="transfer-screen" style={{ position:"relative" }}>
      <div style={{ position:"absolute", inset:0, backgroundImage:`url(${bg1})`, backgroundSize:"cover", backgroundPosition:"center", opacity:0.09, filter:"sepia(0.6) brightness(0.5)", zIndex:0 }}/>
      <div style={{ position:"relative", zIndex:1, display:"flex", flexDirection:"column", alignItems:"center" }}>
        <div style={{ fontSize:60, marginBottom:18 }}>🎙️</div>
        <div className="transfer-text">Verbal Transfer Active</div>
        <div style={{ fontFamily:"'IM Fell English',serif", color:"var(--parchment-dim)", fontStyle:"italic", marginTop:10, fontSize:15, textAlign:"center", maxWidth:480, lineHeight:1.7 }}>
          "Both players: discuss the vision together. The Observer explains what they saw. The Creator listens carefully."
        </div>
        <div className="timer-display" style={{ marginTop:28 }}>{String(m).padStart(2,"0")}:{String(s).padStart(2,"0")}</div>
        <div className="timer-bar" style={{ width:"min(300px,80vw)", margin:"8px auto" }}><div className="timer-fill" style={{ width:`${(tl/(duration||120))*100}%` }}/></div>
      </div>
    </div>
  );
};

const SwapInterval = ({ onComplete, duration, nextPlayerName }) => {
  const [tl,setTl]=useState(duration||60);
  useEffect(()=>{const t=setInterval(()=>setTl(x=>{if(x<=1){clearInterval(t);onComplete();return 0;}return x-1;}),1000);return()=>clearInterval(t);},[]);
  const m=Math.floor(tl/60),s=tl%60;
  return (
    <div className="transfer-screen" style={{ position:"relative" }}>
      <div style={{ position:"absolute", inset:0, backgroundImage:`url(${bg5})`, backgroundSize:"cover", backgroundPosition:"center", opacity:0.09, filter:"sepia(0.5) brightness(0.5)", zIndex:0 }}/>
      <div style={{ position:"relative", zIndex:1, display:"flex", flexDirection:"column", alignItems:"center" }}>
        <div style={{ fontSize:60, marginBottom:18 }}>🔀</div>
        <div className="transfer-text">Player Swap Interval</div>
        <div style={{ fontFamily:"'IM Fell English',serif", color:"var(--parchment-dim)", fontStyle:"italic", marginTop:10, fontSize:15, textAlign:"center", maxWidth:480, lineHeight:1.7 }}>
          {nextPlayerName?`"${nextPlayerName} prepares to take over. No communication during this interval."`:"No communication allowed."}
        </div>
        <div className="timer-display" style={{ marginTop:28 }}>{String(m).padStart(2,"0")}:{String(s).padStart(2,"0")}</div>
        <div className="timer-bar" style={{ width:"min(300px,80vw)", margin:"8px auto" }}><div className="timer-fill" style={{ width:`${(tl/(duration||60))*100}%` }}/></div>
      </div>
    </div>
  );
};

// ─── REFINEMENT, SUBMISSION, JUDGMENT, VICTORY (same as before, condensed) ──
const RefinementSelection = ({ img1, img2, onSelect }) => (
  <div className="lobby-wrap" style={{ flexDirection:"column", position:"relative" }}>
    <div style={{ position:"absolute", inset:0, backgroundImage:`url(${bg4})`, backgroundSize:"cover", backgroundPosition:"center", opacity:0.08, filter:"sepia(0.5) brightness(0.6)", zIndex:0 }}/>
    <div style={{ position:"relative", zIndex:1, display:"flex", flexDirection:"column", alignItems:"center", width:"100%" }}>
      <div className="phase-label" style={{ marginBottom:8 }}>⬡ CHOOSE YOUR BASE</div>
      <div className="phase-title" style={{ color:"var(--oracle-blue)", marginBottom:32 }}>Select the Foundation for Round 3</div>
      <div className="grid-2" style={{ gap:28, maxWidth:860, width:"100%" }}>
        {[{img:img1,label:"Round 1 Output"},{img:img2,label:"Round 2 Output"}].map(({img,label},i)=>(
          <div key={i} className="card" style={{ cursor:"pointer", padding:12, border:"1px solid var(--border-oracle)", transition:"all 0.3s" }}
            onClick={()=>onSelect(img)}
            onMouseOver={e=>e.currentTarget.style.boxShadow="0 0 30px rgba(0,212,255,0.2)"}
            onMouseOut={e=>e.currentTarget.style.boxShadow="none"}>
            <div className="card-title">{label}</div>
            <img src={img} style={{ width:"100%", borderRadius:4 }} alt={label}/>
            <button className="btn btn-oracle" style={{ width:"100%", justifyContent:"center", marginTop:12 }}>✓ Choose This</button>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const SubmissionFlow = ({ images, onSelect }) => (
  <div className="lobby-wrap" style={{ flexDirection:"column", position:"relative" }}>
    <div style={{ position:"absolute", inset:0, backgroundImage:`url(${bg3})`, backgroundSize:"cover", backgroundPosition:"center", opacity:0.08, filter:"sepia(0.5) brightness(0.5)", zIndex:0 }}/>
    <div style={{ position:"relative", zIndex:1, display:"flex", flexDirection:"column", alignItems:"center", width:"100%" }}>
      <div className="phase-label" style={{ marginBottom:8 }}>⬡ FINAL SUBMISSION</div>
      <div className="phase-title" style={{ color:"var(--rune-gold)", marginBottom:10 }}>Choose Your Final Vision</div>
      <div style={{ fontFamily:"'IM Fell English',serif", color:"var(--parchment-dim)", fontStyle:"italic", fontSize:15, marginBottom:32, textAlign:"center" }}>
        "Select the image that best captures the sacred vision."
      </div>
      <div className="grid-3" style={{ gap:20, maxWidth:1000, width:"100%" }}>
        {images.map((img,i)=>(
          <div key={i} className="card" style={{ cursor:"pointer", padding:12, border:"1px solid var(--border-rune)", transition:"all 0.3s" }}
            onClick={()=>onSelect(img)}
            onMouseOver={e=>e.currentTarget.style.borderColor="var(--rune-gold)"}
            onMouseOut={e=>e.currentTarget.style.borderColor="var(--border-rune)"}>
            <div className="card-title">Round {i+1}</div>
            <img src={img} style={{ width:"100%", borderRadius:4 }} alt={`R${i+1}`}/>
            <button className="btn btn-gold" style={{ width:"100%", justifyContent:"center", marginTop:10, fontSize:11 }}>✓ Choose</button>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const JudgmentView = ({ score=78, finalImage, onReturnToLobby }) => {
  const [disp,setDisp]=useState(0);
  const circ=2*Math.PI*100;
  useEffect(()=>{let c=0;const step=score/80;const t=setInterval(()=>{c+=step;if(c>=score){setDisp(score);clearInterval(t);return;}setDisp(Math.round(c));},25);return()=>clearInterval(t);},[score]);
  const offset=circ-(disp/100)*circ;
  return (
    <div className="results-wrap" style={{ animation:"fadeInUp 0.8s ease-out", position:"relative" }}>
      <div style={{ position:"absolute", inset:0, backgroundImage:`url(${bg2})`, backgroundSize:"cover", backgroundPosition:"center", opacity:0.07, filter:"sepia(0.4) brightness(0.5)", zIndex:0, pointerEvents:"none" }}/>
      <div className="result-panel" style={{ position:"relative", zIndex:1 }}>
        <div className="result-label" style={{ color:"var(--rune-gold)" }}>⬡ THE ORIGINAL VISION</div>
        <div style={{ flex:1, border:"1px solid var(--border-rune)", borderRadius:4, overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", background:"linear-gradient(135deg,var(--stone),var(--abyss))" }}>
          <img src="https://picsum.photos/seed/mayatarget/400/400" style={{ width:"100%", height:"100%", objectFit:"contain" }} alt="original"/>
        </div>
      </div>
      <div style={{ width:"min(220px,38vw)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:14, padding:"0 10px", position:"relative", zIndex:1 }}>
        <svg viewBox="0 0 220 220" width="min(180px,36vw)" height="min(180px,36vw)">
          <circle cx="110" cy="110" r="100" fill="none" stroke="var(--stone)" strokeWidth="8"/>
          <circle cx="110" cy="110" r="100" fill="none" stroke="var(--rune-gold)" strokeWidth="8" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={offset} transform="rotate(-90 110 110)"
            style={{ transition:"stroke-dashoffset 0.1s ease-out", filter:"drop-shadow(0 0 8px var(--rune-gold))" }}/>
          <text x="110" y="100" textAnchor="middle" fill="var(--rune-gold)" fontFamily="'Cinzel Decorative',serif" fontSize="34" fontWeight="900">{disp}%</text>
          <text x="110" y="130" textAnchor="middle" fill="var(--parchment-dim)" fontFamily="'Share Tech Mono',monospace" fontSize="9" letterSpacing="2">SIMILARITY</text>
          <text x="110" y="148" textAnchor="middle" fill="var(--parchment-dim)" fontFamily="'Share Tech Mono',monospace" fontSize="9" letterSpacing="2">SCORE</text>
        </svg>
        <div style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:11, color:"var(--parchment-dim)", letterSpacing:2, textAlign:"center" }}>THE ORACLE'S VERDICT</div>
        <div style={{ fontFamily:"'IM Fell English',serif", fontSize:13, color:"var(--parchment-dim)", fontStyle:"italic", textAlign:"center" }}>
          {disp>=80?"⭐ Masterful Vision":disp>=60?"✨ Strong Resonance":disp>=40?"🌀 Partial Alignment":"💨 The Vision was lost"}
        </div>
        <button className="btn btn-ghost" style={{ fontSize:11, marginTop:6 }} onClick={onReturnToLobby}>↩ Return to Sanctum</button>
      </div>
      <div className="result-panel" style={{ position:"relative", zIndex:1 }}>
        <div className="result-label" style={{ color:"var(--oracle-blue)" }}>⬡ THE GENERATED VISION</div>
        <div style={{ flex:1, border:"1px solid var(--border-oracle)", borderRadius:4, overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", background:"linear-gradient(135deg,rgba(0,153,204,0.1),var(--abyss))" }}>
          {finalImage?<img src={finalImage} style={{ width:"100%", height:"100%", objectFit:"contain" }} alt="generated"/>
            :<div style={{ textAlign:"center", opacity:0.5 }}><div style={{ fontSize:52, marginBottom:10 }}>✨</div><div style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:12, color:"var(--oracle-blue)" }}>GENERATED IMAGE</div></div>}
        </div>
      </div>
    </div>
  );
};

const VictoryScreen = ({ winners, teamName, myName }) => {
  const medals=["🥇","🥈","🥉"], mc=["gold","silver","bronze"];
  const myRank=(winners||[]).findIndex(w=>w.name===teamName);
  return (
    <div className="victory-wrap" style={{ position:"relative" }}>
      <div style={{ position:"absolute", inset:0, backgroundImage:`url(${bg2})`, backgroundSize:"cover", backgroundPosition:"center", opacity:0.12, filter:"sepia(0.3) brightness(0.5)", zIndex:0 }}/>
      <div style={{ position:"relative", zIndex:1, display:"flex", flexDirection:"column", alignItems:"center", width:"100%" }}>
        <div style={{ textAlign:"center", marginBottom:36, animation:"fadeInUp 0.8s ease-out" }}>
          <div style={{ fontSize:64, marginBottom:12, animation:"victoryGlow 2s infinite", display:"inline-block" }}>👑</div>
          <div style={{ fontFamily:"'Cinzel Decorative',serif", fontSize:"clamp(20px,5vw,34px)", color:"var(--rune-gold)", animation:"goldPulse 2s infinite", marginBottom:8 }}>The Oracle Has Spoken</div>
          <div style={{ fontFamily:"'IM Fell English',serif", fontSize:"clamp(13px,2.5vw,17px)", color:"var(--parchment-dim)", fontStyle:"italic" }}>
            "The labyrinth has been conquered. These visions shall be remembered."
          </div>
          {myRank>=0&&<div style={{ marginTop:12, fontFamily:"'Share Tech Mono',monospace", fontSize:14, color:"var(--rune-gold)", letterSpacing:3 }}>YOUR TEAM PLACED: {medals[myRank]} #{myRank+1}</div>}
        </div>
        <div style={{ display:"flex", gap:24, justifyContent:"center", flexWrap:"wrap", maxWidth:1100 }}>
          {(winners||[]).map((w,i)=>(
            <div key={w.id||i} className={`winner-card ${mc[i]||""}`} style={{ flex:"1 1 260px", maxWidth:320 }}>
              <div style={{ textAlign:"center", marginBottom:16 }}>
                <div style={{ fontSize:40, marginBottom:6 }}>{medals[i]}</div>
                <div style={{ fontFamily:"'Cinzel Decorative',serif", fontSize:16, color:"var(--rune-gold)" }}>{w.name}</div>
                <div style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:11, color:"var(--parchment-dim)", marginTop:3 }}>{w.observer||"—"} & {w.creator||"—"}</div>
              </div>
              <div style={{ textAlign:"center" }}>
                <div style={{ fontFamily:"'Cinzel Decorative',serif", fontSize:24, color:"var(--oracle-blue)" }}>{w.score||0}%</div>
                <div style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:10, color:"var(--parchment-dim)", letterSpacing:2 }}>SIMILARITY SCORE</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── OVERLAYS ─────────────────────────────────────────────────────────────────
const PenaltyOverlay = ({ onDismiss }) => {
  useEffect(()=>{const t=setTimeout(onDismiss,4000);return()=>clearTimeout(t);},[onDismiss]);
  return (<><div className="penalty-overlay"/><div className="penalty-toast">⚡ PENALTY INVOKED BY THE ORACLE — TIME REDUCED BY 30 SECONDS</div></>);
};

const DisqualificationScreen = () => (
  <div className="disqual-screen">
    <div style={{ fontSize:76, marginBottom:20 }}>☠️</div>
    <div className="disqual-title">DISQUALIFIED</div>
    <div style={{ fontFamily:"'IM Fell English',serif", fontSize:"clamp(14px,3vw,20px)", color:"rgba(255,100,100,0.7)", fontStyle:"italic" }}>"The Oracle has cast you from the labyrinth"</div>
    <div style={{ marginTop:16, fontFamily:"'Share Tech Mono',monospace", fontSize:12, color:"rgba(255,100,100,0.4)", letterSpacing:3 }}>ANTI-CHEAT · ADMIN NOTIFIED</div>
  </div>
);

// ─── PLAYER SECTION ───────────────────────────────────────────────────────────
const PlayerSection = ({ addAlert, globalTags, timers, allTeams, setTeams, winners, teamCodes, setTeamCodes }) => {
  // Per-tab identity (isolated from other tabs via sessionStorage)
  const [tabStep,   setTabStep]   = useState(() => {
    const id = loadTabIdentity();
    if (!id) return "entry";
    if (id.myRole) return "in_game";
    if (id.role==="captain") return "show_code";
    if (id.role==="joiner")  return "pick_role";
    return "entry";
  });

  const [tabId]                       = useState(() => loadTabIdentity()?.teamId || null);
  const [myCode,   setMyCode]         = useState(() => loadTabIdentity()?.code || "");
  const [myName,   setMyName]         = useState(() => loadTabIdentity()?.playerName || "");
  const [myRole,   setMyRole]         = useState(() => loadTabIdentity()?.myRole || null);
  const [teamName, setTeamName]       = useState(() => loadTabIdentity()?.teamName || "");
  const [teamId,   setTeamId]         = useState(() => loadTabIdentity()?.teamId || null);
  const [isCaptain,setIsCaptain]      = useState(() => loadTabIdentity()?.role === "captain");
  const [phase,    setPhaseRaw]       = useState("waiting");
  const [isActive, setIsActive]       = useState(false);
  const [r1Image,  setR1Image]        = useState(null);
  const [r2Image,  setR2Image]        = useState(null);
  const [r3Image,  setR3Image]        = useState(null);
  const [r3Base,   setR3Base]         = useState(null);
  const [finalImage,setFinalImage]    = useState(null);
  const [showPenalty,setShowPenalty]  = useState(false);
  const [disqualified,setDisqual]     = useState(false);
  const [showTabWarn,setShowTabWarn]  = useState(false);
  const [obsTimeLeft,setObsTimeLeft]  = useState(timers.round1||300);
  const [liveObsText,setLiveObsText]  = useState("");
  const vc = useRef(0);
  const myTeamId = useRef(teamId);

  // Derive partner info from shared teamCodes
  const codeEntry    = teamCodes[myCode] || null;
  const partnerName  = codeEntry ? (isCaptain ? codeEntry.player2 : codeEntry.player1) : null;
  const captainRole  = codeEntry?.p1role || null;
  const partnerRole  = isCaptain ? codeEntry?.p2role : codeEntry?.p1role;

  const setPhase = (p) => {
    setPhaseRaw(p);
    // Persist phase to shared state so partner's tab can react
    if (myTeamId.current) {
      updateMyTeam({ currentPhase: p, activePlayer: myRole });
    }
  };

  // Listen for admin events
  useEventListener((evt, payload) => {
    if (evt==="TEAM_APPROVED" && payload.teamId===myTeamId.current) {
      setIsActive(true);
      // Observer starts Round 1, Creator goes to Waiting Lobby
      setPhase(myRole==="observer" ? "round1" : "waiting");
      setObsTimeLeft(timers.round1||300);
    }
    if (evt==="PENALTY_CAST"  && payload.teamId===myTeamId.current) setShowPenalty(true);
    if (evt==="TEAM_BANNED"   && payload.teamId===myTeamId.current) setDisqual(true);
  });

  const updateMyTeam = useCallback(u =>
    setTeams(p => p.map(t => t.id===myTeamId.current ? {...t,...u} : t))
  , [setTeams]);

  const handleViolation = useCallback((type, msg, count) => {
    addAlert({ type, team:teamName||"Unknown", message:msg, time:new Date().toLocaleTimeString() });
    if (count >= 2 || type==="TAB_SWITCH") setDisqual(true);
    else setShowTabWarn(true);
  }, [teamName, addAlert]);

  useAntiCheat(isActive && !disqualified, phase, handleViolation);

  // ── Registration handlers ────────────────────────────────────────────────
  const handleRegistered = ({ code, teamId: tid, teamName: tn, playerName: pn }) => {
    setMyCode(code); setTeamId(tid); setTeamName(tn); setMyName(pn);
    setIsCaptain(true); myTeamId.current = tid;
    setTabStep("show_code");
  };

  const handleJoined = ({ code, teamId: tid, teamName: tn, playerName: pn }) => {
    setMyCode(code); setTeamId(tid); setTeamName(tn); setMyName(pn);
    setIsCaptain(false); myTeamId.current = tid;
    setTabStep("pick_role");
  };

  const handlePickRole = (role) => {
    setMyRole(role);
    const key = isCaptain ? "p1role" : "p2role";
    setTeamCodes(prev => ({ ...prev, [myCode]: { ...prev[myCode], [key]: role } }));
    // Update roster with role assignments
    setTeams(prev => prev.map(t => {
      if (t.id !== myTeamId.current) return t;
      return {
        ...t,
        observer: role === "observer" ? myName : t.observer,
        creator:  role === "creator"  ? myName : t.creator,
      };
    }));
    saveTabIdentity({ role: isCaptain?"captain":"joiner", code:myCode, teamId:myTeamId.current, teamName, playerName:myName, myRole:role });
    setTabStep("in_game");
  };

  // ── Phase transitions ───────────────────────────────────────────────────
  // When observer finishes round 1 → creator's tab should unlock round 2
  // This is done via shared teams state: observer writes currentPhase,
  // creator's tab reads it and unlocks itself.
  // For same-browser two-tab testing, localStorage events handle this.
  useEffect(() => {
    if (!isActive || !myRole || tabStep !== "in_game") return;
    const myTeam = allTeams.find(t => t.id === myTeamId.current);
    if (!myTeam) return;
    const theirPhase = myTeam.currentPhase;
    const activeP    = myTeam.activePlayer;
    // Creator: unlock when observer has completed round1 (phase becomes interval1)
    if (myRole==="creator" && theirPhase==="interval1" && phase==="waiting") {
      setPhase("interval1");
    }
    // Observer: show waiting when creator is in round2
    if (myRole==="observer" && theirPhase==="round2" && phase==="interval1") {
      setPhase("obs_waiting_r2");
    }
    // Creator: go to interval2 / waiting after round2
    if (myRole==="creator" && theirPhase==="r3select" && phase==="round2") {
      setPhase("interval2");
    }
    // Observer: unlock round3 when r3base selected
    if (myRole==="observer" && theirPhase==="round3" && phase==="obs_waiting_r2") {
      setPhase("round3");
    }
  }, [allTeams, myRole, isActive, tabStep, phase]);

  if (disqualified) return <DisqualificationScreen/>;

  const myTeamScore = allTeams.find(t=>t.id===myTeamId.current)?.score || 0;
  const obsTimerMax = timers.round1||300;

  const topBarLabel = () => {
    if (!myRole) return "REGISTRATION";
    const phaseMap = { waiting:"WAITING LOBBY", round1:"ROUND 1 · OBSERVER", interval1:"DISCUSSION", round2:"ROUND 2 · CREATOR", obs_waiting_r2:"WAITING · ROUND 2", interval2:"SWAP INTERVAL", r3select:"SELECT BASE", round3:"ROUND 3 · OBSERVER", submission:"SUBMISSION", judgment:"JUDGMENT" };
    return phaseMap[phase] || phase.toUpperCase();
  };

  return (
    <div className="player-shell">
      <PlayerStyles/>
      {showTabWarn && <div className="tab-warning" style={{ animation:"toastSlide 5s ease-out forwards" }} onAnimationEnd={()=>setShowTabWarn(false)}>🚨 WARNING: Page exit detected. Reported to Oracle. Next = DISQUALIFICATION.</div>}
      {showPenalty && <PenaltyOverlay onDismiss={()=>setShowPenalty(false)}/>}

      {/* Top bar */}
      <div style={{ position:"fixed", top:0, left:0, right:0, height:44, background:"rgba(4,5,10,0.97)", borderBottom:"1px solid var(--border-rune)", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 18px", zIndex:200, flexWrap:"wrap", gap:6 }}>
        <div style={{ fontFamily:"'Cinzel Decorative',serif", fontSize:15, color:"var(--rune-gold)", animation:"goldPulse 3s infinite" }}>MAYAVYUH</div>
        <div style={{ display:"flex", gap:14, alignItems:"center", flexWrap:"wrap" }}>
          {teamName && <span style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:11, color:"var(--parchment-dim)" }}>⬡ {teamName}</span>}
          {myName   && <span style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:11, color:myRole==="observer"?"var(--oracle-blue)":"var(--spirit-purple)" }}>{myName} · {myRole?.toUpperCase()||"NO ROLE"}</span>}
          <span style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:10, color:"var(--rune-gold)", letterSpacing:2 }}>{topBarLabel()}</span>
        </div>
      </div>

      <div style={{ paddingTop:44, minHeight:"100vh", position:"relative", zIndex:2 }}>
        {/* ── PRE-GAME FLOW ── */}
        {tabStep==="entry"     && <EntryScreen onRegister={()=>setTabStep("register")} onJoin={()=>setTabStep("join")}/>}
        {tabStep==="register"  && <RegisterScreen onBack={()=>setTabStep("entry")} onRegistered={handleRegistered} teamCodes={teamCodes} setTeamCodes={setTeamCodes} setTeams={setTeams}/>}
        {tabStep==="join"      && <JoinScreen onBack={()=>setTabStep("entry")} onJoined={handleJoined} teamCodes={teamCodes} setTeamCodes={setTeamCodes} setTeams={setTeams}/>}

        {tabStep==="show_code" && (
          <CodeDisplay
            code={myCode} teamName={teamName}
            partnerJoined={!!codeEntry?.player2}
            partnerName={codeEntry?.player2||null}
            partnerRole={codeEntry?.p2role||null}
            myRole={myRole}
            onPickRole={handlePickRole}
          />
        )}

        {tabStep==="pick_role" && (
          <RolePicker
            captainName={codeEntry?.player1||"Captain"}
            captainRole={captainRole}
            teamName={teamName}
            myRole={myRole}
            onPickRole={handlePickRole}
          />
        )}

        {/* ── IN-GAME FLOW ── */}
        {tabStep==="in_game" && (
          <>
            {/* Waiting for approval */}
            {!isActive && (
              <div style={{ minHeight:"100vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:24, position:"relative", zIndex:2 }}>
                <div style={{ position:"absolute", inset:0, backgroundImage:`url(${bg2})`, backgroundSize:"cover", backgroundPosition:"center", opacity:0.09, filter:"sepia(0.5) brightness(0.6)", zIndex:0 }}/>
                <div style={{ textAlign:"center", maxWidth:500, position:"relative", zIndex:1, animation:"fadeInUp 0.6s ease-out" }}>
                  <div style={{ fontSize:64, marginBottom:20, animation:"oraclePulse 2s infinite", display:"inline-block" }}>⏳</div>
                  <div style={{ fontFamily:"'Cinzel Decorative',serif", fontSize:20, color:"var(--rune-gold)", animation:"goldPulse 2s infinite", marginBottom:12 }}>Awaiting Admin Approval...</div>
                  <div style={{ fontFamily:"'IM Fell English',serif", color:"var(--parchment-dim)", fontStyle:"italic", fontSize:15, lineHeight:1.8 }}>
                    "Both players are ready. The Admin must grant passage before the labyrinth opens."
                  </div>
                  <div style={{ marginTop:16, fontFamily:"'Share Tech Mono',monospace", fontSize:12, color:"var(--oracle-blue)", letterSpacing:2 }}>
                    YOUR ROLE: {myRole?.toUpperCase()} · TEAM: {teamName}
                  </div>
                </div>
              </div>
            )}

            {/* Observer phases */}
            {isActive && myRole==="observer" && phase==="round1" && (
              <GeminiUI forbiddenWords={globalTags} timerDuration={timers.round1||300}
                isRefining={false} roundLabel="ROUND 1 · OBSERVER GENERATES" myName={myName} myRole={myRole} bgImage={bg3}
                onSelect={img=>{ setR1Image(img); updateMyTeam({round:1,status:"active"}); setPhase("interval1"); }}
                onTextChange={t=>{setLiveObsText(t);updateMyTeam({observerText:t});}}
              />
            )}
            {isActive && myRole==="observer" && phase==="interval1" && (
              <DiscussionInterval onComplete={()=>setPhase("obs_waiting_r2")} duration={timers.discussion||120}/>
            )}
            {isActive && myRole==="observer" && phase==="obs_waiting_r2" && (
              <WaitingLobby teamName={teamName} myName={myName} myRole={myRole}
                partnerName={partnerName||"Creator"} allTeams={allTeams}
                observerTimeLeft={obsTimeLeft} observerTimerMax={obsTimerMax}
                observerText={""} winners={winners}/>
            )}
            {isActive && myRole==="observer" && phase==="interval2" && (
              <SwapInterval onComplete={()=>setPhase("round3")} duration={timers.swap||60} nextPlayerName={myName}/>
            )}
            {isActive && myRole==="observer" && phase==="round3" && (
              <GeminiUI forbiddenWords={globalTags} timerDuration={timers.round3||300}
                isRefining={true} imagesToRefine={[r3Base||r2Image||"https://picsum.photos/seed/r3base/400/400"]}
                roundLabel="ROUND 3 · FINAL REFINEMENT" myName={myName} myRole={myRole} bgImage={bg5}
                onSelect={img=>{ setR3Image(img); updateMyTeam({round:3}); setPhase("submission"); }}
                onTextChange={t=>updateMyTeam({observerText:t})}
              />
            )}

            {/* Creator phases */}
            {isActive && myRole==="creator" && phase==="waiting" && (
              <WaitingLobby teamName={teamName} myName={myName} myRole={myRole}
                partnerName={partnerName||"Observer"} allTeams={allTeams}
                observerTimeLeft={obsTimeLeft} observerTimerMax={obsTimerMax}
                observerText={liveObsText} winners={winners}/>
            )}
            {isActive && myRole==="creator" && phase==="interval1" && (
              <DiscussionInterval onComplete={()=>setPhase("round2")} duration={timers.discussion||120}/>
            )}
            {isActive && myRole==="creator" && phase==="round2" && (
              <GeminiUI forbiddenWords={globalTags} timerDuration={timers.round2||300}
                isRefining={true} imagesToRefine={[r1Image||"https://picsum.photos/seed/r1ref/400/400"]}
                roundLabel="ROUND 2 · CREATOR REFINES" myName={myName} myRole={myRole} bgImage={bg4}
                onSelect={img=>{ setR2Image(img); updateMyTeam({round:2,creatorText:""}); setPhase("r3select"); }}
                onTextChange={t=>updateMyTeam({creatorText:t})}
              />
            )}
            {isActive && myRole==="creator" && phase==="r3select" && (
              <RefinementSelection
                img1={r1Image||"https://picsum.photos/seed/r1s/400/400"}
                img2={r2Image||"https://picsum.photos/seed/r2s/400/400"}
                onSelect={img=>{ setR3Base(img); updateMyTeam({r3BaseImage:img}); setPhase("waiting_r3"); }}
              />
            )}
            {isActive && myRole==="creator" && phase==="waiting_r3" && (
              <WaitingLobby teamName={teamName} myName={myName} myRole={myRole}
                partnerName={partnerName||"Observer"} allTeams={allTeams}
                observerTimeLeft={obsTimeLeft} observerTimerMax={obsTimerMax}
                observerText={""} winners={winners}/>
            )}
            {isActive && myRole==="creator" && phase==="interval2" && (
              <SwapInterval onComplete={()=>setPhase("waiting_r3")} duration={timers.swap||60} nextPlayerName={partnerName}/>
            )}

            {/* Shared phases (both tabs see these simultaneously) */}
            {isActive && phase==="submission" && (
              <SubmissionFlow
                images={[r1Image||"https://picsum.photos/seed/s1/400/400", r2Image||"https://picsum.photos/seed/s2/400/400", r3Image||"https://picsum.photos/seed/s3/400/400"]}
                onSelect={img=>{ setFinalImage(img); const sc=Math.floor(Math.random()*40+55); updateMyTeam({score:sc,status:"active",finalImage:img}); setPhase("judgment"); }}
              />
            )}
            {isActive && phase==="judgment" && (
              <JudgmentView score={myTeamScore||Math.floor(Math.random()*40+55)} finalImage={finalImage} onReturnToLobby={()=>setPhase("waiting")}/>
            )}
          </>
        )}
      </div>

      {/* Dev controls */}
      {isActive && (
        <div style={{ position:"fixed", bottom:14, right:14, zIndex:300, display:"flex", gap:5, flexDirection:"column" }}>
          <button className="btn btn-ghost" style={{ fontSize:10, padding:"4px 10px", borderColor:"var(--oracle-blue)", color:"var(--oracle-blue)" }}
            onClick={()=>{ setIsActive(true); setPhase(myRole==="observer"?"round1":"waiting"); }}>
            [DEV] SKIP APPROVAL
          </button>
          <button className="btn btn-ghost" style={{ fontSize:10, padding:"4px 10px", borderColor:"var(--blood-red)", color:"var(--blood-glow)" }}
            onClick={()=>setShowPenalty(true)}>
            [DEV] PENALTY
          </button>
        </div>
      )}
    </div>
  );
};

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const getView = () => { const h=window.location.hash; if(h==="#admin")return"admin"; if(h==="#player")return"player"; return"landing"; };
  const [view, setView] = useState(getView);
  useEffect(() => { const h=()=>setView(getView()); window.addEventListener("hashchange",h); return()=>window.removeEventListener("hashchange",h); },[]);
  const nav = (v) => { window.location.hash = v==="landing"?"":v; setView(v); };

  const [teams, setTeams]             = useSyncState("maya_teams",      INIT_TEAMS);
  const [forbiddenWords, setForbWords]= useSyncState("maya_words",      INIT_WORDS);
  const [timers, setTimersRaw]        = useSyncState("maya_timers",     INIT_TIMERS);
  const [alerts, setAlerts]           = useSyncState("maya_alerts",     []);
  const [winners, setWinners]         = useSyncState("maya_winners",    []);
  const [eventState, setEventState]   = useSyncState("maya_event",      INIT_EVENT);
  const [teamCodes, setTeamCodes]     = useSyncState("maya_team_codes", INIT_TEAM_CODES);

  const addForbiddenWord    = useCallback(w=>setForbWords(p=>[...p.filter(x=>x!==w),w]),[setForbWords]);
  const removeForbiddenWord = useCallback(w=>setForbWords(p=>p.filter(x=>x!==w)),[setForbWords]);
  const updateTimers        = useCallback((r,s)=>setTimersRaw(p=>({...p,[r]:s})),[setTimersRaw]);
  const addAlert            = useCallback(a=>setAlerts(p=>[a,...p.slice(0,49)]),[setAlerts]);

  return (
    <>
      <GlobalStyles/>
      <SceneWrapper>
        {view==="landing" && <LandingPage onSelect={r=>nav(r)}/>}
        {view==="admin"   && <AdminDashboard alerts={alerts} setAlerts={setAlerts} teams={teams} setTeams={setTeams} forbiddenWords={forbiddenWords} addForbiddenWord={addForbiddenWord} removeForbiddenWord={removeForbiddenWord} timers={timers} updateTimers={updateTimers} winners={winners} setWinners={setWinners} eventState={eventState} setEventState={setEventState}/>}
        {view==="player"  && <PlayerSection addAlert={addAlert} globalTags={forbiddenWords} timers={timers} allTeams={teams} setTeams={setTeams} winners={winners} teamCodes={teamCodes} setTeamCodes={setTeamCodes}/>}
      </SceneWrapper>
    </>
  );
}