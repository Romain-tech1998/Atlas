/**
 * RFC-0003 §8b (Sprint-014): every external system sits behind exactly one
 * abstraction — `Provider`. Deliberately data-only: the Registry and any UI
 * operate on this shape generically, without knowing what any given
 * Provider actually *does*. Capability-specific behavior (e.g. reading
 * calendar events) lives in narrow extensions like `CalendarProvider`
 * (`src/providers/calendar-provider.ts`), never here — no `execute(action,
 * params)`, no capability-negotiation machinery. Do not add fields beyond
 * these five without a concrete Skill/Provider needing them.
 */
export type ProviderAuthType = "none" | "oauth" | "api_key";

/** Static for now — `MockCalendarProvider` hardcodes `"connected"` and never
 * transitions, since nothing it does actually connects to anything. The
 * full vocabulary exists so a real Provider has somewhere to report state
 * once one exists; the transition logic itself is deferred until then. */
export type ProviderStatus = "disconnected" | "connecting" | "connected" | "unavailable";

export interface Provider {
  id: string;
  name: string;
  /** Plain strings (e.g. `"calendar:read"`) — no enum, no schema, same
   * discipline as `ComparableValue.measure?: string` (RFC-0003 §9). */
  capabilities: string[];
  authType: ProviderAuthType;
  /** RFC-0003 §8c: optional — present/static for a Provider with one global
   * state (Mock), absent for a Provider whose connection status is
   * per-user (Google Calendar). When absent, status is resolved separately
   * from `ExternalConnection`, never stored on or read from the Registry. */
  status?: ProviderStatus;
}

/** RFC-0003 §8c: the typed failure a Provider throws instead of a bare
 * exception — `read_calendar` catches this and maps `code` into its own
 * discriminated-union output, so a Skill's internal error handling follows
 * RFC-0003 §6's "structured errors, never a bare exception" rule even
 * though this is a Provider throwing, not the Skill Engine itself. */
export class ProviderError extends Error {
  constructor(
    public readonly code: "unauthorized" | "unavailable",
    message: string,
  ) {
    super(message);
  }
}
