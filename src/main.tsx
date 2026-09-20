import React, { FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./icloud.css";
import "./logo-overrides.css";
import "./home-card-overrides.css";
import "./home-review-final.css";

function Login() {
  const [email, setEmail] = useState("info@olyxee.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const clearError = () => {
    if (error) setError("");
  };

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
      const responseType = response.headers.get("content-type") || "";
      const result = responseType.includes("application/json")
        ? await response.json()
        : { error: response.ok ? "" : "We couldn't sign you in. Please try again." };
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
         <label className="form-label">Email<input className="input" type="email" autoComplete="username" value={email} aria-invalid={Boolean(error)} onChange={event=>{setEmail(event.target.value);clearError()}} required/></label>
         <label className="form-label">Password<span className="password-field"><input className="input" type={showPassword?"text":"password"} autoComplete="current-password" value={password} aria-invalid={Boolean(error)} aria-describedby={error?"login-error":undefined} onChange={event=>{setPassword(event.target.value);clearError()}} required/><button className="password-toggle" type="button" onClick={()=>setShowPassword(value=>!value)} aria-label={showPassword?"Hide password":"Show password"}>{showPassword?"Hide":"Show"}</button></span>{error&&<span id="login-error" className="login-field-error" role="alert">{error}</span>}</label>
        <button className="btn primary" type="submit" disabled={submitting}>{submitting?"Signing in…":"Sign in"}</button>
      </div>
      <div className="login-trust"><span className="login-lock" aria-hidden="true">✓</span><span>Private workspace · encrypted in transit</span></div>
    </form>
    <p className="login-footer">Olyxee Ops <span>•</span> Internal operations</p>
  </div>;
}

function Root() {
  const accountSetup=window.location.pathname==="/setup-account";
  const [authenticated, setAuthenticated] = useState<boolean|null>(null);
  useEffect(()=>{
    fetch("/api/auth/session")
      .then(async response=>{
        if(!response.ok||!(response.headers.get("content-type")||"").includes("application/json"))return {authenticated:false};
        return response.json();
      })
      .then(result=>setAuthenticated(Boolean(result.authenticated)))
      .catch(()=>setAuthenticated(false));
  },[]);
  if(accountSetup)return <App/>;
  if(authenticated===null)return <div className="login"><div className="login-card"><div className="loading-bar loading-profile-name"/><div className="loading-bar loading-profile-meta"/></div></div>;
  return authenticated?<App/>:<Login/>;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><Root/></React.StrictMode>,
);