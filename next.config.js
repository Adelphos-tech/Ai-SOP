/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep `next dev` output out of `.next` so a dev server can't clobber a
  // production build (mixing the two caused "Cannot find module './NNNN.js'").
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
  },
};
module.exports = nextConfig;
