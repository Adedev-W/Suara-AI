import { getHealthStatus } from "./dependencies";
import { HealthPage } from "../presentation/HealthPage";

export function App() {
  return <HealthPage getHealthStatus={getHealthStatus} />;
}
