"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { LOCALES, type AppLocale } from "@/i18n/locale";
import { cn } from "@/lib/utils";

export function LanguageSwitcher() {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("languageSwitcher");
  const [isSwitching, setIsSwitching] = useState(false);

  async function switchTo(nextLocale: AppLocale) {
    if (nextLocale === locale || isSwitching) return;
    setIsSwitching(true);
    try {
      await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: nextLocale }),
      });
      router.refresh();
    } finally {
      setIsSwitching(false);
    }
  }

  return (
    <div className="flex items-center gap-0.5 rounded-md border p-0.5" aria-label={t("label")}>
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          disabled={isSwitching}
          onClick={() => switchTo(option)}
          aria-pressed={option === locale}
          className={cn(
            "rounded px-2 py-0.5 text-xs font-medium uppercase transition-colors disabled:opacity-50",
            option === locale
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
