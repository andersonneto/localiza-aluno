"""Relatórios em PDF (A4 paisagem) no mesmo layout do sistema desktop."""
from __future__ import annotations

import csv
import io
import math
import os
from datetime import datetime
from zoneinfo import ZoneInfo

from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

from .engine import REGRAS, REGRAS_DESC

GREEN = HexColor("#548235")
ROW_A = HexColor("#E2EFDA")
ROW_B = HexColor("#FFF2CC")
FONT, FONT_B = "Helvetica", "Helvetica-Bold"
PAGE_W, PAGE_H = landscape(A4)
MARGIN_X = 24
TOP = 30
BOTTOM = 46
ROW_H = 10.6
HEAD_H = 12
FS = 7
MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
         "agosto", "setembro", "outubro", "novembro", "dezembro"]


def _safe(s: str) -> str:
    """Helvetica (WinAnsi) não tem todos os caracteres; troca os que faltam."""
    s = s or ""
    try:
        s.encode("cp1252")
        return s
    except UnicodeEncodeError:
        import unicodedata
        out = []
        for ch in s:
            try:
                ch.encode("cp1252")
                out.append(ch)
            except UnicodeEncodeError:
                d = unicodedata.normalize("NFKD", ch).encode("ascii", "ignore").decode()
                out.append(d or "?")
        return "".join(out)


def _fit(c: canvas.Canvas, text: str, width: float, font=FONT, size=FS, min_size=5.2) -> tuple[str, float]:
    """Reduz a fonte (até min_size) e, se ainda não couber, corta o texto."""
    text = _safe(text)
    s = size
    while s > min_size and stringWidth(text, font, s) > width:
        s -= 0.2
    if stringWidth(text, font, s) <= width:
        return text, s
    while text and stringWidth(text + "…", font, s) > width:
        text = text[:-1]
    return text.rstrip() + "…", s


def _hoje() -> datetime:
    return datetime.now(ZoneInfo(os.environ.get("TZ_NAME", "America/Belem")))


def _extenso(d: datetime) -> str:
    return f"{d.day} de {MESES[d.month - 1]} de {d.year}"


