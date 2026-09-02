from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True, slots=True)
class ServiceHealth:
    """Current health state exposed by the application."""

    status: Literal["ok"]
    service: str
