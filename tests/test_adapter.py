"""
Tests: Government Aid data adapter — schema validation, cleaning, feature engineering.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1]))

import numpy as np
import pandas as pd
import pytest

from backend.data.gov_aid_schema import (
    ID_COL, COUNTRY_COL, DAC_MAPPING, COST_OVERRUN_PCT,
    SUCCESS, CPI_SCORE, EVAL_LAG, BUDGET_INIT,
)
from backend.data.gov_aid_adapter import (
    validate_schema, clean_dataframe, engineer_features,
    build_records, flag_suspicious, get_dataset_statistics,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def sample_df():
    """Minimal valid Government Aid DataFrame."""
    return pd.DataFrame({
        "Project_ID":        ["AID-001", "AID-002", "AID-003", "AID-004", "AID-005"],
        "Recipient_Country": ["Kenya", "Germany", "France", "Colombia", "India"],
        "Approval_Date":     ["28/04/2005", "12/19/2010", "01/01/2015", "05/06/2018", "30/11/2020"],
        "Approval_Date_corrected_EU": ["28.04.2005", "19.12.2010", "01.01.2015", "05.06.2018", "30.11.2020"],
        "Approval Date_Phase": ["April", "December", "January", "June", "November"],
        "Approva_Date_Year": [2005.0, 2010.0, 2015.0, 2018.0, 2020.0],
        "DAC_Sector_Code":   [12191.0, 15123.0, 12230.0, 12220.0, 15122.0],
        "DAC_Mapping":       ["Medical Services", "Admin", "Infrastructure", "Health", "Education"],
        "Initial_Budget_USD": [1e7, 5e8, 2e6, 3e9, 1e8],
        "Initial_Budget_Unusual": ["usual", "unusual", "usual", "usual", "usual"],
        "Final_Cost_USD":    [9e6, 6e8, 5e6, 2e9, 1.2e8],
        "Cost_Overran":      [-1e6, 1e8, 3e6, -1e9, 2e7],
        "Cost_Overran_in %": [-0.1, 0.2, 1.5, -0.33, 0.2],
        "Loss":              [np.nan] * 5,
        "CPI_Score":         [320.0, 500.0, 470.0, 280.0, 380.0],
        "Evaluation_Lag_Days": [220.0, 180.0, 250.0, 300.0, 200.0],
        "Project_Success":   [1.0, 1.0, 0.0, 0.0, 1.0],
    })


@pytest.fixture
def dirty_df(sample_df):
    """DataFrame with some nulls and type issues."""
    df = sample_df.copy()
    df.loc[0, "Project_ID"]    = None
    df.loc[1, "CPI_Score"]     = np.nan
    df.loc[2, "Cost_Overran_in %"] = np.nan
    df.loc[3, "Project_Success"]   = np.nan
    return df


# ── Schema validation ─────────────────────────────────────────────────────────

def test_validate_schema_pass(sample_df):
    warnings = validate_schema(sample_df)
    assert isinstance(warnings, list)
    # No required column errors
    col_errors = [w for w in warnings if "Missing required" in w]
    assert len(col_errors) == 0


def test_validate_schema_missing_column(sample_df):
    df = sample_df.drop(columns=["Cost_Overran_in %"])
    warnings = validate_schema(df)
    assert any("Cost_Overran_in %" in w for w in warnings)


def test_validate_schema_null_id(dirty_df):
    warnings = validate_schema(dirty_df)
    assert any("null Project_ID" in w for w in warnings)


# ── Cleaning ──────────────────────────────────────────────────────────────────

def test_clean_fills_null_id(dirty_df):
    df = clean_dataframe(dirty_df)
    assert df["Project_ID"].isnull().sum() == 0
    assert "AID-SYNTH" in df["Project_ID"].iloc[0]


def test_clean_fills_numeric_nulls(dirty_df):
    df = clean_dataframe(dirty_df)
    assert df["CPI_Score"].isnull().sum() == 0
    assert df["Cost_Overran_in %"].isnull().sum() == 0


def test_clean_fills_success_null(dirty_df):
    df = clean_dataframe(dirty_df)
    assert df["Project_Success"].isnull().sum() == 0
    assert df["Project_Success"].dtype in [int, float, "int64", "float64"]


def test_clean_categorical_fills(sample_df):
    df = sample_df.copy()
    df.loc[0, "DAC_Mapping"] = np.nan
    cleaned = clean_dataframe(df)
    assert cleaned["DAC_Mapping"].iloc[0] == "Unknown"


def test_clean_adds_overrun_clipped(sample_df):
    df = clean_dataframe(sample_df)
    assert "_overrun_clipped" in df.columns
    assert df["_overrun_clipped"].max() <= 20.0


# ── Feature engineering ────────────────────────────────────────────────────────

def test_engineer_features_adds_log_budget(sample_df):
    df = clean_dataframe(sample_df)
    df2, cols = engineer_features(df)
    assert "_log_budget" in df2.columns
    assert "_overrun_class" in df2.columns
    assert "_cpi_norm" in df2.columns
    assert "_lag_norm" in df2.columns
    assert "_risk_composite" in df2.columns


def test_engineer_features_returns_tda_cols(sample_df):
    df = clean_dataframe(sample_df)
    _, cols = engineer_features(df)
    assert len(cols) >= 3
    # Must include at least core features
    assert any("overrun" in c.lower() or "cpi" in c.lower() for c in cols)


def test_cpi_norm_range(sample_df):
    df = clean_dataframe(sample_df)
    df2, _ = engineer_features(df)
    assert df2["_cpi_norm"].min() >= 0.0
    assert df2["_cpi_norm"].max() <= 1.0


def test_lag_norm_range(sample_df):
    df = clean_dataframe(sample_df)
    df2, _ = engineer_features(df)
    assert df2["_lag_norm"].min() >= 0.0
    assert df2["_lag_norm"].max() <= 1.0


def test_overrun_class_values(sample_df):
    df = clean_dataframe(sample_df)
    df2, _ = engineer_features(df)
    valid = {0.0, 1.0, 2.0, 3.0}
    assert set(df2["_overrun_class"].unique()).issubset(valid)


# ── Records ────────────────────────────────────────────────────────────────────

def test_build_records_count(sample_df):
    df = clean_dataframe(sample_df)
    df, _ = engineer_features(df)
    records = build_records(df)
    assert len(records) == len(sample_df)


def test_build_records_fields(sample_df):
    df = clean_dataframe(sample_df)
    df, _ = engineer_features(df)
    records = build_records(df)
    r = records[0]
    assert r.project_id == "AID-001"
    assert r.country    == "Kenya"
    assert r.dac_sector == "Medical Services"
    assert r.cpi_score  == pytest.approx(320.0)


def test_record_display_methods(sample_df):
    df = clean_dataframe(sample_df)
    df, _ = engineer_features(df)
    records = build_records(df)
    for r in records:
        assert r.overrun_pct_display != ""
        assert r.success_label in ("Yes", "No", "N/A")
        assert r.budget_display != ""


def test_record_to_dict(sample_df):
    df = clean_dataframe(sample_df)
    df, _ = engineer_features(df)
    records = build_records(df)
    d = records[0].to_dict()
    assert "project_id"        in d
    assert "anomaly_score"     in d
    assert "overrun_pct_display" in d
    assert "budget_display"    in d


# ── Suspicious flagging ───────────────────────────────────────────────────────

def test_flag_suspicious_extreme_overrun(sample_df):
    df = clean_dataframe(sample_df)
    df, _ = engineer_features(df)
    records = build_records(df)
    # Make one record have extreme overrun
    records[2].cost_overrun_pct = 6.0
    records[2].anomaly_score    = 0.0
    flagged = flag_suspicious(records)
    r = flagged[2]
    assert "overrun" in r.suspicious_reason.lower() or r.priority in ("HIGH", "MEDIUM", "REVIEW")


def test_flag_suspicious_unusual_budget(sample_df):
    df = clean_dataframe(sample_df)
    df, _ = engineer_features(df)
    records = build_records(df)
    records[1].budget_unusual = "unusual"
    records[1].anomaly_score  = 0.0
    flagged = flag_suspicious(records)
    assert "unusual" in flagged[1].suspicious_reason.lower()


def test_flag_suspicious_low_cpi(sample_df):
    df = clean_dataframe(sample_df)
    df, _ = engineer_features(df)
    records = build_records(df)
    records[3].cpi_score = 150.0
    records[3].anomaly_score = 0.0
    flagged = flag_suspicious(records)
    assert "CPI" in flagged[3].suspicious_reason or "cpi" in flagged[3].suspicious_reason.lower()


def test_flag_normal_record_no_suspicious(sample_df):
    df = clean_dataframe(sample_df)
    df, _ = engineer_features(df)
    records = build_records(df)
    # Normal record: low overrun, high CPI, succeeded
    records[0].cost_overrun_pct = 0.05
    records[0].success          = 1
    records[0].cpi_score        = 480.0
    records[0].anomaly_score    = 0.05
    records[0].budget_unusual   = "usual"
    flagged = flag_suspicious(records)
    assert flagged[0].priority in ("NORMAL", "REVIEW")


# ── Statistics ────────────────────────────────────────────────────────────────

def test_get_statistics_keys(sample_df):
    df = clean_dataframe(sample_df)
    stats = get_dataset_statistics(df)
    expected = [
        "total_records", "countries", "sectors",
        "success_rate", "avg_overrun_pct", "avg_cpi",
    ]
    for k in expected:
        assert k in stats


def test_get_statistics_values(sample_df):
    df = clean_dataframe(sample_df)
    stats = get_dataset_statistics(df)
    assert stats["total_records"] == 5
    assert stats["countries"]     == 5
    assert stats["sectors"]       == 5
    assert 0 <= stats["success_rate"] <= 100
