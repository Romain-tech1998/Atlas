"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AxisInput } from "@/components/axis/axis-input";

const PHASE_COUNT = 4;
const PHASE_DURATION_MS = 800;

interface CreateMissionResponse {
  missionId: string;
}

interface MissionCreationProps {
  /** "hero" is the full welcoming empty-state experience; "compact" is the
   * smaller "start another mission" affordance shown once missions exist. */
  variant?: "hero" | "compact";
}

export function MissionCreation({ variant = "hero" }: MissionCreationProps) {
  const router = useRouter();
  const t = useTranslations("home");
  const tCommon = useTranslations("common");
  const [heroInput, setHeroInput] = useState("");
  const [status, setStatus] = useState<"idle" | "creating" | "error">("idle");
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const phases = [t("transition.phase1"), t("transition.phase2"), t("transition.phase3"), t("transition.phase4")];
  // Kept in English regardless of UI language — the deterministic Intent
  // Engine only recognizes English trigger phrases today, so a translated
  // example would silently fail to parse. See the i18n recap.
  const examples = t.raw("hero.examples") as string[];

  function fillExample(example: string) {
    setHeroInput(example);
    textareaRef.current?.focus();
  }

  function runPhaseAnimation(): Promise<void> {
    return new Promise((resolve) => {
      let index = 0;
      const interval = setInterval(() => {
        index = Math.min(index + 1, PHASE_COUNT - 1);
        setPhaseIndex(index);
      }, PHASE_DURATION_MS);

      setTimeout(
        () => {
          clearInterval(interval);
          resolve();
        },
        PHASE_DURATION_MS * PHASE_COUNT,
      );
    });
  }

  async function createMission(rawInput: string) {
    setStatus("creating");
    setPhaseIndex(0);
    setError(null);

    const requestPromise = fetch("/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawInput }),
    }).then(async (response) => {
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? t("creationError"));
      }
      return (await response.json()) as CreateMissionResponse;
    });

    try {
      const [, data] = await Promise.all([runPhaseAnimation(), requestPromise]);
      router.push(`/missions/${data.missionId}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : tCommon("somethingWentWrong"));
      setStatus("error");
    }
  }

  function handleHeroSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = heroInput.trim();
    if (!trimmed || status === "creating") return;
    void createMission(trimmed);
  }

  if (status === "creating") {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-5 text-center">
        <p key={phaseIndex} className="animate-in fade-in text-lg font-medium duration-500">
          {phases[phaseIndex]}
        </p>
        <div className="flex items-center gap-1.5">
          {phases.map((phase, index) => (
            <span
              key={phase}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                index === phaseIndex
                  ? "bg-foreground w-5"
                  : index < phaseIndex
                    ? "bg-foreground/40 w-1.5"
                    : "bg-muted-foreground/20 w-1.5"
              }`}
            />
          ))}
        </div>
      </div>
    );
  }

  if (variant === "compact") {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">{t("compact.title")}</h2>
        <AxisInput
          onSubmit={createMission}
          isSubmitting={false}
          placeholder={t("compact.placeholder")}
          submitLabel={t("compact.cta")}
          rows={1}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-6 text-center">
      <div>
        <h1 className="font-heading text-3xl font-semibold">{t("hero.title")}</h1>
        <p className="text-muted-foreground mt-2">{t("hero.subtitle")}</p>
      </div>

      <form onSubmit={handleHeroSubmit} className="flex w-full max-w-xl flex-col gap-3">
        <Textarea
          ref={textareaRef}
          value={heroInput}
          onChange={(event) => setHeroInput(event.target.value)}
          placeholder={t("hero.placeholder")}
          rows={3}
          className="text-base"
          autoFocus
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={heroInput.trim().length === 0} size="lg" className="self-center px-8">
          {t("hero.cta")}
        </Button>
      </form>

      <div className="flex flex-col items-center gap-2">
        <p className="text-muted-foreground text-xs">{t("hero.examplesLabel")}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => fillExample(example)}
              className="text-muted-foreground hover:text-foreground hover:border-foreground/40 rounded-full border px-3 py-1 text-xs transition-colors"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
