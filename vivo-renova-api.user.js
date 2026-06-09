// ==UserScript==
// @name         Vivo — Renova API
// @namespace    conectachip
// @version      1.1.0
// @updateURL    https://raw.githubusercontent.com/naldo-sat/tm-scripts-private-mirror/main/vivo-renova-api.user.js
// @downloadURL  https://raw.githubusercontent.com/naldo-sat/tm-scripts-private-mirror/main/vivo-renova-api.user.js
// @description  Renovação via API na conta já logada. Move por API (filtra blockConsumptionStatus + handshake validate:"1"→commit) + redistribui a cota (libera origem → set destino do GD → saveLines por linha). Independente da automação: sem login/logout/troca de conta, reusa a sessão ativa. Botão discreto no canto inferior esquerdo → modal com os grupos → "Renovar conta".
// @match        https://vivogestao.vivoempresas.com.br/Portal/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(function () {
  'use strict';

  const API = 'https://vivogestao.vivoempresas.com.br/Portal/api';
  const DP  = API + '/datapackconsumption';
  const MG  = API + '/datapackmanagergroup';
  const EMPTY_NAME = 'GRUPO SEM LINHAS';
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const pad = (n) => String(n).padStart(2, '0');

  // ─── Sessão: reusa a ativa (URL do GET loadView). NÃO faz login. ───
  function getSession() {
    const w = window;
    let s = (w.VG_AUTO && w.VG_AUTO.getSession && w.VG_AUTO.getSession()) ||
            (w.AVG_AUTO && w.AVG_AUTO.getSession && w.AVG_AUTO.getSession()) || {};
    if (!s.sessionId) {
      const u = performance.getEntriesByType('resource').map(e => e.name)
        .filter(x => x.includes('datapackconsumption') && x.includes('loadView')).pop();
      if (u) { const p = new URLSearchParams(u.split('?')[1] || ''); s = { sessionId: p.get('sessionId'), remoteHost: p.get('remoteHost'), remoteIp: p.get('remoteIp'), acessLogin: p.get('acessLogin') }; }
    }
    return (s && s.sessionId) ? { sessionId: s.sessionId, remoteHost: s.remoteHost || '', remoteIp: s.remoteIp || '', acessLogin: s.acessLogin || '' } : null;
  }

  const post = (url, body) => fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
    .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) }));

  async function loadView(sess) {
    const qs = new URLSearchParams({ action: 'loadView', technology: '4G', startRow: '1', fetchSize: '500', ...sess });
    const lv = await (await fetch(DP + '?' + qs, { headers: { Accept: 'application/json' } })).json();
    const all = [];
    (function walk(n) { if (!n || typeof n !== 'object') return; if (n.id != null && n.name != null) all.push(n); for (const c of (Array.isArray(n) ? n : Object.values(n))) if (c && typeof c === 'object') walk(c); })(lv);
    return all;
  }

  // estrutural = NÃO renovável (pool GD ou destino vazio). Tudo o mais é listável/selecionável.
  const estrutural = (g) => /(^|\s)GD\b|GD CONNECTA|GRUPO SEM LINHAS/i.test(g.name || '');
  const numerado   = (g) => /^\s*\d/.test(g.name || '');           // marcado por padrão
  const activeLines = (g) => (g.lines || []).filter(l => String(l.blockConsumptionStatus) !== '1');
  const qplFromName = (name) => { const m = (name || '').match(/(\d+(?:[.,]\d+)?)\s*GB/i); return m ? Number(m[1].replace(',', '.')) : null; };
  const findEmpty   = (all) => all.find(g => new RegExp(EMPTY_NAME, 'i').test(g.name || '') && (!g.lines || activeLines(g).length === 0)) || all.find(g => new RegExp(EMPTY_NAME, 'i').test(g.name || ''));

  async function editGroup(sess, id, name, quotaGb) {
    return post(MG, {
      action: 'edit', id: Number(id), name, isData: true, contextVoice: false, is5GPortifolio: 0,
      quota: { value: String(quotaGb), dataPackValueType: 'GB' }, limit: { dataPackValueType: 'MIN' }, manager: { login: '' },
      overBalanceAllCallsLimit: { dataPackValueType: 'MIN' }, overBalanceAllCallsLimitNextCycleControll: { dataPackValueType: 'MIN' },
      overBalanceLimit: { dataPackValueType: 'R$' }, overBalanceLimitNextCycleControll: { dataPackValueType: 'R$' },
      overBalanceLocalsLimit: { dataPackValueType: 'MIN' }, overBalanceLocalsLimitNextCycleControll: { dataPackValueType: 'MIN' },
      technology: '4G', ...sess,
    });
  }
  async function editGroupRetry(sess, id, name, quotaGb, tries = 5) {
    let last = null;
    for (let i = 0; i < tries; i++) { last = await editGroup(sess, id, name, quotaGb); if (last.json && (!last.json.severity || last.json.severity === 'info')) return true; await sleep(2000); }
    return false;
  }
  async function saveLinesQuota(sess, groupId, qpl, lines) {
    for (let i = 0; i < lines.length; i += 20) {
      const chunk = lines.slice(i, i + 20).map(l => ({ account: l.account, lineNumber: l.lineNumber || l.msisdn, userName: l.userName || l.name, quota: { value: String(qpl), dataPackValueType: 'GB' }, futureQuota: { value: String(qpl), dataPackValueType: 'GB' }, notifyManagerGroup: false }));
      let ok = false;
      for (let t = 0; t < 5 && !ok; t++) { const r = await post(DP, { action: 'saveLines', acessLogin: sess.acessLogin, sourceGroup: { id: Number(groupId) }, lines: chunk, remoteHost: sess.remoteHost, remoteIp: sess.remoteIp, sessionId: sess.sessionId }); ok = !!(r.json && (!r.json.severity || r.json.severity === 'info')); if (!ok) await sleep(2000); }
      if (!ok) return false;
    }
    return true;
  }

  // Renova UM grupo (achado por id no estado fresco): move por API + redistribui cota.
  async function renovarGrupo(sess, groupId, log) {
    const all = await loadView(sess);
    const g = all.find(x => String(x.id) === String(groupId));
    if (!g) return { ok: false, motivo: 'grupo não encontrado na conta' };
    const dest = findEmpty(all);
    if (!dest) return { ok: false, motivo: 'sem "GRUPO SEM LINHAS" de destino' };
    const lines = activeLines(g);
    if (!lines.length) return { skip: true, motivo: 'sem linhas pra mover' };
    const qpl = qplFromName(g.name) || (g.lines[0] && g.lines[0].quota && Number(g.lines[0].quota.value)) || null;
    const gid = Number(g.id), did = Number(dest.id), nome = g.name;

    const v = await post(DP, { action: 'moveLines', validate: '1', isData: true, hasHibridService: false, hasOverBalanceMonetaryVoice: true, sourceGroup: { id: gid }, destinationGroup: { id: did }, lines, ...sess });
    if (!(v.json && v.json.question)) return { ok: false, motivo: 'validate: ' + ((v.json && v.json.result) || v.status) };
    const c = await post(DP, { action: 'moveLines', sourceGroup: { id: gid }, destinationGroup: { id: did }, lines, ...sess });
    if (!(c.status === 200 && c.json && c.json.severity === 'info')) return { ok: false, motivo: 'move: ' + ((c.json && c.json.result) || c.status) };
    log(lines.length + ' linhas movidas — aplicando cota…');
    if (!qpl) return { ok: 'parcial', motivo: 'movido, sem GB no nome p/ cota' };

    await sleep(1500);
    await editGroup(sess, gid, EMPTY_NAME, 0);          // libera origem ao GD
    await sleep(2500);                                  // GD assimila
    const setOk = await editGroupRetry(sess, did, nome, Math.round(qpl * lines.length * 100) / 100, 5);
    if (!setOk) return { ok: 'parcial', motivo: 'movido, cota do grupo não aplicou (GD)' };
    const slOk = await saveLinesQuota(sess, did, qpl, lines);
    return { ok: !!slOk, motivo: slOk ? (lines.length + ' linhas × ' + qpl + 'GB') : 'cota grupo ok, por-linha falhou' };
  }

  // ─────────────────────── UI ───────────────────────
  const CSS = `
    #rv-fab{position:fixed;left:16px;bottom:16px;z-index:2147483646;display:flex;align-items:center;gap:7px;background:#0a66c2;color:#fff;border:none;border-radius:24px;padding:9px 16px;font:600 13px/1 -apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 4px 14px rgba(10,102,194,.35);cursor:pointer;transition:.15s}
    #rv-fab:hover{background:#0959ab;box-shadow:0 6px 18px rgba(10,102,194,.45)}
    #rv-ov{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:2147483647;display:none;align-items:center;justify-content:center;font:14px/1.4 -apple-system,Segoe UI,Roboto,sans-serif}
    #rv-md{background:#fff;width:560px;max-width:94vw;max-height:88vh;border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.35)}
    #rv-hd{padding:16px 20px;background:linear-gradient(135deg,#0a66c2,#1565C0);color:#fff}
    #rv-hd h3{margin:0;font-size:16px;font-weight:700}
    #rv-hd .sub{font-size:12px;opacity:.9;margin-top:3px}
    #rv-tools{display:flex;gap:14px;align-items:center;padding:10px 20px;border-bottom:1px solid #eef2f7;background:#f8fafc;font-size:12px;color:#475569}
    #rv-tools a{color:#0a66c2;cursor:pointer;text-decoration:none;font-weight:600}
    #rv-bd{padding:6px 8px 6px 20px;overflow:auto;flex:1}
    .rv-row{display:flex;align-items:center;gap:11px;padding:9px 12px 9px 0;border-bottom:1px solid #f1f5f9}
    .rv-row:hover{background:#f8fafc}
    .rv-cb{width:18px;height:18px;flex:0 0 auto;accent-color:#0a66c2;cursor:pointer;-webkit-appearance:checkbox!important;appearance:auto!important;opacity:1!important;position:static!important;margin:0}
    .rv-nm{flex:1;font-weight:600;color:#0f172a}
    .rv-ct{font-size:12px;color:#94a3b8;white-space:nowrap}
    #rv-ft{padding:14px 20px;border-top:1px solid #eef2f7;display:flex;gap:10px;align-items:center;background:#fff}
    #rv-hint{font-size:12px;color:#64748b;margin-right:auto}
    #rv-go{background:#0a66c2;color:#fff;border:none;border-radius:9px;padding:10px 22px;font-weight:700;font-size:14px;cursor:pointer;transition:.15s}
    #rv-go:hover{background:#0959ab}#rv-go:disabled{opacity:.45;cursor:default}
    #rv-x{background:#eef2f7;color:#334155;border:none;border-radius:9px;padding:10px 16px;font-weight:600;cursor:pointer}
    .rv-li{padding:7px 2px;border-bottom:1px solid #f4f7fb;font-size:13px;color:#334155}
    .rv-ok{color:#15803d}.rv-fail{color:#dc2626}.rv-part{color:#c2410c}.rv-skip{color:#64748b}
    #rv-sum{margin-top:12px;padding:12px 14px;border-radius:10px;background:#f0f9ff;border:1px solid #bae6fd;font:600 14px/1.4 ui-monospace,Menlo,monospace;color:#0c4a6e}
  `;
  const el = (h) => { const d = document.createElement('div'); d.innerHTML = h.trim(); return d.firstChild; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function openModal() {
    const sess = getSession();
    const ov = document.getElementById('rv-ov'), bd = document.getElementById('rv-bd');
    ov.style.display = 'flex';
    document.getElementById('rv-conta').textContent = sess ? ('Conta ' + sess.acessLogin) : 'sessão não encontrada';
    if (!sess) { bd.innerHTML = '<p style="color:#dc2626;padding:16px">Sessão não encontrada. Recarregue a tela de Consumo de Dados (logado) e reabra.</p>'; document.getElementById('rv-go').disabled = true; return; }
    bd.innerHTML = '<p style="color:#64748b;padding:16px">Carregando grupos…</p>';
    loadView(sess).then(all => {
      const grupos = all.filter(g => !estrutural(g)).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt', { numeric: true }));
      if (!grupos.length) { bd.innerHTML = '<p style="padding:16px">Nenhum grupo encontrado.</p>'; return; }
      bd.innerHTML = grupos.map(g => `<label class="rv-row">
        <input type="checkbox" class="rv-cb" value="${g.id}" data-name="${esc(g.name)}" ${numerado(g) ? 'checked' : ''}>
        <span class="rv-nm">${esc(g.name)}</span>
        <span class="rv-ct">${activeLines(g).length} linha(s)</span></label>`).join('');
      document.getElementById('rv-go').disabled = false;
    }).catch(e => { bd.innerHTML = '<p style="color:#dc2626;padding:16px">Erro ao listar: ' + esc(e.message) + '</p>'; });
  }

  async function executar() {
    const sess = getSession();
    if (!sess) return;
    const alvos = [...document.querySelectorAll('.rv-cb:checked')].map(c => ({ id: c.value, name: c.dataset.name }));
    if (!alvos.length) { alert('Marque ao menos 1 grupo.'); return; }
    if (!confirm('Renovar ' + alvos.length + ' grupo(s) por API nesta conta?')) return;
    const go = document.getElementById('rv-go'), bd = document.getElementById('rv-bd');
    go.disabled = true;
    bd.innerHTML = '<div id="rv-log"></div>';
    const logBox = document.getElementById('rv-log');
    const line = (txt, cls) => { const p = document.createElement('div'); p.className = 'rv-li' + (cls ? ' ' + cls : ''); p.innerHTML = txt; logBox.appendChild(p); bd.scrollTop = bd.scrollHeight; return p; };
    const t0 = new Date();
    let ok = 0, part = 0, fail = 0, skip = 0; const falhas = [];
    for (const a of alvos) {
      const row = line('⏳ ' + esc(a.name) + '…');
      try {
        const r = await renovarGrupo(sess, a.id, (m) => { row.innerHTML = '⏳ ' + esc(a.name) + ' — ' + esc(m); });
        if (r.skip) { skip++; row.className = 'rv-li rv-skip'; row.innerHTML = '⏭️ ' + esc(a.name) + ' — ' + esc(r.motivo); }
        else if (r.ok === true) { ok++; row.className = 'rv-li rv-ok'; row.innerHTML = '✅ ' + esc(a.name) + ' — ' + esc(r.motivo); }
        else if (r.ok === 'parcial') { part++; falhas.push(a.name); row.className = 'rv-li rv-part'; row.innerHTML = '⚠️ ' + esc(a.name) + ' — ' + esc(r.motivo); }
        else { fail++; falhas.push(a.name); row.className = 'rv-li rv-fail'; row.innerHTML = '❌ ' + esc(a.name) + ' — ' + esc(r.motivo); }
      } catch (e) { fail++; falhas.push(a.name); row.className = 'rv-li rv-fail'; row.innerHTML = '❌ ' + esc(a.name) + ' — ' + esc(e.message); }
    }
    const s = Math.round((Date.now() - t0.getTime()) / 1000);
    const dur = s >= 60 ? (Math.floor(s / 60) + 'min ' + (s % 60) + 's') : (s + 's');
    const hhmm = pad(t0.getHours()) + ':' + pad(t0.getMinutes());
    let txt = 'OK: ' + ok + '/' + alvos.length + ' | ' + hhmm + ' — duração (' + dur + ')';
    if (part || skip || fail) txt += '<br><span style="font-weight:500;font-size:12px">' + (part ? '⚠️ ' + part + ' parcial · ' : '') + (skip ? '⏭️ ' + skip + ' sem linhas · ' : '') + (fail ? '❌ ' + fail + ' falha' : '') + '</span>';
    if (falhas.length) txt += '<br><span style="font-weight:500;font-size:12px">Revisar: ' + esc(falhas.join(', ')) + '</span>';
    const sum = document.createElement('div'); sum.id = 'rv-sum'; sum.innerHTML = txt; logBox.appendChild(sum);
    bd.scrollTop = bd.scrollHeight;
    go.disabled = false; go.textContent = 'Renovar de novo';
  }

  function mount() {
    if (document.getElementById('rv-fab')) return;
    document.head.appendChild(el('<style>' + CSS + '</style>'));
    const fab = el('<button id="rv-fab">↻ Renovar via API</button>'); fab.onclick = openModal;
    document.body.appendChild(fab);
    const ov = el(`<div id="rv-ov"><div id="rv-md">
      <div id="rv-hd"><h3>Renovação via API</h3><div class="sub" id="rv-conta"></div></div>
      <div id="rv-tools"><span>Marque os grupos a renovar:</span><a id="rv-all">todos</a><a id="rv-none">nenhum</a><a id="rv-num">só numerados</a></div>
      <div id="rv-bd"></div>
      <div id="rv-ft"><span id="rv-hint">os marcados serão processados</span><button id="rv-x">Fechar</button><button id="rv-go" disabled>Renovar conta</button></div>
    </div></div>`);
    document.body.appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) ov.style.display = 'none'; });
    document.getElementById('rv-x').onclick = () => { ov.style.display = 'none'; };
    document.getElementById('rv-go').onclick = executar;
    const setAll = (fn) => document.querySelectorAll('.rv-cb').forEach(fn);
    document.getElementById('rv-all').onclick = () => setAll(c => c.checked = true);
    document.getElementById('rv-none').onclick = () => setAll(c => c.checked = false);
    document.getElementById('rv-num').onclick = () => setAll(c => c.checked = /^\s*\d/.test(c.dataset.name || ''));
  }

  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
