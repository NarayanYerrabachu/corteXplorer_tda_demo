"""
Government Aid data adapter.
Loads data from Excel file (primary), validates schema, normalises,
prepares features for TDA, and provides full record traceability.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pandas as pd

from .gov_aid_schema import (
    GovAidRecord,
    ID_COL, COUNTRY_COL, APPROVAL_DATE, APPROVAL_YEAR, APPROVAL_PHASE,
    DAC_CODE, DAC_MAPPING, BUDGET_INIT, BUDGET_UNUSUAL, BUDGET_FINAL,
    COST_OVERRUN_ABS, COST_OVERRUN_PCT, LOSS, CPI_SCORE, EVAL_LAG, SUCCESS,
    NUMERIC_FEATURES, TDA_FEATURES_DEFAULT, CATEGORICAL_FEATURES, SHEET_NAME,
    ANOMALY_HIGH_THRESHOLD, ANOMALY_MED_THRESHOLD,
    OVERRUN_EXTREME_THRESHOLD, OVERRUN_HIGH_THRESHOLD,
)

log = logging.getLogger(__name__)

_DEFAULT_EXCEL = os.environ.get(
    "GOV_AID_EXCEL_PATH",
    str(Path(__file__).parents[3] / "data" / "Datenanalyse_Gov_Cleaned_MH.xlsx"),
)
_SHEET = os.environ.get("GOV_AID_SHEET", SHEET_NAME)


# ── Loading ────────────────────────────────────────────────────────────────────

def load_dataframe(excel_path: Optional[str] = None, sheet: Optional[str] = None) -> pd.DataFrame:
    """Load raw DataFrame from Excel. Raises FileNotFoundError if missing."""
    path = excel_path or _DEFAULT_EXCEL
    sh   = sheet or _SHEET
    if not Path(path).exists():
        # Try Downloads fallback
        fallback = Path.home() / "Downloads" / "Datenanalyse_Gov_Cleaned_MH.xlsx"
        if fallback.exists():
            path = str(fallback)
        else:
            raise FileNotFoundError(
                f"Government Aid dataset not found at {path}. "
                "Set GOV_AID_EXCEL_PATH in .env or place the file in ~/Downloads/."
            )
    log.info("Loading government aid data from %s [%s]", path, sh)
    df = pd.read_excel(path, sheet_name=sh, engine="openpyxl")
    log.info("Loaded %d rows × %d cols", len(df), len(df.columns))
    return df


# ── Validation ─────────────────────────────────────────────────────────────────

REQUIRED_COLS = [ID_COL, COUNTRY_COL, DAC_MAPPING, COST_OVERRUN_PCT, SUCCESS]

def validate_schema(df: pd.DataFrame) -> list[str]:
    """Return list of validation warnings. Empty = OK."""
    warnings = []
    for col in REQUIRED_COLS:
        if col not in df.columns:
            warnings.append(f"Missing required column: {col}")
    n_null_id = df[ID_COL].isnull().sum() if ID_COL in df.columns else 0
    if n_null_id > 0:
        warnings.append(f"{n_null_id} records have null Project_ID — will be assigned synthetic IDs")
    n_dup = df[ID_COL].duplicated().sum() if ID_COL in df.columns else 0
    if n_dup > 0:
        warnings.append(f"{n_dup} duplicate Project_IDs detected")
    return warnings


# ── Cleaning ───────────────────────────────────────────────────────────────────

def clean_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """Normalise, fill nulls, cast types. Returns clean copy."""
    df = df.copy()

    # Synthesise missing IDs
    if ID_COL in df.columns:
        mask = df[ID_COL].isnull()
        df.loc[mask, ID_COL] = [f"AID-SYNTH-{i}" for i in df.index[mask]]
    df[ID_COL] = df[ID_COL].astype(str).str.strip()

    # Numeric coercions
    for col in [APPROVAL_YEAR, DAC_CODE, BUDGET_INIT, BUDGET_FINAL,
                COST_OVERRUN_ABS, COST_OVERRUN_PCT, CPI_SCORE, EVAL_LAG, SUCCESS]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Fill numeric nulls with median
    for col in [BUDGET_INIT, BUDGET_FINAL, COST_OVERRUN_ABS, COST_OVERRUN_PCT,
                CPI_SCORE, EVAL_LAG]:
        if col in df.columns:
            med = df[col].median()
            df[col] = df[col].fillna(med)

    # Success: if null, default to median
    if SUCCESS in df.columns:
        df[SUCCESS] = df[SUCCESS].fillna(0).astype(int)

    # Categorical fills
    for col in [COUNTRY_COL, DAC_MAPPING, BUDGET_UNUSUAL, APPROVAL_PHASE]:
        if col in df.columns:
            df[col] = df[col].fillna("Unknown").astype(str).str.strip()

    # Clip extreme overrun values for feature engineering (keep raw for display)
    if COST_OVERRUN_PCT in df.columns:
        df["_overrun_clipped"] = df[COST_OVERRUN_PCT].clip(-2.0, 20.0)

    log.info("Cleaned DataFrame: %d rows", len(df))
    return df


# ── Feature engineering ────────────────────────────────────────────────────────

def engineer_features(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """
    Add derived features for TDA.
    Returns (enriched_df, list_of_tda_feature_columns).
    """
    df = df.copy()

    # Budget log scale (handles huge range)
    if BUDGET_INIT in df.columns:
        df["_log_budget"] = np.log1p(df[BUDGET_INIT].clip(0))

    # Overrun severity class (0=under, 1=normal, 2=high, 3=extreme)
    if COST_OVERRUN_PCT in df.columns:
        def _overrun_class(v):
            if v < -0.5:  return 0
            if v < 1.0:   return 1
            if v < 5.0:   return 2
            return 3
        df["_overrun_class"] = df[COST_OVERRUN_PCT].apply(_overrun_class).astype(float)

    # CPI normalised 0-1
    if CPI_SCORE in df.columns:
        cpi_min, cpi_max = df[CPI_SCORE].min(), df[CPI_SCORE].max()
        if cpi_max > cpi_min:
            df["_cpi_norm"] = (df[CPI_SCORE] - cpi_min) / (cpi_max - cpi_min)
        else:
            df["_cpi_norm"] = 0.5

    # Lag normalised
    if EVAL_LAG in df.columns:
        lag_p95 = df[EVAL_LAG].quantile(0.95)
        df["_lag_norm"] = (df[EVAL_LAG] / lag_p95).clip(0, 1)

    # Risk composite: overrun * (1 - CPI_norm) * (1 - success)
    if all(c in df.columns for c in ["_overrun_clipped", "_cpi_norm", SUCCESS]):
        df["_risk_composite"] = (
            df["_overrun_clipped"].clip(0) *
            (1.0 - df["_cpi_norm"]) *
            (1.0 - df[SUCCESS].clip(0, 1))
        )

    # TDA feature columns = preferred + engineered
    tda_cols = []
    for col in [COST_OVERRUN_PCT, CPI_SCORE, EVAL_LAG, SUCCESS, "_log_budget",
                "_overrun_class", "_cpi_norm", "_lag_norm", "_risk_composite"]:
        if col in df.columns:
            tda_cols.append(col)

    return df, tda_cols


# ── Records ────────────────────────────────────────────────────────────────────

def build_records(df: pd.DataFrame) -> list[GovAidRecord]:
    """Convert cleaned DataFrame rows into typed GovAidRecord objects."""
    records = []
    for _, row in df.iterrows():
        def _f(col):
            v = row.get(col)
            if v is None or (isinstance(v, float) and np.isnan(v)):
                return None
            return v

        rec = GovAidRecord(
            project_id       = str(row[ID_COL]),
            country          = str(row.get(COUNTRY_COL, "Unknown")),
            approval_date    = str(_f(APPROVAL_DATE)) if _f(APPROVAL_DATE) else None,
            approval_year    = int(_f(APPROVAL_YEAR)) if _f(APPROVAL_YEAR) is not None else None,
            approval_phase   = str(_f(APPROVAL_PHASE)) if _f(APPROVAL_PHASE) else None,
            dac_code         = _f(DAC_CODE),
            dac_sector       = str(row.get(DAC_MAPPING, "Unknown")),
            initial_budget   = _f(BUDGET_INIT),
            budget_unusual   = str(row.get(BUDGET_UNUSUAL, "usual")),
            final_cost       = _f(BUDGET_FINAL),
            cost_overrun_abs = _f(COST_OVERRUN_ABS),
            cost_overrun_pct = _f(COST_OVERRUN_PCT),
            loss             = _f(LOSS),
            cpi_score        = _f(CPI_SCORE),
            eval_lag_days    = _f(EVAL_LAG),
            success          = int(_f(SUCCESS)) if _f(SUCCESS) is not None else None,
        )
        records.append(rec)
    return records


# ── Suspicious rule engine ─────────────────────────────────────────────────────

def flag_suspicious(records: list[GovAidRecord]) -> list[GovAidRecord]:
    """Apply rule-based suspicious flags to records."""
    for rec in records:
        reasons = []
        ovr = rec.cost_overrun_pct
        if ovr is not None:
            if ovr > OVERRUN_EXTREME_THRESHOLD:
                reasons.append(f"Extreme financial overrun ({ovr*100:.1f}%)")
            elif ovr > OVERRUN_HIGH_THRESHOLD:
                reasons.append(f"High cost overrun ({ovr*100:.1f}%)")
            if ovr < -0.5:
                reasons.append(f"Severe underspend ({ovr*100:.1f}%)")

        if rec.success == 0 and ovr is not None and ovr > 0.5:
            reasons.append("Failed outcome with significant overrun")

        if rec.budget_unusual and "unusual" in rec.budget_unusual.lower():
            reasons.append("Unusual initial budget flagged")

        if rec.cpi_score is not None and rec.cpi_score < 250:
            reasons.append(f"Low governance score (CPI {rec.cpi_score:.0f})")

        if rec.anomaly_score > ANOMALY_HIGH_THRESHOLD:
            reasons.append(f"High ML anomaly score ({rec.anomaly_score:.3f})")

        rec.suspicious_reason = "; ".join(reasons) if reasons else ""

        # Priority
        if rec.anomaly_score >= ANOMALY_HIGH_THRESHOLD or (ovr is not None and ovr > OVERRUN_EXTREME_THRESHOLD):
            rec.priority = "HIGH"
        elif rec.anomaly_score >= ANOMALY_MED_THRESHOLD or (ovr is not None and ovr > OVERRUN_HIGH_THRESHOLD):
            rec.priority = "MEDIUM"
        elif reasons:
            rec.priority = "REVIEW"
        else:
            rec.priority = "NORMAL"

    return records


# ── Full pipeline ──────────────────────────────────────────────────────────────

def load_and_prepare(
    excel_path: Optional[str] = None,
) -> tuple[pd.DataFrame, list[str], list[GovAidRecord], list[str]]:
    """
    Full adapter pipeline.
    Returns:
        df              — clean enriched DataFrame
        tda_feature_cols — feature columns ready for TDA
        records         — typed GovAidRecord list
        warnings        — schema validation warnings
    """
    raw_df = load_dataframe(excel_path)
    warnings = validate_schema(raw_df)
    for w in warnings:
        log.warning("Schema: %s", w)
    df = clean_dataframe(raw_df)
    df, tda_cols = engineer_features(df)
    records = build_records(df)
    log.info("Adapter: %d records, %d TDA features", len(records), len(tda_cols))
    return df, tda_cols, records, warnings


def get_dataset_statistics(df: pd.DataFrame) -> dict:
    """Compute summary statistics about the dataset."""
    stats: dict[str, Any] = {
        "total_records": len(df),
        "countries": df[COUNTRY_COL].nunique() if COUNTRY_COL in df.columns else 0,
        "sectors": df[DAC_MAPPING].nunique() if DAC_MAPPING in df.columns else 0,
        "year_range": None,
        "success_rate": None,
        "avg_overrun_pct": None,
        "avg_cpi": None,
        "avg_eval_lag": None,
        "n_unusual_budget": 0,
        "n_failed": 0,
        "n_overrun": 0,
    }

    if APPROVAL_YEAR in df.columns:
        y = df[APPROVAL_YEAR].dropna()
        if len(y):
            stats["year_range"] = [int(y.min()), int(y.max())]

    if SUCCESS in df.columns:
        stats["success_rate"]  = round(float((df[SUCCESS] == 1).mean() * 100), 1)
        stats["n_failed"]      = int((df[SUCCESS] == 0).sum())

    if COST_OVERRUN_PCT in df.columns:
        stats["avg_overrun_pct"] = round(float(df[COST_OVERRUN_PCT].mean() * 100), 2)
        stats["n_overrun"]       = int((df[COST_OVERRUN_PCT] > 0).sum())

    if CPI_SCORE in df.columns:
        stats["avg_cpi"] = round(float(df[CPI_SCORE].mean()), 1)

    if EVAL_LAG in df.columns:
        stats["avg_eval_lag"] = round(float(df[EVAL_LAG].mean()), 1)

    if BUDGET_UNUSUAL in df.columns:
        stats["n_unusual_budget"] = int((df[BUDGET_UNUSUAL].str.lower() == "unusual").sum())

    return stats
