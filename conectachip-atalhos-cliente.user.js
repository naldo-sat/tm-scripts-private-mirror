// ==UserScript==
// @name         ConectaChip – Atalhos do Cliente (GestãoClick)
// @namespace    http://tampermonkey.net/
// @version      2.7
// @updateURL    https://raw.githubusercontent.com/naldo-sat/tm-scripts-private-mirror/main/conectachip-atalhos-cliente.user.js
// @downloadURL  https://raw.githubusercontent.com/naldo-sat/tm-scripts-private-mirror/main/conectachip-atalhos-cliente.user.js
// @description  Injeta botões de atalho em Editar Cliente, Contas a receber e Assinaturas.
// @match        https://portal.conectachip.com.br/clientes/editar/*
// @match        https://portal.conectachip.com.br/clientes/visualizar/*
// @match        https://portal.conectachip.com.br/movimentacoes_financeiras/index_recebimento*
// @match        https://portal.conectachip.com.br/servicos_recorrentes*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const LOJA = '158520';

  // ── Construtores de URL ──────────────────────────────────────────────────────

  function urlEditar(id) {
    return `https://portal.conectachip.com.br/clientes/editar/${id}`;
  }

  function urlContasReceber(id, nome) {
    return 'https://portal.conectachip.com.br/movimentacoes_financeiras/index_recebimento?' + [
      `loja=${LOJA}`, 'codigo=', 'numero-boleto=', 'tipo-entidade=C',
      `cliente=${id}`, 'fornecedor=', 'transportadora=', 'funcionario=',
      'outros=', 'nome=', 'data_inicio=', 'data_fim=',
      'data_inicio_emissao=', 'data_fim_emissao=',
      'data_inicio_boleto=', 'data_fim_boleto=',
      'valor_inicio=', 'valor_fim=', 'baixado=', 'situacao=',
      'categoria=', 'centro-custo=', 'nota=', 'nfse=',
      'conta_bancaria=', 'forma_pagamento=', 'tipo=C',
      `cliente_id=${id}`,
      `nome_cliente=${encodeURIComponent(nome)}`,
      'situacaoBuscaAvancada=true', 'atributo[7945]=',
    ].join('&');
  }

  function urlAssinaturas(id) {
    return 'https://portal.conectachip.com.br/servicos_recorrentes?' + [
      `loja=${LOJA}`, 'codigo=', 'cliente=',
      `cliente-id=${id}`, 'nome_cliente=',
      'data_inicio=', 'data_fim=', 'situacao=',
      'centro-custo=', 'detalhes=', 'atributo=',
      'situacaoBuscaAvancada=true',
    ].join('&');
  }

  // ── Botões: usa a classe .btn do Bootstrap já carregado pelo portal ──────────
  // Só sobrescrevemos background e color — todo o resto (padding, font, height)
  // vem do Bootstrap nativo, garantindo visual idêntico ao Buscar/Limpar.

  const hoverOn  = "this.style.filter='brightness(1.15)'";
  const hoverOff = "this.style.filter=''";

  function makeHeaderLink(href, icon, label) {
    return `<a href="${href}" class="btn"
      style="background:#2157d9;color:#fff;"
      onmouseover="${hoverOn}" onmouseout="${hoverOff}">
      <i class="glyphicon ${icon}"></i> ${label}
    </a>`;
  }

  function makePageLink(href, icon, label) {
    return `<a href="${href}" class="btn"
      style="background:#2157d9;color:#fff;"
      onmouseover="${hoverOn}" onmouseout="${hoverOff}">
      <i class="glyphicon ${icon}"></i> ${label}
    </a>`;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ROTEAMENTO
  // ════════════════════════════════════════════════════════════════════════════

  const path   = location.pathname;
  const params = new URLSearchParams(location.search);

  if (path.includes('/clientes/editar/')) {
    runEditar();
  } else if (path.includes('/clientes/visualizar/')) {
    runVisualizar();
  } else if (path.includes('/movimentacoes_financeiras/index_recebimento')) {
    runContasReceber();
  } else if (path.includes('/servicos_recorrentes')) {
    runAssinaturas();
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PÁGINA: EDITAR CLIENTE
  // Botões à direita do header "Dados gerais"
  // ════════════════════════════════════════════════════════════════════════════

  function runEditar() {
    const pathMatch = path.match(/\/clientes\/editar\/(\d+)/);
    if (!pathMatch) return;

    const id = pathMatch[1];

    // Caso 1: nome vem como parâmetro direto (?nome=JORGE...)
    // Caso 2: nome vem dentro do retorno (?retorno=/clientes?nome=Jorge...)
    let nome = params.get('nome') || '';
    if (!nome) {
      const retorno = params.get('retorno') || '';
      nome = new URLSearchParams(retorno.split('?')[1] || '').get('nome') || '';
    }

    function inject() {
      const header = Array.from(document.querySelectorAll('.card-header'))
        .find(el => el.textContent.includes('Dados gerais'));
      if (!header || header.querySelector('#cc-atalhos-editar')) return;

      // Deixa o header flex para empurrar os botões para a direita
      header.style.cssText += ';display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;';

      const wrap = document.createElement('div');
      wrap.id = 'cc-atalhos-editar';
      wrap.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
      wrap.innerHTML =
        makeHeaderLink(urlContasReceber(id, nome), 'glyphicon-stats',   'Contas a receber') +
        makeHeaderLink(urlAssinaturas(id),          'glyphicon-refresh', 'Assinaturas');

      header.appendChild(wrap);
    }

    inject();
    new MutationObserver(inject).observe(document.body, { childList: true, subtree: true });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PÁGINA: VISUALIZAR CLIENTE
  // Botões ao lado do botão "Editar cadastro" — só tem ID, sem nome na URL
  // ════════════════════════════════════════════════════════════════════════════

  function runVisualizar() {
    const pathMatch = path.match(/\/clientes\/visualizar\/(\d+)/);
    if (!pathMatch) return;
    const id = pathMatch[1];

    function inject() {
      if (document.getElementById('cc-atalhos-visualizar')) return;

      // Localiza o botão "Editar cadastro" pelo href
      const editarBtn = document.querySelector('a[href="/clientes/editar/' + id + '"]');
      if (!editarBtn) return;

      const wrap = document.createElement('span');
      wrap.id = 'cc-atalhos-visualizar';
      wrap.style.cssText = 'display:inline-flex;gap:6px;margin-left:6px;margin-right:6px;';
      wrap.innerHTML =
        makePageLink(urlContasReceber(id, ''), 'glyphicon-stats',   'Contas a receber') +
        makePageLink(urlAssinaturas(id),        'glyphicon-refresh', 'Assinaturas');

      editarBtn.insertAdjacentElement('beforebegin', wrap);
    }

    inject();
    new MutationObserver(inject).observe(document.body, { childList: true, subtree: true });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PÁGINA: CONTAS A RECEBER
  // Botões "Editar cliente" e "Assinaturas" ao lado do botão Limpar
  // ════════════════════════════════════════════════════════════════════════════

  function runContasReceber() {
    const id   = params.get('cliente_id') || params.get('cliente') || '';
    const nome = params.get('nome_cliente') || '';
    if (!id) return;

    function inject() {
      if (document.getElementById('cc-atalhos-contas')) return;

      // Localiza o botão "Limpar" pelo texto
      const limparBtn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.trim().includes('Limpar'));
      if (!limparBtn) return;

      const wrap = document.createElement('span');
      wrap.id = 'cc-atalhos-contas';
      wrap.style.cssText = 'display:inline-flex;gap:6px;margin-left:6px;';
      wrap.innerHTML =
        makePageLink(urlEditar(id),       'glyphicon-pencil',  'Editar cliente') +
        makePageLink(urlAssinaturas(id),  'glyphicon-refresh', 'Assinaturas');

      limparBtn.insertAdjacentElement('afterend', wrap);
    }

    inject();
    new MutationObserver(inject).observe(document.body, { childList: true, subtree: true });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PÁGINA: ASSINATURAS
  // Botões "Editar cliente" e "Contas a receber" ao lado do botão Limpar
  // ════════════════════════════════════════════════════════════════════════════

  function runAssinaturas() {
    const id   = params.get('cliente-id') || '';
    const nome = params.get('nome_cliente') || '';
    if (!id) return;

    function inject() {
      if (document.getElementById('cc-atalhos-assin')) return;

      const limparBtn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.trim().includes('Limpar'));
      if (!limparBtn) return;

      const wrap = document.createElement('span');
      wrap.id = 'cc-atalhos-assin';
      wrap.style.cssText = 'display:inline-flex;gap:6px;margin-left:6px;';
      wrap.innerHTML =
        makePageLink(urlEditar(id),              'glyphicon-pencil', 'Editar cliente') +
        makePageLink(urlContasReceber(id, nome), 'glyphicon-stats',  'Contas a receber');

      limparBtn.insertAdjacentElement('afterend', wrap);
    }

    inject();
    new MutationObserver(inject).observe(document.body, { childList: true, subtree: true });
  }

})();