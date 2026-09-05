"""
Tests: TDA engine — lenses, clustering, anomaly detection, relationships, drift.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1]))

import numpy as np
import pandas as pd
import pytest

from backend.data.gov_aid_adapter import clean_dataframe, engineer_features, build_records
from backend.tda.engine import (
    _normalize,
    compute_persistent_homology,
    compute_clusters,
    detect_anomalies,
    compute_relationships,
    compute_drift,
    build_suspicious_findings,
    run_full_pipeline,
)
from backend.tda.lenses import get_lens, LENS_REGISTRY


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def sample_df():
    np.random.seed(42)
    n = 100
    return pd.DataFrame({
        "Project_ID":        [f"AID-{i:04d}" for i in range(n)],
        "Recipient_Country": np.random.choice(["Kenya", "Germany", "France", "Colombia", "India"], n),
        "Approval_Date":     ["28/04/2005"] * n,
        "Approval_Date_corrected_EU": ["28.04.2005"] * n,
        "Approval Date_Phase": ["April"] * n,
        "Approva_Date_Year": np.random.choice([2005, 2010, 2015, 2018, 2020], n).astype(float),
        "DAC_Sector_Code":   np.random.choice([12191, 15123, 12230], n).astype(float),
        "DAC_Mapping":       np.random.choice(["Medical Services", "Admin", "Infrastructure"], n),
        "Initial_Budget_USD": np.random.lognormal(15, 2, n),
        "Initial_Budget_Unusual": ["usual"] * n,
        "Final_Cost_USD":    np.random.lognormal(15, 2, n),
        "Cost_Overran":      np.random.normal(0, 1e6, n),
        "Cost_Overran_in %": np.random.normal(0.1, 0.5, n),
        "Loss":              [np.nan] * n,
        "CPI_Score":         np.random.uniform(200, 500, n),
        "Evaluation_Lag_Days": np.random.uniform(100, 400, n),
        "Project_Success":   np.random.choice([0.0, 1.0], n),
    })


@pytest.fixture
def clean_sample(sample_df):
    df = clean_dataframe(sample_df)
    df, tda_cols = engineer_features(df)
    return df, tda_cols


# ── Normalisation ─────────────────────────────────────────────────────────────

def test_normalize_shape(clean_sample):
    df, tda_cols = clean_sample
    feat_cols = [c for c in tda_cols if c in df.columns]
    X = df[feat_cols].values.astype(float)
    X_norm = _normalize(X)
    assert X_norm.shape == X.shape


def test_normalize_no_nan(clean_sample):
    df, tda_cols = clean_sample
    feat_cols = [c for c in tda_cols if c in df.columns]
    X = df[feat_cols].values.astype(float)
    X_norm = _normalize(X)
    assert not np.isnan(X_norm).any()


def test_normalize_zero_mean(clean_sample):
    df, tda_cols = clean_sample
    feat_cols = [c for c in tda_cols if c in df.columns]
    X = df[feat_cols].values.astype(float)
    X_norm = _normalize(X)
    # Each column should be approximately zero-mean
    col_means = X_norm.mean(axis=0)
    np.testing.assert_allclose(col_means, 0.0, atol=1e-10)


# ── Lenses ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("lens_name", ["pca", "density", "eccentricity", "feature"])
def test_lens_fit_transform(lens_name, clean_sample):
    df, tda_cols = clean_sample
    feat_cols = [c for c in tda_cols if c in df.columns]
    X = df[feat_cols].values.astype(float)
    X_norm = _normalize(X)
    lens = get_lens(lens_name)
    result = lens.fit_transform(X_norm)
    assert result.shape[0] == len(X_norm)
    assert not np.isnan(result).any()


def test_lens_registry_complete():
    for name in ["pca", "umap", "density", "eccentricity", "feature"]:
        assert name in LENS_REGISTRY


def test_lens_unknown_raises():
    with pytest.raises(ValueError, match="Unknown lens"):
        get_lens("nonexistent_lens")


# ── Clustering ────────────────────────────────────────────────────────────────

def test_compute_clusters_returns_labels(clean_sample):
    df, tda_cols = clean_sample
    feat_cols = [c for c in tda_cols if c in df.columns]
    X_norm    = _normalize(df[feat_cols].values.astype(float))
    record_ids = df["Project_ID"].astype(str).tolist()
    cat_cols   = ["Recipient_Country", "DAC_Mapping"]
    labels, themes = compute_clusters(X_norm, df, record_ids, cat_cols)
    assert len(labels) == len(df)
    assert isinstance(themes, list)


def test_compute_clusters_themes_structure(clean_sample):
    df, tda_cols = clean_sample
    feat_cols = [c for c in tda_cols if c in df.columns]
    X_norm    = _normalize(df[feat_cols].values.astype(float))
    record_ids = df["Project_ID"].astype(str).tolist()
    cat_cols   = ["Recipient_Country", "DAC_Mapping"]
    _, themes  = compute_clusters(X_norm, df, record_ids, cat_cols)
    for t in themes:
        assert "kind"    in t
        assert "title"   in t
        assert "sources" in t
        assert "extra"   in t
        assert "cluster_id" in t["extra"]


def test_noise_label_minus_one(clean_sample):
    df, tda_cols = clean_sample
    feat_cols = [c for c in tda_cols if c in df.columns]
    X_norm    = _normalize(df[feat_cols].values.astype(float))
    record_ids = df["Project_ID"].astype(str).tolist()
    labels, _ = compute_clusters(X_norm, df, record_ids, [])
    # -1 is valid (noise) but not required
    assert set(labels).issubset(set(range(-1, 100)))


# ── Anomaly detection ─────────────────────────────────────────────────────────

def test_detect_anomalies_count(clean_sample):
    df, tda_cols = clean_sample
    feat_cols = [c for c in tda_cols if c in df.columns]
    X_norm    = _normalize(df[feat_cols].values.astype(float))
    record_ids = df["Project_ID"].astype(str).tolist()
    labels, _ = compute_clusters(X_norm, df, record_ids, [])
    findings, scores = detect_anomalies(X_norm, df, record_ids, labels, feat_cols, [])
    assert len(findings) > 0
    assert len(scores) == len(df)


def test_detect_anomalies_score_range(clean_sample):
    df, tda_cols = clean_sample
    feat_cols = [c for c in tda_cols if c in df.columns]
    X_norm    = _normalize(df[feat_cols].values.astype(float))
    record_ids = df["Project_ID"].astype(str).tolist()
    labels, _ = compute_clusters(X_norm, df, record_ids, [])
    _, scores = detect_anomalies(X_norm, df, record_ids, labels, feat_cols, [])
    assert scores.min() >= 0.0
    assert scores.max() <= 1.0


def test_detect_anomalies_structure(clean_sample):
    df, tda_cols = clean_sample
    feat_cols = [c for c in tda_cols if c in df.columns]
    X_norm    = _normalize(df[feat_cols].values.astype(float))
    record_ids = df["Project_ID"].astype(str).tolist()
    labels, _ = compute_clusters(X_norm, df, record_ids, [])
    findings, _ = detect_anomalies(X_norm, df, record_ids, labels, feat_cols, [])
    for f in findings:
        assert f["kind"]    == "anomaly"
        assert "score"      in f
        assert "sources"    in f
        assert "extra"      in f
        assert "iso_score"  in f["extra"]
        assert "topo_score" in f["extra"]
        assert "flagged_by" in f["extra"]


# ── Relationships ─────────────────────────────────────────────────────────────

def test_compute_relationships(clean_sample):
    df, tda_cols = clean_sample
    feat_cols  = [c for c in tda_cols if c in df.columns]
    X_norm     = _normalize(df[feat_cols].values.astype(float))
    record_ids = df["Project_ID"].astype(str).tolist()
    labels, _  = compute_clusters(X_norm, df, record_ids, [])
    rels, nodes, edges = compute_relationships(df, record_ids, labels, X_norm)
    assert isinstance(rels, list)
    assert isinstance(nodes, list)
    assert isinstance(edges, list)


def test_relationship_structure(clean_sample):
    df, tda_cols = clean_sample
    feat_cols  = [c for c in tda_cols if c in df.columns]
    X_norm     = _normalize(df[feat_cols].values.astype(float))
    record_ids = df["Project_ID"].astype(str).tolist()
    labels, _  = compute_clusters(X_norm, df, record_ids, [])
    rels, _, _  = compute_relationships(df, record_ids, labels, X_norm)
    for r in rels:
        assert r["kind"]  == "relationship"
        assert "title"    in r
        assert "extra"    in r
        assert "a"        in r["extra"]
        assert "b"        in r["extra"]


# ── Drift ─────────────────────────────────────────────────────────────────────

def test_compute_drift_returns_list(clean_sample):
    df, tda_cols = clean_sample
    feat_cols = [c for c in tda_cols if c in df.columns]
    X_norm    = _normalize(df[feat_cols].values.astype(float))
    labels    = np.zeros(len(df), dtype=int)
    drift     = compute_drift(df, X_norm, labels)
    assert isinstance(drift, list)


def test_drift_structure(clean_sample):
    df, tda_cols = clean_sample
    feat_cols = [c for c in tda_cols if c in df.columns]
    X_norm    = _normalize(df[feat_cols].values.astype(float))
    labels    = np.zeros(len(df), dtype=int)
    drift     = compute_drift(df, X_norm, labels)
    for d in drift:
        assert d["kind"]   == "drift"
        assert "title"     in d
        assert "extra"     in d
        assert "delta"     in d["extra"]
        assert "direction" in d["extra"]


# ── Full pipeline ─────────────────────────────────────────────────────────────

def test_run_full_pipeline_returns_dict(clean_sample):
    df, tda_cols = clean_sample
    result = run_full_pipeline(df, tda_cols, lens_name="pca")
    assert isinstance(result, dict)
    assert "meta"          in result
    assert "themes"        in result
    assert "anomalies"     in result
    assert "suspicious"    in result
    assert "relationships" in result
    assert "drift"         in result
    assert "topology"      in result
    assert "graph"         in result


def test_run_full_pipeline_meta(clean_sample):
    df, tda_cols = clean_sample
    result = run_full_pipeline(df, tda_cols, lens_name="pca")
    meta   = result["meta"]
    assert meta["n_docs"]      == len(df)
    assert meta["data_type"]   == "tabular"
    assert meta["lens"]        == "pca"
    assert "tda"               in meta
    assert "numeric_features"  in meta


def test_run_full_pipeline_all_lenses(clean_sample):
    df, tda_cols = clean_sample
    for lens in ["pca", "density", "eccentricity"]:
        result = run_full_pipeline(df, tda_cols, lens_name=lens)
        assert "anomalies" in result, f"Lens {lens} failed"


def test_run_full_pipeline_record_ids(clean_sample):
    df, tda_cols = clean_sample
    result = run_full_pipeline(df, tda_cols)
    assert "record_ids"      in result
    assert len(result["record_ids"])  == len(df)
    assert "cluster_labels"  in result
    assert len(result["cluster_labels"]) == len(df)


def test_run_full_pipeline_no_fake_data(clean_sample):
    """Verify no hardcoded fake statistics are returned."""
    df, tda_cols = clean_sample
    result = run_full_pipeline(df, tda_cols)
    meta   = result["meta"]
    # n_docs must equal actual DataFrame length
    assert meta["n_docs"] == len(df)
    # Anomaly count must match list length
    assert meta["n_anomalies"] == len(result["anomalies"])
    # Relationship count must match list length
    assert meta["n_relationships"] == len(result["relationships"])


def test_run_full_pipeline_graph_structure(clean_sample):
    df, tda_cols = clean_sample
    result = run_full_pipeline(df, tda_cols)
    graph  = result["graph"]
    assert "nodes"        in graph
    assert "edges"        in graph
    assert "mapper_nodes" in graph
    assert "mapper_edges" in graph


def test_run_full_pipeline_empty_features(sample_df):
    """Pipeline with no valid features should return error."""
    df = clean_dataframe(sample_df)
    result = run_full_pipeline(df, ["nonexistent_col_1", "nonexistent_col_2"])
    assert "error" in result


def test_mapper_nodes_expose_lens_mean(clean_sample):
    """Each Mapper node must carry its members' mean lens value (drives the X axis)."""
    df, tda_cols = clean_sample
    result = run_full_pipeline(df, tda_cols, lens_name="pca")
    nodes  = result["graph"]["mapper_nodes"]
    assert nodes, "expected at least one mapper node"
    assert all("lens_mean" in n and isinstance(n["lens_mean"], float) for n in nodes)


