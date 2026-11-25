import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import type { NextConfig } from "next";

const envFile = resolve(process.cwd(), "../.env");

if (existsSync(envFile)) {
  for (const [name, value] of Object.entries(parseEnv(readFileSync(envFile, "utf8")))) {
    if (name.startsWith("NEXT_PUBLIC_CLM_APP_")) {
      process.env[name] ??= value;
    }
  }
}

const config: NextConfig = {
  poweredByHeader: false,
};

export default config;
