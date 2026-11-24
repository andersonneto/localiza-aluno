"""Localiza Aluno — API + arquivos estáticos."""
from __future__ import annotations

import base64
import logging
import hmac
import os
import re
import secrets
import threading
import time
from pathlib import Path
from datetime import datetime
from urllib.parse import quote
from zoneinfo import ZoneInfo

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import notify, reports
from .engine import REGRAS_DESC, ArquivoInvalido, Resultado, cruzar, norm_text, parse_ge, parse_pbf

VERSION = "1.1.0"
BASE = Path(__file__).parent
MAX_UPLOAD = int(os.environ.get("MAX_UPLOAD_MB", "40")) * 1024 * 1024
TTL = int(os.environ.get("SESSION_TTL_MIN", "60")) * 60
AUTH_USER = os.environ.get("APP_USER", "")
AUTH_PASS = os.environ.get("APP_PASSWORD", "")

log = logging.getLogger("localiza")
app = FastAPI(title="Localiza Aluno", version=VERSION, docs_url=None, redoc_url=None, openapi_url=None)

# --------------------------------------------------------------------------
# Sessões em memória (nada é gravado em disco; expira sozinho)
# --------------------------------------------------------------------------
_sessions: dict[str, dict] = {}
_lock = threading.Lock()


def _purge():
    now = time.time()
    with _lock:
        for k in [k for k, v in _sessions.items() if now - v["ts"] > TTL]:
            del _sessions[k]


def _get(sid: str) -> dict:
    _purge()
    s = _sessions.get(sid)
    if not s:
        raise HTTPException(404, "Sessão expirada. Importe os arquivos novamente.")
    s["ts"] = time.time()
    return s


# --------------------------------------------------------------------------
# Segurança: Basic Auth opcional + cabeçalhos
# --------------------------------------------------------------------------
@app.middleware("http")
async def seguranca(request: Request, call_next):
    if AUTH_USER and request.url.path != "/api/saude":
        ok = False
        h = request.headers.get("authorization", "")
        if h.lower().startswith("basic "):
            try:
                u, _, p = base64.b64decode(h[6:]).decode().partition(":")
                ok = hmac.compare_digest(u, AUTH_USER) and hmac.compare_digest(p, AUTH_PASS)
            except Exception:
                ok = False
        if not ok:
            return Response("Autenticação necessária", 401, headers={"WWW-Authenticate": 'Basic realm="Localiza Aluno"'})
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "SAMEORIGIN"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self'; object-src 'self'"
    )
    if request.url.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


# --------------------------------------------------------------------------
# Definição das abas
# --------------------------------------------------------------------------
TABS = {
    "pbf": {
        "titulo": "Sistema Presença", "arquivo": "Sistema_Presenca", "req": ("pbf",),
        "cols": [("nis", "NIS"), ("nome", "Nome do Aluno"), ("nasc", "D. Nasc."), ("resp", "Filiação"),
                 ("situacao", "Situação"), ("inep", "INEP"), ("escola", "Escola"),
                 ("dependencia", "Dependência"), ("serie", "Série")],
        "dados": lambda r: r.pbf, "pdf": reports.pdf_pbf,
    },
    "ge": {
        "titulo": "Gestor Escolar", "arquivo": "Gestor_Escolar", "req": ("ge",),
        "cols": [("nome", "Nome do Aluno"), ("nasc", "D. Nasc."), ("f1", "Filiação 1"), ("f2", "Filiação 2"),
                 ("turma", "Turma"), ("inep", "INEP"), ("escola", "Escola")],
        "dados": lambda r: r.ge, "pdf": reports.pdf_ge,
    },
    "localizados": {
        "titulo": "Alunos localizados", "arquivo": "Alunos_Localizados", "req": ("pbf", "ge"),
        "cols": [("nis", "NIS"), ("nome", "Nome do Aluno"), ("nasc", "D. Nasc."), ("f1", "Filiação 1"),
                 ("f2", "Filiação 2"), ("turma", "Turma"), ("inep_ge", "INEP"), ("escola_ge", "Escola"),
                 ("busca", "Pesq.")],
        "dados": lambda r: r.localizados, "pdf": reports.pdf_localizados,
    },
    "nao-localizados": {
        "titulo": "Alunos não localizados", "arquivo": "Alunos_Nao_Localizados", "req": ("pbf", "ge"),
        "cols": [("nis", "NIS"), ("nome", "Nome do Aluno"), ("nasc", "D. Nasc."), ("resp", "Filiação")],
        "dados": lambda r: r.nao_localizados, "pdf": reports.pdf_nao_localizados,
    },
}
NOME_ARQ = {"pbf": "do Sistema Presença", "ge": "do Gestor Escolar"}


