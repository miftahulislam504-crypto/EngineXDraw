/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@archibim/firebase-config',
    '@archibim/object-model',
    '@archibim/shared-ui',
  ],
  reactStrictMode: true,
};

module.exports = nextConfig;
