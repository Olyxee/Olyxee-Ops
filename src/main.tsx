import React, { FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./icloud.css";

function Login() {
  const [email, setEmail] = useState("info@olyxee.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Sign in failed.");
      window.location.assign("/");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Sign in failed.");
      setSubmitting(false);
    }
  };

  return <div className="login">
    <div className="login-orb login-orb-one" aria-hidden="true"/>
    <div className="login-orb login-orb-two" aria-hidden="true"/>
    <form className="login-card" onSubmit={submit}>
      <div className="login-brand">
        <img src="/olyxee-logo.png" alt="Olyxee"/>
        <span>Olyxee <em>Ops</em></span>
      </div>
      <div className="login-rule" aria-hidden="true"><span/></div>
      <div className="eyebrow">OLYXEE / INTERNAL</div>
      <h1>Welcome back</h1>
      <p>Use your secure Ops account to continue.</p>
      <div className="form-grid">
        <label className="form-label">Email<input className="input" type="email" autoComplete="username" value={email} onChange={event=>setEmail(event.target.value)} required/></label>
        <label className="form-label">Password<span className="password-field"><input className="input" type={showPassword?"text":"password"} autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} required/><button className="password-toggle" type="button" onClick={()=>setShowPassword(value=>!value)} aria-label={showPassword?"Hide password":"Show password"}>{showPassword?"Hide":"Show"}</button></span></label>
        {error&&<div className="notice">{error}</div>}
        <button className="btn primary" type="submit" disabled={submitting}>{submitting?"Signing in…":"Sign in"}</button>
      </div>
      <div className="login-trust"><span className="login-lock" aria-hidden="true">✓</span><span>Private workspace · encrypted in transit</span></div>
    </form>
    <p className="login-footer">Olyxee Ops <span>•</span> Internal operations</p>
  </div>;
}

function Root() {
  const [authenticated, setAuthenticated] = useState<boolean|null>(null);
  useEffect(()=>{
    fetch("/api/auth/session")
      .then(response=>response.json())
      .then(result=>setAuthenticated(Boolean(result.authenticated)))
      .catch(()=>setAuthenticated(false));
  },[]);
  if(authenticated===null)return <div className="login"><div className="login-card"><div className="loading-bar loading-profile-name"/><div className="loading-bar loading-profile-meta"/></div></div>;
  return authenticated?<App/>:<Login/>;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><Root/></React.StrictMode>,
);