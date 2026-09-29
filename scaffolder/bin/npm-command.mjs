// How the scaffolder launches npm.
//
// On Windows `npm` is a `npm.cmd` batch shim, and Node refuses to run a .cmd
// or .bat file through execFile/spawn without a shell: since the fix for
// CVE-2024-27980 (Node 18.20.2 / 20.12.2 / 21.7.3) it throws
// `spawnSync npm.cmd EINVAL`. So `execFileSync("npm.cmd", ["install"])` failed
// on every current Node, and `npx @santifer/career-ops init` left every Windows
// user with a clone and no dependencies.
//
// `shell: true` would work but concatenates args unescaped (DEP0190), so this
// avoids it. On Windows, prefer running npm's own JS entrypoint with the
// current Node: `npx` exports it as npm_execpath, so it is the same npm the
// user just invoked. Only an actual npm-cli.js is trusted — under `pnpm dlx`
// or `bunx`, npm_execpath names a different package manager. Otherwise, hand
// cmd.exe one fixed command string. macOS and Linux run `npm` directly, as
// before.

const SAFE_ARG = /^[\w.@=:/-]+$/;
const NPM_CLI_JS = /[\\/]npm-cli\.(?:c|m)?js$/i;

import { execFileSync } from "node:child_process";

/**
 * Which of the three launch routes applies. Returns only a route name, so the
 * decision carries no path data of its own.
 */
function npmRoute(npmArgs, platform, env) {
  for (const arg of npmArgs) {
    if (!SAFE_ARG.test(arg)) throw new Error(`npmCommand: refusing unsafe npm argument ${JSON.stringify(arg)}`);
  }
  if (platform !== "win32") return "posix";
  const npmCli = env.npm_execpath;
  return npmCli && NPM_CLI_JS.test(npmCli) ? "node" : "cmd";
}

/**
 * Returns `{ file, args }` describing how `npm <npmArgs>` is launched.
 * `npmArgs` must be plain tokens (e.g. "install", "--version"): on the
 * cmd.exe fallback they are joined into a command line, so anything that
 * needs quoting or could be read as shell syntax is refused.
 *
 * Descriptive only — run npm with execNpm(), which keeps the cmd.exe route
 * and the npm-cli.js route on separate execFileSync calls.
 */
export function npmCommand(npmArgs, {
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
} = {}) {
  switch (npmRoute(npmArgs, platform, env)) {
    case "posix": return { file: "npm", args: [...npmArgs] };
    case "node": return { file: execPath, args: [env.npm_execpath, ...npmArgs] };
    // /d skips AutoRun commands, /s keeps the quoted command line intact.
    default: return { file: env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", ["npm", ...npmArgs].join(" ")] };
  }
}

/**
 * Runs `npm <npmArgs>` with execFileSync and returns its result.
 *
 * Each route has its own execFileSync call, so the npm-cli.js path (an
 * absolute path from the environment) only ever reaches Node's argv and never
 * the cmd.exe command line (CodeQL js/shell-command-injection-from-environment).
 */
export function execNpm(npmArgs, execOptions = {}, {
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
} = {}) {
  switch (npmRoute(npmArgs, platform, env)) {
    case "posix":
      return execFileSync("npm", [...npmArgs], execOptions);
    case "node":
      return execFileSync(execPath, [env.npm_execpath, ...npmArgs], execOptions);
    default:
      return execFileSync(env.ComSpec || "cmd.exe", ["/d", "/s", "/c", ["npm", ...npmArgs].join(" ")], execOptions);
  }
}
