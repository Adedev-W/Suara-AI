import { useCallback, useEffect, useState } from "react";

import type { GetHealthStatus } from "../application/getHealthStatus";
import type { HealthStatus } from "../domain/health";

type HealthPageProps = {
  getHealthStatus: GetHealthStatus;
};

type ViewState =
  | { state: "loading" }
  | { state: "healthy"; health: HealthStatus }
  | { state: "unavailable" };

export function HealthPage({ getHealthStatus }: HealthPageProps) {
  const [viewState, setViewState] = useState<ViewState>({ state: "loading" });

  const loadHealth = useCallback(async () => {
    setViewState({ state: "loading" });

    try {
      const health = await getHealthStatus();
      setViewState({ state: "healthy", health });
    } catch {
      setViewState({ state: "unavailable" });
    }
  }, [getHealthStatus]);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
      <section className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl shadow-cyan-950/30">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">
          SuaraAI
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">System status</h1>
        <p className="mt-2 text-slate-400">
          Clean architecture is wired and ready for audio features.
        </p>

        <div
          aria-live="polite"
          className="mt-8 rounded-2xl border border-slate-800 bg-slate-950/60 p-5"
        >
          {viewState.state === "loading" && (
            <p className="text-slate-300">Checking API...</p>
          )}

          {viewState.state === "healthy" && (
            <div>
              <p className="flex items-center gap-3 font-semibold text-emerald-400">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" aria-hidden="true" />
                API is healthy
              </p>
              <p className="mt-2 text-sm text-slate-400">
                Service: {viewState.health.service}
              </p>
            </div>
          )}

          {viewState.state === "unavailable" && (
            <div>
              <p className="font-semibold text-rose-400">API unavailable</p>
              <p className="mt-2 text-sm text-slate-400">
                The backend did not return a valid health response.
              </p>
              <button
                className="mt-4 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-300"
                type="button"
                onClick={() => void loadHealth()}
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
