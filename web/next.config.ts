import { existsSync, readdirSync, readFileSync } from "node:fs";
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

const characters = resolve(process.cwd(), "public/characters");
const characterFiles = new Set(existsSync(characters) ? readdirSync(characters) : []);
const characterSets = [...characterFiles]
  .filter((name) => /^celmento-[a-z\d-]+\.svg$/u.test(name))
  .map((name) => name.slice(0, -4))
  .filter((name) =>
    [200, 400, 600].every(
      (size) =>
        characterFiles.has(`${name}@${size}px.png`) && characterFiles.has(`${name}@${size}px.webp`),
    ),
  );

const config: NextConfig = {
  poweredByHeader: false,
  env: { NEXT_PUBLIC_CLM_APP_CHARACTER_SETS: characterSets.sort().join(",") },
};

export default config;
