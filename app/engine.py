"""Leitura dos CSVs (por nome de coluna) e cruzamento PBF x Gestor Escolar."""
from __future__ import annotations

import csv
import io
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date

# --------------------------------------------------------------------------
# Normalização
# --------------------------------------------------------------------------


def norm_text(value: str | None) -> str:
    """MAIÚSCULAS, sem acentos, sem pontuação, espaços colapsados."""
    s = unicodedata.normalize("NFD", value or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^A-Za-z0-9]+", " ", s)
    return s.strip().upper()


def norm_header(value: str | None) -> str:
    return norm_text(value).replace(" ", "")


_DATE_RE = re.compile(r"^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})")
_ISO_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")


def parse_date(value: str | None) -> str:
    """Devolve a data em ISO (AAAA-MM-DD) para comparar; '' se vazia/ilegível."""
    s = (value or "").strip()
    if not s:
        return ""
    m = _ISO_RE.match(s)
    if m:
        y, mo, d = map(int, m.groups())
    else:
        m = _DATE_RE.match(s)
        if not m:
            return ""
        d, mo, y = map(int, m.groups())
        if y < 100:
            y += 2000 if y <= (date.today().year % 100) else 1900
    try:
        return date(y, mo, d).isoformat()
    except ValueError:
        return ""


def fmt_date(iso: str, raw: str = "") -> str:
    if iso:
        y, m, d = iso.split("-")
        return f"{d}/{m}/{y}"
    return (raw or "").strip()


# Responsáveis que não identificam ninguém: nunca servem de chave de busca.
_GENERIC_RESP = re.compile(
    r"^(PAI |MAE )?(NAO (DECLARAD[OA]|INFORMAD[OA]|CONSTA)|SEM (INFORMACAO|DECLARACAO)|IGNORAD[OA]|DESCONHECID[OA])\b"
)


def resp_key(value: str | None) -> str:
    k = norm_text(value)
    if not k or _GENERIC_RESP.match(k):
        return ""
    return k


# --------------------------------------------------------------------------
# Leitura por nome de coluna
# --------------------------------------------------------------------------

# chave interna -> nomes aceitos (já normalizados por norm_header)
PBF_COLS = {
    "nis": {"NIS", "NISALUNO", "NISDOALUNO"},
    "nome": {"NOMEDOALUNO", "ALUNO", "ALUNOS", "NOME", "ESTUDANTE", "NOMEDOESTUDANTE"},
    "nasc": {"DATADENASCIMENTO", "DATANASCIMENTO", "DTNASCIMENTO", "NASCIMENTO", "DATANASC"},
    "resp": {"NOMEDORESPONSAVEL", "RESPONSAVEL", "NOMERESPONSAVEL"},
    "situacao": {"SITUACAO"},
    "uf": {"UF"},
    "municipio": {"MUNICIPIO"},
    "cpf": {"CPF"},
    "nis_resp": {"NISRESPONSAVEL", "NISDORESPONSAVEL"},
    "inep": {"INEP", "INEPESCOLA", "CODIGOINEP"},
    "escola": {"ESCOLA", "NOMEDAESCOLA"},
    "dependencia": {"DEPENDENCIA"},
    "serie": {"SERIEDOESTUDANTE", "SERIE"},
}
PBF_REQUIRED = ["nis", "nome", "nasc", "resp"]

GE_COLS = {
    "nome": {"ALUNOS", "ALUNO", "NOMEDOALUNO", "NOME", "ESTUDANTE"},
    "nasc": {"DATADENASCIMENTO", "DATANASCIMENTO", "DTNASCIMENTO", "NASCIMENTO", "DATANASC"},
    "f1": {"FILIACAO1", "FILIACAO01", "FILIACAOUM"},
    "f2": {"FILIACAO2", "FILIACAO02", "FILIACAODOIS"},
    "turma": {"TURMA"},
    "inep": {"INEPESCOLA", "INEP", "CODIGOINEP"},
    "escola": {"ESCOLA", "NOMEDAESCOLA"},
}
GE_REQUIRED = ["nome", "nasc", "f1"]

