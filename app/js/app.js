/* Localiza Aluno - interface */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var tick = function () { return new Promise(function (r) { setTimeout(r, 20); }); };

  var state = { pbf: [], ge: [], loc: [], nloc: [], ready: { pbf: false, ge: false }, names: { pbf: '', ge: '' }, ran: false };
  var PAGE = 100;

  /* ---------------- definição das tabelas / relatórios ---------------- */
  var TABLES = {
    pbf: {
      title: 'Sistema Presença', unit: 'alunos', file: 'Sistema_Presenca',
      pdfTitles: function (m) { return ['SISTEMA PRESENÇA - ALUNOS NÃO LOCALIZADOS (DADOS IMPORTADOS)', 'MÊS DE REFERÊNCIA: ' + m]; },
      cols: [
        { h: 'NIS', get: function (r) { return r.nis; }, w: 9 },
        { h: 'Nome do Aluno', get: function (r) { return r.nome; }, w: 24 },
        { h: 'D. Nasc.', get: function (r) { return r.nasc; }, w: 8, align: 'center' },
        { h: 'Filiação', get: function (r) { return r.resp; }, w: 20 },
        { h: 'Situação', get: function (r) { return r.situacao; }, w: 15 },
        { h: 'INEP', get: function (r) { return r.inep; }, w: 7 },
        { h: 'Escola', get: function (r) { return r.escola; }, w: 12 },
        { h: 'Dependência', get: function (r) { return r.dependencia; }, w: 8 },
        { h: 'Série', get: function (r) { return r.serie; }, w: 13 }
      ],
      rows: function () { return state.pbf; }
    },
    ge: {
      title: 'Gestor Escolar', unit: 'alunos', file: 'Gestor_Escolar',
      pdfTitles: function (m) { return ['GESTOR ESCOLAR - MATRÍCULAS ATIVAS (DADOS IMPORTADOS)', 'MÊS DE REFERÊNCIA: ' + m]; },
      cols: [
        { h: 'Nome do Aluno', get: function (r) { return r.nome; }, w: 24 },
        { h: 'D. Nasc.', get: function (r) { return r.nasc; }, w: 8, align: 'center' },
        { h: 'Filiação 1', get: function (r) { return r.f1; }, w: 20 },
        { h: 'Filiação 2', get: function (r) { return r.f2; }, w: 20 },
        { h: 'Turma', get: function (r) { return r.turma; }, w: 8, align: 'center' },
        { h: 'INEP', get: function (r) { return r.inep; }, w: 8, align: 'center' },
        { h: 'Escola', get: function (r) { return r.escola; }, w: 24 }
      ],
      rows: function () { return state.ge; }
    },
    loc: {
      title: 'Alunos localizados', unit: 'alunos', file: 'Alunos_Localizados', legend: true,
      pdfTitles: function (m) {
        return ['FREQUÊNCIA ESCOLAR DO AUXÍLIO BRASIL - ATUALIZAÇÃO DE ENDEREÇO ESCOLAR - MÊS DE REFERÊNCIA: ' + m,
          'CRUZAMENTO DE DADOS ENTRE ALUNOS NÃO LOCALIZADOS DO SISTEMA PRESENÇA E MATRÍCULA DO GESTOR ESCOLAR'];
      },
      cols: [
        { h: 'NIS', get: function (r) { return r.pbf.nis; }, w: 9 },
        { h: 'Nome do Aluno', get: function (r) { return r.ge.nome || r.pbf.nome; }, w: 22 },
        { h: 'D. Nasc.', get: function (r) { return r.ge.nasc || r.pbf.nasc; }, w: 8, align: 'center' },
        { h: 'Filiação 1', get: function (r) { return r.ge.f1; }, w: 17 },
        { h: 'Filiação 2', get: function (r) { return r.ge.f2; }, w: 17 },
        { h: 'Turma', get: function (r) { return r.ge.turma; }, w: 7, align: 'center' },
        { h: 'INEP', get: function (r) { return r.ge.inep; }, w: 8, align: 'center' },
        { h: 'Escola', get: function (r) { return r.ge.escola; }, w: 22 },
        { h: 'Pesq.', get: function (r) { return r.busca; }, w: 5, align: 'center' }
      ],
      rows: function () { return state.loc; }
    },
    nloc: {
      title: 'Alunos não localizados', unit: 'alunos', file: 'Alunos_Nao_Localizados',
      pdfTitles: function () { return ['ALUNOS NÃO LOCALIZADOS - SISTEMA PRESENÇA']; },
      cols: [
        { h: 'NIS', get: function (r) { return r.nis; }, w: 10 },
        { h: 'Nome do Aluno', get: function (r) { return r.nome; }, w: 40 },
        { h: 'D. Nasc.', get: function (r) { return r.nasc; }, w: 9, align: 'center' },
        { h: 'Responsável', get: function (r) { return r.resp; }, w: 30 }
      ],
      rows: function () { return state.nloc; }
    }
  };

  var LEGEND = '*Metodologia de busca: ' + LA.RULES.map(function (r) { return r + ' = ' + LA.RULE_HELP[r].replace('Nome do aluno', 'Nome do Aluno').replace('nome do responsável com a ', ''); }).join('; ');

  /* ---------------- abas ---------------- */
  function showTab(name) {
    $$('.tab').forEach(function (t) {
      var on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on);
    });
    $$('.panel').forEach(function (p) { p.classList.toggle('active', p.id === 'tab-' + name); });
    window.scrollTo(0, 0);
  }
  $$('.tab').forEach(function (t) { t.addEventListener('click', function () { showTab(t.dataset.tab); }); });

  /* ---------------- painéis de tabela ---------------- */
  var views = {};
  function buildPanel(key) {
    var cfg = TABLES[key], panel = $('#tab-' + key);
    panel.innerHTML =
      '<div class="toolbar">' +
        '<input class="search" type="search" placeholder="Pesquisar nesta lista…" aria-label="Pesquisar">' +
        '<span class="count">Quantidade de registros: <strong class="n">0</strong></span>' +
      '</div>' +
      '<div class="table-wrap"><table class="grid"><thead></thead><tbody></tbody></table><div class="empty" hidden></div></div>' +
      '<div class="pager"><button class="btn prev" type="button">‹ Anterior</button><span class="pg"></span><button class="btn next" type="button">Próxima ›</button></div>' +
      '<div class="report-btns">' +
        '<button class="btn primary" data-act="pdf" type="button">Exportar PDF</button>' +
        '<button class="btn" data-act="view" type="button">Visualizar</button>' +
        '<button class="btn" data-act="print" type="button">Imprimir</button>' +
        '<button class="btn" data-act="csv" type="button">Exportar CSV</button>' +
      '</div>' +
      (cfg.legend ? '<p class="legend"></p>' : '');

    var v = views[key] = { page: 0, q: '', filtered: [], hay: null, hayFor: null };
    var thead = $('thead', panel);
    thead.innerHTML = '<tr>' + cfg.cols.map(function (c) { return '<th' + (c.align === 'center' ? ' class="c"' : '') + '>' + esc(c.h) + '</th>'; }).join('') + '</tr>';
    if (cfg.legend) {
      $('.legend', panel).innerHTML = LA.RULES.map(function (r) { return '<span class="tag">' + r + '</span> ' + esc(LA.RULE_HELP[r]); }).join(' &nbsp;·&nbsp; ');
    }

    $('.search', panel).addEventListener('input', function (e) { v.q = e.target.value; v.page = 0; renderTable(key); });
    $('.prev', panel).addEventListener('click', function () { v.page = Math.max(0, v.page - 1); renderTable(key, true); });
    $('.next', panel).addEventListener('click', function () { v.page++; renderTable(key, true); });
    $$('[data-act]', panel).forEach(function (b) { b.addEventListener('click', function () { reportAction(key, b.dataset.act); }); });
    renderTable(key);
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function filteredRows(key) {
    var cfg = TABLES[key], v = views[key], rows = cfg.rows();
    if (v.hayFor !== rows) {
      v.hay = rows.map(function (r) { return LA.norm(cfg.cols.map(function (c) { return c.get(r); }).join(' | ')); });
      v.hayFor = rows;
    }
    var q = LA.norm(v.q);
    if (!q) return rows;
    var terms = q.split(' ');
    return rows.filter(function (r, i) { return terms.every(function (t) { return v.hay[i].indexOf(t) !== -1; }); });
  }

  function renderTable(key, keepScroll) {
    var cfg = TABLES[key], v = views[key], panel = $('#tab-' + key);
    var rows = v.filtered = filteredRows(key);
    var pages = Math.max(1, Math.ceil(rows.length / PAGE));
    v.page = Math.min(v.page, pages - 1);
    var slice = rows.slice(v.page * PAGE, v.page * PAGE + PAGE);
    var html = slice.map(function (r) {
      return '<tr>' + cfg.cols.map(function (c) {
        var val = esc(c.get(r));
        return '<td' + (c.align === 'center' ? ' class="c"' : '') + ' title="' + val + '">' + val + '</td>';
      }).join('') + '</tr>';
    }).join('');
    $('tbody', panel).innerHTML = html;
    var empty = $('.empty', panel);
    var all = cfg.rows().length;
    empty.hidden = rows.length > 0;
    if (!rows.length) empty.textContent = all ? 'Nenhum registro encontrado para a pesquisa.' : 'Importe os arquivos na aba Dados e clique em Iniciar.';
    $('.n', panel).textContent = rows.length === all ? all : rows.length + ' de ' + all;
    $('.pg', panel).textContent = 'Página ' + (v.page + 1) + ' de ' + pages;
    $('.prev', panel).disabled = v.page === 0;
    $('.next', panel).disabled = v.page >= pages - 1;
    $$('[data-act]', panel).forEach(function (b) { b.disabled = !all; });
    if (keepScroll) $('.table-wrap', panel).scrollTop = 0;
    var badge = $('#b-' + key); if (badge) badge.textContent = all;
  }

  /* ---------------- relatórios ---------------- */
  function mesRef() { return $('#mesRef').value.trim() || '—'; }
  function slug(s) { return s.replace(/[^0-9A-Za-z]+/g, '-').replace(/^-|-$/g, ''); }

  function buildReport(key) {
    var cfg = TABLES[key];
    // o relatório sempre contém todos os registros (a pesquisa da tela não o filtra)
    return Reports.buildPdf({
      titles: cfg.pdfTitles(mesRef()),
      columns: cfg.cols,
      rows: cfg.rows(),
      unit: cfg.unit,
      local: $('#local').value.trim(),
      legend: cfg.legend ? LEGEND : null
    });
  }
  function fileBase(key) { return TABLES[key].file + '_' + slug(mesRef()); }

  function busy(on, msg) { $('#busy').hidden = !on; if (msg) $('#busyMsg').textContent = msg; }

  var viewerState = { url: null, name: '', doc: null };
  async function reportAction(key, act) {
    var cfg = TABLES[key];
    if (!cfg.rows().length) return;
    try {
      if (act === 'csv') {
        Reports.downloadBlob(new Blob([Reports.csvText(cfg.cols, cfg.rows())], { type: 'text/csv;charset=utf-8' }), fileBase(key) + '.csv');
        return;
      }
      busy(true, 'Gerando relatório…'); await tick();
      var doc = buildReport(key);
      busy(false);
      if (act === 'pdf') { doc.save(fileBase(key) + '.pdf'); return; }
      if (act === 'view') { openViewer(doc, cfg.title, fileBase(key) + '.pdf'); return; }
      if (act === 'print') { printDoc(doc); return; }
    } catch (e) {
      busy(false); console.error(e);
      alert('Não foi possível gerar o relatório: ' + e.message);
    }
  }

  function openViewer(doc, title, name) {
    closeViewer();
    viewerState.doc = doc; viewerState.name = name;
    viewerState.url = URL.createObjectURL(doc.output('blob'));
    $('#viewerTitle').textContent = title;
    $('#viewerFrame').src = viewerState.url;
    $('#viewer').hidden = false;
  }
  function closeViewer() {
    $('#viewer').hidden = true;
    $('#viewerFrame').removeAttribute('src');
    if (viewerState.url) URL.revokeObjectURL(viewerState.url);
    viewerState.url = null;
  }
  function printDoc(doc) {
    var url = URL.createObjectURL(doc.output('blob'));
    var f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    f.onload = function () {
      try { f.contentWindow.focus(); f.contentWindow.print(); }
      catch (e) { window.open(url, '_blank'); }
      setTimeout(function () { f.remove(); URL.revokeObjectURL(url); }, 60000);
    };
    f.src = url;
    document.body.appendChild(f);
  }
  $('#viewerClose').addEventListener('click', closeViewer);
  $('#viewerDownload').addEventListener('click', function () { if (viewerState.doc) viewerState.doc.save(viewerState.name); });
  $('#viewerPrint').addEventListener('click', function () {
    var f = $('#viewerFrame');
    try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { if (viewerState.doc) printDoc(viewerState.doc); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('#viewer').hidden) closeViewer(); });

  /* ---------------- aba Dados ---------------- */
  var mes = $('#mesRef');
  var d = new Date();
  mes.value = ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear();
  mes.addEventListener('input', function () {
    var x = mes.value.replace(/\D/g, '').slice(0, 6);
    mes.value = x.length > 2 ? x.slice(0, 2) + '/' + x.slice(2) : x;
  });
  try { $('#local').value = localStorage.getItem('la.local') || 'Xinguara/PA'; } catch (e) { $('#local').value = 'Xinguara/PA'; }
  $('#local').addEventListener('change', function () { try { localStorage.setItem('la.local', this.value.trim()); } catch (e) { /* ignore */ } });

  $('#rulesBody').innerHTML = LA.RULES.map(function (r) { return '<tr><td>' + r + '</td><td>' + esc(LA.RULE_HELP[r]) + '</td></tr>'; }).join('');

  async function readText(file) {
    var buf = await file.arrayBuffer();
    var t = new TextDecoder('utf-8').decode(buf);
    if (t.indexOf('�') !== -1) t = new TextDecoder('windows-1252').decode(buf);
    return t;
  }

  var pending = { pbf: null, ge: null };
  async function loadFile(kind, file) {
    var status = $('#status-' + kind), name = $('#name-' + kind);
    status.className = 'status'; status.textContent = 'Lendo arquivo…';
    name.textContent = file.name;
    state.ready[kind] = false; pending[kind] = null; updateStart();
    try {
      await tick();
      var res = LA.parseCsv(await readText(file), kind, Papa);
      var rows = res.rows.slice().sort(function (a, b) { return LA.norm(a.nome).localeCompare(LA.norm(b.nome), 'pt-BR'); });
      if (!rows.length) throw new Error('O arquivo foi lido, mas não contém nenhum aluno abaixo do cabeçalho.');
      pending[kind] = rows;
      state.ready[kind] = true; state.names[kind] = file.name;
      var opt = Object.keys(LA.SCHEMAS[kind].cols).filter(function (k) { return res.recognized.indexOf(k) === -1; });
      status.className = 'status ok';
      status.textContent = '✔ ' + rows.length.toLocaleString('pt-BR') + ' registros lidos (cabeçalho na linha ' + res.headerLine + ', separador “' + (res.delimiter === '\t' ? 'TAB' : res.delimiter) + '”).' +
        (opt.length ? ' Colunas não encontradas (opcionais): ' + opt.join(', ') + '.' : '');
    } catch (e) {
      name.textContent = 'Nenhum arquivo selecionado';
      status.className = 'status err'; status.textContent = '✖ ' + e.message;
    }
    updateStart();
  }
  function updateStart() { $('#btnIniciar').disabled = !(state.ready.pbf && state.ready.ge); }

  ['pbf', 'ge'].forEach(function (kind) {
    var input = $('#file-' + kind), drop = $('#drop-' + kind);
    $('[data-pick="' + kind + '"]').addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () { if (input.files[0]) loadFile(kind, input.files[0]); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { var f = e.dataTransfer.files[0]; if (f) loadFile(kind, f); });
    $('[data-model="' + kind + '"]').addEventListener('click', function () {
      Reports.downloadBlob(new Blob([LA.modelCsv(kind)], { type: 'text/csv;charset=utf-8' }), LA.MODELS[kind].filename);
    });
  });

  function setProgress(p) {
    var b = $('#bar'); p = Math.round(p);
    b.style.width = p + '%'; b.textContent = p + '%';
  }

  $('#btnIniciar').addEventListener('click', async function () {
    var btn = this; btn.disabled = true;
    $('#progress').hidden = false; setProgress(5); await tick();
    try {
      state.pbf = pending.pbf; state.ge = pending.ge;
      setProgress(25); await tick();
      var res = LA.run(state.pbf, state.ge);
      setProgress(75); await tick();
      state.loc = res.found; state.nloc = res.notFound; state.ran = true;
      ['pbf', 'ge', 'loc', 'nloc'].forEach(function (k) { views[k].page = 0; renderTable(k); });
      setProgress(100);
      await tick();
      showTab('loc');
    } catch (e) {
      console.error(e); alert('Erro ao processar: ' + e.message);
    }
    btn.disabled = false;
  });

  $('#btnLimpar').addEventListener('click', function () {
    state.pbf = []; state.ge = []; state.loc = []; state.nloc = [];
    state.ready = { pbf: false, ge: false }; pending = { pbf: null, ge: null };
    ['pbf', 'ge'].forEach(function (k) {
      $('#name-' + k).textContent = 'Nenhum arquivo selecionado';
      $('#status-' + k).textContent = ''; $('#status-' + k).className = 'status';
    });
    $('#progress').hidden = true; setProgress(0);
    Object.keys(views).forEach(function (k) { views[k].q = ''; $('#tab-' + k + ' .search').value = ''; renderTable(k); });
    updateStart();
  });

  Object.keys(TABLES).forEach(buildPanel);
})();