class ApiErro(Exception):
    def __init__(self, status: int, msg: str, **extra):
        self.status, self.msg, self.extra = status, msg, extra


@app.exception_handler(ApiErro)
async def api_erro(request: Request, exc: ApiErro):
    return JSONResponse({"erro": exc.msg, **exc.extra}, status_code=exc.status)


def _tab(nome: str) -> dict:
    if nome not in TABS:
        raise HTTPException(404, "Aba desconhecida.")
    return TABS[nome]


def _rows(s: dict, tab: str) -> list[dict]:
    t = _tab(tab)
    falta = [NOME_ARQ[k] for k in t["req"] if not s[k]]
    if falta:
        raise ApiErro(409, "Importe primeiro o arquivo " + " e ".join(falta) + ".")
    return t["dados"](s["res"])


def _montar(s: dict) -> None:
    """(Re)calcula o resultado com o que já foi importado."""
    s["cache"].clear()
    pbf, ge = s["pbf"], s["ge"]
    if pbf and ge:
        res = cruzar(pbf, ge, s["mes_ref"])
    else:
        ref = pbf.extra if pbf else {}
        res = Resultado(pbf=pbf.rows if pbf else [], ge=ge.rows if ge else [], localizados=[], nao_localizados=[],
                        meta={"mes_ref": s["mes_ref"], "emitido_em": ref.get("emitido_em", ""),
                              "uf": ref.get("uf", ""), "municipio": ref.get("municipio", "")})
    res.meta["mes_ref"] = s["mes_ref"]
    s["res"] = res
    for nome, t in TABS.items():  # texto de busca pré-calculado por aba
        if all(s[k] for k in t["req"]):
            keys = [k for k, _ in t["cols"]]
            for row in t["dados"](res):
                row["_s_" + nome] = " ".join(norm_text(str(row.get(k, ""))) for k in keys)


def _estado(sid: str, s: dict) -> dict:
    res = s["res"]

    def info(a):
        return None if not a else {"nome": a.nome, "total": len(a.rows), "lidos": a.lidos, "avisos": a.avisos}

    resumo = None
    if s["pbf"] and s["ge"]:
        total = len(res.pbf)
        resumo = {
            "pbf": total, "ge": len(res.ge),
            "localizados": len(res.localizados), "nao_localizados": len(res.nao_localizados),
            "pct": round(100 * len(res.localizados) / total, 1) if total else 0,
            "por_regra": res.meta["por_regra"], "varias": res.meta["com_varias_matriculas"],
            "mes_ref": s["mes_ref"], "emitido_em": res.meta["emitido_em"],
        }
    return {
        "sid": sid, "mes_ref": s["mes_ref"], "pbf": info(s["pbf"]), "ge": info(s["ge"]), "resumo": resumo,
        "regras": REGRAS_DESC,
        "abas": {k: {"titulo": v["titulo"], "colunas": [{"key": c, "label": l} for c, l in v["cols"]]}
                 for k, v in TABS.items()},
    }


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------
@app.get("/api/saude")
def saude():
    return {"ok": True, "versao": VERSION}


def _valida_mes(mes: str) -> str:
    mes = (mes or "").strip()
    if not re.fullmatch(r"(0[1-9]|1[0-2])/\d{4}", mes):
        raise ApiErro(422, "Informe o mês de referência no formato MM/AAAA (ex.: 11/2026).")
    return mes


