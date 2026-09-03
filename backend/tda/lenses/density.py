from __future__ import annotations
import numpy as np
from sklearn.neighbors import KernelDensity
from .base import BaseLens


class DensityLens(BaseLens):
    name = "density"
    description = "Local kernel density estimate — highlights dense vs sparse regions."

    def __init__(self, bandwidth: float = 0.5):
        self.bandwidth = bandwidth

    def fit_transform(self, X: np.ndarray) -> np.ndarray:
        kde = KernelDensity(bandwidth=self.bandwidth, kernel="gaussian")
        kde.fit(X)
        log_dens = kde.score_samples(X)
        return log_dens  # shape (n_samples,)
