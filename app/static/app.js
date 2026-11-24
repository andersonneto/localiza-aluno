(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
    del(k) { try { sessionStorage.removeItem(k); } catch {} },
  };
  const S = { sid: store.get("sid"), abas: null, regras: null, tab: "dados", est: null,
              list: { page: 1, q: "", per: 50 } };
  const NOMES = { pbf: "Sistema Presença", ge: "Gestor Escolar" };

  const fmtN = n => Number(n).toLocaleString("pt-BR");
  const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
  const el = (tag, props = {}, ...kids) => {
    const e = Object.assign(document.createElement(tag), props);
    kids.flat().forEach(k => e.append(k));
    return e;
  };

  // ------------------------------------------------------------ toasts
  function toast(tipo, titulo, texto, ms) {
    const t = el("div", { className: "toast " + (tipo === "ok" ? "" : tipo), role: tipo === "err" ? "alert" : "status" },
      el("div", {}, el("b", { textContent: titulo }), texto ? el("span", { textContent: texto }) : ""),
      el("button", { type: "button", ariaLabel: "Fechar", textContent: "✕", onclick: () => t.remove() }));
    $("#toasts").append(t);
    setTimeout(() => t.remove(), ms ?? (tipo === "err" ? 14000 : 6000));
  }

  // ------------------------------------------------------------ versão
  fetch("/api/saude").then(r => r.json()).then(j => { $("#versao").textContent = j.versao; }).catch(() => {});

  // ------------------------------------------------------------ mês de referência
  const mes = $("#mes");
  const hoje = new Date();
  mes.value = String(hoje.getMonth() + 1).padStart(2, "0") + "/" + hoje.getFullYear();
  const mesOk = () => /^(0[1-9]|1[0-2])\/\d{4}$/.test(mes.value);
  let tMes;
  mes.addEventListener("input", () => {
    const d = mes.value.replace(/\D/g, "").slice(0, 6);
    mes.value = d.length > 2 ? d.slice(0, 2) + "/" + d.slice(2) : d;
    clearTimeout(tMes);
    if (mesOk() && S.sid && S.est && (S.est.pbf || S.est.ge) && mes.value !== S.est.mes_ref) {
      tMes = setTimeout(async () => {
        const fd = new FormData(); fd.append("mes_ref", mes.value);
        const r = await fetch(`/api/sessao/${S.sid}/mes`, { method: "PUT", body: fd });
        if (r.ok) { aplicar(await r.json()); toast("ok", "Mês de referência atualizado", mes.value, 2500); }
      }, 500);
    }
  });

  // ------------------------------------------------------------ status de cada arquivo
  function statusBox(k, nodes) { $(`[data-status=${k}]`).replaceChildren(...[].concat(nodes)); }
  function mini(k, pct, indet) {
    const m = $(`[data-mini=${k}]`);
    m.hidden = pct === null;
    m.classList.toggle("indet", !!indet);
    if (pct !== null) $(".mini-bar", m).style.width = pct + "%";
  }
  function pintaOk(k, info) {
    const nodes = [el("div", { className: "ok", textContent: `✔ ${info.nome} — ${fmtN(info.total)} registros lidos` })];
    if (info.lidos > info.total) nodes[0].textContent += ` (${fmtN(info.lidos - info.total)} ignorados)`;
    if (info.avisos?.length) nodes.push(el("ul", {}, info.avisos.map(a => el("li", { textContent: a }))));
    statusBox(k, nodes);
    const d = $(`[data-drop=${k}]`);
    d.classList.add("has");
    $(`[data-file=${k}]`).textContent = info.nome;
  }
  function pintaErro(k, j) {
    const nodes = [el("div", { className: "errbox", role: "alert" },
      el("b", { textContent: "✖ Não foi possível importar. " }), j.erro || "Erro desconhecido.",
      j.notificado ? el("small", { textContent: "O administrador foi avisado desse erro." }) : "")];
    const d = j.detalhe;
    if (d?.encontradas?.length) {
      nodes.push(el("small", { textContent: `Colunas encontradas na linha ${d.linha_cabecalho}: ${d.encontradas.join(" · ")}` }));
    }
    statusBox(k, nodes);
  }

  // ------------------------------------------------------------ aplicar estado do servidor
  function aplicar(e) {
    S.est = e; S.sid = e.sid; S.abas = e.abas; S.regras = e.regras;
    store.set("sid", e.sid);
    ["pbf", "ge"].forEach(k => {
      if (e[k]) pintaOk(k, e[k]);
      else { statusBox(k, []); $(`[data-drop=${k}]`).classList.remove("has"); $(`[data-file=${k}]`).textContent = ""; }
    });
    if (e.mes_ref) mes.value = e.mes_ref;
    const cnt = e.resumo ? { localizados: e.resumo.localizados, "nao-localizados": e.resumo.nao_localizados } : {};
    if (e.pbf) cnt.pbf = e.pbf.total;
    if (e.ge) cnt.ge = e.ge.total;
    const liberada = { pbf: !!e.pbf, ge: !!e.ge, localizados: !!e.resumo, "nao-localizados": !!e.resumo };
    $$(".tab").forEach(t => {
      const k = t.dataset.tab;
      if (k === "dados") return;
      t.disabled = !liberada[k];
      $(".n", t).textContent = liberada[k] ? fmtN(cnt[k]) : "";
    });
    $("#btn-limpar").hidden = !(e.pbf || e.ge);
    $("#resultado").hidden = !e.resumo;
    if (e.resumo) mostrarResultado(e.resumo);
    if (S.tab !== "dados") { if (!liberada[S.tab]) goTab("dados"); else carregar(); }
  }

  function mostrarResultado(r) {
    $("#s-pbf").textContent = fmtN(r.pbf);
    $("#s-ge").textContent = fmtN(r.ge);
    $("#s-loc").textContent = fmtN(r.localizados);
    $("#s-nao").textContent = fmtN(r.nao_localizados);
    $("#s-pct").textContent = `(${String(r.pct).replace(".", ",")}%)`;
    const ul = $("#rules"); ul.replaceChildren();
    const max = Math.max(1, ...Object.values(r.por_regra));
    Object.entries(r.por_regra).forEach(([k, v]) => {
      ul.append(el("li", {},
        el("span", { className: "code", textContent: k }),
        el("div", {}, el("div", { className: "desc", textContent: S.regras[k] }),
          el("div", { className: "track" }, el("div", { className: "fill", style: `width:${v / max * 100}%` }))),
        el("span", { className: "cnt", textContent: fmtN(v) })));
    });
    const v = $("#varias");
    v.hidden = !r.varias;
    if (r.varias) v.textContent = `${r.varias} aluno(s) localizado(s) possuem mais de uma matrícula; o sistema mostra a de melhor regra e indica as demais com “+n”.`;
    $("#meta-info").textContent =
      `Mês de referência ${r.mes_ref}` + (r.emitido_em ? ` · Arquivo do Sistema Presença emitido em ${r.emitido_em}` : "") +
      ` · Regras aplicadas na ordem: ${Object.keys(r.por_regra).join(" › ")}.`;
  }

  // ------------------------------------------------------------ envio (um por vez, em fila)
  let fila = Promise.resolve();
  function enviar(k, f) {
    fila = fila.then(() => new Promise(done => {
      if (!/\.csv$/i.test(f.name)) {
        pintaErro(k, { erro: `O arquivo “${f.name}” não é .csv.` });
        toast("err", `Arquivo inválido (${NOMES[k]})`, `“${f.name}” não é um arquivo .csv.`); return done();
      }
      if (!mesOk()) {
        toast("err", "Mês de referência inválido", "Informe no formato MM/AAAA antes de importar."); mes.focus(); return done();
      }
      statusBox(k, el("div", { textContent: `Enviando ${f.name} (${fmtSize(f.size)})…` }));
      mini(k, 0);
      const fd = new FormData();
      fd.append("arquivo", f); fd.append("mes_ref", mes.value); fd.append("sid", S.sid || "");
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/arquivo/" + k);
      xhr.upload.onprogress = e => { if (e.lengthComputable) mini(k, Math.round(e.loaded / e.total * 90)); };
      xhr.upload.onload = () => { mini(k, 100, true); statusBox(k, el("div", { textContent: "Lendo e validando o arquivo…" })); };
      xhr.onerror = () => {
        mini(k, null); pintaErro(k, { erro: "Não foi possível conectar ao servidor." });
        toast("err", "Falha de conexão", "Não foi possível enviar o arquivo."); done();
      };
      xhr.onload = () => {
        mini(k, null);
        let j = {}; try { j = JSON.parse(xhr.responseText); } catch {}
        if (xhr.status !== 200) {
          pintaErro(k, { erro: j.erro || `Erro ${xhr.status} no servidor.`, detalhe: j.detalhe, notificado: j.notificado });
          toast("err", `Falha ao importar — ${NOMES[k]}`, j.erro || `Erro ${xhr.status}`);
          return done();
        }
        aplicar(j);
        toast("ok", `${NOMES[k]} importado`, `${fmtN(j[k].total)} registros lidos.` + (j[k].avisos.length ? " Há avisos — veja abaixo do campo." : ""));
        if (j.resumo) {
          toast("ok", "Cruzamento concluído", `${fmtN(j.resumo.localizados)} localizados · ${fmtN(j.resumo.nao_localizados)} continuam não localizados.`);
        }
        done();
      };
      xhr.send(fd);
    }));
  }

  ["pbf", "ge"].forEach(k => {
    const input = $("#file-" + k), drop = $(`[data-drop=${k}]`);
    input.addEventListener("change", e => { if (e.target.files[0]) enviar(k, e.target.files[0]); input.value = ""; });
    ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", e => { if (e.dataTransfer.files[0]) enviar(k, e.dataTransfer.files[0]); });
  });
  // soltar um arquivo fora das caixas não deve abrir o arquivo no navegador
  ["dragover", "drop"].forEach(ev => window.addEventListener(ev, e => e.preventDefault()));

  // ------------------------------------------------------------ abas
  function goTab(k) {
    S.tab = k;
    $$(".tab").forEach(t => t.setAttribute("aria-selected", String(t.dataset.tab === k)));
    $("#panel-dados").hidden = k !== "dados";
    $("#panel-lista").hidden = k === "dados";
    if (k !== "dados") { S.list = { page: 1, q: "", per: +$("#per").value }; $("#q").value = ""; carregar(); }
    window.scrollTo({ top: 0 });
  }
  $$(".tab").forEach(t => t.addEventListener("click", () => !t.disabled && goTab(t.dataset.tab)));
  $$("[data-go]").forEach(b => b.addEventListener("click", () => goTab(b.dataset.go)));

  // ------------------------------------------------------------ lista
  let reqId = 0;
  async function carregar() {
    const id = ++reqId, k = S.tab, L = S.list;
    const u = `/api/sessao/${S.sid}/dados/${k}?page=${L.page}&per=${L.per}&q=${encodeURIComponent(L.q)}`;
    let j;
    try {
      const r = await fetch(u);
      j = await r.json();
      if (!r.ok) throw new Error(j.erro || r.status);
    } catch (e) {
      if (id !== reqId) return;
      $("#tablewrap").replaceChildren(el("div", { className: "empty", textContent: String(e.message || e) }));
      if (/expirad/i.test(String(e.message))) { toast("warn", "Sessão expirada", "Importe os arquivos novamente."); resetSessao(); }
      return;
    }
    if (id !== reqId) return;
    L.page = j.page;
    render(k, j);
  }

  function render(k, j) {
    const cols = S.abas[k].colunas;
    const loc = k === "localizados";
    const vis = cols.filter(c => j.rows.some(r => (r[c.key] ?? "") !== ""));
    const usar = vis.length ? vis : cols;
    const thead = el("thead", {}, el("tr", {}, el("th", { className: "n", textContent: "N." }),
      usar.map(c => el("th", { textContent: c.label, title: c.key === "busca" ? "Regra que localizou o aluno" : "" }))));
    const tbody = el("tbody");
    j.rows.forEach((r, i) => {
      const tr = el("tr", {}, el("td", { className: "n", textContent: j.offset + i + 1 }));
      usar.forEach(c => {
        const v = r[c.key] ?? "";
        const td = el("td", { title: v });
        if (c.key === "busca") {
          td.className = "c";
          td.append(el("span", { className: "badge", textContent: v, title: S.regras[v] || "" }));
          if (r.outras?.length) {
            td.append(el("span", { className: "badge plus", textContent: "+" + r.outras.length,
              title: "Também encontrado em:\n" + r.outras.map(o => `${o.turma} — ${o.escola} (${o.busca})`).join("\n") }));
          }
        } else if (["nis", "nasc", "inep", "inep_ge", "turma"].includes(c.key)) { td.className = "c"; td.textContent = v; }
        else td.textContent = v;
        tr.append(td);
      });
      tbody.append(tr);
    });
    const wrap = $("#tablewrap");
    wrap.replaceChildren(j.rows.length ? el("table", {}, thead, tbody)
      : el("div", { className: "empty", textContent: j.total ? "Nenhum registro corresponde à busca." : "Nenhum registro." }));
    wrap.scrollTop = 0;
    $("#cnt").textContent = fmtN(j.total);
    $("#cnt-f").textContent = j.filtrado !== j.total ? `· exibindo ${fmtN(j.filtrado)} na busca` : "";
    $("#p-info").textContent = `${j.page} / ${j.pages}`;
    $("#p-prev").disabled = j.page <= 1;
    $("#p-next").disabled = j.page >= j.pages;
    const lg = $("#legenda");
    lg.hidden = !loc;
    if (loc) lg.textContent = "Pesq. (busca): " + Object.entries(S.regras).map(([c, d]) => `${c} = ${d}`).join(" · ");
  }

  let t0;
  $("#q").addEventListener("input", e => {
    clearTimeout(t0);
    t0 = setTimeout(() => { S.list.q = e.target.value; S.list.page = 1; carregar(); }, 250);
  });
  $("#per").addEventListener("change", e => { S.list.per = +e.target.value; S.list.page = 1; carregar(); });
  $("#p-prev").addEventListener("click", () => { S.list.page--; carregar(); });
  $("#p-next").addEventListener("click", () => { S.list.page++; carregar(); });

  // ------------------------------------------------------------ relatórios
  const urlRel = (ext, extra = "") => `/api/sessao/${S.sid}/relatorio/${S.tab}.${ext}${extra}`;
  const dialog = $("#viewer");
  function visualizar() {
    const url = urlRel("pdf");
    if (navigator.pdfViewerEnabled === false || matchMedia("(max-width:720px)").matches || typeof dialog.showModal !== "function") {
      window.open(url, "_blank", "noopener"); return;
    }
    $("#v-title").textContent = S.abas[S.tab].titulo;
    $("#v-open").href = url;
    $("#v-down").href = urlRel("pdf", "?baixar=1");
    $("#v-frame").src = url;
    dialog.showModal();
  }
  $("#v-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { $("#v-frame").src = "about:blank"; });
  dialog.addEventListener("click", e => { if (e.target === dialog) dialog.close(); });
  function imprimir() {
    const f = el("iframe", { style: "position:fixed;right:0;bottom:0;width:0;height:0;border:0" });
    f.onload = () => {
      try { f.contentWindow.focus(); f.contentWindow.print(); }
      catch { window.open(urlRel("pdf"), "_blank", "noopener"); }
      setTimeout(() => f.remove(), 60000);
    };
    f.src = urlRel("pdf");
    document.body.append(f);
  }
  const baixar = url => { const a = el("a", { href: url, download: "" }); document.body.append(a); a.click(); a.remove(); };
  $("#b-ver").addEventListener("click", visualizar);
  $("#b-pdf").addEventListener("click", () => baixar(urlRel("pdf", "?baixar=1")));
  $("#b-csv").addEventListener("click", () => baixar(urlRel("csv")));
  $("#b-print").addEventListener("click", imprimir);

  // ------------------------------------------------------------ nova consulta / restaurar sessão
  function resetSessao() {
    if (S.sid) fetch(`/api/sessao/${S.sid}`, { method: "DELETE" }).catch(() => {});
    S.sid = null; S.est = null; store.del("sid");
    aplicar({ sid: null, mes_ref: mes.value, pbf: null, ge: null, resumo: null, regras: S.regras, abas: S.abas });
    store.del("sid");
    goTab("dados");
  }
  $("#btn-limpar").addEventListener("click", resetSessao);

  (async () => {
    if (!S.sid) return;
    try {
      const r = await fetch(`/api/sessao/${S.sid}/estado`);
      if (!r.ok) throw 0;
      aplicar(await r.json());
    } catch { S.sid = null; store.del("sid"); }
  })();
})();
