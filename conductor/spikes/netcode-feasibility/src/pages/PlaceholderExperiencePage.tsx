import { ExperienceLayout } from "../components/ExperienceLayout";
import { ResultView } from "../components/ResultView";
import { RunButton } from "../components/RunButton";
import { useRunStore } from "../state/RunStore";

export function PlaceholderExperiencePage() {
  const { experiences, results, running, abortAll } = useRunStore();
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
      <RunButton experienceId={experience.id} testId="page-placeholder-run-button" label="Run" />
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
