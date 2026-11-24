# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Localiza Aluno cross-references students flagged "não localizado" (NLOC) in the federal **Sistema Presença / PBF** export with active enrollments in the municipal **Gestor Escolar (GE)** export. It shows which school and class each one is enrolled in. The UI, messages, identifiers and comments are all in Brazilian Portuguese; keep new code and user-facing text in Portuguese.

# Diretrizes de Idioma e Comunicação

- **Idioma padrão:** Responda sempre em **português do Brasil (pt-BR)**, independentemente do idioma da pergunta ou do código analisado.
- **Explicações e planos:** Escreva todo o raciocínio, resumos de alterações, perguntas de confirmação e mensagens de status em português do Brasil.
- **Código e comentários:** Mantenha nomes de variáveis, classes, métodos e sintaxe no idioma padrão do projeto, mas redija todos os **comentários de código**, documentações (Javadoc/docstrings) e mensagens de commit em português do Brasil.
- **Termos técnicos:** Preserve termos técnicos consolidados da engenharia de software em inglês (ex: *commit*, *build*, *deploy*, *branch*, *merge*, *refactor*) quando forem mais naturais no contexto de desenvolvimento.

## Commands

A local virtualenv exists at `.venv` (Windows layout: `.venv\Scripts\`).

```bash
pip install -r requirements.txt pytest
pytest                                   # all tests
pytest tests/test_engine.py::test_avisos_com_numero_da_linha   # single test
uvicorn app.main:app --reload --port 8000                       # dev server (http://localhost:8000)
docker compose up -d --build                                    # production-like, http://localhost:8080
```

There is no linter or formatter configured.

`test_dados_reais_se_existirem` runs only when `samples/pbf.csv` and `samples/ge.csv` exist (real data, expected 36 found / 626 not found). Otherwise it skips. Those files hold children's personal data, so never commit them or copy their contents anywhere.

## Architecture

**Served app = FastAPI backend + `app/static/` frontend.** All parsing, matching and report generation runs server-side in Python.
- `app/main.py`: HTTP API, in-memory sessions, optional Basic Auth middleware, security headers. The `TABS` dict is the single definition of the four result tabs (`pbf`, `ge`, `localizados`, `nao-localizados`). It sets each tab's columns, its data source on `Resultado`, which uploads it requires, and its PDF builder. Add or change a tab or column there.
- `app/engine.py`: CSV reading and the matching algorithm (pure functions, the part the tests cover).
- `app/reports.py`: PDF builder (ReportLab) and CSV export (with formula-injection escaping in `_csv_safe`).
- `app/notify.py`: SMTP alerts to the admin when an import fails. Dedup is 10 min per key and the cap is 20/hour. Alerts must carry only technical details (file name, columns, line numbers), never student data.
- `app/static/{index.html,app.js,style.css}`: vanilla-JS UI that calls `/api/...`.

**Legacy, not served:** `app/index.html`, `app/js/` (`matching.js`, `reports.js`, `app.js`), `app/css/` and `app/vendor/` (PapaParse, jsPDF) are an older fully client-side version. `main.py` mounts only `app/static`. Don't edit these thinking you are changing the running app.

### Data flow
1. Each file is uploaded on its own to `POST /api/arquivo/{pbf|ge}` along with `mes_ref` (MM/AAAA) and the current `sid`. A new session is created when no `sid` is sent.
2. `parse_pbf` / `parse_ge` → `read_table` detects the encoding and delimiter, then finds the header row. PBF exports have title rows above the header, which are skipped. Columns are mapped **by name**: headers are normalized (no accents, uppercase, only alphanumerics) and looked up in `PBF_COLS` / `GE_COLS` alias sets. Column order is free and extra columns are ignored. Missing required columns raise `ArquivoInvalido`, whose `detalhe` holds `linha_cabecalho`, `faltando` and `encontradas`. Per-row problems such as invalid dates become `avisos` that cite line numbers.
3. `_montar` re-runs `cruzar` whenever either file or the month changes, clears the per-session PDF cache, and precomputes a normalized `_s_<tab>` search string on each row. `/dados/{tab}` uses that string for paginated search.
4. Sessions live in the module-level `_sessions` dict under a lock and expire after `SESSION_TTL_MIN`. Nothing is written to disk, by design (privacy requirement). **This is why the container runs with `--workers 1`**: multiple workers would not share sessions.

### Matching rules (`engine.cruzar`)
`cruzar` builds an index over the GE rows keyed by rule. For each PBF row it collects every hit, then picks the best one by rule priority `NF1 > NF2 > ND > F1D > F2D`, breaking ties by GE file order. Any other matching enrollments go into `outras`.
- The PBF **responsável** name is compared against GE Filiação 1 and 2.
- Names are normalized with `norm_text`, which drops accents, uppercases and collapses spaces.
- `resp_key` blanks out generic guardian names such as "PAI NÃO DECLARADO", "NÃO INFORMADO" or "IGNORADO" (`_GENERIC_RESP`). These must never count as a match key.
- Dates are compared as ISO strings (`nasc_iso`).

## Configuration (env vars)

| Variable | Purpose |
|---|---|
| `APP_USER`, `APP_PASSWORD` | Enable Basic Auth; `/api/saude` stays open for the Docker healthcheck |
| `SESSION_TTL_MIN` | Session lifetime in minutes |
| `MAX_UPLOAD_MB` | Upload size limit in MB |
| `TZ_NAME` | Time zone (default `America/Belem`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY` (`starttls`/`ssl`/`none`), `SMTP_USER`, `SMTP_PASSWORD`, `ADMIN_EMAIL` | Admin email alerts on import failures |

Bump `VERSION` in `app/main.py` when releasing; the UI shows it via `/api/saude`.
