"""TDA lens implementations — dataset-independent."""
from .base import BaseLens
from .pca import PCALens
from .umap_lens import UMAPLens
from .density import DensityLens
from .eccentricity import EccentricityLens
from .feature import FeatureLens

LENS_REGISTRY = {
    "pca":          PCALens,
    "umap":         UMAPLens,
    "density":      DensityLens,
    "eccentricity": EccentricityLens,
    "feature":      FeatureLens,
}

def get_lens(name: str, **kwargs) -> BaseLens:
    cls = LENS_REGISTRY.get(name)
    if cls is None:
        raise ValueError(f"Unknown lens '{name}'. Available: {list(LENS_REGISTRY)}")
    return cls(**kwargs)
