"""
CorteXplorer TDA Engine — Government Aid Edition.
Dataset-independent core. Adapted for tabular structured data.
Implements: Mapper, persistent homology, clustering, anomaly detection,
            relationships, drift, topology, audit trail.
"""
from __future__ import annotations

import logging
import os
import time
from collections import defaultdict
from typing import Any, Optional

import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN
from sklearn.decomposition import PCA
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

log = logging.getLogger(__name__)

_SAMPLE_N        = int(os.environ.get("TDA_SAMPLE_N", "3000"))
_CONTAMINATION   = float(os.environ.get("TDA_CONTAMINATION", "0.03"))
_DBSCAN_EPS      = float(os.environ.get("TDA_DBSCAN_EPS", "0.9"))
_DBSCAN_MIN_SAMP = int(os.environ.get("TDA_DBSCAN_MIN_SAMPLES", "5"))


# ── Normalisation ──────────────────────────────────────────────────────────────

def _normalize(X: np.ndarray) -> np.ndarray:
    X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)
    scaler = StandardScaler()
    return scaler.fit_transform(X)


# ── Persistent Homology ────────────────────────────────────────────────────────

def compute_persistent_homology(X_norm: np.ndarray, sample_n: int = _SAMPLE_N) -> dict[str, Any]:
    """Compute H0/H1 persistent homology using ripser."""
    result: dict[str, Any] = {
        "available":       False,
        "betti_0":         1,
        "betti_1":         0,
        "max_persistence": 0.0,
        "h1_features":     [],
    }
    try:
        from ripser import ripser as _ripser

        n = len(X_norm)
        X_pca = PCA(n_components=min(5, X_norm.shape[1])).fit_transform(X_norm)
        idx = np.random.choice(n, min(sample_n, n), replace=False)
        X_s = X_pca[idx]

        dgms = _ripser(X_s, maxdim=1)["dgms"]
        h1   = dgms[1]
        if len(h1) > 0:
            finite = h1[np.isfinite(h1[:, 1])]
            betti1  = len(finite)
            pers    = finite[:, 1] - finite[:, 0] if betti1 > 0 else np.array([])
            max_p   = float(pers.max()) if betti1 > 0 else 0.0
            top10   = finite[np.argsort(-pers)[:10]] if betti1 > 0 else []
            h1_feats = [
                {
                    "birth":       float(r[0]),
                    "death":       float(r[1]),
                    "persistence": float(r[1] - r[0]),
                    "label":       f"Loop {i+1} (pers {r[1]-r[0]:.4f})",
                    "sources":     [],
                }
                for i, r in enumerate(top10)
            ]
            result.update({
                "available":       True,
                "betti_0":         1,
                "betti_1":         betti1,
                "max_persistence": round(max_p, 4),
                "h1_features":     h1_feats,
            })
        log.info("TDA: β₁=%d  max_pers=%.4f", result["betti_1"], result["max_persistence"])
    except Exception as exc:
        log.warning("Persistent homology unavailable: %s", exc)
    return result


# ── Mapper graph ───────────────────────────────────────────────────────────────

