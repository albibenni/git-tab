import { execSync } from "node:child_process";

const args = process.argv.slice(2);
let type = "patch";

for (const arg of args) {
  if (arg.startsWith("type=")) type = arg.slice("type=".length);
  else if (arg.startsWith("--type=")) type = arg.slice("--type=".length);
  else if (["major", "minor", "patch"].includes(arg)) type = arg;
}

if (!["major", "minor", "patch"].includes(type)) {
  console.error(`Invalid release type: ${type}. Use major, minor, or patch.`);
  process.exit(1);
}

try {
  console.log(`Releasing new ${type} version...`);
  execSync(`pnpm version ${type} --tag-version-prefix=""`, {
    stdio: "inherit",
  });
  console.log("Version metadata updated. Pushing commit and tag...");
  execSync("git push --follow-tags", { stdio: "inherit" });
} catch (error) {
  console.error(
    "Release failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
}