def _avisa_admin(request: Request, tipo: str, nome: str, titulo: str, msg: str, detalhe: dict) -> bool:
    linhas = [
        f"Quando: {datetime.now(ZoneInfo(os.environ.get('TZ_NAME', 'America/Belem'))):%d/%m/%Y %H:%M:%S}",
        f"Versão: {VERSION}",
        f"Arquivo {NOME_ARQ.get(tipo, tipo)}: {nome}",
        f"Problema: {msg}",
    ]
    if detalhe.get("linha_cabecalho"):
        linhas.append(f"Linha do cabeçalho: {detalhe['linha_cabecalho']}")
    if detalhe.get("faltando"):
        linhas.append("Colunas obrigatórias não encontradas: " + ", ".join(detalhe["faltando"]))
    if detalhe.get("encontradas"):
        linhas.append("Colunas encontradas no arquivo: " + ", ".join(detalhe["encontradas"]))
    linhas.append(f"Navegador: {request.headers.get('user-agent', '?')}")
    linhas.append("(Nenhum dado de aluno é enviado neste aviso.)")
    return notify.notificar(titulo, linhas, f"{tipo}|{nome}|{msg[:80]}")


@app.post("/api/arquivo/{tipo}")
async def api_arquivo(request: Request, tipo: str, arquivo: UploadFile = File(...),
                      sid: str = Form(""), mes_ref: str = Form("")):
    if tipo not in ("pbf", "ge"):
        raise HTTPException(404)
    nome = arquivo.filename or f"{tipo}.csv"
    if not nome.lower().endswith(".csv"):
        raise ApiErro(422, f"O arquivo '{nome}' não é .csv.")
    mes = _valida_mes(mes_ref)
    raw = await arquivo.read(MAX_UPLOAD + 1)
    if len(raw) > MAX_UPLOAD:
        raise ApiErro(413, f"O arquivo {NOME_ARQ[tipo]} excede {MAX_UPLOAD // 1024 // 1024} MB.")
    try:
        arq = (parse_pbf if tipo == "pbf" else parse_ge)(raw, nome)
    except ArquivoInvalido as e:
        ok = _avisa_admin(request, tipo, nome, f"Falha ao importar arquivo {NOME_ARQ[tipo]}", str(e), e.detalhe)
        raise ApiErro(422, str(e), detalhe=e.detalhe, notificado=ok)
    except Exception as e:  # erro inesperado: registra e avisa
        log.exception("Erro inesperado ao ler %s", nome)
        ok = _avisa_admin(request, tipo, nome, "ERRO INESPERADO na importação",
                          f"{type(e).__name__}: {e}", {})
        raise ApiErro(500, "Erro inesperado ao ler o arquivo.", notificado=ok)

    _purge()
    with _lock:
        s = _sessions.get(sid)
        if not s:
            sid = secrets.token_urlsafe(18)
            s = _sessions[sid] = {"ts": time.time(), "pbf": None, "ge": None, "res": None, "cache": {}, "mes_ref": mes}
        s["ts"] = time.time()
        s[tipo] = arq
        s["mes_ref"] = mes
        _montar(s)
        return _estado(sid, s)


@app.put("/api/sessao/{sid}/mes")
def api_mes(sid: str, mes_ref: str = Form(...)):
    s = _get(sid)
    with _lock:
        s["mes_ref"] = _valida_mes(mes_ref)
        _montar(s)
        return _estado(sid, s)


@app.get("/api/sessao/{sid}/estado")
def api_estado(sid: str):
    return _estado(sid, _get(sid))


