/*
 * Localiza Aluno - núcleo de leitura e cruzamento de dados
 * Funciona no navegador (window.LA) e em Node (module.exports) para testes.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- normalização ---------- */
  var strip = function (s) {
    return String(s == null ? '' : s).replace(/^﻿/, '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  };
  // nomes de pessoas: maiúsculo, sem acento, espaços colapsados
  var norm = function (s) { return strip(s).toUpperCase().replace(/\s+/g, ' ').trim(); };
  // nomes de colunas: só letras/números/espaço ("Filiação 1" e "FILIAÇÃO1" viram equivalentes abaixo)
  var normHeader = function (s) { return norm(s).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); };
  var compactHeader = function (s) { return normHeader(s).replace(/ /g, ''); };

  // Data -> dd/mm/aaaa (aceita d/m/aaaa, aaaa-mm-dd, com hora, etc.)
  function normDate(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    var m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
    if (m) return pad(m[1]) + '/' + pad(m[2]) + '/' + m[3];
    m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
    if (m) return pad(m[3]) + '/' + pad(m[2]) + '/' + m[1];
    return s;
  }
  function pad(n) { return ('0' + n).slice(-2); }

  /* ---------- definição das colunas (leitura pelo NOME, nunca pela posição) ---------- */
  // aliases já em formato "compacto" (sem acento, sem espaço, sem pontuação)
  var SCHEMAS = {
    pbf: {
      label: 'Sistema Presença (PBF)',
      required: ['nome', 'nasc', 'resp'],
      cols: {
        nis: ['NIS'],
        nome: ['NOMEDOALUNO', 'NOMEALUNO', 'ALUNO', 'ALUNOS', 'NOME'],
        nasc: ['DATADENASCIMENTO', 'DATANASCIMENTO', 'DATANASC', 'NASCIMENTO'],
        resp: ['NOMEDORESPONSAVEL', 'NOMERESPONSAVEL', 'RESPONSAVEL', 'FILIACAO'],
        situacao: ['SITUACAO', 'SITUACAOETIPODEACOMPANHAMENTO'],
        inep: ['INEP', 'INEPESCOLA'],
        escola: ['ESCOLA'],
        dependencia: ['DEPENDENCIA'],
        serie: ['SERIEDOESTUDANTE', 'SERIE'],
        tipoAcomp: ['TIPODEACOMPANHAMENTO']
      }
    },
    ge: {
      label: 'Gestor Escolar (GE)',
      required: ['nome', 'nasc'],
      cols: {
        nome: ['ALUNOS', 'ALUNO', 'NOMEDOALUNO', 'NOMEALUNO', 'NOME'],
        nasc: ['DATADENASCIMENTO', 'DATANASCIMENTO', 'DATANASC', 'NASCIMENTO'],
        f1: ['FILIACAO1', 'FILIACAO01', 'FILIACAOUM', 'MAE'],
        f2: ['FILIACAO2', 'FILIACAO02', 'FILIACAODOIS', 'PAI'],
        turma: ['TURMA'],
        inep: ['INEPESCOLA', 'INEP', 'INEPDAESCOLA'],
        escola: ['ESCOLA', 'NOMEDAESCOLA']
      }
    }
  };

  var MODELS = {
    pbf: {
      filename: 'modelo_PBF_Sistema_Presenca.csv',
      delimiter: ';',
      lines: [
        ['Ano/Período', 'UF', 'Município', 'CPF', 'NIS', 'Nome do Aluno', 'Data de Nascimento', 'Nome do Responsável', 'NIS Responsável', 'Situação', 'INEP', 'Escola', 'Dependência', 'Série do Estudante', 'Frequência OUT', 'Motivo OUT', 'Frequência NOV', 'Motivo NOV'],
        ['2026(Outubro/Novembro)', 'PA', 'Xinguara', '00000000000', '21000000001', 'NOME DO ALUNO EXEMPLO', '01/01/2015', 'NOME DO RESPONSAVEL EXEMPLO', '16000000001', 'NLOC - Aluno não localizado', '', '', '', '4º ano Ensino Fundamental', '', '', '', '']
      ]
    },
    ge: {
      filename: 'modelo_GE_Gestor_Escolar.csv',
      delimiter: ',',
      lines: [
        ['ALUNOS', 'DATA DE NASCIMENTO', 'FILIAÇÃO1', 'FILIAÇÃO2', 'TURMA', 'INEP ESCOLA', 'ESCOLA'],
        ['NOME DO ALUNO EXEMPLO', '01/01/2015', 'NOME DA MAE EXEMPLO', 'NOME DO PAI EXEMPLO', '4º A', '15000000', 'E M E F ESCOLA EXEMPLO']
      ]
    }
  };

  function modelCsv(kind) {
    var m = MODELS[kind], d = m.delimiter;
    var q = function (v) { v = String(v); return /[";,\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return '﻿' + m.lines.map(function (r) { return r.map(q).join(d); }).join('\r\n') + '\r\n';
  }

  /* ---------- localizar cabeçalho e mapear colunas ---------- */
  function mapHeader(row, schema) {
    var map = {}, cells = row.map(compactHeader);
    Object.keys(schema.cols).forEach(function (key) {
      var aliases = schema.cols[key];
      for (var a = 0; a < aliases.length; a++) {   // respeita prioridade dos aliases
        var i = cells.indexOf(aliases[a]);
        if (i !== -1) { map[key] = i; break; }
      }
    });
    return map;
  }

  function findHeader(rows, schema) {
    var best = null;
    for (var i = 0; i < Math.min(rows.length, 60); i++) {
      var map = mapHeader(rows[i], schema);
      var missing = schema.required.filter(function (k) { return map[k] === undefined; });
      if (!missing.length) return { index: i, map: map, missing: [] };
      var score = Object.keys(map).length;
      if (!best || score > best.score) best = { index: i, map: map, missing: missing, score: score };
    }
    return { index: -1, map: best ? best.map : {}, missing: best ? best.missing : schema.required.slice() };
  }

  var FRIENDLY = { nome: 'Nome do aluno', nasc: 'Data de nascimento', resp: 'Nome do responsável', nis: 'NIS', f1: 'Filiação 1', f2: 'Filiação 2' };

  /**
   * Lê o texto de um CSV (PBF ou GE).
   * Detecta delimitador e linha do cabeçalho; lê as colunas pelo nome.
   * Papa = biblioteca PapaParse (injetada).
   */
  function parseCsv(text, kind, Papa) {
    var schema = SCHEMAS[kind];
    text = String(text || '').replace(/^﻿/, '');
    var head = text.split(/\r?\n/).slice(0, 80).join('\n');
    var delims = [';', ',', '\t'], chosen = null, hdr = null;

    for (var d = 0; d < delims.length; d++) {
      var r = Papa.parse(head, { delimiter: delims[d], skipEmptyLines: false }).data;
      var h = findHeader(r, schema);
      if (h.index !== -1) { chosen = delims[d]; hdr = h; break; }
    }
    if (!chosen) {
      var any = findHeader(Papa.parse(head, { delimiter: ';' }).data, schema);
      var names = any.missing.map(function (k) { return FRIENDLY[k] || k; }).join(', ');
      throw new Error('Não encontrei o cabeçalho esperado do arquivo ' + schema.label + '. Colunas obrigatórias ausentes: ' + names + '.');
    }

    var all = Papa.parse(text, { delimiter: chosen, skipEmptyLines: true }).data;
    // recalcula o índice do cabeçalho no arquivo completo (linhas vazias foram removidas)
    var full = findHeader(all, schema);
    var map = full.map, out = [], keys = Object.keys(map);
    for (var i = full.index + 1; i < all.length; i++) {
      var row = all[i], o = {};
      keys.forEach(function (k) { o[k] = (row[map[k]] == null ? '' : String(row[map[k]])).trim(); });
      if (!o.nome) continue;
      o.nasc = normDate(o.nasc);
      out.push(o);
    }
    return { rows: out, delimiter: chosen, headerLine: full.index + 1, recognized: keys, map: map };
  }

  /* ---------- cruzamento ---------- */
  // Ordem de prioridade das regras (a primeira que coincidir define o rótulo da busca)
  var RULES = ['NF1', 'NF2', 'ND', 'F1D', 'F2D'];
  var RULE_HELP = {
    ND: 'Nome do aluno e data de nascimento',
    NF1: 'Nome do aluno e nome do responsável com a Filiação 1',
    NF2: 'Nome do aluno e nome do responsável com a Filiação 2',
    F1D: 'Data de nascimento e nome do responsável com a Filiação 1',
    F2D: 'Data de nascimento e nome do responsável com a Filiação 2'
  };

  function buildIndex(ge, onProgress) {
    var idx = {}; RULES.forEach(function (r) { idx[r] = new Map(); });
    var add = function (rule, key, g) {
      var m = idx[rule], list = m.get(key);
      if (list) list.push(g); else m.set(key, [g]);
    };
    ge.forEach(function (g, i) {
      var n = norm(g.nome), d = g.nasc, f1 = norm(g.f1), f2 = norm(g.f2);
      g._n = n;
      if (n && d) add('ND', n + '|' + d, g);
      if (n && f1) add('NF1', n + '|' + f1, g);
      if (n && f2) add('NF2', n + '|' + f2, g);
      if (d && f1) add('F1D', d + '|' + f1, g);
      if (d && f2) add('F2D', d + '|' + f2, g);
      if (onProgress && i % 2000 === 0) onProgress(i / ge.length);
    });
    return idx;
  }

  function matchOne(p, idx) {
    var n = norm(p.nome), d = p.nasc, r = norm(p.resp);
    var keys = {
      ND: n && d ? n + '|' + d : null,
      NF1: n && r ? n + '|' + r : null,
      NF2: n && r ? n + '|' + r : null,
      F1D: d && r ? d + '|' + r : null,
      F2D: d && r ? d + '|' + r : null
    };
    for (var i = 0; i < RULES.length; i++) {
      var rule = RULES[i], k = keys[rule];
      if (!k) continue;
      var hit = idx[rule].get(k);
      if (hit && hit.length) return { rule: rule, ge: hit[0], candidates: hit.length };
    }
    return null;
  }

  function run(pbf, ge, onProgress) {
    var idx = buildIndex(ge);
    var found = [], notFound = [];
    pbf.forEach(function (p, i) {
      var m = matchOne(p, idx);
      if (m) found.push({ pbf: p, ge: m.ge, busca: m.rule, candidatos: m.candidates });
      else notFound.push(p);
      if (onProgress && i % 100 === 0) onProgress(i / pbf.length);
    });
    var byName = function (a, b) { return norm(a.nome || a.pbf.nome).localeCompare(norm(b.nome || b.pbf.nome), 'pt-BR'); };
    found.sort(byName);
    notFound.sort(byName);
    return { found: found, notFound: notFound };
  }

  return {
    norm: norm, normDate: normDate, SCHEMAS: SCHEMAS, MODELS: MODELS, modelCsv: modelCsv,
    parseCsv: parseCsv, run: run, RULES: RULES, RULE_HELP: RULE_HELP
  };
});
