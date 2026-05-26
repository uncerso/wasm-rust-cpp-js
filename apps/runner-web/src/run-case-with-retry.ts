import type { CaseInput, CaseResult, DriverSession } from "./driver.js";

/** Minimal contract used by retry helper — narrower than full DriverSession for easier mocking. */
export interface DriverSessionLike {
    runCase(input: CaseInput): Promise<CaseResult>;
    quit(): Promise<void>;
}

export type CreateSessionFn = () => Promise<DriverSession>;

export interface RetryFailure {
    caseId: string;
    error: string;
}

function caseIdOf(input: CaseInput): string {
    return `${input.entry}__${input.language}-${input.toolchain}-${input.profile}__${input.size}`;
}

function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/**
 * Run a case with one retry attempt. On any error:
 *   1. Log the error
 *   2. Quit + recreate the session (replacing sessionRef.current)
 *   3. Retry the case on the fresh session
 *   4. If retry also fails → push to failures[] and return null
 *
 * Unified path for per-case errors and session-level crashes (Selenium error
 * distinction is unreliable; relaunch on any failure is the conservative choice).
 */
export async function runCaseWithRetry(
    sessionRef: { current: DriverSessionLike },
    caseInput: CaseInput,
    failures: RetryFailure[],
    createSession: CreateSessionFn,
): Promise<CaseResult | null> {
    const caseId = caseIdOf(caseInput);
    try {
        return await sessionRef.current.runCase(caseInput);
    } catch (e1) {
        const msg1 = errorMessage(e1);
        console.error(`[retry] ${caseId}: 1st attempt failed: ${msg1}`);
        await sessionRef.current.quit().catch(() => { /* best-effort */ });
        try {
            sessionRef.current = await createSession();
        } catch (eRelaunch) {
            const msgR = errorMessage(eRelaunch);
            console.error(`[fail] ${caseId}: relaunch failed: ${msgR}`);
            failures.push({ caseId, error: msgR });
            return null;
        }
        try {
            return await sessionRef.current.runCase(caseInput);
        } catch (e2) {
            const msg2 = errorMessage(e2);
            console.error(`[fail] ${caseId}: 2nd attempt failed: ${msg2}`);
            failures.push({ caseId, error: msg2 });
            return null;
        }
    }
}