@app.get("/api/sessao/{sid}/dados/{tab}")
def api_dados(sid: str, tab: str, page: int = 1, per: int = 50, q: str = ""):
    s = _get(sid)
    rows = _rows(s, tab)
    total = len(rows)
    qn = norm_text(q)
    if qn:
        termos = qn.split()
        chave = "_s_" + tab
        rows = [r for r in rows if all(x in r.get(chave, "") for x in termos)]
    per = min(max(per, 10), 200)
    pages = max(1, -(-len(rows) // per))
    page = min(max(page, 1), pages)
    ini = (page - 1) * per
    out = [{k: v for k, v in r.items() if not k.startswith("_") and k != "nasc_iso"} for r in rows[ini:ini + per]]
    return {"total": total, "filtrado": len(rows), "page": page, "pages": pages, "per": per, "rows": out, "offset": ini}


def _nome_arquivo(tab: str, res, ext: str) -> str:
    mes = res.meta.get("mes_ref", "").replace("/", "-")
    return f"{TABS[tab]['arquivo']}_{mes}.{ext}" if mes else f"{TABS[tab]['arquivo']}.{ext}"


@app.get("/api/sessao/{sid}/relatorio/{tab}.pdf")
def api_pdf(sid: str, tab: str, baixar: int = 0):
    s, t = _get(sid), _tab(tab)
    _rows(s, tab)
    with _lock:
        pdf = s["cache"].get(("pdf", tab))
    if pdf is None:
        pdf = t["pdf"](s["res"])
        with _lock:
            s["cache"][("pdf", tab)] = pdf
    nome = _nome_arquivo(tab, s["res"], "pdf")
    disp = "attachment" if baixar else "inline"
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f"{disp}; filename*=UTF-8''{quote(nome)}"})


@app.get("/api/sessao/{sid}/relatorio/{tab}.csv")
def api_csv(sid: str, tab: str):
    s = _get(sid)
    data = reports.to_csv(tab, _rows(s, tab))
    nome = _nome_arquivo(tab, s["res"], "csv")
    return Response(data, media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(nome)}"})


@app.delete("/api/sessao/{sid}")
def api_apagar(sid: str):
    with _lock:
        _sessions.pop(sid, None)
    return {"ok": True}


# --------------------------------------------------------------------------
# Modelos .csv (dados fictícios)
# --------------------------------------------------------------------------
MODELO_PBF = (
    "Ano/Período;UF;Município;CPF;NIS;Nome do Aluno;Data de Nascimento;Nome do Responsável;NIS Responsável;"
    "Situação;INEP;Escola;Dependência;Série do Estudante;Frequência OUT;Motivo OUT;Frequência NOV;Motivo NOV\r\n"
    "2026(Outubro/Novembro);PA;Município Exemplo;00000000000;10000000001;ALUNO EXEMPLO UM DA SILVA;01/02/2015;"
    "RESPONSAVEL EXEMPLO UM;10000000002;NLOC - Aluno não localizado;;;;4º ano Ensino Fundamental;;;;\r\n"
    "2026(Outubro/Novembro);PA;Município Exemplo;00000000000;10000000003;ALUNA EXEMPLO DOIS SOUZA;15/08/2018;"
    "RESPONSAVEL EXEMPLO DOIS;10000000004;NLOC - Aluno não localizado;;;;Não informada;;;;\r\n"
)
MODELO_GE = (
    "ALUNOS,DATA DE NASCIMENTO,FILIAÇÃO1,FILIAÇÃO2,TURMA,INEP ESCOLA,ESCOLA\r\n"
    "ALUNO EXEMPLO UM DA SILVA,01/02/2015,RESPONSAVEL EXEMPLO UM,PAI EXEMPLO UM,4º A,15000001,E M E F ESCOLA EXEMPLO\r\n"
    "ALUNA EXEMPLO DOIS SOUZA,15/08/2018,RESPONSAVEL EXEMPLO DOIS,,1º B,15000002,E M E I E F OUTRA ESCOLA EXEMPLO\r\n"
)


@app.get("/api/modelo/{tipo}.csv")
def api_modelo(tipo: str):
    if tipo not in ("pbf", "ge"):
        raise HTTPException(404)
    txt = MODELO_PBF if tipo == "pbf" else MODELO_GE
    nome = "modelo_sistema_presenca.csv" if tipo == "pbf" else "modelo_gestor_escolar.csv"
    return Response(("﻿" + txt).encode("utf-8"), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{nome}"'})


@app.exception_handler(HTTPException)
async def http_exc(request: Request, exc: HTTPException):
    return JSONResponse({"erro": exc.detail}, status_code=exc.status_code)


@app.get("/")
def index():
    return FileResponse(BASE / "static" / "index.html", headers={"Cache-Control": "no-cache"})


app.mount("/", StaticFiles(directory=BASE / "static"), name="static")