def build_mapper_graph(
    X_norm: np.ndarray,
    lens_values: np.ndarray,
    n_intervals: int = 10,
    overlap: float = 0.5,
    cluster_labels: Optional[np.ndarray] = None,
    record_ids: Optional[list[str]] = None,
) -> dict[str, Any]:
    """
    Build a Mapper graph.
    Returns nodes (with member record IDs) and edges (with overlap).
    """
    lo, hi   = lens_values.min(), lens_values.max()
    span     = hi - lo + 1e-9
    step     = span / n_intervals
    half_ov  = step * overlap / 2

    interval_members: list[list[int]] = []
    for k in range(n_intervals):
        c      = lo + step * (k + 0.5)
        lo_k   = c - step / 2 - half_ov
        hi_k   = c + step / 2 + half_ov
        members = np.where((lens_values >= lo_k) & (lens_values <= hi_k))[0].tolist()
        if members:
            interval_members.append(members)

    # Cluster within each interval
    mapper_nodes: list[dict] = []
    for im_idx, members in enumerate(interval_members):
        X_sub = X_norm[members]
        if len(X_sub) < 2:
            mapper_nodes.append({"members": members, "cluster": 0})
            continue
        pca_sub = PCA(n_components=min(2, X_sub.shape[1])).fit_transform(X_sub)
        db = DBSCAN(eps=0.8, min_samples=2).fit(pca_sub)
        lbs = db.labels_
        for cid in sorted(set(lbs)):
            mask  = lbs == cid
            group = [members[j] for j in range(len(members)) if mask[j]]
            if group:
                mapper_nodes.append({
                    "members": group,
                    "interval": im_idx,
                    "cluster":  int(cid),
                })

    # Build edges between overlapping nodes
    mapper_edges: list[dict] = []
    for i in range(len(mapper_nodes)):
        for j in range(i + 1, len(mapper_nodes)):
            s1 = set(mapper_nodes[i]["members"])
            s2 = set(mapper_nodes[j]["members"])
            shared = s1 & s2
            if shared:
                mapper_edges.append({"source": i, "target": j, "weight": len(shared)})

    # Build output graph
    rids = record_ids or [str(k) for k in range(len(X_norm))]
    graph_nodes = []
    for i, nd in enumerate(mapper_nodes):
        members  = nd["members"]
        node_ids = [rids[m] for m in members]
        graph_nodes.append({
            "id":      f"node-{i}",
            "size":    len(members),
            "sources": node_ids[:20],
            "interval": nd.get("interval", 0),
            "cluster":  nd.get("cluster", 0),
        })

    return {"nodes": graph_nodes, "edges": mapper_edges}


# ── Anomaly detection ──────────────────────────────────────────────────────────

def detect_anomalies(
    X_norm: np.ndarray,
    df: pd.DataFrame,
    record_ids: list[str],
    cluster_labels: np.ndarray,
    feature_cols: list[str],
    cat_cols: list[str],
    id_col: str = "Project_ID",
    top_k: int = 30,
) -> tuple[list[dict], np.ndarray]:
    """
    Isolation Forest + topological score → anomaly findings.
    Returns (anomaly_finding_list, iso_scores_array).
    """
    n = len(X_norm)
    cont = min(0.05, max(0.01, top_k / n))
    iso  = IsolationForest(contamination=cont, random_state=42, n_jobs=-1)
    iso.fit(X_norm)
    iso_scores = -iso.score_samples(X_norm)   # higher = more anomalous

    # Topological score: distance from cluster centroid
    topo_scores = np.zeros(n)
    for cid in set(cluster_labels):
        if cid == -1:
            continue
        mask = cluster_labels == cid
        centroid = X_norm[mask].mean(axis=0)
        dists    = np.linalg.norm(X_norm[mask] - centroid, axis=1)
        topo_scores[mask] = dists / (dists.max() + 1e-9)

    # Noise points get max topo score
    noise_mask = cluster_labels == -1
    topo_scores[noise_mask] = 1.0

    # Combined score
    combined = 0.6 * iso_scores + 0.4 * topo_scores
    combined = (combined - combined.min()) / (combined.max() - combined.min() + 1e-9)

    top_idx = np.argsort(combined)[::-1][:top_k]

    # Find which features drove each anomaly
    feat_means = X_norm.mean(axis=0)
    feat_stds  = X_norm.std(axis=0) + 1e-9

    findings = []
    for rank, i in enumerate(top_idx):
        pid = record_ids[i]
        row = df.iloc[i] if i < len(df) else {}

        # Flag features that deviate > 2σ
        z_scores = np.abs(X_norm[i] - feat_means) / feat_stds
        flagged  = [feature_cols[j] for j in np.argsort(-z_scores)[:3]]

        # Build readable title
        parts = []
        for c in cat_cols[:2]:
            if c in df.columns:
                v = df.iloc[i].get(c, "")
                if v and str(v) not in ("nan", "None", "Unknown"):
                    parts.append(str(v))

        from backend.data.gov_aid_schema import COST_OVERRUN_PCT, SUCCESS
        if COST_OVERRUN_PCT in df.columns:
            ov = df.iloc[i].get(COST_OVERRUN_PCT)
            if ov is not None and not (isinstance(ov, float) and np.isnan(ov)):
                parts.append(f"overrun {float(ov)*100:.1f}%")
        if SUCCESS in df.columns:
            s = df.iloc[i].get(SUCCESS)
            if s is not None:
                parts.append("failed" if int(s) == 0 else "succeeded")

        title = pid + (" — " + ", ".join(parts) if parts else "")

        extra_nums = {}
        for c in feature_cols[:6]:
            if c in df.columns:
                v = df.iloc[i].get(c)
                if v is not None and not (isinstance(v, float) and np.isnan(float(v))):
                    extra_nums[c] = round(float(v), 4)

        findings.append({
            "kind":    "anomaly",
            "title":   title,
            "score":   round(float(combined[i]), 4),
            "sources": [pid],
            "detail":  (
                f"Anomaly score: {combined[i]:.4f}. "
                f"Isolation Forest: {iso_scores[i]:.4f}. "
                f"Topo score: {topo_scores[i]:.4f}. "
                f"Cluster: {int(cluster_labels[i])}."
            ),
            "extra": {
                "iso_score":   round(float(iso_scores[i]), 4),
                "ae_score":    None,
                "topo_score":  round(float(topo_scores[i]), 4),
                "flagged_by":  flagged,
                **extra_nums,
            },
        })

    return findings, combined