LABELS = {
    "nis": "NIS",
    "nome": "Nome do Aluno",
    "nasc": "Data de Nascimento",
    "resp": "Nome do Responsável",
    "situacao": "Situação",
    "f1": "FILIAÇÃO1",
    "f2": "FILIAÇÃO2",
    "turma": "TURMA",
    "inep": "INEP ESCOLA",
    "escola": "ESCOLA",
}


class ArquivoInvalido(ValueError):
    """Erro de leitura do arquivo. `detalhe` leva informações técnicas (sem dados de alunos)."""

    def __init__(self, msg: str, detalhe: dict | None = None):
        super().__init__(msg)
        self.detalhe = detalhe or {}


@dataclass
class Arquivo:
    tipo: str  # "pbf" | "ge"
    nome: str
    rows: list[dict]
    mapa: dict[str, int]
    avisos: list[str]
    lidos: int = 0
    extra: dict = field(default_factory=dict)
    ordem: list[dict] | None = None  # ordem original do arquivo (GE)


def decode_bytes(raw: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _map_header(row: list[str], spec: dict[str, set[str]]) -> dict[str, int]:
    found: dict[str, int] = {}
    for i, cell in enumerate(row):
        h = norm_header(cell)
        if not h:
            continue
        for key, names in spec.items():
            if h in names and key not in found:
                found[key] = i
    return found


def _linhas_txt(linhas: list[int], limite: int = 8) -> str:
    if len(linhas) <= limite:
        return ", ".join(map(str, linhas))
    return ", ".join(map(str, linhas[:limite])) + f" e mais {len(linhas) - limite}"


def _cols_txt(cells: list[str], limite: int = 14) -> str:
    c = [x.strip() for x in cells if x.strip()]
    return ", ".join(f"“{x}”" for x in c[:limite]) + (" …" if len(c) > limite else "")


def read_table(raw: bytes, spec: dict[str, set[str]], required: list[str], nome: str):
    """Acha a linha de cabeçalho (ignora títulos do relatório) e devolve
    (linhas como dict com '_linha', mapa de colunas, preâmbulo, nº da linha do cabeçalho)."""
    if raw[:2] == b"PK" or raw[:4] == b"\xd0\xcf\x11\xe0":
        raise ArquivoInvalido(
            f"O arquivo '{nome}' parece ser uma planilha do Excel, não um .csv. Salve/exporte como CSV e envie novamente.",
            {"arquivo": nome, "motivo": "formato_excel"})
    text = decode_bytes(raw)
    if not text.strip():
        raise ArquivoInvalido(f"O arquivo '{nome}' está vazio.", {"arquivo": nome, "motivo": "vazio"})
    melhor = None  # (qtde faltando, linha, faltando, células)
    for delim in (";", ",", "\t", "|"):
        rows = list(csv.reader(io.StringIO(text), delimiter=delim))
        for hi, row in enumerate(rows[:60]):
            mapping = _map_header(row, spec)
            missing = [k for k in required if k not in mapping]
            if not missing:
                data = []
                for n, r in enumerate(rows[hi + 1:], start=hi + 2):
                    if not any((c or "").strip() for c in r):
                        continue
                    d = {k: (r[i].strip() if i < len(r) else "") for k, i in mapping.items()}
                    d["_linha"] = n
                    data.append(d)
                pre = "\n".join(" ".join(r) for r in rows[:hi])
                return data, mapping, pre, hi + 1
            if len(mapping) >= 2 and (melhor is None or len(missing) < melhor[0]):
                melhor = (len(missing), hi + 1, missing, row)
    if melhor:
        _, linha, faltando, cells = melhor
        nomes = ", ".join(f"“{LABELS.get(k, k)}”" for k in faltando)
        raise ArquivoInvalido(
            f"Arquivo '{nome}', cabeçalho na linha {linha}: não encontrei a(s) coluna(s) {nomes}. "
            f"Colunas encontradas: {_cols_txt(cells)}. Confira se enviou o arquivo certo ou baixe o modelo .csv.",
            {"arquivo": nome, "linha_cabecalho": linha, "faltando": [LABELS.get(k, k) for k in faltando],
             "encontradas": [c.strip() for c in cells if c.strip()][:40]})
    primeira = next(csv.reader(io.StringIO(text), delimiter=";"), [])
    raise ArquivoInvalido(
        f"Não consegui identificar o cabeçalho do arquivo '{nome}' (linha 1: {_cols_txt(primeira) or 'em branco'}). "
        "Confira se é um .csv e baixe o modelo para comparar.",
        {"arquivo": nome, "motivo": "sem_cabecalho"})


# --------------------------------------------------------------------------
# Leitura de cada arquivo
# --------------------------------------------------------------------------

def _sort_key(r: dict):
    return (norm_text(r.get("nome")), r.get("nasc_iso") or "", r.get("nis", ""))


def _prepara_datas(data: list[dict], avisos: list[str], rotulo: str):
    sem_nome, data_inv, rows = [], [], []
    for r in data:
        if not r.get("nome"):
            sem_nome.append(r["_linha"])
            continue
        iso = parse_date(r.get("nasc"))
        if not iso:
            data_inv.append(r["_linha"])
        r["nasc_iso"] = iso
        r["nasc"] = fmt_date(iso, r.get("nasc", ""))
        rows.append(r)
    if sem_nome:
        avisos.append(f"Linha(s) {_linhas_txt(sem_nome)}: sem nome do aluno — ignorada(s).")
    if data_inv:
        avisos.append(
            f"Linha(s) {_linhas_txt(data_inv)}: data de nascimento vazia ou inválida — "
            "esses alunos só podem ser localizados por regras que não usam a data.")
    return rows


def parse_pbf(raw: bytes, nome: str = "PBF.csv") -> Arquivo:
    data, mapa, pre, hl = read_table(raw, PBF_COLS, PBF_REQUIRED, nome)
    avisos: list[str] = []
    m = re.search(r"emitido em (\d{2}/\d{2}/\d{4})(?:\s+(?:às|as)\s+(\d{1,2}:\d{2}))?", pre, re.I)
    emitido = (m.group(1) + (f" {m.group(2)}" if m.group(2) else "")) if m else ""
    manter, ign = [], []
    for r in data:
        if "situacao" in mapa and r.get("situacao") and r.get("nome"):
            s = norm_text(r["situacao"])
            if not (s.startswith("NLOC") or "NAO LOCALIZAD" in s):
                ign.append(r["_linha"])
                continue
        manter.append(r)
    if ign:
        avisos.append(f"{len(ign)} linha(s) (ex.: {_linhas_txt(ign, 3)}) ignorada(s): situação diferente de “NLOC - Aluno não localizado”.")
    rows = _prepara_datas(manter, avisos, "PBF")
    if not rows:
        raise ArquivoInvalido(
            f"Nenhum aluno não localizado (situação NLOC) encontrado no arquivo '{nome}'.",
            {"arquivo": nome, "motivo": "sem_registros", "linha_cabecalho": hl})
    rows.sort(key=_sort_key)
    return Arquivo("pbf", nome, rows, mapa, avisos, lidos=len(data), extra={
        "emitido_em": emitido,
        "uf": next((r.get("uf") for r in rows if r.get("uf")), ""),
        "municipio": next((r.get("municipio") for r in rows if r.get("municipio")), ""),
    })


def parse_ge(raw: bytes, nome: str = "GE.csv") -> Arquivo:
    data, mapa, _, hl = read_table(raw, GE_COLS, GE_REQUIRED, nome)
    avisos: list[str] = []
    for k in ("f2", "turma", "inep", "escola"):
        if k not in mapa:
            avisos.append(f"Coluna “{LABELS[k]}” não encontrada — ficará em branco.")
    rows = _prepara_datas(data, avisos, "GE")
    for r in rows:
        for k in ("f2", "turma", "inep", "escola"):
            r.setdefault(k, "")
    if not rows:
        raise ArquivoInvalido(f"Nenhuma matrícula encontrada no arquivo '{nome}'.",
                              {"arquivo": nome, "motivo": "sem_registros", "linha_cabecalho": hl})
    return Arquivo("ge", nome, sorted(rows, key=_sort_key), mapa, avisos, lidos=len(data), ordem=rows)


# --------------------------------------------------------------------------
# Cruzamento
# --------------------------------------------------------------------------

# Ordem de prioridade: é o código exibido quando mais de uma regra coincide.
REGRAS = ["NF1", "NF2", "ND", "F1D", "F2D"]
REGRAS_DESC = {
    "NF1": "Nome do aluno e nome do responsável com a Filiação 1",
    "NF2": "Nome do aluno e nome do responsável com a Filiação 2",
    "ND": "Nome do aluno e data de nascimento",
    "F1D": "Data de nascimento e nome do responsável com a Filiação 1",
    "F2D": "Data de nascimento e nome do responsável com a Filiação 2",
}


@dataclass
class Resultado:
    pbf: list[dict]
    ge: list[dict]
    localizados: list[dict]
    nao_localizados: list[dict]
    meta: dict = field(default_factory=dict)
    avisos: list[str] = field(default_factory=list)


def cruzar(pbf_arq: Arquivo, ge_arq: Arquivo, mes_ref: str = "") -> Resultado:
    pbf, ge = pbf_arq.rows, ge_arq.ordem or ge_arq.rows
    idx: dict[tuple, list[int]] = defaultdict(list)
    for i, g in enumerate(ge):
        nm = norm_text(g["nome"])
        d = g["nasc_iso"]
        f1, f2 = resp_key(g.get("f1")), resp_key(g.get("f2"))
        if nm and d:
            idx["ND", nm, d].append(i)
        if nm and f1:
            idx["NF1", nm, f1].append(i)
        if nm and f2:
            idx["NF2", nm, f2].append(i)
        if d and f1:
            idx["F1D", d, f1].append(i)
        if d and f2:
            idx["F2D", d, f2].append(i)

    localizados: list[dict] = []
    nao: list[dict] = []
    for p in pbf:
        nm, d, rs = norm_text(p["nome"]), p["nasc_iso"], resp_key(p.get("resp"))
        chaves = {
            "NF1": (nm, rs) if nm and rs else None,
            "NF2": (nm, rs) if nm and rs else None,
            "ND": (nm, d) if nm and d else None,
            "F1D": (d, rs) if d and rs else None,
            "F2D": (d, rs) if d and rs else None,
        }
        achados: list[tuple[str, int]] = []
        for regra in REGRAS:
            ch = chaves[regra]
            if ch:
                achados += [(regra, i) for i in idx.get((regra,) + ch, [])]
        if not achados:
            nao.append(p)
            continue
        regra, gi = min(achados, key=lambda t: (REGRAS.index(t[0]), t[1]))
        g = ge[gi]
        outras_idx = sorted({i for _, i in achados if i != gi})
        loc = dict(p)
        loc.update({
            "f1": g.get("f1", ""), "f2": g.get("f2", ""), "turma": g.get("turma", ""),
            "inep_ge": g.get("inep", ""), "escola_ge": g.get("escola", ""), "busca": regra,
            "outras": [{
                "turma": ge[i].get("turma", ""), "escola": ge[i].get("escola", ""),
                "busca": min((t[0] for t in achados if t[1] == i), key=REGRAS.index),
            } for i in outras_idx],
        })
        localizados.append(loc)

    localizados.sort(key=_sort_key)
    nao.sort(key=_sort_key)
    meta = {
        "mes_ref": mes_ref,
        "emitido_em": pbf_arq.extra.get("emitido_em", ""),
        "uf": pbf_arq.extra.get("uf", ""),
        "municipio": pbf_arq.extra.get("municipio", ""),
        "arquivo_pbf": pbf_arq.nome, "arquivo_ge": ge_arq.nome,
        "por_regra": {r: sum(1 for x in localizados if x["busca"] == r) for r in REGRAS},
        "com_varias_matriculas": sum(1 for x in localizados if x["outras"]),
    }
    return Resultado(pbf=pbf, ge=ge_arq.rows, localizados=localizados, nao_localizados=nao,
                     meta=meta, avisos=pbf_arq.avisos + ge_arq.avisos)


def processar(pbf_bytes: bytes, ge_bytes: bytes, pbf_nome="PBF.csv", ge_nome="GE.csv", mes_ref="") -> Resultado:
    return cruzar(parse_pbf(pbf_bytes, pbf_nome), parse_ge(ge_bytes, ge_nome), mes_ref)
