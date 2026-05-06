import { execa } from "execa";
import { resolve } from "node:path";

export async function emsdkEnv(): Promise<Record<string, string>> {
    const emsdkDir = resolve(".tools/emsdk");
    let stdout: string;
    try {
        const result = await execa("bash", ["-c", "source ./emsdk_env.sh > /dev/null 2>&1 && env"], { cwd: emsdkDir });
        if (typeof result.stdout !== "string") {
            throw new Error("emsdk env capture: stdout missing");
        }

        stdout = result.stdout;
    } catch (err) {
        throw new Error(
            `Failed to capture emsdk env from .tools/emsdk/emsdk_env.sh — did you run \`pnpm setup\`? Underlying error: ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    const captured: Record<string, string> = {};
    for (const line of stdout.split("\n")) {
        const eq = line.indexOf("=");
        if (eq > 0) {
            const key = line.slice(0, eq);
            const value = line.slice(eq + 1);
            captured[key] = value;
        }
    }

    const delta: Record<string, string> = {};
    for (const [key, value] of Object.entries(captured)) {
        if (process.env[key] !== value) {
            delta[key] = value;
        }
    }
    return delta;
}
