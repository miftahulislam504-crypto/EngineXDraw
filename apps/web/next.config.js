/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@archibim/firebase-config',
    '@archibim/object-model',
    '@archibim/shared-ui',
  ],
  reactStrictMode: true,
  // TEMPORARY — uploads .map files alongside production JS so stack
  // traces show real file/line numbers instead of minified names.
  // Purely additive: doesn't change any runtime behavior, just what
  // the browser can show for an error's stack. Safe to remove once
  // the Floor Plan / Site Plan crash (React error #185) is found.
  productionBrowserSourceMaps: true,
};

module.exports = nextConfig;