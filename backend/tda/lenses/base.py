"""Abstract base class for all TDA lenses."""
from __future__ import annotations
from abc import ABC, abstractmethod
import numpy as np


class BaseLens(ABC):
    name: str = "base"
    description: str = ""

    @abstractmethod
    def fit_transform(self, X: np.ndarray) -> np.ndarray:
        """Map high-dim X (n_samples, n_features) → 1D or 2D filter values."""

    def __repr__(self):
        return f"{self.__class__.__name__}()"
