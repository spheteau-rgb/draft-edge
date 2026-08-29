/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // players.json is committed to /data and read server-side (fs) or copied into
  // the app at build time by precompute/build_players.py. No client bundling of
  // secrets; see docs/09.
};

export default nextConfig;
