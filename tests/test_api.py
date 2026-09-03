"""
Tests: FastAPI endpoints — schema, response structure, traceability.
Uses TestClient (no live server required).
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1]))

import pytest
from fastapi.testclient import TestClient

# We need to mock the startup data load to avoid requiring the real Excel file
import unittest.mock as mock
import numpy as np
import pandas as pd

# ── Minimal mock state ─────────────────────────────────────────────────────────

def _make_mock_df(n: int = 50) -> pd.DataFrame:
    np.random.seed(0)
    return pd.DataFrame({
        "Project_ID":        [f"AID-{i:04d}" for i in range(n)],
        "Recipient_Country": np.random.choice(["Kenya", "Germany", "France"], n),
        "Approval_Date":     ["28/04/2010"] * n,
        "Approval_Date_corrected_EU": ["28.04.2010"] * n,
        "Approval Date_Phase": ["April"] * n,
        "Approva_Date_Year": np.random.choice([2010.0, 2015.0, 2020.0], n),
        "DAC_Sector_Code":   [12191.0] * n,
        "DAC_Mapping":       np.random.choice(["Admin", "Infrastructure"], n),
        "Initial_Budget_USD": np.random.lognormal(15, 1, n),
        "Initial_Budget_Unusual": ["usual"] * n,
        "Final_Cost_USD":    np.random.lognormal(15, 1, n),
        "Cost_Overran":      np.random.normal(0, 1e5, n),
        "Cost_Overran_in %": np.random.normal(0.05, 0.3, n),
        "Loss":              [np.nan] * n,
        "CPI_Score":         np.random.uniform(250, 450, n),
        "Evaluation_Lag_Days": np.random.uniform(150, 300, n),
        "Project_Success":   np.random.choice([0.0, 1.0], n),
    })


@pytest.fixture(scope="module")
def client():
    """Build test client with mocked startup data."""
    from backend.data.gov_aid_adapter import clean_dataframe, engineer_features
    from backend.main import app, _state, _build_state

    df_raw   = _make_mock_df()
    df       = clean_dataframe(df_raw)
    df, cols = engineer_features(df)

    state = _build_state(df, cols, lens="pca")
    _state.update(state)

    with TestClient(app) as c:
        yield c


# ── Health ────────────────────────────────────────────────────────────────────

def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["records"] > 0
    assert body["port"]   == 8010


# ── Dataset ───────────────────────────────────────────────────────────────────

def test_dataset_info(client):
    r = client.get("/api/dataset")
    assert r.status_code == 200
    body = r.json()
    assert "total_records"   in body
    assert "countries"       in body
    assert "sectors"         in body


def test_dataset_schema(client):
    r = client.get("/api/dataset/schema")
    assert r.status_code == 200
    body = r.json()
    assert "id_column"          in body
    assert "numeric_features"   in body
    assert "categorical_features" in body
    assert "tda_features_default" in body


def test_dataset_statistics(client):
    r = client.get("/api/dataset/statistics")
    assert r.status_code == 200
    body = r.json()
    assert "total_records" in body
    assert body["total_records"] > 0


# ── Records ───────────────────────────────────────────────────────────────────

def test_get_records(client):
    r = client.get("/api/records?limit=10&offset=0")
    assert r.status_code == 200
    body = r.json()
    assert "records" in body
    assert "total"   in body
    assert len(body["records"]) <= 10


def test_get_records_filter_country(client):
    r = client.get("/api/records?country=Kenya&limit=50")
    assert r.status_code == 200
    body = r.json()
    for rec in body["records"]:
        assert "Kenya" in rec["country"]


def test_get_record_by_id(client):
    r = client.get("/api/records?limit=1")
    first_id = r.json()["records"][0]["project_id"]
    r2 = client.get(f"/api/record/{first_id}")
    assert r2.status_code == 200
    body = r2.json()
    assert "record"      in body
    assert "audit_trail" in body
    assert body["record"]["project_id"] == first_id


def test_get_record_not_found(client):
    r = client.get("/api/record/NONEXISTENT-9999")
    assert r.status_code == 404


# ── Findings ──────────────────────────────────────────────────────────────────

def test_get_findings(client):
    r = client.get("/api/findings")
    assert r.status_code == 200
    body = r.json()
    for key in ["meta", "themes", "anomalies", "suspicious", "relationships", "drift", "topology"]:
        assert key in body


def test_findings_meta_structure(client):
    body = client.get("/api/findings").json()
    meta = body["meta"]
    assert "n_docs"        in meta
    assert "n_clusters"    in meta
    assert "n_anomalies"   in meta
    assert "data_type"     in meta
    assert meta["data_type"] == "tabular"


def test_findings_no_hardcoded_counts(client):
    """Counts in meta must equal actual list lengths."""
    body   = client.get("/api/findings").json()
    meta   = body["meta"]
    assert meta["n_anomalies"]    == len(body["anomalies"])
    assert meta["n_suspicious"]   == len(body["suspicious"])
    assert meta["n_relationships"] == len(body["relationships"])


def test_get_anomalies(client):
    r = client.get("/api/anomalies?limit=10")
    assert r.status_code == 200
    body = r.json()
    assert "anomalies" in body
    for a in body["anomalies"]:
        assert a["kind"]   == "anomaly"
        assert "score"     in a
        assert "sources"   in a
        assert "extra"     in a


def test_get_suspicious(client):
    r = client.get("/api/suspicious")
    assert r.status_code == 200
    body = r.json()
    assert "suspicious" in body


def test_get_clusters(client):
    r = client.get("/api/clusters")
    assert r.status_code == 200
    body = r.json()
    assert "clusters" in body
    for c in body["clusters"]:
        assert c["kind"] == "theme"


def test_get_relationships(client):
    r = client.get("/api/relationships")
    assert r.status_code == 200
    body = r.json()
    assert "relationships" in body


def test_get_drift(client):
    r = client.get("/api/drift")
    assert r.status_code == 200
    assert "drift" in r.json()


def test_get_topology(client):
    r = client.get("/api/topology")
    assert r.status_code == 200
    body = r.json()
    assert "tda"      in body
    assert "topology" in body


def test_get_tda_cycles(client):
    r = client.get("/api/tda/cycles")
    assert r.status_code == 200
    body = r.json()
    assert "betti_0"         in body
    assert "betti_1"         in body
    assert "max_persistence" in body
    assert "h1_features"     in body


def test_get_tda_graph(client):
    r = client.get("/api/tda/graph")
    assert r.status_code == 200
    body = r.json()
    assert "nodes"        in body
    assert "edges"        in body
    assert "mapper_nodes" in body
    assert "mapper_edges" in body


# ── Query ─────────────────────────────────────────────────────────────────────

def test_query(client):
    r = client.post("/api/query", json={"query": "Kenya", "top_k": 5})
    assert r.status_code == 200
    body = r.json()
    assert "results" in body
    assert "records" in body


# ── Summarize ─────────────────────────────────────────────────────────────────

def test_summarize_overview(client):
    r = client.post("/api/summarize", json={"kind": "overview"})
    assert r.status_code == 200
    body = r.json()
    assert "summary" in body
    assert len(body["summary"]) > 20


def test_summarize_record(client):
    first_id = client.get("/api/records?limit=1").json()["records"][0]["project_id"]
    r = client.post("/api/summarize", json={"kind": "record", "id": first_id})
    assert r.status_code == 200
    body = r.json()
    assert "summary" in body
    assert first_id in body["summary"]


# ── Audit trail ───────────────────────────────────────────────────────────────

def test_audit_trail_structure(client):
    first_id = client.get("/api/records?limit=1").json()["records"][0]["project_id"]
    r = client.get(f"/api/audit/{first_id}")
    assert r.status_code == 200
    body = r.json()
    assert "audit_trail"  in body
    steps = [s["step"] for s in body["audit_trail"]]
    assert "Source"          in steps
    assert "Record ID"       in steps
    assert "Preprocessing"   in steps
    assert "Traceability"    in steps


def test_audit_trail_traceability_verified(client):
    first_id = client.get("/api/records?limit=1").json()["records"][0]["project_id"]
    r = client.get(f"/api/audit/{first_id}")
    trail = r.json()["audit_trail"]
    trace_step = next(s for s in trail if s["step"] == "Traceability")
    assert trace_step["value"] == "VERIFIED"


def test_audit_trail_not_found(client):
    r = client.get("/api/audit/NONEXISTENT-9999")
    assert r.status_code == 404


# ── Interrogate ───────────────────────────────────────────────────────────────

def test_interrogate_record(client):
    first_id = client.get("/api/records?limit=1").json()["records"][0]["project_id"]
    r = client.post("/api/interrogate", json={"target": "record", "id": first_id})
    assert r.status_code == 200
    body = r.json()
    assert "explanation" in body
    assert "audit_trail" in body
    assert body["traceable"] is True


def test_interrogate_overview(client):
    r = client.post("/api/interrogate", json={"target": "overview"})
    assert r.status_code == 200
    body = r.json()
    assert "explanation" in body
    assert "meta"        in body


# ── Chat ──────────────────────────────────────────────────────────────────────

def test_chat_anomaly_question(client):
    r = client.post("/api/chat", json={"message": "which records are anomalous?"})
    assert r.status_code == 200
    body = r.json()
    assert "answer"     in body
    assert "traceable"  in body
    assert len(body["answer"]) > 10


def test_chat_overrun_question(client):
    r = client.post("/api/chat", json={"message": "what is the average cost overrun?"})
    assert r.status_code == 200
    body = r.json()
    assert "answer" in body
    assert "overrun" in body["answer"].lower() or "%" in body["answer"]


def test_chat_tda_question(client):
    r = client.post("/api/chat", json={"message": "explain the topology"})
    assert r.status_code == 200
    body = r.json()
    assert "answer" in body
    # Should mention betti or loops or topology
    answer_lower = body["answer"].lower()
    assert any(w in answer_lower for w in ["β₁", "betti", "loop", "topolog", "persistence"])


def test_chat_unknown_question(client):
    r = client.post("/api/chat", json={"message": "xyzzy unknown question"})
    assert r.status_code == 200
    body = r.json()
    assert "answer" in body
    assert len(body["answer"]) > 10


# ── Report ────────────────────────────────────────────────────────────────────

def test_get_report(client):
    r = client.get("/api/report")
    assert r.status_code == 200
    body = r.json()
    assert "report"       in body
    assert "traceable"    in body
    assert "hallucinations" in body
    assert body["hallucinations"] == 0
    assert "GOVERNMENT AID" in body["report"].upper()
    assert "100% TRACEABLE" in body["report"]


# ── End-to-end traceability ───────────────────────────────────────────────────

def test_e2e_traceability_chain(client):
    """
    End-to-end: record → findings → audit → source.
    Ensures every anomaly finding references a traceable record.
    """
    # Get anomalies
    anoms = client.get("/api/anomalies?limit=5").json()["anomalies"]
    if not anoms:
        pytest.skip("No anomalies found in test data")

    for anom in anoms[:3]:
        sources = anom.get("sources", [])
        assert len(sources) > 0, "Anomaly must have at least one source record"
        pid = sources[0]

        # Record must exist
        r = client.get(f"/api/record/{pid}")
        assert r.status_code == 200, f"Record {pid} not found"

        # Audit trail must exist
        ra = client.get(f"/api/audit/{pid}")
        assert ra.status_code == 200, f"Audit trail for {pid} not found"

        trail = ra.json()["audit_trail"]
        trace = next((s for s in trail if s["step"] == "Traceability"), None)
        assert trace is not None, "Traceability step missing from audit trail"
        assert trace["value"] == "VERIFIED"
