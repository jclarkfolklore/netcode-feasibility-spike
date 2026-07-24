import { ExperienceLayout } from "../components/ExperienceLayout";
import { ResultView } from "../components/ResultView";
import { useRunStore } from "../state/RunStore";

export function PlaceholderExperiencePage() {
  const { experiences, results, running, runOne, abortAll } = useRunStore();
  const experience = experiences.find((e) => e.id === "placeholder")!;
  const result = results[experience.id];
  const isRunning = running[experience.id] ?? false;

  return (
    <ExperienceLayout
      testId="page-placeholder"
      title={experience.title}
      whatItTests={experience.whatItTests}
      whyItMatters={experience.whyItMatters}
      howToRead={experience.howToRead}
    >
      <button
        type="button"
        data-testid="page-placeholder-run-button"
        disabled={isRunning}
        onClick={() => void runOne(experience.id)}
      >
        {isRunning ? "Running…" : "Run"}
      </button>
      <button
        type="button"
        data-testid="page-placeholder-abort-button"
        disabled={!isRunning}
        onClick={abortAll}
      >
        Abort
      </button>
      {result && <ResultView testId="page-placeholder-result" result={result} />}
    </ExperienceLayout>
  );
}
