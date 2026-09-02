import type { HealthStatus } from "../domain/health";

export interface HealthGateway {
  getHealth(): Promise<HealthStatus>;
}
