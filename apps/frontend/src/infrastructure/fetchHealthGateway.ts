import type { HealthGateway } from "../application/healthGateway";
import type { HealthStatus } from "../domain/health";

function isHealthStatus(value: unknown): value is HealthStatus {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return candidate.status === "ok" && typeof candidate.service === "string";
}

export class FetchHealthGateway implements HealthGateway {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async getHealth(): Promise<HealthStatus> {
    const response = await fetch(`${this.baseUrl}/health`, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Health request failed with status ${response.status}`);
    }

    const payload: unknown = await response.json();
    if (!isHealthStatus(payload)) {
      throw new Error("Health response has an invalid shape");
    }

    return payload;
  }
}
