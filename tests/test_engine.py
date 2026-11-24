import random, sys, csv, io
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from app.engine import processar, ArquivoInvalido
import pytest

PBF = ("x;;;\n;;;\nAno;UF;Município;NIS;Nome do Aluno;Data de Nascimento;Nome do Responsável;Situação\n"
       "2026;PA;X;1;JOÃO  DA SILVA;01/02/2015;MARIA SOUZA;NLOC - Aluno não localizado\n"
       "2026;PA;X;2;ANA LIMA;03/04/2016;PAI NAO DECLARADO;NLOC - Aluno não localizado\n"
       "2026;PA;X;3;ZZ;03/04/2010;ZZ;NLOC - Aluno não localizado\n")
GE = ("EXTRA,ESCOLA,TURMA,FILIAÇÃO2,FILIAÇÃO1,DATA DE NASCIMENTO,ALUNOS,INEP ESCOLA\n"
      "q,ESC A,1º A,,MARIA SOUZA,15/08/2015,JOAO DA SILVA,111\n"
      "q,ESC B,2º B,PAI NAO DECLARADO,,03/04/2016,ANA LIMA,222\n")

def test_colunas_fora_de_ordem_e_regras():
    r = processar(PBF.encode(), GE.encode())
    assert [x["nis"] for x in r.localizados] == ["2", "1"]
    assert r.localizados[1]["busca"] == "NF1" and r.localizados[1]["escola_ge"] == "ESC A"
    assert r.localizados[0]["busca"] == "ND"  # "PAI NAO DECLARADO" não vale como responsável
    assert [x["nis"] for x in r.nao_localizados] == ["3"]

def test_coluna_obrigatoria_ausente():
    with pytest.raises(ArquivoInvalido):
        processar(PBF.encode(), b"ALUNOS,TURMA\nA,B\n")

def test_dados_reais_se_existirem():
    p, g = Path("samples/pbf.csv"), Path("samples/ge.csv")
    if not (p.exists() and g.exists()): pytest.skip()
    r = processar(p.read_bytes(), g.read_bytes())
    assert (len(r.localizados), len(r.nao_localizados)) == (36, 626)


def test_avisos_com_numero_da_linha():
    from app.engine import parse_ge
    a = parse_ge("ALUNOS,DATA DE NASCIMENTO,FILIAÇÃO1\nANA,31/02/2015,M\n,01/01/2015,X\nBIA,,Y\n".encode())
    txt = " ".join(a.avisos)
    assert "Linha(s) 3" in txt and "Linha(s) 2, 4" in txt

def test_erro_traz_colunas_encontradas():
    with pytest.raises(ArquivoInvalido) as e:
        processar(PBF.encode(), b"ALUNOS,DATA DE NASCIMENTO\nA,01/01/2010\n")
    assert "FILIAÇÃO1" in str(e.value) and e.value.detalhe["linha_cabecalho"] == 1
