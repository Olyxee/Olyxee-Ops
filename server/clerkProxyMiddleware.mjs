import { createProxyMiddleware } from "http-proxy-middleware";

const CLERK_FAPI = "https://frontend-api.clerk.dev";
export const CLERK_PROXY_PATH = "/api/__clerk";

export function getClerkProxyHost(request) {
  const forwarded = request.headers["x-forwarded-host"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return raw?.split(",")[0]?.trim() || request.headers.host?.trim() || undefined;
}

export function clerkProxyMiddleware() {
  if (process.env.NODE_ENV !== "production" || !process.env.CLERK_SECRET_KEY) {
    return (_request, _response, next) => next();
  }

  return createProxyMiddleware({
    target: CLERK_FAPI,
    changeOrigin: true,
    pathRewrite: (path) => path.replace(new RegExp(`^${CLERK_PROXY_PATH}`), ""),
    on: {
      proxyReq: (proxyRequest, request) => {
        const protocol = request.headers["x-forwarded-proto"] || "https";
        const host = getClerkProxyHost(request) || "";
        proxyRequest.setHeader("Clerk-Proxy-Url", `${protocol}://${host}${CLERK_PROXY_PATH}`);
        proxyRequest.setHeader("Clerk-Secret-Key", process.env.CLERK_SECRET_KEY);
      },
    },
  });
}