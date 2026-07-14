// AceSettings.jsx
// 3-column responsive web layout
// Col 1: Sylectus Login + Search Parameters
// Col 2: Load Types + Actions
// Col 3: Bid Filters + Rate Calculator + Connection Status
// Reads/writes: ace_syl_settings, ace_syl_credentials, ace_vm_access

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";

const LOAD_TYPES = [
  { value: "expedited load",        label: "Expedited Load" },
  { value: "expedited truck load",  label: "Expedited Truck Load" },
  { value: "small straight",        label: "Small Straight" },
  { value: "large straight",        label: "Large Straight" },
  { value: "cargo van",             label: "Cargo Van" },
  { value: "sprinter",              label: "Sprinter" },
  { value: "truckload",             label: "Truckload" },
  { value: "less than truckload",   label: "Less Than Truckload" },
  { value: "truckload/ltl",         label: "Truckload/LTL" },
  { value: "courier type work",     label: "Courier" },
  { value: "flatbed",               label: "Flatbed" },
  { value: "reefer",                label: "Reefer" },
  { value: "climate control",       label: "Climate Control" },
  { value: "air freight",           label: "Air Freight" },
  { value: "air charter",           label: "Air Charter" },
  { value: "dump trailer",          label: "Dump Trailer" },
  { value: "lane/project rfq",      label: "Lane/Project RFQ" },
  { value: "van",                   label: "Van" },
];

