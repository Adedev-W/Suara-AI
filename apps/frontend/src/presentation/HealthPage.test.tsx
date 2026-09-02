import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HealthPage } from "./HealthPage";

describe("HealthPage", () => {
  it("shows a healthy API response", async () => {
    const getHealthStatus = vi.fn().mockResolvedValue({ status: "ok", service: "suaraai-api" });

    render(<HealthPage getHealthStatus={getHealthStatus} />);

    expect(screen.getByText("Checking API...")).toBeInTheDocument();
    expect(await screen.findByText("API is healthy")).toBeInTheDocument();
    expect(screen.getByText("Service: suaraai-api")).toBeInTheDocument();
  });

  it("allows an unavailable API to be retried", async () => {
    const getHealthStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ status: "ok", service: "suaraai-api" });

    render(<HealthPage getHealthStatus={getHealthStatus} />);

    expect(await screen.findByText("API unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("API is healthy")).toBeInTheDocument();
    expect(getHealthStatus).toHaveBeenCalledTimes(2);
  });
});
