import React from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider, SignIn, SignUp, Show } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { Route, Router, Switch, useLocation } from "wouter";
import App from "./App";
import "./index.css";
import "./icloud.css";

const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const appearance = {
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "#315efb",
    colorForeground: "#172033",
    colorMutedForeground: "#687083",
    colorBackground: "#ffffff",
    colorInput: "#f6f7f9",
    colorInputForeground: "#172033",
    colorDanger: "#c33b44",
    colorNeutral: "#dfe3ea",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    borderRadius: "12px",
  },
  elements: {
    rootBox: { width: "100%", display: "flex", justifyContent: "center" },
    cardBox: { width: "440px", maxWidth: "100%", background: "#fff", border: "1px solid #e4e7ec", borderRadius: "20px", boxShadow: "0 24px 70px rgba(38,49,74,.12)", overflow: "hidden" },
    card: { boxShadow: "none", border: 0, background: "transparent" },
    footer: { boxShadow: "none", border: 0, background: "transparent" },
    headerTitle: { color: "#172033", fontWeight: 700 },
    headerSubtitle: { color: "#687083" },
    formFieldLabel: { color: "#344054", fontWeight: 600 },
    formFieldInput: { background: "#f6f7f9", color: "#172033", borderColor: "#dfe3ea" },
    formButtonPrimary: { background: "#315efb", color: "#fff" },
    footerActionLink: { color: "#315efb", fontWeight: 600 },
    footerActionText: { color: "#687083" },
    socialButtonsBlockButtonText: { color: "#172033" },
    dividerText: { color: "#687083" },
  },
};

function PublicHome() {
  const [, navigate] = useLocation();
  return <div className="login"><div className="login-card"><img src="/olyxee-logo.png" alt="Olyxee" style={{width:52}}/><div className="eyebrow">OLYXEE / INTERNAL</div><h1>Olyxee Ops</h1><p>Secure operations, delivery, projects, and staff coordination for the Olyxee team.</p><button className="btn primary" onClick={()=>navigate("/sign-in")}>Sign in</button></div></div>;
}

function Routes() {
  return <Switch>
    <Route path="/"><Show when="signed-in"><App/></Show><Show when="signed-out"><PublicHome/></Show></Route>
    <Route path="/sign-in/*?"><div className="login"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}/></div></Route>
    <Route path="/sign-up/*?"><div className="login"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`}/></div></Route>
    <Route><Show when="signed-in"><App/></Show><Show when="signed-out"><PublicHome/></Show></Route>
  </Switch>;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={appearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{signIn:{start:{title:"Welcome back",subtitle:"Sign in to Olyxee Ops"}},signUp:{start:{title:"Create your account",subtitle:"Use your Olyxee work email"}}}}
    >
      <Router base={basePath}><Routes/></Router>
    </ClerkProvider>
  </React.StrictMode>,
);