const DEFAULT_LOAD_TYPES = ["expedited load", "large straight", "small straight"];
const MAX_AGE_OPTIONS = [
  { value: 0,  label: "Off" },
  { value: 10, label: "10 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "60 min" },
];

const GOLD  = "#E8A020";
const GREEN = "#2ecc71";
const RED   = "#e74c3c";

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;900&family=Barlow:wght@400;500&display=swap');
  .ace-wrap { background:#0a0a0a; color:#fff; font-family:'Barlow',sans-serif; font-size:13px; display:flex; flex-direction:column; min-height:100vh; }
  .ace-header { background:#111; border-bottom:2px solid #E8A020; padding:10px 24px; display:flex; align-items:center; justify-content:space-between; flex-shrink:0; }
  .ace-logo { font-family:'Barlow Condensed',sans-serif; font-size:20px; font-weight:900; color:#E8A020; letter-spacing:2px; }
  .ace-sub { font-size:9px; color:rgba(255,255,255,0.3); letter-spacing:1px; text-transform:uppercase; }
  .ace-status-pill { display:flex; align-items:center; gap:6px; background:#1a1a1a; border:1px solid rgba(255,255,255,0.07); border-radius:20px; padding:3px 12px; font-size:11px; color:rgba(255,255,255,0.4); }
  .ace-body { display:grid; grid-template-columns:1fr 1fr 1fr; gap:0; flex:1; }
  .ace-col { padding:16px 20px; border-right:1px solid rgba(255,255,255,0.06); }
  .ace-col:last-child { border-right:none; }
  .slabel { font-size:9px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:#E8A020; margin-bottom:9px; margin-top:2px; display:block; }
  .ace-field { margin-bottom:8px; }
  .ace-label { display:block; font-size:10px; color:rgba(255,255,255,0.4); letter-spacing:.5px; text-transform:uppercase; margin-bottom:3px; }
  .ace-input { width:100%; background:#1a1a1a; border:1px solid rgba(255,255,255,0.1); border-radius:4px; padding:6px 9px; color:#fff; font-size:12px; font-family:'Barlow',sans-serif; outline:none; box-sizing:border-box; transition:border-color .2s; }
  .ace-input:focus { border-color:#E8A020; }
  .ace-input::placeholder { color:rgba(255,255,255,0.2); }
  .ace-row2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .ace-divider { border:none; border-top:1px solid rgba(255,255,255,0.06); margin:12px 0; }
  .ace-hint { font-size:9px; color:rgba(255,255,255,0.22); margin-top:2px; }
  .search-preview { background:#1a1a1a; border-radius:4px; padding:7px 10px; font-size:11px; color:rgba(255,255,255,0.4); margin-top:6px; line-height:1.6; }
  .filter-summary { background:#1a1a1a; border:1px solid rgba(46,204,113,0.2); border-radius:4px; padding:7px 10px; font-size:11px; color:rgba(255,255,255,0.4); margin-top:5px; line-height:1.6; }
  .radio-row { display:flex; gap:10px; margin-top:5px; flex-wrap:wrap; }
  .ace-radio-label { display:flex; align-items:center; gap:4px; font-size:11px; color:rgba(255,255,255,0.45); cursor:pointer; }
  .cb-grid { display:grid; grid-template-columns:1fr 1fr; gap:4px; margin-top:4px; }
  .cb-row { display:flex; align-items:center; gap:6px; font-size:11px; color:rgba(255,255,255,0.5); cursor:pointer; padding:3px 4px; border-radius:3px; }
  .cb-row:hover { background:rgba(255,255,255,0.05); color:#fff; }
  .lt-summary { margin-top:7px; font-size:10px; color:rgba(255,255,255,0.3); line-height:1.6; }
  .rpm-preview { background:#1a1a1a; border:1px solid rgba(232,160,32,0.25); border-radius:4px; padding:7px 10px; display:flex; justify-content:space-between; align-items:center; margin-top:5px; }
  .btn-primary { width:100%; background:#E8A020; color:#000; border:none; border-radius:4px; padding:8px; font-family:'Barlow Condensed',sans-serif; font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:1px; cursor:pointer; transition:background .2s; }
  .btn-primary:hover { background:#d4911c; }
  .btn-sec { width:100%; background:transparent; border:1px solid rgba(255,255,255,0.12); color:rgba(255,255,255,0.45); border-radius:4px; padding:7px; font-family:'Barlow Condensed',sans-serif; font-size:12px; text-transform:uppercase; letter-spacing:1px; margin-top:6px; cursor:pointer; transition:border-color .2s,color .2s; }
  .btn-sec:hover { border-color:rgba(255,255,255,0.3); color:#fff; }
  .btn-red { width:100%; background:rgba(231,76,60,0.12); border:1px solid rgba(231,76,60,0.25); color:#e74c3c; border-radius:4px; padding:7px; font-family:'Barlow Condensed',sans-serif; font-size:12px; text-transform:uppercase; letter-spacing:1px; margin-top:6px; cursor:pointer; }
  .saved-msg { text-align:center; font-size:10px; color:#2ecc71; margin-top:6px; transition:opacity .3s; }
  .conn-label { font-size:9px; color:rgba(255,255,255,0.3); text-transform:uppercase; letter-spacing:1px; margin-bottom:6px; display:block; }
  .conn-row { display:flex; align-items:center; gap:7px; font-size:11px; color:rgba(255,255,255,0.4); margin-bottom:4px; }
  .ace-footer { background:#111; border-top:1px solid rgba(255,255,255,0.06); padding:8px 24px; font-size:9px; color:rgba(255,255,255,0.15); letter-spacing:.5px; text-align:center; flex-shrink:0; }
  .ace-error { background:rgba(231,76,60,0.12); color:#e74c3c; font-size:11px; padding:7px 20px; border-bottom:1px solid rgba(231,76,60,0.2); }
  @media (max-width: 900px) { .ace-body { grid-template-columns:1fr 1fr; } .ace-col:nth-child(2) { border-right:none; } .ace-col:nth-child(3) { grid-column:1/-1; border-top:1px solid rgba(255,255,255,0.06); border-right:none; } }
  @media (max-width: 580px) { .ace-body { grid-template-columns:1fr; } .ace-col { border-right:none; border-bottom:1px solid rgba(255,255,255,0.06); } }
`;

function StatusDot({ status }) {
  const color = status === "active" ? GREEN : status === "paused" ? GOLD : RED;
  return <span style={{ width:"7px", height:"7px", borderRadius:"50%", background:color, display:"inline-block", boxShadow: status==="active" ? "0 0 5px rgba(46,204,113,0.5)" : "none" }} />;
}

function statusLabel(status) {
  if (status === "active")  return "ACE Status — Running";
  if (status === "paused")  return "ACE Status — Paused";
  if (status === "nogmail") return "Email not connected";
  return "Checking...";
}

export default function AceSettings() {
  const [carrierId, setCarrierId] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCarrierId(session?.user?.id ?? null);
    });
  }, []);

  const [settings, setSettings] = useState({
    mc_number: "", bid_contact_name: "",
    search_from_city: "", search_from_state: "",
    search_to_states_raw: "", pickup_radius: "",
    max_weight: "", max_miles: "",
    max_load_age: 0, target_load_types: DEFAULT_LOAD_TYPES, rpm: "",
  });

  const [creds, setCreds] = useState({
    syl_corp_id: "", syl_corp_password: "",
    syl_user_id: "", syl_user_password: "",
  });

  const [status,    setStatus]    = useState("checking");
  const [paused,    setPaused]    = useState(false);
  // LOGOFF. Distinct from paused, by founder determination:
  //   paused    -> stop scanning. Sylectus session STAYS ALIVE.
  //   loggedOff -> tear down the Sylectus session. No re-login until false.
  const [loggedOff, setLoggedOff] = useState(false);
  const [savedShow, setSavedShow] = useState(false);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [exMiles,   setExMiles]   = useState(250);

  useEffect(() => {
    if (!carrierId) return;
    (async () => {
      setLoading(true);
      try {
        const [{ data: s, error: se }, { data: c, error: ce }, { data: v }] = await Promise.all([
          supabase.from("ace_syl_settings").select("*").eq("carrier_id", carrierId).single(),
          supabase.from("ace_syl_credentials").select("syl_corp_id,syl_corp_password,syl_user_id,syl_user_password,active").eq("carrier_id", carrierId).eq("source","syl").maybeSingle(),
          supabase.from("ace_vm_access").select("paused,logged_off").eq("carrier_id", carrierId).eq("source","syl").maybeSingle(),
        ]);
        if (se && se.code !== "PGRST116") throw se;
        if (ce) throw ce;
        if (s) setSettings({
          mc_number:            s.mc_number            ?? "",
          bid_contact_name:     s.bid_contact_name     ?? "",
          search_from_city:     s.search_from_city     ?? "",
          search_from_state:    s.search_from_state    ?? "",
          search_to_states_raw: s.search_to_states_raw ?? "",
          pickup_radius:        s.pickup_radius         ?? "",
          max_weight:           s.max_weight            ?? "",
          max_miles:            s.max_miles             ?? "",
          max_load_age:         s.max_load_age          ?? 0,
          target_load_types:    s.target_load_types     ?? DEFAULT_LOAD_TYPES,
          rpm:                  s.rpm                   ?? "",
        });
        if (c) {
          setCreds({ syl_corp_id: c.syl_corp_id ?? "", syl_corp_password: c.syl_corp_password ?? "", syl_user_id: c.syl_user_id ?? "", syl_user_password: c.syl_user_password ?? "" });
          setStatus(c.active ? "active" : "checking");
        } else {
          setStatus("nogmail");
        }
        if (v) setPaused(v.paused ?? false);
        if (v) setLoggedOff(v.logged_off ?? false);
      } catch (err) {
        setError("Failed to load settings.");
      } finally {
        setLoading(false);
      }
    })();
  }, [carrierId]);

  const handleSave = useCallback(async () => {
    if (!carrierId) return;
    setError(null);
    try {
      const { error: se } = await supabase.from("ace_syl_settings").upsert({
        carrier_id: carrierId,
        mc_number:            settings.mc_number            || null,
        bid_contact_name:     settings.bid_contact_name     || null,
        search_from_city:     settings.search_from_city     || null,
        search_from_state:    settings.search_from_state?.toUpperCase() || null,
        search_to_states_raw: settings.search_to_states_raw || null,
        pickup_radius:        settings.pickup_radius  ? parseInt(settings.pickup_radius)  : null,
        max_weight:           settings.max_weight     ? parseInt(settings.max_weight)     : null,
        max_miles:            settings.max_miles      ? parseInt(settings.max_miles)      : null,
        max_load_age:         parseInt(settings.max_load_age) || 0,
        target_load_types:    settings.target_load_types,
        rpm:                  settings.rpm ? parseFloat(settings.rpm) : null,
        updated_at:           new Date().toISOString(),
      }, { onConflict: "carrier_id" });
      if (se) throw se;

      const credPayload = { carrier_id: carrierId, source: "syl", active: true, updated_at: new Date().toISOString() };
      if (creds.syl_corp_id)       credPayload.syl_corp_id       = creds.syl_corp_id;
      if (creds.syl_corp_password)  credPayload.syl_corp_password  = creds.syl_corp_password;
      if (creds.syl_user_id)        credPayload.syl_user_id        = creds.syl_user_id;
      if (creds.syl_user_password)  credPayload.syl_user_password  = creds.syl_user_password;
      const { error: ce } = await supabase.from("ace_syl_credentials").upsert(credPayload, { onConflict: "carrier_id,source" });
      if (ce) throw ce;

      setSavedShow(true);
      setTimeout(() => setSavedShow(false), 2500);
      setStatus("active");
    } catch (err) {
      setError("Save failed — check connection.");
    }
  }, [carrierId, settings, creds]);

  const handlePause = useCallback(async () => {
    if (!carrierId) return;
    const next = !paused;
    setPaused(next);
    setStatus(next ? "paused" : "active");
    await supabase.from("ace_vm_access").update({ paused: next, updated_at: new Date().toISOString() }).eq("carrier_id", carrierId).eq("source","syl");
  }, [carrierId, paused]);

  // LOG OFF / LOG ON — writes ace_vm_access.logged_off.
  // The VM reads the flag and clicks Sylectus's own logout anchor
  // (a[href$="UserPages/Logout.aspx"]) so the session ends SERVER-side.
  // Flipping it back to false makes the VM reload and log itself in again.
  //
  // LATENCY: there is no push channel from Supabase to the VM -- the VM polls.
  // Logoff lands within ~45s (rescan cycle); log-on within ~30s (resume poller).
  const handleLogoff = useCallback(async () => {
    if (!carrierId) return;
    const next = !loggedOff;
    setLoggedOff(next);
    await supabase.from("ace_vm_access")
      .update({ logged_off: next, updated_at: new Date().toISOString() })
      .eq("carrier_id", carrierId).eq("source", "syl");
  }, [carrierId, loggedOff]);

  const setSetting = (k, v) => setSettings(p => ({ ...p, [k]: v }));
  const setCred    = (k, v) => setCreds(p    => ({ ...p, [k]: v }));
  const toggleLT   = (val)  => setSettings(p => ({ ...p, target_load_types: p.target_load_types.includes(val) ? p.target_load_types.filter(v => v !== val) : [...p.target_load_types, val] }));

  const rpm     = parseFloat(settings.rpm) || 2.75;
  const miles   = parseFloat(exMiles)      || 250;
  const rpmRes  = Math.round(miles * rpm);
  const fromPart   = [settings.search_from_city, settings.search_from_state].filter(Boolean).join(", ");
  const toStates   = settings.search_to_states_raw || "";
  const radiusPart = settings.pickup_radius ? `${settings.pickup_radius}mi radius` : "";
  const weightFmt  = settings.max_weight ? Number(settings.max_weight).toLocaleString() : "9,000";
  const ltSelected = (settings.target_load_types || []).map(v => LOAD_TYPES.find(l => l.value === v)?.label).filter(Boolean);

  if (loading) return <div style={{ background:"#0a0a0a", color:"rgba(255,255,255,0.3)", padding:"24px", fontSize:"11px", letterSpacing:"1px", minHeight:"100vh" }}>Loading ACE Settings...</div>;

  return (
    <>
      <style>{css}</style>
      <div className="ace-wrap">

        {/* Header */}
        <div className="ace-header">
          <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
            <span style={{ color:GOLD, fontSize:"18px" }}>⚡</span>
            <div>
              <div className="ace-logo">ACE Settings</div>
              <div className="ace-sub">Sylectus Load Capture · XTX Transport</div>
            </div>
          </div>
          <div className="ace-status-pill">
            <StatusDot status={status} />
            <span>{statusLabel(status)}</span>
          </div>
        </div>

        {error && <div className="ace-error">⚠ {error}</div>}

        <div className="ace-body">

          {/* ── COL 1: Login + Search ── */}
          <div className="ace-col">
            <span className="slabel">Sylectus Login</span>
            <div className="ace-row2">
              <div className="ace-field"><label className="ace-label">Corporate ID</label><input className="ace-input" type="text" value={creds.syl_corp_id} placeholder="Corp username" onChange={e => setCred("syl_corp_id", e.target.value)} /></div>
              <div className="ace-field"><label className="ace-label">Corporate Password</label><input className="ace-input" type="password" value={creds.syl_corp_password} placeholder="Update when notified" onChange={e => setCred("syl_corp_password", e.target.value)} /></div>
            </div>
            <div className="ace-row2">
              <div className="ace-field"><label className="ace-label">User ID</label><input className="ace-input" type="text" value={creds.syl_user_id} placeholder="User login" onChange={e => setCred("syl_user_id", e.target.value)} /></div>
              <div className="ace-field"><label className="ace-label">User Password</label><input className="ace-input" type="password" value={creds.syl_user_password} placeholder="Update when notified" onChange={e => setCred("syl_user_password", e.target.value)} /></div>
            </div>
            <div className="ace-row2">
              <div className="ace-field"><label className="ace-label">MC Number</label><input className="ace-input" type="text" value={settings.mc_number} placeholder="e.g. 1610666" onChange={e => setSetting("mc_number", e.target.value)} /></div>
              <div className="ace-field"><label className="ace-label">Bid Contact Name</label><input className="ace-input" type="text" value={settings.bid_contact_name} placeholder="Ken" onChange={e => setSetting("bid_contact_name", e.target.value)} /><div className="ace-hint">Used in bid email greeting</div></div>
            </div>

            <hr className="ace-divider" />

            <span className="slabel">Search Parameters</span>
            <div className="ace-row2">
              <div className="ace-field"><label className="ace-label">From City</label><input className="ace-input" type="text" value={settings.search_from_city} placeholder="Dallas" onChange={e => setSetting("search_from_city", e.target.value)} /></div>
              <div className="ace-field"><label className="ace-label">From State</label><input className="ace-input" type="text" value={settings.search_from_state} placeholder="TX" maxLength={2} onChange={e => setSetting("search_from_state", e.target.value)} /></div>
            </div>
            <div className="ace-row2">
              <div className="ace-field"><label className="ace-label">To States</label><input className="ace-input" type="text" value={settings.search_to_states_raw} placeholder="TX, OK" onChange={e => setSetting("search_to_states_raw", e.target.value)} /><div className="ace-hint">Type ANY for all states</div></div>
              <div className="ace-field"><label className="ace-label">Pickup Radius (mi)</label><input className="ace-input" type="number" value={settings.pickup_radius} placeholder="50" min={1} max={500} step={5} onChange={e => setSetting("pickup_radius", e.target.value)} /></div>
            </div>
            <div className="search-preview">
              Search: <strong style={{ color:"#fff" }}>{fromPart || "any"}</strong> → <strong style={{ color:"#fff" }}>{toStates || "any"}</strong>{radiusPart && <> | <strong style={{ color:"#fff" }}>{radiusPart}</strong></>}<br />
              <span style={{ fontSize:"10px", color:"rgba(255,255,255,0.25)" }}>Types: {ltSelected.length ? ltSelected.join(", ") : <span style={{ color:RED }}>none selected</span>}</span>
            </div>
          </div>

          {/* ── COL 2: Load Types + Actions ── */}
          <div className="ace-col">
            <span className="slabel">Load Types to Monitor</span>
            <div className="cb-grid">
              {LOAD_TYPES.map(lt => (
                <label key={lt.value} className="cb-row">
                  <input type="checkbox" checked={(settings.target_load_types || []).includes(lt.value)} onChange={() => toggleLT(lt.value)} style={{ accentColor:GOLD, width:"13px", height:"13px", flexShrink:0, cursor:"pointer" }} />
                  {lt.label}
                </label>
              ))}
            </div>
            <div className="lt-summary">Monitoring: <strong style={{ color:GOLD }}>{ltSelected.length ? ltSelected.join(", ") : "none selected"}</strong></div>

            <hr className="ace-divider" />

            <span className="slabel">Actions</span>
            <button className="btn-primary" onClick={handleSave}>Save All Settings</button>
            <button className="btn-sec">⊞ Open Load Board</button>
            <button className="btn-sec">Connect Email</button>
            <button className="btn-red" onClick={handlePause}>{paused ? "▶ Resume ACE" : "⏸ Pause ACE"}</button>
            <button className="btn-red" onClick={handleLogoff}>{loggedOff ? "🔓 LOG ON to Sylectus" : "🔒 LOG OFF Sylectus"}</button>
            <div className="saved-msg" style={{ opacity: savedShow ? 1 : 0 }}>✓ Saved</div>
          </div>

          {/* ── COL 3: Bid Filters + Rate Calc + Connection ── */}
          <div className="ace-col">
            <span className="slabel">Bid Filters</span>
            <div className="ace-row2">
              <div className="ace-field"><label className="ace-label">Max Weight (lbs)</label><input className="ace-input" type="number" value={settings.max_weight} placeholder="9000" min={1} max={99999} step={500} onChange={e => setSetting("max_weight", e.target.value)} /></div>
              <div className="ace-field"><label className="ace-label">Max Trip Miles</label><input className="ace-input" type="number" value={settings.max_miles} placeholder="1200" min={1} max={9999} step={50} onChange={e => setSetting("max_miles", e.target.value)} /></div>
            </div>
            <div className="filter-summary">Alert when: <strong style={{ color:GREEN }}>≤ {weightFmt} lbs</strong> · delivery in <strong style={{ color:GREEN }}>{toStates || "TX, OK"}</strong></div>
            <div className="ace-field" style={{ marginTop:"8px" }}>
              <label className="ace-label">Max Load Age</label>
              <div className="radio-row">
                {MAX_AGE_OPTIONS.map(opt => (
                  <label key={opt.value} className="ace-radio-label">
                    <input type="radio" name="max-age" value={opt.value} checked={parseInt(settings.max_load_age) === opt.value} onChange={() => setSetting("max_load_age", opt.value)} style={{ accentColor:GOLD }} />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            <hr className="ace-divider" />

            <span className="slabel">Rate Calculator</span>
            <div className="ace-row2">
              <div className="ace-field"><label className="ace-label">RPM ($)</label><input className="ace-input" type="number" value={settings.rpm} placeholder="2.75" step={0.05} min={1} max={10} onChange={e => setSetting("rpm", e.target.value)} /></div>
              <div className="ace-field"><label className="ace-label">Example Miles</label><input className="ace-input" type="number" value={exMiles} placeholder="250" onChange={e => setExMiles(e.target.value)} /></div>
            </div>
            <div className="rpm-preview">
              <span style={{ fontSize:"10px", color:"rgba(255,255,255,0.4)" }}>{miles} mi × ${rpm}</span>
              <span style={{ fontSize:"14px", fontWeight:600, color:GOLD }}>= ${rpmRes}</span>
            </div>

            <hr className="ace-divider" />

            <span className="conn-label">Connection Status</span>
            <div className="conn-row"><span style={{ width:"6px", height:"6px", borderRadius:"50%", background:GREEN, display:"inline-block", flexShrink:0 }} />Sylectus — {status === "active" ? "Connected" : "Not connected"}</div>
            <div className="conn-row"><span style={{ width:"6px", height:"6px", borderRadius:"50%", background:GOLD, display:"inline-block", flexShrink:0 }} />Gmail — Not connected</div>
          </div>

        </div>

        <div className="ace-footer">ACE Load Capture v2.0 · EDGEai · XTX LLC</div>
      </div>
    </>
  );
}
