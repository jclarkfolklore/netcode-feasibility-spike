import type { ExperienceResult } from "../contracts";
import type { Experience } from "./types";

/** Default per-experience timeout (contracts.md §6 — "timeout per experience"). */
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface RunOptions {
  timeoutMs?: number;
  /** External abort — e.g. the user hit "abort" or navigated away. */
  signal?: AbortSignal;
}

function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), {
      once: true,
    });
  }
  return controller.signal;
}

function failedResult(
  exp: Experience,
  config: Record<string, unknown>,
  reason: "timeout" | "aborted" | "error",
  error?: unknown,
): ExperienceResult {
  return {
    experienceId: exp.id,
    status: "failed",
    topology: "loopback",
    lossMode: "none",
    raw: {
      config,
      reason,
      error: error instanceof Error ? error.message : error,
    },
    subScores: [],
    verdict:
      reason === "timeout"
        ? `Timed out after the experience's timeout budget.`
        : reason === "aborted"
          ? "Aborted before completion."
          : "Failed with an unexpected error.",
    measuredCaveat: "n/a — run did not complete",
  };
}

/**
 * Runs a single experience through the ONE path shared by manual per-page
 * buttons and "run all" (contracts.md §6 `RunControl`). Timeout and external
 * abort both surface as `status: 'failed'`, never thrown past this
 * boundary, so callers can always render a result.
 */
export async function runExperience<TConfig extends Record<string, unknown>>(
  experience: Experience<TConfig>,
  config: TConfig = experience.defaultConfig,
  options: RunOptions = {},
): Promise<ExperienceResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort("timeout"), timeoutMs);
  const signal = combineSignals(options.signal, timeoutController.signal);

  try {
    const result = await experience.run(config, signal);
    return result;
  } catch (err) {
    if (signal.aborted) {
      const reason = signal.reason === "timeout" ? "timeout" : "aborted";
      return failedResult(experience as Experience, config, reason, err);
    }
    return failedResult(experience as Experience, config, "error", err);
  } finally {
    clearTimeout(timer);
  }
}

export interface RunAllProgress {
  experienceId: string;
  index: number;
  total: number;
  result: ExperienceResult;
}

/**
 * "Run all" — identical path as manual, sequentially, using each
 * experience's `defaultConfig` (contracts.md §6: "run-all uses exactly the
 * defaults so 'run-all results match manual' is checkable").
 */
export async function runAll(
  experiences: Experience[],
  options: RunOptions & { onProgress?: (p: RunAllProgress) => void } = {},
): Promise<ExperienceResult[]> {
  const results: ExperienceResult[] = [];
  for (let i = 0; i < experiences.length; i++) {
    const exp = experiences[i];
    if (options.signal?.aborted) {
      results.push(failedResult(exp, exp.defaultConfig, "aborted"));
      continue;
    }
    const result = await runExperience(exp, exp.defaultConfig, options);
    results.push(result);
    options.onProgress?.({
      experienceId: exp.id,
      index: i,
      total: experiences.length,
      result,
    });
  }
  return results;
}