# ── Clustering ────────────────────────────────────────────────────────────────

def compute_clusters(
    X_norm: np.ndarray,
    df: pd.DataFrame,
    record_ids: list[str],
    cat_cols: list[str],
    id_col: str = "Project_ID",
    eps: float = _DBSCAN_EPS,
    min_samples: int = _DBSCAN_MIN_SAMP,
) -> tuple[np.ndarray, list[dict]]:
    """DBSCAN clustering → cluster labels + theme findings."""
    X_pca = PCA(n_components=min(5, X_norm.shape[1])).fit_transform(X_norm)
    db    = DBSCAN(eps=eps, min_samples=min_samples, n_jobs=-1).fit(X_pca)
    labels = db.labels_

    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    log.info("DBSCAN: %d clusters, %d noise", n_clusters, int((labels == -1).sum()))

    from backend.data.gov_aid_schema import COST_OVERRUN_PCT, CPI_SCORE

    themes = []
    for cid in sorted(set(labels)):
        if cid == -1:
            continue
        mask  = labels == cid
        c_df  = df[mask] if len(df) == len(labels) else df.iloc[np.where(mask)[0]]
        n_in  = int(mask.sum())

        label_parts = []
        for c in cat_cols[:2]:
            if c in c_df.columns and len(c_df) > 0:
                top = c_df[c].value_counts().index[0]
                label_parts.append(f"{top}")

        for c in [COST_OVERRUN_PCT, CPI_SCORE]:
            if c in c_df.columns:
                m = c_df[c].mean()
                if not np.isnan(m):
                    lbl = "overrun" if c == COST_OVERRUN_PCT else "CPI"
                    label_parts.append(f"avg {lbl} {m*100:.0f}%" if c == COST_OVERRUN_PCT else f"avg CPI {m:.0f}")

        c_ids = [record_ids[j] for j in np.where(mask)[0]]

        # Statistics summary
        stat_fields = {}
        for col in [COST_OVERRUN_PCT, CPI_SCORE, "Evaluation_Lag_Days", "Project_Success"]:
            if col in c_df.columns:
                stat_fields[col] = {
                    "mean": round(float(c_df[col].mean()), 3),
                    "std":  round(float(c_df[col].std()), 3),
                }

        themes.append({
            "kind":    "theme",
            "title":   f"Cluster {cid}: " + " · ".join(label_parts[:3]),
            "score":   0.0,
            "sources": c_ids[:15],
            "detail":  f"{n_in} aid projects in this cluster.",
            "extra":   {"cluster_id": int(cid), "n_records": n_in, "stats": stat_fields},
        })

    return labels, themes


# ── Relationships ─────────────────────────────────────────────────────────────