def build_pdf(*, titulo: list[str], colunas: list[dict], linhas: list[dict], meta: dict,
              rotulo_qtd="alunos", nota: list[str] | None = None, mostrar_exportado=True) -> bytes:
    """colunas: [{h, key, w (peso), align ('l'|'c'), opcional?}]"""
    cols = [c for c in colunas if not c.get("opcional") or any(str(l.get(c["key"], "")).strip() for l in linhas)]
    total_w = PAGE_W - 2 * MARGIN_X
    soma = sum(c["w"] for c in cols)
    xs, x = [], MARGIN_X
    for c in cols:
        w = total_w * c["w"] / soma
        xs.append((x, w))
        x += w

    n = len(linhas)
    cidade = "/".join(p for p in (meta.get("municipio"), meta.get("uf")) if p)
    agora = _hoje()
    rodape_dir = (f"{cidade}, " if cidade else "") + _extenso(agora)

    top_tab = PAGE_H - TOP - 17 * len(titulo) - 6
    area = top_tab - HEAD_H - BOTTOM
    por_pag = max(1, int(area // ROW_H))
    paginas = max(1, math.ceil(n / por_pag))

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(PAGE_W, PAGE_H))
    c.setTitle(titulo[0] if len(titulo) == 1 else titulo[-1])
    c.setAuthor("Localiza Aluno")

    for pg in range(paginas):
        # título
        y = PAGE_H - TOP
        for t in titulo:
            c.setFont(FONT_B, 10.5)
            c.setFillColor(black)
            c.drawCentredString(PAGE_W / 2, y - 8, _safe(t))
            y -= 17
        # cabeçalho da tabela
        yh = top_tab
        c.setFillColor(GREEN)
        c.rect(MARGIN_X, yh - HEAD_H, total_w, HEAD_H, stroke=0, fill=1)
        c.setFillColor(white)
        for col, (x0, w) in zip(cols, xs):
            txt, s = _fit(c, col["h"], w - 4, FONT_B, 6.8)
            c.setFont(FONT_B, s)
            c.drawCentredString(x0 + w / 2, yh - HEAD_H + 3.6, txt)
        # linhas
        ini, fim = pg * por_pag, min(n, (pg + 1) * por_pag)
        for k, i in enumerate(range(ini, fim)):
            row = linhas[i]
            ytop = yh - HEAD_H - k * ROW_H
            c.setFillColor(ROW_A if k % 2 == 0 else ROW_B)
            c.rect(MARGIN_X, ytop - ROW_H, total_w, ROW_H, stroke=0, fill=1)
            c.setFillColor(black)
            for col, (x0, w) in zip(cols, xs):
                val = str(i + 1) if col["key"] == "_n" else str(row.get(col["key"], "") or "")
                txt, s = _fit(c, val, w - 5)
                c.setFont(FONT, s)
                ty = ytop - ROW_H + 3
                if col.get("align") == "c":
                    c.drawCentredString(x0 + w / 2, ty, txt)
                else:
                    c.drawString(x0 + 2.5, ty, txt)
        if n == 0:
            c.setFillColor(black)
            c.setFont(FONT, 9)
            c.drawCentredString(PAGE_W / 2, yh - HEAD_H - 30, "Nenhum registro encontrado.")
        # rodapé
        c.setFillColor(black)
        yb = 24
        for j, linha in enumerate(reversed(nota or [])):
            c.setFont(FONT, 6.3)
            c.drawString(MARGIN_X, yb + 22 + 8 * j, _safe(linha))
        c.setFont(FONT, 7)
        c.drawString(MARGIN_X, yb + 11, f"Quantidade de {rotulo_qtd}: {fim}/{n}")
        c.drawRightString(PAGE_W - MARGIN_X, yb + 11, f"Página: {pg + 1}/{paginas}")
        if mostrar_exportado and meta.get("emitido_em"):
            c.drawString(MARGIN_X, yb, f"Data que o arquivo foi exportado do Sistema Presença: {meta['emitido_em']}")
        c.drawRightString(PAGE_W - MARGIN_X, yb, _safe(rodape_dir))
        c.showPage()
    c.save()
    return buf.getvalue()


# --------------------------------------------------------------------------
# Relatórios específicos
# --------------------------------------------------------------------------

def pdf_nao_localizados(res) -> bytes:
    return build_pdf(
        titulo=["ALUNOS NÃO LOCALIZADOS - SISTEMA PRESENÇA"],
        colunas=[
            {"h": "N.", "key": "_n", "w": 30, "align": "c"},
            {"h": "NIS", "key": "nis", "w": 80, "align": "c"},
            {"h": "NOME DO ALUNO", "key": "nome", "w": 300},
            {"h": "D. NASC", "key": "nasc", "w": 70, "align": "c"},
            {"h": "RESPONSÁVEL", "key": "resp", "w": 314},
        ],
        linhas=res.nao_localizados, meta=res.meta,
    )


def pdf_localizados(res) -> bytes:
    mes = res.meta.get("mes_ref", "")
    d = [f"{k} = {REGRAS_DESC[k]}" for k in REGRAS]
    nota = ["*Metodologia de busca: " + "; ".join(d[:3]) + ";", "; ".join(d[3:]) + "."]
    return build_pdf(
        titulo=[
            "FREQUÊNCIA ESCOLAR DO AUXÍLIO BRASIL - ATUALIZAÇÃO DE ENDEREÇO ESCOLAR - MÊS DE REFERÊNCIA:  " + mes,
            "CRUZAMENTO DE DADOS ENTRE ALUNOS NÃO LOCALIZADOS DO SISTEMA PRESENÇA E MATRÍCULA DO GESTOR ESCOLAR",
        ],
        colunas=[
            {"h": "N.", "key": "_n", "w": 20, "align": "c"},
            {"h": "NIS", "key": "nis", "w": 56, "align": "c"},
            {"h": "NOME DO ALUNO", "key": "nome", "w": 158},
            {"h": "D. NASC", "key": "nasc", "w": 46, "align": "c"},
            {"h": "FILIAÇÃO 1", "key": "f1", "w": 122},
            {"h": "FILIAÇÃO 2", "key": "f2", "w": 122},
            {"h": "TURMA", "key": "turma", "w": 56, "align": "c"},
            {"h": "INEP", "key": "inep_ge", "w": 42, "align": "c"},
            {"h": "ESCOLA", "key": "escola_ge", "w": 142},
            {"h": "BUSCA*", "key": "busca", "w": 30, "align": "c"},
        ],
        linhas=res.localizados, meta=res.meta, nota=nota,
    )


def pdf_pbf(res) -> bytes:
    return build_pdf(
        titulo=["DADOS IMPORTADOS - SISTEMA PRESENÇA (ALUNOS NÃO LOCALIZADOS)"],
        colunas=[
            {"h": "N.", "key": "_n", "w": 28, "align": "c"},
            {"h": "NIS", "key": "nis", "w": 66, "align": "c"},
            {"h": "NOME DO ALUNO", "key": "nome", "w": 190},
            {"h": "D. NASC", "key": "nasc", "w": 50, "align": "c"},
            {"h": "RESPONSÁVEL", "key": "resp", "w": 170},
            {"h": "SITUAÇÃO", "key": "situacao", "w": 150},
            {"h": "SÉRIE", "key": "serie", "w": 130},
            {"h": "INEP", "key": "inep", "w": 50, "align": "c", "opcional": True},
            {"h": "ESCOLA", "key": "escola", "w": 120, "opcional": True},
            {"h": "DEPENDÊNCIA", "key": "dependencia", "w": 70, "opcional": True},
        ],
        linhas=res.pbf, meta=res.meta,
    )


def pdf_ge(res) -> bytes:
    return build_pdf(
        titulo=["ALUNOS COM MATRÍCULA ATIVA - GESTOR ESCOLAR"],
        colunas=[
            {"h": "N.", "key": "_n", "w": 30, "align": "c"},
            {"h": "NOME DO ALUNO", "key": "nome", "w": 200},
            {"h": "D. NASC", "key": "nasc", "w": 52, "align": "c"},
            {"h": "FILIAÇÃO 1", "key": "f1", "w": 140},
            {"h": "FILIAÇÃO 2", "key": "f2", "w": 140},
            {"h": "TURMA", "key": "turma", "w": 56, "align": "c"},
            {"h": "INEP", "key": "inep", "w": 46, "align": "c"},
            {"h": "ESCOLA", "key": "escola", "w": 130},
        ],
        linhas=res.ge, meta=res.meta, rotulo_qtd="registros", mostrar_exportado=False,
    )


# --------------------------------------------------------------------------
# CSV de cada aba
# --------------------------------------------------------------------------

CSV_COLS = {
    "pbf": [("NIS", "nis"), ("Nome do Aluno", "nome"), ("Data de Nascimento", "nasc"),
            ("Nome do Responsável", "resp"), ("Situação", "situacao"), ("INEP", "inep"),
            ("Escola", "escola"), ("Dependência", "dependencia"), ("Série do Estudante", "serie")],
    "ge": [("ALUNOS", "nome"), ("DATA DE NASCIMENTO", "nasc"), ("FILIAÇÃO1", "f1"), ("FILIAÇÃO2", "f2"),
           ("TURMA", "turma"), ("INEP ESCOLA", "inep"), ("ESCOLA", "escola")],
    "localizados": [("NIS", "nis"), ("Nome do Aluno", "nome"), ("Data de Nascimento", "nasc"),
                    ("Nome do Responsável (PBF)", "resp"), ("Filiação 1", "f1"), ("Filiação 2", "f2"),
                    ("Turma", "turma"), ("INEP", "inep_ge"), ("Escola", "escola_ge"), ("Busca", "busca")],
    "nao-localizados": [("NIS", "nis"), ("Nome do Aluno", "nome"), ("Data de Nascimento", "nasc"),
                        ("Nome do Responsável", "resp")],
}


def _csv_safe(v: str) -> str:
    # evita "injeção de fórmula" ao abrir no Excel
    return "'" + v if v and v[0] in "=+-@" else v


def to_csv(tab: str, linhas: list[dict]) -> bytes:
    cols = CSV_COLS[tab]
    out = io.StringIO()
    w = csv.writer(out, delimiter=";", lineterminator="\r\n")
    w.writerow([h for h, _ in cols])
    for r in linhas:
        w.writerow([_csv_safe(str(r.get(k, "") or "")) for _, k in cols])
    return ("﻿" + out.getvalue()).encode("utf-8")
