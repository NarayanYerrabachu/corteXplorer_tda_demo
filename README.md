# CorteXplorer TDA Demo — Government Aid Edition

> Pattern Intelligence for Government Aid Projects using Topological Data Analysis

**Port: 8010** (separate from the original CorteXplorer TDA on port 8003)

---

## What is CorteXplorer?

CorteXplorer is a Pattern Intelligence platform that applies Topological Data Analysis (TDA) to
complex datasets to find anomalies, clusters, relationships, and structural drift that conventional
statistics miss.

This demo adapts the full CorteXplorer experience to **25,000+ Government Aid projects**, replacing
the Enron email dataset while preserving the complete analysis capability: TDA Explorer, Analysis,
Dashboard, Chat, Interrogate, Audit Trail, Report, and AI Report.

---

## What is TDA?

Topological Data Analysis uses concepts from algebraic topology to study the **shape** of data:

- **Persistent Homology** — tracks topological features (connected components, loops, voids) across
  scales. Features that persist longer are structurally significant.
- **Betti Numbers** — β₀ = number of connected components, β₁ = number of independent loops
- **Mapper Algorithm** — builds a graph summary of high-dimensional data by covering a lens function
  with overlapping intervals and clustering within each interval
- **Lenses** — filter functions (PCA, UMAP, Density, Eccentricity) that reveal different facets of
  the data structure

---

## Government Aid Use Case

### Dataset
- **Source**: `Datenanalyse_Gov_Cleaned_MH.xlsx` / sheet `government_aid_projects_v3`
- **Records**: 25,003 government aid projects
- **Period**: 2005–2024

### Schema

| Column | Type | Description |
|--------|------|-------------|
| `Project_ID` | string | Unique project identifier (AID-XXXXX) |
| `Recipient_Country` | string | Country receiving the aid |
| `Approval_Date` | date | Project approval date |
| `Approva_Date_Year` | int | Approval year |
| `DAC_Sector_Code` | float | OECD DAC sector code |
| `DAC_Mapping` | string | Human-readable sector (Admin, Infrastructure, etc.) |
| `Initial_Budget_USD` | float | Initial planned budget in USD |
| `Initial_Budget_Unusual` | string | "usual" or "unusual" budget flag |
| `Final_Cost_USD` | float | Actual final cost in USD |
| `Cost_Overran` | float | Absolute cost overrun (USD) |
| `Cost_Overran_in %` | float | Relative cost overrun (decimal: 0.5 = 50%) |
| `CPI_Score` | float | Corruption Perception Index score |
| `Evaluation_Lag_Days` | float | Days between approval and evaluation |
| `Project_Success` | int | 1 = succeeded, 0 = failed |

### Feature Engineering

| Feature | Description |
|---------|-------------|
| `_log_budget` | Log-scaled budget (handles wide range) |
| `_overrun_class` | 0=underspend, 1=normal, 2=high, 3=extreme |
| `_cpi_norm` | CPI normalised 0–1 |
| `_lag_norm` | Evaluation lag normalised 0–1 |
| `_risk_composite` | overrun × (1−CPI_norm) × (1−success) |

---

## Architecture

See [docs/architecture.md](docs/architecture.md) for full diagram and component details.

```
Government Aid Excel
        ↓
Schema Validation + Cleaning
        ↓
Feature Engineering
        ↓
StandardScaler Normalisation
        ↓
TDA Lenses (PCA / UMAP / Density / Eccentricity)
        ↓
Persistent Homology (ripser: β₁ loops)
        ↓
Mapper Graph + DBSCAN Clusters
        ↓
Anomaly Detection (IsolationForest + Topo)
        ↓
Relationships (country × sector co-occurrence)
        ↓
Drift (temporal feature shift)
        ↓
CorteXplorer API (FastAPI, port 8010)
        ↓
Explorer / Dashboard / Chat / Reports
```

---

## TDA Workflow

1. **Load** — data adapter loads and validates the Excel dataset
2. **Clean** — null imputation, type coercion
3. **Engineer** — derived features (log budget, risk composite, etc.)
4. **Normalise** — StandardScaler zero-mean unit-variance
5. **Lens** — apply filter function to create 1D projection
6. **Topology** — persistent homology via ripser
7. **Cluster** — DBSCAN on PCA(5) projection
8. **Anomalies** — Isolation Forest + topological distance score
9. **Relationships** — country × sector co-occurrence in overrun projects
10. **Drift** — temporal comparison of feature means
11. **Serve** — FastAPI exposes all results via REST

---

## Lenses