def compute_relationships(
    df: pd.DataFrame,
    record_ids: list[str],
    cluster_labels: np.ndarray,
    X_norm: np.ndarray,
) -> tuple[list[dict], list[dict], list[dict]]:
    """
    Detect relationships:
      1. Same-country × same-sector co-occurrence in overrun projects
      2. Cluster-level country/sector links
      3. Topological neighbourhood (cosine similarity)
    Returns (relationships, graph_nodes, graph_edges).
    """
    from backend.data.gov_aid_schema import (
        COUNTRY_COL, DAC_MAPPING, COST_OVERRUN_PCT, SUCCESS
    )
    relationships = []
    nodes_map: dict[str, set[str]] = defaultdict(set)

    # ── Co-occurrence: country × sector in overrun projects ──────────────────
    if all(c in df.columns for c in [COUNTRY_COL, DAC_MAPPING, COST_OVERRUN_PCT]):
        overrun_df = df[df[COST_OVERRUN_PCT] > 0.5].copy()
        overrun_df.index = range(len(overrun_df))
        for _, grp in overrun_df.groupby([COUNTRY_COL, DAC_MAPPING]):
            if len(grp) < 2:
                continue
            country = str(grp[COUNTRY_COL].iloc[0])
            sector  = str(grp[DAC_MAPPING].iloc[0])
            weight  = len(grp)
            src_ids = grp.get(grp.columns[0], grp.index).tolist()[:5]
            try:
                pid_col = "Project_ID"
                if pid_col in grp.columns:
                    src_ids = grp[pid_col].astype(str).tolist()[:5]
            except Exception:
                pass
            nodes_map[country].update(src_ids)
            nodes_map[sector].update(src_ids)
            relationships.append({
                "kind":    "relationship",
                "title":   f"{country} ↔ {sector}",
                "score":   round(weight / (len(df) + 1e-9), 4),
                "sources": src_ids,
                "detail":  f"{weight} overrun projects in {country} / {sector}.",
                "extra":   {"a": country, "b": sector, "weight": weight, "type": "overrun_cooccurrence"},
            })

    # ── Cluster membership links ─────────────────────────────────────────────
    if COUNTRY_COL in df.columns:
        for cid in sorted(set(cluster_labels)):
            if cid == -1:
                continue
            mask  = cluster_labels == cid
            c_df  = df[mask] if len(df) == len(mask) else df.iloc[np.where(mask)[0]]
            top_c = c_df[COUNTRY_COL].value_counts().head(1)
            for country, cnt in top_c.items():
                nodes_map[str(country)].update(
                    c_df.get("Project_ID", pd.Series()).astype(str).tolist()[:5]
                )

    relationships.sort(key=lambda r: r["extra"].get("weight", 0), reverse=True)

    graph_nodes = [
        {"id": name, "docs": len(ids), "exposure": 0.0}
        for name, ids in sorted(nodes_map.items(), key=lambda x: len(x[1]), reverse=True)[:30]
    ]
    graph_edges = [
        {"a": r["extra"]["a"], "b": r["extra"]["b"],
         "w": r["extra"].get("weight", 1), "sources": r["sources"]}
        for r in relationships[:30]
    ]

    return relationships[:60], graph_nodes, graph_edges


# ── Drift detection ───────────────────────────────────────────────────────────

def compute_drift(
    df: pd.DataFrame,
    X_norm: np.ndarray,
    cluster_labels: np.ndarray,
) -> list[dict]:
    """
    Temporal and distributional drift.
    Compares early vs. late years, and cluster composition shift.
    """
    from backend.data.gov_aid_schema import (
        APPROVAL_YEAR, COST_OVERRUN_PCT, CPI_SCORE, SUCCESS
    )
    drift_findings = []

    if APPROVAL_YEAR not in df.columns:
        return drift_findings

    years = df[APPROVAL_YEAR].dropna()
    if len(years) < 10:
        return drift_findings

    mid_year = years.median()
    early = df[df[APPROVAL_YEAR] <= mid_year]
    late  = df[df[APPROVAL_YEAR] > mid_year]

    for col, label in [
        (COST_OVERRUN_PCT, "Cost Overrun %"),
        (CPI_SCORE,        "CPI Score"),
        (SUCCESS,          "Project Success Rate"),
    ]:
        if col not in df.columns:
            continue
        e_mean = float(early[col].dropna().mean()) if len(early) > 0 else 0.0
        l_mean = float(late[col].dropna().mean())  if len(late)  > 0 else 0.0
        delta  = l_mean - e_mean

        if abs(delta) < 0.001:
            continue

        direction = "increased" if delta > 0 else "decreased"
        display_e = f"{e_mean*100:.1f}%" if col == COST_OVERRUN_PCT else f"{e_mean:.2f}"
        display_l = f"{l_mean*100:.1f}%" if col == COST_OVERRUN_PCT else f"{l_mean:.2f}"

        drift_findings.append({
            "kind":    "drift",
            "title":   f"{label} drift: {direction} over time",
            "score":   round(abs(delta), 4),
            "sources": [],
            "detail":  (
                f"{label} {direction} from {display_e} "
                f"(pre-{int(mid_year)}) to {display_l} "
                f"(post-{int(mid_year)})."
            ),
            "extra": {
                "feature":     col,
                "early_mean":  round(e_mean, 4),
                "late_mean":   round(l_mean, 4),
                "delta":       round(delta, 4),
                "mid_year":    int(mid_year),
                "direction":   direction,
            },
        })

    drift_findings.sort(key=lambda x: abs(x["extra"]["delta"]), reverse=True)
    return drift_findings


