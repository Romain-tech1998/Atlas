interface AtlasWorkingIndicatorProps {
  label: string;
}

/** A small "this is real, right now" signal — only ever rendered when
 * something genuinely true is happening (see callers). Never shown as
 * decoration. */
export function AtlasWorkingIndicator({ label }: AtlasWorkingIndicatorProps) {
  return (
    <div className="text-muted-foreground inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">
      <span className="relative flex size-1.5">
        <span className="bg-amber-500 absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
        <span className="bg-amber-500 relative inline-flex size-1.5 rounded-full" />
      </span>
      {label}
    </div>
  );
}
