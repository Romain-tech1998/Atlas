/** Atlas State Engine's view of a user's current state. */
export interface AtlasStateSnapshot {
  /** Domain (module id) -> interaction count. */
  activeDomains: Record<string, number>;
  priorities: string[];
  /** Free-form key/value facts extracted from memory-type requests. */
  preferences: Record<string, string>;
  activeProjects: string[];
  openTaskCount: number;
}