# ── Suspicious flag ────────────────────────────────────────────────────────────

def build_suspicious_findings(
    df: pd.DataFrame,
    combined_scores: np.ndarray,
    record_ids: list[str],
    top_k: int = 20,
) -> list[dict]:
    """Build suspicious findings using rule-based + score combination."""
    from backend.data.gov_aid_schema import (
        COST_OVERRUN_PCT, SUCCESS, CPI_SCORE, BUDGET_UNUSUAL,
        OVERRUN_EXTREME_THRESHOLD, ANOMALY_HIGH_THRESHOLD
    )

    suspicious = []
    for i, pid in enumerate(record_ids):
        if i >= len(df):
            break
        row     = df.iloc[i]
        reasons = []
        score   = float(combined_scores[i]) if i < len(combined_scores) else 0.0

        ovr = row.get(COST_OVERRUN_PCT)
        if isinstance(ovr, float) and not np.isnan(ovr):
            if ovr > OVERRUN_EXTREME_THRESHOLD:
                reasons.append(f"Extreme overrun ({ovr*100:.1f}%)")
            elif ovr > 1.0 and score > 0.5:
                reasons.append(f"High overrun ({ovr*100:.1f}%)")

        suc = row.get(SUCCESS)
        if isinstance(suc, (int, float)) and int(suc) == 0 and score > 0.5:
            reasons.append("Failed project")

        cpi = row.get(CPI_SCORE)
        if isinstance(cpi, float) and not np.isnan(cpi) and cpi < 250:
            reasons.append(f"Low CPI ({cpi:.0f})")

        bu = row.get(BUDGET_UNUSUAL, "")
        if "unusual" in str(bu).lower():
            reasons.append("Unusual budget")

        if not reasons:
            continue

        country = row.get("Recipient_Country", "")
        sector  = row.get("DAC_Mapping", "")

        suspicious.append({
            "kind":    "suspicious",
            "title":   f"{pid} — {country}, {sector}",
            "score":   round(score, 4),
            "sources": [pid],
            "detail":  "; ".join(reasons),
            "extra":   {"reasons": reasons},
        })

    suspicious.sort(key=lambda x: x["score"], reverse=True)
    return suspicious[:top_k]


# ── Main pipeline ─────────────────────────────────────────────────────────────