def test_lens_choice_changes_mapper_layout(clean_sample):
    """Switching the lens function must produce a different Mapper node layout."""
    df, tda_cols = clean_sample
    pca_means = sorted(
        n["lens_mean"] for n in run_full_pipeline(df, tda_cols, lens_name="pca")["graph"]["mapper_nodes"]
    )
    ecc_means = sorted(
        n["lens_mean"] for n in run_full_pipeline(df, tda_cols, lens_name="eccentricity")["graph"]["mapper_nodes"]
    )
    assert pca_means != ecc_means


def test_lens_change_reuses_cached_base(clean_sample):
    """A second run with the same features but a new lens reuses the cached base."""
    from backend.tda.engine import clear_base_cache
    clear_base_cache()
    df, tda_cols = clean_sample

    first  = run_full_pipeline(df, tda_cols, lens_name="pca")
    second = run_full_pipeline(df, tda_cols, lens_name="eccentricity")

    # First run computes the base; second reuses it.
    assert first["meta"]["cached_base"] is False
    assert second["meta"]["cached_base"] is True
    # Lens-independent findings are identical across the two lenses (came from cache)...
    assert first["anomalies"] == second["anomalies"]
    assert first["combined_scores"] == second["combined_scores"]
    # ...but the lens-dependent projection differs.
    assert first["lens_values"] != second["lens_values"]
