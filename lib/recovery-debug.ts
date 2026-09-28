// Live status of the welcome-screen wallet recovery loop, surfaced in the
// storage diagnostic so we can see whether it runs, what it reads, and whether
// it triggered a re-hydrate. Temporary debugging aid — remove with the diagnostic.
export const recoveryDebug = {
  mounts: 0,
  polls: 0,
  lastFmt: '-',
  hydrateCalled: false,
  cancelled: false,
};

export function recoverySummary(): string {
  const r = recoveryDebug;
  return `recovery: mounts=${r.mounts} polls=${r.polls} last=${r.lastFmt} hydrated=${r.hydrateCalled} cancelled=${r.cancelled}`;
}