def run_full_pipeline(
    df: pd.DataFrame,
    tda_feature_cols: list[str],
    lens_name: str = "pca",
    n_intervals: int = 10,
    overlap: float = 0.5,
) -> dict[str, Any]:
    """
    Complete TDA pipeline for Government Aid data.
    Returns a findings dict compatible with the CorteXplorer frontend API contract.
    """
    t0 = time.time()

    from backend.data.gov_aid_schema import (
        ID_COL, COUNTRY_COL, DAC_MAPPING
    )

    # ── Feature matrix ────────────────────────────────────────────────────────
    feat_cols = [c for c in tda_feature_cols if c in df.columns]
    if not feat_cols:
        return {"error": "No TDA feature columns available in DataFrame."}

    X_raw  = df[feat_cols].values.astype(float)
    X_norm = _normalize(X_raw)

    record_ids = df[ID_COL].astype(str).tolist() if ID_COL in df.columns else [str(i) for i in range(len(df))]
    cat_cols   = [c for c in [COUNTRY_COL, DAC_MAPPING] if c in df.columns]

    # ── Lens ─────────────────────────────────────────────────────────────────
    from backend.tda.lenses import get_lens
    lens       = get_lens(lens_name)
    lens_vals  = lens.fit_transform(X_norm)

    # ── Persistent homology ───────────────────────────────────────────────────
    tda_info   = compute_persistent_homology(X_norm)

    # ── Clustering ────────────────────────────────────────────────────────────
    cluster_labels, themes = compute_clusters(X_norm, df, record_ids, cat_cols)

    # ── Anomaly detection ─────────────────────────────────────────────────────
    anomalies, combined_scores = detect_anomalies(
        X_norm, df, record_ids, cluster_labels, feat_cols, cat_cols
    )

    # Attach scores back to records for suspicious engine
    for i, pid in enumerate(record_ids):
        pass  # scores already in anomaly findings

    # ── Suspicious ────────────────────────────────────────────────────────────
    suspicious = build_suspicious_findings(df, combined_scores, record_ids)

    # ── Relationships ─────────────────────────────────────────────────────────
    relationships, graph_nodes, graph_edges = compute_relationships(
        df, record_ids, cluster_labels, X_norm
    )

    # ── Drift ─────────────────────────────────────────────────────────────────
    drift = compute_drift(df, X_norm, cluster_labels)

    # ── Mapper graph ──────────────────────────────────────────────────────────
    mapper = build_mapper_graph(X_norm, lens_vals, n_intervals, overlap,
                                cluster_labels, record_ids)

    # ── Topology findings (H1 loops) ──────────────────────────────────────────
    topology_findings = []
    for lp in tda_info.get("h1_features", []):
        topology_findings.append({
            "kind":    "topology",
            "title":   lp["label"],
            "score":   round(float(lp["persistence"]), 4),
            "sources": lp.get("sources", []),
            "detail":  (
                f"H₁ loop: birth={lp['birth']:.4f}, death={lp['death']:.4f}, "
                f"persistence={lp['persistence']:.4f}."
            ),
            "extra": lp,
        })

    # ── Meta ──────────────────────────────────────────────────────────────────
    n_docs      = len(df)
    n_clusters  = len(set(cluster_labels)) - (1 if -1 in cluster_labels else 0)
    n_noise     = int((cluster_labels == -1).sum())
    elapsed     = round(time.time() - t0, 2)

    meta = {
        "n_docs":           n_docs,
        "n_clusters":       n_clusters,
        "n_noise_docs":     n_noise,
        "n_anomalies":      len(anomalies),
        "n_suspicious":     len(suspicious),
        "n_relationships":  len(relationships),
        "n_drift":          len(drift),
        "n_topology":       len(topology_findings),
        "graph_backend":    "in-memory",
        "torch_available":  False,
        "ripser_available": tda_info["available"],
        "giotto_available": False,
        "neo4j_available":  False,
        "theme_quality":    0.0,
        "n_themes":         n_clusters,
        "tda":              tda_info,
        "numeric_features": feat_cols,
        "category_features": cat_cols,
        "data_type":        "tabular",
        "lens":             lens_name,
        "elapsed_s":        elapsed,
    }

    log.info(
        "Pipeline complete: %d records, %d clusters, %d anomalies, %d rels, %.1fs",
        n_docs, n_clusters, len(anomalies), len(relationships), elapsed
    )

    return {
        "meta":          meta,
        "themes":        themes,
        "anomalies":     anomalies,
        "suspicious":    suspicious,
        "relationships": relationships,
        "drift":         drift,
        "topology":      topology_findings,
        "graph": {
            "nodes":        graph_nodes,
            "edges":        graph_edges,
            "mapper_nodes": mapper["nodes"],
            "mapper_edges": mapper["edges"],
        },
        "documents": [],
        "record_ids": record_ids,
        "lens_values": lens_vals.tolist(),
        "cluster_labels": cluster_labels.tolist(),
        "combined_scores": combined_scores.tolist() if len(combined_scores) else [],
    }
