import { createGetHealthStatus } from "../application/getHealthStatus";
import { FetchHealthGateway } from "../infrastructure/fetchHealthGateway";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "/api/v1";
const healthGateway = new FetchHealthGateway(apiBaseUrl);

export const getHealthStatus = createGetHealthStatus(healthGateway);
