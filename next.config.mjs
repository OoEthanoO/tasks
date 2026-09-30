/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  deploymentId: process.env.YANTASKS_COMMIT_SHA,
};

export default nextConfig;
