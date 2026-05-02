import { execa } from "execa";

export async function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<void> {
  const out = await (opts.cwd === undefined
    ? execa(cmd, args, { env: { ...process.env, ...opts.env }, stdio: "inherit" })
    : execa(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: "inherit" }));
  if (out.exitCode !== 0) throw new Error(`${cmd} ${args.join(" ")} -> exit ${out.exitCode}`);
}

export async function capture(
  cmd: string,
  args: string[],
  opts: { cwd?: string } = {},
): Promise<string> {
  const out = await (opts.cwd === undefined
    ? execa(cmd, args)
    : execa(cmd, args, { cwd: opts.cwd }));
  if (typeof out.stdout !== "string") {
    throw new Error(`${cmd} ${args.join(" ")} -> stdout is not a string`);
  }
  return out.stdout;
}
