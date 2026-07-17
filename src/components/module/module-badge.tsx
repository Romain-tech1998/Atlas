import { moduleColor, moduleLabel } from "@/i18n/module-label";
import type { AxisModuleId } from "@/domain/axis";

interface ModuleBadgeProps {
  module: AxisModuleId;
  t: (key: string) => string;
}

/** Matches Claude Design's "Projet atlas" ModuleBadge component
 * (mission-card inline badge) exactly: a colored dot plus an uppercase
 * label, both in the module's own color. `unknown` has no assigned
 * color (moduleColor returns null) — rendered as muted text with no dot
 * rather than inventing a 7th color for a non-identity module. */
export function ModuleBadge({ module, t }: ModuleBadgeProps) {
  const color = moduleColor(module);
  return (
    <span className="inline-flex items-center gap-1.5">
      {color ? <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} /> : null}
      <span
        className={`text-[11px] font-semibold tracking-[0.04em] uppercase ${color ? "" : "text-muted-foreground"}`}
        style={color ? { color } : undefined}
      >
        {moduleLabel(t, module)}
      </span>
    </span>
  );
}
