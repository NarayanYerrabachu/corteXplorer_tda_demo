from __future__ import annotations
import logging
import numpy as np
from .base import BaseLens

log = logging.getLogger(__name__)


class UMAPLens(BaseLens):
    name = "umap"
    description = "UMAP dimensionality reduction as filter function."

    def __init__(self, n_components: int = 1, n_neighbors: int = 15, min_dist: float = 0.1):
        self.n_components = n_components
        self.n_neighbors  = n_neighbors
        self.min_dist     = min_dist

    def fit_transform(self, X: np.ndarray) -> np.ndarray:
        try:
            import umap
            reducer = umap.UMAP(
                n_components=self.n_components,
                n_neighbors=self.n_neighbors,
                min_dist=self.min_dist,
                random_state=42,
            )
            result = reducer.fit_transform(X)
            return result[:, 0] if self.n_components == 1 else result
        except ImportError:
            log.warning("umap-learn not installed, falling back to PCA")
            from .pca import PCALens
            return PCALens(n_components=self.n_components).fit_transform(X)
