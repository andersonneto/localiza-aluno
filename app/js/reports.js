/*
 * Localiza Aluno - geração de relatórios (PDF e CSV)
 * Layout inspirado no relatório do Sistema Presença: título central em negrito,
 * cabeçalho verde, linhas alternadas e rodapé com contagem acumulada/paginação.
 */
(function (root) {
  'use strict';

  var GREEN = [74, 125, 52];
  var ROW_A = [231, 241, 223];
  var ROW_B = [255, 251, 214];

  function longDate(d) {
    return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function stamp(d) {
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR');
  }

  /**
   * opts: { titles:[string], columns:[{h,get,w,align}], rows:[], total, unit, local, legend }
   * Retorna o objeto jsPDF.
   */
  function buildPdf(opts) {
    var jsPDF = root.jspdf.jsPDF;
    var doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    var pw = doc.internal.pageSize.getWidth();
    var ph = doc.internal.pageSize.getHeight();
    var ML = 28, MR = 28, contentW = pw - ML - MR;
    var titles = opts.titles || [];
    var topMargin = 26 + titles.length * 15 + 12;
    var bottomMargin = opts.legend ? 58 : 46;
    var cols = opts.columns;
    var sumW = cols.reduce(function (a, c) { return a + (c.w || 1); }, 0);

    var columnStyles = {};
    cols.forEach(function (c, i) {
      columnStyles[i] = { cellWidth: (c.w || 1) / sumW * contentW, halign: c.align || 'left' };
    });

    var pageRows = {};
    var body = opts.rows.map(function (r) { return cols.map(function (c) { return String(c.get(r) == null ? '' : c.get(r)); }); });

    function drawTitles() {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(20, 20, 20);
      titles.forEach(function (t, i) {
        doc.setFontSize(i === 0 ? 12.5 : 9.5);
        doc.text(t, pw / 2, 28 + i * 15, { align: 'center' });
      });
    }

    doc.autoTable({
      head: [cols.map(function (c) { return c.h; })],
      body: body,
      margin: { top: topMargin, bottom: bottomMargin, left: ML, right: MR },
      theme: 'plain',
      styles: { font: 'helvetica', fontSize: 7.6, cellPadding: { top: 2.6, bottom: 2.6, left: 4, right: 4 }, textColor: [25, 25, 25], overflow: 'linebreak', valign: 'middle' },
      headStyles: { fillColor: GREEN, textColor: 255, fontStyle: 'bold', halign: 'center' },
      bodyStyles: { fillColor: ROW_A },
      alternateRowStyles: { fillColor: ROW_B },
      columnStyles: columnStyles,
      showHead: 'everyPage',
      didParseCell: function (d) {
        if (d.section === 'head') d.cell.styles.halign = 'center';
      },
      didDrawCell: function (d) {
        if (d.section === 'body' && d.column.index === 0) {
          var pg = doc.internal.getCurrentPageInfo().pageNumber;
          pageRows[pg] = Math.max(pageRows[pg] || 0, d.row.index + 1);
        }
      },
      didDrawPage: drawTitles
    });

    if (!body.length) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(10); doc.setTextColor(90);
      doc.text('Nenhum registro.', pw / 2, topMargin + 40, { align: 'center' });
    }

    // rodapé de todas as páginas (agora que o total de páginas é conhecido)
    var N = doc.getNumberOfPages();
    var now = new Date();
    var total = opts.total != null ? opts.total : opts.rows.length;
    var last = 0;
    for (var p = 1; p <= N; p++) {
      doc.setPage(p);
      if (pageRows[p]) last = pageRows[p];
      doc.setTextColor(40); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
      var y = ph - 34;
      if (opts.legend) {
        doc.setFontSize(7);
        doc.text(doc.splitTextToSize(opts.legend, contentW), ML, ph - 48);
        doc.setFontSize(7.5);
      }
      doc.text('Quantidade de ' + (opts.unit || 'registros') + ': ' + (body.length ? last : 0) + '/' + total, ML, y);
      doc.text('Gerado em ' + stamp(now) + ' pelo Localiza Aluno', ML, y + 11);
      doc.text('Página: ' + p + '/' + N, pw - MR, y, { align: 'right' });
      doc.text((opts.local ? opts.local + ', ' : '') + longDate(now), pw - MR, y + 11, { align: 'right' });
    }
    return doc;
  }

  function csvText(columns, rows) {
    var q = function (v) {
      v = String(v == null ? '' : v);
      return /[";\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    var out = [columns.map(function (c) { return q(c.h); }).join(';')];
    rows.forEach(function (r) { out.push(columns.map(function (c) { return q(c.get(r)); }).join(';')); });
    return '﻿' + out.join('\r\n') + '\r\n';
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  root.Reports = { buildPdf: buildPdf, csvText: csvText, downloadBlob: downloadBlob };
})(window);
