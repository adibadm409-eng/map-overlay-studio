const base = (process.env.BUILT_IN_FORGE_API_URL || "").replace(/\/+$/, "");
const serverKey = process.env.BUILT_IN_FORGE_API_KEY || "";
const frontendKey = process.env.VITE_FRONTEND_FORGE_API_KEY || "";
const origin = "https://3000-ixx0yq3buu6f5s4p7vcpa-28014fc9.us5.manus.computer";

const attempts = [
  { name: "server-key", key: serverKey, headers: { Origin: origin } },
  { name: "frontend-key", key: frontendKey, headers: { Origin: origin } },
  { name: "server-bearer", key: "", headers: { Origin: origin, Authorization: `Bearer ${serverKey}` } },
  { name: "frontend-bearer", key: "", headers: { Origin: origin, Authorization: `Bearer ${frontendKey}` } },
];

for (const attempt of attempts) {
  const url = new URL("/v1/maps/proxy/maps/api/staticmap", base);
  if (attempt.key) url.searchParams.set("key", attempt.key);
  url.searchParams.set("center", "15.073,43.279");
  url.searchParams.set("zoom", "14");
  url.searchParams.set("size", "640x480");
  url.searchParams.set("maptype", "hybrid");
  const response = await fetch(url, { headers: attempt.headers });
  const body = await response.text();
  console.log(`${attempt.name}: ${response.status} ${body.slice(0, 100).replace(/\s+/g, " ")}`);
}
