"""
Government Aid dataset schema definition.
Single source of truth for column names, types and feature groupings.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional

SHEET_NAME = "government_aid_projects_v3"

# ── Column registry ────────────────────────────────────────────────────────────

ID_COL           = "Project_ID"
COUNTRY_COL      = "Recipient_Country"
APPROVAL_DATE    = "Approval_Date"
APPROVAL_YEAR    = "Approva_Date_Year"
APPROVAL_PHASE   = "Approval Date_Phase"
DAC_CODE         = "DAC_Sector_Code"
DAC_MAPPING      = "DAC_Mapping"
BUDGET_INIT      = "Initial_Budget_USD"
BUDGET_UNUSUAL   = "Initial_Budget_Unusual"
BUDGET_FINAL     = "Final_Cost_USD"
COST_OVERRUN_ABS = "Cost_Overran"
COST_OVERRUN_PCT = "Cost_Overran_in %"
LOSS             = "Loss"
CPI_SCORE        = "CPI_Score"
EVAL_LAG         = "Evaluation_Lag_Days"
SUCCESS          = "Project_Success"

# All numeric features available for TDA
NUMERIC_FEATURES = [
    BUDGET_INIT,
    BUDGET_FINAL,
    COST_OVERRUN_ABS,
    COST_OVERRUN_PCT,
    CPI_SCORE,
    EVAL_LAG,
    APPROVAL_YEAR,
    SUCCESS,
    DAC_CODE,
]

# Preferred TDA feature subset (most informative)
TDA_FEATURES_DEFAULT = [
    COST_OVERRUN_PCT,
    CPI_SCORE,
    EVAL_LAG,
    SUCCESS,
    BUDGET_INIT,
]

# Categorical features
CATEGORICAL_FEATURES = [
    COUNTRY_COL,
    DAC_MAPPING,
    BUDGET_UNUSUAL,
    APPROVAL_PHASE,
]

# Date features
DATE_FEATURES = [APPROVAL_DATE, "Approval_Date_corrected_EU"]

# Geographic features
GEO_FEATURES = [COUNTRY_COL]

# Priority threshold for anomaly score
ANOMALY_HIGH_THRESHOLD  = 0.60
ANOMALY_MED_THRESHOLD   = 0.40

# Overrun thresholds (as decimal fraction of budget)
OVERRUN_EXTREME_THRESHOLD  = 5.0   # >500 %
OVERRUN_HIGH_THRESHOLD     = 1.0   # >100 %
OVERRUN_LOW_THRESHOLD      = -0.5  # < -50 % (under-spend)


@dataclass
class GovAidRecord:
    """Typed representation of a single government aid project record."""
    project_id:       str
    country:          str
    approval_date:    Optional[str]
    approval_year:    Optional[int]
    approval_phase:   Optional[str]
    dac_code:         Optional[float]
    dac_sector:       Optional[str]
    initial_budget:   Optional[float]
    budget_unusual:   Optional[str]
    final_cost:       Optional[float]
    cost_overrun_abs: Optional[float]
    cost_overrun_pct: Optional[float]   # decimal: 0.5 = 50 %
    loss:             Optional[float]
    cpi_score:        Optional[float]
    eval_lag_days:    Optional[float]
    success:          Optional[int]     # 0 or 1
    # Added during analysis
    anomaly_score:    float = 0.0
    iso_score:        float = 0.0
    ae_score:         Optional[float] = None
    topo_score:       float = 0.0
    cluster_id:       int = -1
    priority:         str = "NORMAL"
    suspicious_reason: str = ""

    @property
    def overrun_pct_display(self) -> str:
        if self.cost_overrun_pct is None:
            return "N/A"
        return f"{self.cost_overrun_pct * 100:.1f}%"

    @property
    def success_label(self) -> str:
        if self.success is None:
            return "N/A"
        return "Yes" if self.success == 1 else "No"

    @property
    def budget_display(self) -> str:
        if self.initial_budget is None:
            return "N/A"
        b = self.initial_budget
        if b >= 1e9:
            return f"${b/1e9:.2f}B"
        if b >= 1e6:
            return f"${b/1e6:.1f}M"
        return f"${b:,.0f}"

    def to_dict(self) -> dict:
        return {
            "project_id":        self.project_id,
            "country":           self.country,
            "approval_date":     self.approval_date,
            "approval_year":     self.approval_year,
            "approval_phase":    self.approval_phase,
            "dac_code":          self.dac_code,
            "dac_sector":        self.dac_sector,
            "initial_budget":    self.initial_budget,
            "budget_unusual":    self.budget_unusual,
            "final_cost":        self.final_cost,
            "cost_overrun_abs":  self.cost_overrun_abs,
            "cost_overrun_pct":  self.cost_overrun_pct,
            "loss":              self.loss,
            "cpi_score":         self.cpi_score,
            "eval_lag_days":     self.eval_lag_days,
            "success":           self.success,
            "anomaly_score":     self.anomaly_score,
            "iso_score":         self.iso_score,
            "ae_score":          self.ae_score,
            "topo_score":        self.topo_score,
            "cluster_id":        self.cluster_id,
            "priority":          self.priority,
            "suspicious_reason": self.suspicious_reason,
            # display helpers
            "overrun_pct_display": self.overrun_pct_display,
            "success_label":       self.success_label,
            "budget_display":      self.budget_display,
        }