| Lens | Description |
|------|-------------|
| `pca` | First principal component — default |
| `umap` | UMAP 1D projection (requires umap-learn) |
| `density` | Kernel density estimate — highlights sparse/dense regions |
| `eccentricity` | Mean pairwise distance — highlights outliers |
| `feature` | Raw feature column (configurable index) |

---

## Anomaly Detection

Combined score: **60% Isolation Forest + 40% Topological Distance**

- **Isolation Forest**: samples random splits; anomalies require fewer splits to isolate
- **Topological distance**: distance from DBSCAN cluster centroid; noise points score 1.0
- **Combined score**: normalised 0–1; ≥0.60 = HIGH priority, ≥0.40 = MEDIUM

---

## Screens

### Analysis (index.html)
Main CorteXplorer Pattern Intelligence screen.
- **Left rail**: Lenses — Suspicious | Anomalies | Topology | Drift | Relationships | Clusters
- **Center**: Finding cards with score bars, detail, feature chips, trace links
- **Right panel**: Graph | Audit Trail | Summarize tabs
- **TDA Explorer**: feature selection, lens picker, parameter sliders, Re-run TDA
- **Header**: dynamic metrics — Records | Circular Patterns | Hallucinations | Traceable

### Dashboard (dashboard.html)
KPI overview and charts:
- KPI tiles: Total Projects, Success Rate, Avg Overrun, Countries, Sectors, Anomalies
- Charts: yearly trends, sector distribution, country breakdown, CPI vs overrun scatter

### Chat (chat.html)
Conversational Q&A over TDA results.
- Context-grounded answers (no hallucination)
- Suggested questions for quick exploration
- Traceable badge on all assistant responses

---

## Traceability

Every finding is 100% traceable:

```
Project_ID → Schema Validation → Cleaning → Feature Engineering
→ Normalisation → Lens → Cluster → Anomaly Score → Priority → VERIFIED
```

Access: `GET /api/audit/{project_id}` or click **trace** on any finding card.

---

## Installation

```bash
cd /path/to/CorteXplorer_tda_demo

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure
cp .env.example .env
# Edit .env: set GOV_AID_EXCEL_PATH to your Excel file location
```

---

## Configuration (.env)

```bash
GOV_AID_EXCEL_PATH=/path/to/Datenanalyse_Gov_Cleaned_MH.xlsx
GOV_AID_SHEET=government_aid_projects_v3
PORT=8010
HOST=0.0.0.0
OPENAI_API_KEY=          # optional — enables AI report and enhanced chat
TDA_SAMPLE_N=3000        # points sampled for persistent homology
TDA_CONTAMINATION=0.03   # IsolationForest contamination rate
TDA_DBSCAN_EPS=0.9       # DBSCAN epsilon
TDA_DBSCAN_MIN_SAMPLES=5 # DBSCAN min_samples
```

---

## Running Locally

```bash
# Option 1: run script
bash run.sh

# Option 2: direct
source .venv/bin/activate
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8010 --reload
```

Open: **http://localhost:8010**

- Explorer:   http://localhost:8010
- Dashboard:  http://localhost:8010/dashboard
- Chat:       http://localhost:8010/chat
- API Docs:   http://localhost:8010/docs

---

## Testing

```bash
source .venv/bin/activate
pytest tests/ -v
```

Test coverage:
- `test_adapter.py` — data loading, schema validation, cleaning, feature engineering
- `test_tda_engine.py` — lenses, clustering, anomalies, relationships, drift, full pipeline
- `test_api.py` — all API endpoints, audit trail, end-to-end traceability chain

---

## Independent Operation

This project runs **completely independently** of the original CorteXplorer TDA repository.

- No imports from `/Users/narayanyerrabachu/git/CorteXplorer_tda/`
- No dependency on the Enron dataset
- No shared database
- Port 8010 (original uses 8003)

---

## Key Differences from Original

| Aspect | Original (Enron) | This Demo (Gov Aid) |
|--------|-----------------|---------------------|
| Dataset | Enron emails | Government Aid projects |
| Record type | Email document | Aid project |
| Key features | TF-IDF text vectors | Numeric: overrun, CPI, lag, budget |
| Relationships | Email sender/receiver | Country × sector co-occurrence |
| Anomalies | Suspicious emails | Overrun + failed outcome projects |
| Drift | Email volume/tone drift | Temporal feature drift |
| Port | 8003 | **8010** |
| Database | Optional PostgreSQL | None (in-memory) |

---

## Credits

CorteXplorer TDA — Pattern Intelligence Platform  
Government Aid Edition — adapted from the Enron email reference implementation.
