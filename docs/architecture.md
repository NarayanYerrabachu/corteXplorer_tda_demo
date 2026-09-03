# CorteXplorer TDA Demo — Architecture

## Overview

CorteXplorer TDA Demo is a Government Aid edition of the CorteXplorer Pattern Intelligence platform.
It applies Topological Data Analysis (TDA) to 25,000+ government aid projects to detect anomalies,
structural patterns, cost overrun clusters, and temporal drift.

```
                    Government Aid Dataset
                           |
                    (Excel / API source)
                           |
                           v
                  ┌──────────────────┐
                  │  Data Adapter    │
                  │  gov_aid_adapter │
                  └────────┬─────────┘
                           │
                    Schema Validation
                           │
                    Data Cleaning
                   (null fill, cast)
                           │
                  Feature Engineering
                  (_log_budget, _cpi_norm,
                   _overrun_class, _risk_composite)
                           │
                    Normalisation
                    (StandardScaler)
                           │
                           v
          ┌────────────────┴────────────────┐
          │                                 │
          v                                 v
    TDA Lenses                     Persistent Homology
    (PCA / UMAP /                  (ripser: β₀, β₁,
    Density / Eccentricity /        max_persistence,
    Feature)                        H1 loops)
          │
          v
     Mapper Graph
     (interval cover +
      local DBSCAN clusters)
          │
          v
    ┌─────────────────────────────────────────┐
    │           CorteXplorer Analysis          │
    ├─────────┬──────────┬──────────┬──────────┤
    │Clusters │Anomalies │Relations │  Drift   │
    │(DBSCAN) │(IsoForest│(country× │(temporal │
    │         │+topo)    │ sector)  │ feature) │
    └────┬────┴────┬─────┴────┬─────┴────┬─────┘
         │         │          │          │
         └─────────┴──────────┴──────────┘
                           │
                           v
                  CorteXplorer API
                  (FastAPI, port 8010)
                           │
           ┌───────────────┼───────────────┐
           v               v               v
       Analysis        Dashboard         Chat
       (index.html)  (dashboard.html) (chat.html)
           │
      ┌────┴────────────────┐
      │                     │
   TDA Explorer         Interrogate
   (lens/param control)  (deep Q&A)
      │
   Audit Trail
   (100% Traceable)
```

## Components

### Backend (`backend/`)

| Module | Purpose |
|--------|---------|
| `main.py` | FastAPI application, all REST endpoints, port 8010 |
| `data/gov_aid_adapter.py` | Load, validate, clean, engineer features |
| `data/gov_aid_schema.py` | Column registry, field constants, GovAidRecord type |
| `tda/engine.py` | Full TDA pipeline: normalise → lens → topology → cluster → anomaly → relationship → drift |
| `tda/lenses/` | PCA, UMAP, Density, Eccentricity, Feature lenses |

### Frontend (`frontend/`)

| File | Purpose |
|------|---------|
| `index.html` | Main CorteXplorer explorer: lenses, findings, graph, audit trail |
| `dashboard.html` | KPI dashboard with charts |
| `chat.html` | Conversational Q&A over TDA results |

### Tests (`tests/`)

| File | Tests |
|------|-------|
| `test_adapter.py` | Schema validation, cleaning, feature engineering, record building |
| `test_tda_engine.py` | Lenses, clustering, anomaly detection, relationships, drift, pipeline |
| `test_api.py` | All API endpoints, audit trail, traceability chain |

## Data Pipeline Detail

### 1. Loading
- Source: `Datenanalyse_Gov_Cleaned_MH.xlsx` / sheet `government_aid_projects_v3`
- 25,003 records × 17 columns
- Fallback: `~/Downloads/Datenanalyse_Gov_Cleaned_MH.xlsx`

### 2. Schema Validation
- Checks required columns exist: `Project_ID`, `Recipient_Country`, `DAC_Mapping`, `Cost_Overran_in %`, `Project_Success`
- Reports null IDs and duplicates as warnings (non-fatal)

### 3. Cleaning
- Synthetic IDs for null `Project_ID`
- Numeric nulls → median imputation
- Categorical nulls → "Unknown"
- Overrun clipped to [-2.0, 20.0] for feature engineering (raw value preserved for display)

### 4. Feature Engineering
| Feature | Formula |
|---------|---------|
| `_log_budget` | `log1p(Initial_Budget_USD.clip(0))` |
| `_overrun_class` | 0=underspend, 1=normal, 2=high, 3=extreme |
| `_cpi_norm` | min-max normalised CPI |
| `_lag_norm` | Evaluation_Lag / p95(lag) clipped 0–1 |
| `_risk_composite` | overrun × (1 - cpi_norm) × (1 - success) |

### 5. TDA
- Normalisation: StandardScaler
- Lens: configurable (default: PCA first component)
- Persistent homology: ripser on PCA(5) sample up to 3,000 points
- Clustering: DBSCAN(eps=0.9, min_samples=5) on PCA(5)
- Anomaly: IsolationForest (60%) + topological distance (40%)
- Mapper: interval cover over lens values + local DBSCAN per interval

## API Endpoints

```
GET  /                          → Main explorer (index.html)
GET  /dashboard                 → Dashboard
GET  /chat                      → Chat interface

GET  /api/health                → Server health
GET  /api/dataset               → Dataset overview
GET  /api/dataset/schema        → Column schema
GET  /api/dataset/statistics    → Summary statistics

GET  /api/records               → Paginated record list (filterable)
GET  /api/record/{id}           → Single record + audit trail

GET  /api/findings              → Full findings (meta+all categories)
GET  /api/anomalies             → Anomaly findings
GET  /api/suspicious            → Suspicious records
GET  /api/clusters              → Cluster themes
GET  /api/cluster/{id}          → Single cluster
GET  /api/relationships         → Relationship findings
GET  /api/drift                 → Drift findings
GET  /api/topology              → TDA topology
GET  /api/tda/cycles            → H1 features (Betti numbers)
GET  /api/tda/graph             → Force graph + mapper graph

POST /api/tda/run               → Re-run TDA with custom params
POST /api/query                 → Keyword search
POST /api/summarize             → Generate summary
POST /api/interrogate           → Deep interrogation
POST /api/chat                  → Conversational Q&A

GET  /api/audit/{id}            → Full audit trail
GET  /api/report                → Text report
GET  /api/report/ai             → AI-enhanced report (requires OPENAI_API_KEY)
```

## Ports
| Service | Port |
|---------|------|
| CorteXplorer TDA Demo (this project) | **8010** |
| CorteXplorer TDA (original Enron)    | 8003 |

## Traceability

Every result is 100% traceable:

```
Source Record (Project_ID)
    ↓ Schema Validation
    ↓ Cleaning (what was imputed)
    ↓ Feature Engineering (what was computed)
    ↓ Normalisation (StandardScaler)
    ↓ Lens (which filter function)
    ↓ Cluster assignment (DBSCAN cluster ID)
    ↓ Anomaly score (IsoForest + topo)
    ↓ Priority classification (rule-based)
    ↓ VERIFIED
```

Access via `GET /api/audit/{record_id}` or click "trace" on any finding card.
