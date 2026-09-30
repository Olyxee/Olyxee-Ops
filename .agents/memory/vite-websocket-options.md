---
name: Vite websocket options
description: Vite 8 separates websocket configuration from hot-module-reload settings.
---

In Vite 8, configure the websocket transport through `server.ws`, not `server.hmr`. Disabling HMR alone does not stop Vite from opening a websocket listener.

**Why:** Middleware-mode component tests still attempted to bind the default websocket port when HMR was disabled or given a custom port. The installed Vite implementation reads transport options from `server.ws`.

**How to apply:** Use `server.ws: false` for SSR-only test servers. For preview websocket troubleshooting, inspect the installed Vite version and its transport options before reusing older HMR configuration advice. Keep test dependency caches separate from the running app.