import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  // DATABASE_SSL_CA_PATH is resolved at runtime, so explicitly include the public CA
  // in API function bundles. Keep it outside public/: only the server needs this file.
  outputFileTracingIncludes: {
    "/api/**": ["./certs/supabase-prod-ca-2021.crt"],
  },
};

export default config;
