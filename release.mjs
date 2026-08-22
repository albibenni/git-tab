import { execSync } from "node:child_process";

const type = process.argv[2] ?? "patch";
if (!new Set(["major", "minor", "patch"]).has(type)) {
  console.error("Release type must be major, minor, or patch.");
  process.exit(1);
}

execSync(`pnpm version ${type} --tag-version-prefix=""`, { stdio: "inherit" });
execSync("git push --follow-tags", { stdio: "inherit" });
