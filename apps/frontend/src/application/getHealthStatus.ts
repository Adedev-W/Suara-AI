import type { HealthStatus } from "../domain/health";
import type { HealthGateway } from "./healthGateway";

export type GetHealthStatus = () => Promise<HealthStatus>;

export function createGetHealthStatus(gateway: HealthGateway): GetHealthStatus {
  return () => gateway.getHealth();
}
