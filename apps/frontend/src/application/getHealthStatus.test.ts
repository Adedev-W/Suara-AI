import { describe, expect, it, vi } from "vitest";

import type { HealthGateway } from "./healthGateway";
import { createGetHealthStatus } from "./getHealthStatus";

describe("get health status", () => {
  it("returns the status supplied by its gateway", async () => {
    const gateway: HealthGateway = {
      getHealth: vi.fn().mockResolvedValue({ status: "ok", service: "suaraai-api" }),
    };

    await expect(createGetHealthStatus(gateway)()).resolves.toEqual({
      status: "ok",
      service: "suaraai-api",
    });
  });
});
