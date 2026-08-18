const base = (process.env.BUILT_IN_FORGE_API_URL || "").replace(/\/+$/, "");
const serverKey = process.env.BUILT_IN_FORGE_API_KEY || "";
const frontendKey = process.env.VITE_FRONTEND_FORGE_API_KEY || "";

const attempts = [
  { name: "server-key-query", key: serverKey, headers: {} },
  { name: "frontend-key-query", key: frontendKey, headers: {} },
  { name: "server-bearer-header", key: "", headers: { Authorization: `Bearer ${serverKey}` } },
  { name: "frontend-bearer-header", key: "", headers: { Authorization: `Bearer ${frontendKey}` } },
  { name: "frontend-key-with-local-origin", key: frontendKey, headers: {}, origin: "http://localhost:3000" },
  { name: "frontend-key-with-preview-origin", key: frontendKey, headers: {}, origin: "https://3000-ixx0yq3buu6f5s4p7vcpa-28014fc9.us5.manus.computer" },
  { name: "frontend-key-with-origin-header", key: frontendKey, headers: { Origin: "http://localhost:3000" } },
  { name: "frontend-key-with-preview-origin-header", key: frontendKey, headers: { Origin: "https://3000-ixx0yq3buu6f5s4p7vcpa-28014fc9.us5.manus.computer" } },
];

for (const attempt of attempts) {
  const url = new URL("/v1/maps/proxy/maps/api/js", base);
  if (attempt.key) url.searchParams.set("key", attempt.key);
  if (attempt.origin) url.searchParams.set("origin", attempt.origin);
  url.searchParams.set("v", "weekly");
  const response = await fetch(url, { headers: attempt.headers });
  const body = await response.text();
  console.log(`${attempt.name}: ${response.status} ${body.slice(0, 100).replace(/\s+/g, " ")}`);
}
