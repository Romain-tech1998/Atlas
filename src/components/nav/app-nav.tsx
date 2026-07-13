"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "./language-switcher";

interface AppNavProps {
  userLabel: string;
}

export function AppNav({ userLabel }: AppNavProps) {
  const pathname = usePathname();
  const t = useTranslations("nav");

  const navLinks = [
    { href: "/home", label: t("home") },
    { href: "/dashboard", label: t("dashboard") },
    { href: "/axis", label: t("axis") },
    { href: "/documents", label: t("documents") },
    { href: "/providers", label: t("providers") },
  ] as const;

  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-3">
        <nav className="flex items-center gap-1">
          {navLinks.map((link) => {
            const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <span className="text-muted-foreground text-sm">{userLabel}</span>
          <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: "/login" })}>
            {t("signOut")}
          </Button>
        </div>
      </div>
    </header>
  );
}
