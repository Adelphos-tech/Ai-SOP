// ============================================================
// GENERATION START — accept early, run detached
// ============================================================
// A full six-stage pipeline can exceed every HTTP timeout in the
// chain (nginx proxy_read_timeout, client abort). Holding the request
// open for the whole run made a SUCCESSFUL generation surface as
// "Generation failed" when the proxy cut the connection.
//
// startDetached resolves as soon as the run signals it was accepted
// (run row persisted + lock held). Outcomes produced BEFORE acceptance
// (blocked, lock conflict, busy) are still returned synchronously.
// After acceptance the run continues in-process; the status endpoint
// is the authoritative reconciler.
// ============================================================

export function startDetached<R>(
  run: (onAccepted: (generationId: string) => void) => Promise<R>,
  accepted: (generationId: string) => R,
  onBackgroundError: (e: unknown) => void,
): Promise<R> {
  return new Promise<R>((resolve, reject) => {
    let isAccepted = false;
    run((generationId) => {
      if (isAccepted) return;
      isAccepted = true;
      resolve(accepted(generationId));
    }).then(
      (result) => { if (!isAccepted) resolve(result); },
      (e) => { if (isAccepted) onBackgroundError(e); else reject(e); },
    );
  });
}
