export type CronStep = {
  readonly name: string;
  readonly run: () => Promise<void>;
};

export type StepResult = {
  readonly name: string;
  readonly ok: boolean;
  readonly error?: string;
};

// Execute each step sequentially, isolating failures so one broken Fitbit
// endpoint (e.g. AZM 403) can't take the whole cron tick with it. Re-throws
// only when every step failed, so the scheduled handler still surfaces total
// outages.
export async function runSteps(
  cron: string,
  steps: ReadonlyArray<CronStep>,
): Promise<StepResult[]> {
  const results: StepResult[] = [];
  for (const step of steps) {
    try {
      await step.run();
      results.push({ name: step.name, ok: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[cron:${cron}] step ${step.name} failed: ${message}`);
      results.push({ name: step.name, ok: false, error: message });
    }
  }
  if (results.length > 0 && results.every((r) => !r.ok)) {
    const details = results.map((r) => `${r.name}(${r.error ?? ""})`).join(", ");
    throw new Error(`[cron:${cron}] all ${results.length} steps failed: ${details}`);
  }
  return results;
}
