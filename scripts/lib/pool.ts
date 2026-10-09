/**
 * Run `tasks` with at most `limit` in flight at once. Preserves result order
 * (result[i] is tasks[i]'s value). Rejects with the FIRST task rejection — build
 * failures must halt the run, not be swallowed. In-flight tasks are allowed to
 * settle; no new task starts once an error is seen.
 */
export async function runPool<T>(
    tasks: ReadonlyArray<() => Promise<T>>,
    limit: number,
): Promise<T[]> {
    if (limit < 1) {
        throw new Error(`runPool: limit must be >= 1, got ${limit}`);
    }
    const results = new Array<T>(tasks.length);
    let next = 0;
    let firstError: unknown;
    let errored = false;

    async function worker(): Promise<void> {
        while (true) {
            const i = next++;
            if (i >= tasks.length || errored) {
                return;
            }
            try {
                results[i] = await tasks[i]!();
            } catch (e) {
                if (!errored) {
                    errored = true;
                    firstError = e;
                }
                return;
            }
        }
    }

    const workers = Math.min(limit, tasks.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));
    if (errored) {
        throw firstError;
    }
    return results;
}
