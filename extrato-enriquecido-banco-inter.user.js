// ==UserScript==
// @name         Extrato Enriquecido — Banco Inter (ConectaChip)
// @namespace    naldo.conectachip.extrato
// @version      6.5.3
// @updateURL    https://raw.githubusercontent.com/naldo-sat/tm-scripts-private-mirror/main/extrato-enriquecido-banco-inter.user.js
// @downloadURL  https://raw.githubusercontent.com/naldo-sat/tm-scripts-private-mirror/main/extrato-enriquecido-banco-inter.user.js
// @description  v6.5.3: Excluir nota robusto (flag excluindo), salvar vazio não apaga, bookmark/clone vermelhos em saídas
// @match        https://portal.conectachip.com.br/banco_inter/extratos*
// @match        https://portal.conectachip.com.br/movimentacoes_financeiras/adicionar_pagamento*
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

/*
CHANGELOG v6.5.0:
1. IMPORT — preservar nota existente quando coluna Nota do xlsx estiver vazia.
   Antes: nota vazia no xlsx deletava a nota salva. Agora: só sobrescreve se
   o xlsx trouxer um valor não-vazio para aquela linha.
2. NOME DO ARQUIVO — padrão "Relatório de Pagamentos - [Filtro] - DD-MM-YYYY.xlsx".
3. CLIQUE POR COLUNA:
   - Clicar na coluna Nome → copia o nome para o clipboard (sem pintar).
     Cursor "copy" no texto do nome. Ícone bookmark e nota inline mantêm comportamento.
   - Clicar em Tipo / Data / Valor → pinta/despinta a linha (comportamento anterior).
4. BORDA TRACEJADA — removida a linha pontilhada abaixo do texto da nota inline.
*/

(function () {
  'use strict';

  // ============================================================
  // CONSTANTES
  // ============================================================
  const SEL = {
    TABLE:    'table.b-table.table-striped',
    ROWS:     'table.b-table.table-striped tbody tr',
    COL_NOME: 'td[aria-colindex="1"]',
    COL_TIPO: 'td[aria-colindex="2"]',
    COL_DATA: 'td[aria-colindex="3"]',
    COL_VALOR:'td[aria-colindex="4"]',
    TH_NOME:  'th[aria-colindex="1"]',
    TH_DATA:  'th[aria-colindex="3"]',
    TH_VALOR: 'th[aria-colindex="4"]',
    SALDO_TD: 'tr.cabecalho-dia-tr td.d-flex.justify-content-between',
    ESQ:      'div.mb-2.col.col-auto',
    DIR:      'div.mb-2.text-right.col',
    BTN_BUSCAR:'button[type="submit"].btn.mr-1.btn-success',
    DT_INI:   '#data_inicio',
    DT_FIM:   '#data_fim',
  };

  const URL_DESPESA = 'https://portal.conectachip.com.br/movimentacoes_financeiras/adicionar_pagamento?retorno=%2Fmovimentacoes_financeiras%2Findex_pagamento';
  const URL_CLIENTE = 'https://portal.conectachip.com.br/clientes';

  const LS_FILTROS = 'extratoConecta:filtros';
  const LS_DESPESA = 'extratoConecta:despesaPendente';
  const KEY_RF_MIN = 'cc_refresh_min';
  const KEY_RF_ON  = 'cc_refresh_ativo';
  const KEY_RF_INI = 'cc_refresh_inicio';
  const PFX_CONCIL = 'cc:concil:';
  const PFX_NOTA   = 'cc:nota:';

  const MARKER = 'cc-enriched';
  const HIDDEN = 'cc-hidden';
  const ROW_CE = 'cc-conciliada-entrada';
  const ROW_CS = 'cc-conciliada-saida';

  const COR_BLUE    = '#2157d9';
  const COR_ICONE   = '#6fc17c';   // entradas / neutro
  const COR_SAIDA_IC = '#b03a2e';  // saídas (despesa, bookmark, clone em linha vermelha)
  const COR_CONCIL_E = '#a5d6a7';
  const COR_CONCIL_S = '#ef9a9a';
  const WPP_SEP     = '──────────────────────────';
  // Cor do ícone baseada no tipo da linha
  const corLinha = tr => tr.classList.contains('table-danger') ? COR_SAIDA_IC : COR_ICONE;

  const XL_HDR  = '2157D9';
  const XL_CONS = 'C8E6C9';
  const XL_PEND = 'FFCDD2';
  const XL_TOT  = 'F8F9FA';

  const DESPESA_TTL = 60_000;
  const SCROLL_TMO  = 60_000;
  const SCROLL_WAIT = 5_000;
  const FILTRO_DEB  = 200;
  const TTL_DIAS    = 30;
  const COPY_FB_MS  = 900;
  const FIM_TXT     = 'todas as transações foram carregadas';

  // Classes que impedem toggle de conciliação (clique na TR)
  const IGN_CLICK = [
    'cc-icon-btn','cc-copy-btn','cc-nota-btn','cc-receita','cc-despesa',
    'cc-cell-icons','cc-nota-editor-wrap','cc-nota-actions',
  ];

  let filtroSinal = null, filtroNome = '', debFiltro = null;
  let rfTimeout = null, rfInterval = null, nextRfTs = 0;
  const sort = { col: null, dir: null };
  const SORT_DEF = { nome:'asc', data:'desc', valor:'desc' };

  // ============================================================
  // HELPERS
  // ============================================================
  const parseVal  = s => parseFloat(String(s).replace(/\./g,'').replace(',','.'));
  const fmtBRL    = n => n.toLocaleString('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtNumBR  = n => n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtAbsBR  = n => Math.abs(n).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtData   = d => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  const fmtDataFN = d => `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;
  const parseDtBR = s => { if(!s)return null; const m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m?new Date(+m[3],+m[2]-1,+m[1]):null; };
  const escHtml   = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const fmtWpp    = n => n>=0?`+R$ ${fmtAbsBR(n)}`:`-R$ ${fmtAbsBR(n)}`;

  function waitEl(sel,ms=5000){
    return new Promise((res,rej)=>{
      const f=document.querySelector(sel);if(f)return res(f);
      const obs=new MutationObserver(()=>{const el=document.querySelector(sel);if(el){obs.disconnect();res(el);}});
      obs.observe(document.body,{childList:true,subtree:true});
      setTimeout(()=>{obs.disconnect();rej();},ms);
    });
  }
  function fillVue(inp,val){
    const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    s.call(inp,val);inp.dispatchEvent(new Event('input',{bubbles:true}));inp.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function toast(msg,ok=true){
    let t=document.querySelector('.cc-toast');
    if(!t){t=document.createElement('div');t.className='cc-toast';document.body.appendChild(t);}
    t.textContent=msg;t.style.background=ok?'#28a745':'#dc3545';
    t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),2500);
  }
  async function clipboard(txt){
    try{await navigator.clipboard.writeText(txt);return true;}
    catch{try{const ta=Object.assign(document.createElement('textarea'),{value:txt,style:'position:fixed;left:-9999px'});document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();return true;}catch{return false;}}
  }
  function getNome(tr){
    if(tr.dataset.ccNome)return tr.dataset.ccNome;
    const td=tr.querySelector(SEL.COL_NOME);if(!td)return'';
    const n=[...td.childNodes].find(x=>x.nodeType===Node.TEXT_NODE&&x.textContent.trim());
    const t=n?n.textContent.trim():td.textContent.trim();tr.dataset.ccNome=t;return t;
  }
  function getValor(tr){
    if(tr.dataset.ccValor)return tr.dataset.ccValor;
    const td=tr.querySelector(SEL.COL_VALOR);if(!td)return'';
    const v=td.textContent.trim();tr.dataset.ccValor=v;return v;
  }
  const getContNativo=()=>document.querySelector(SEL.BTN_BUSCAR)?.parentElement??null;
  const getBtnAtu=()=>[...document.querySelectorAll('button.btn.btn-success[type="button"]')].find(b=>b.querySelector('i.fa-refresh')||/atualizar/i.test(b.textContent.trim()));

  // ============================================================
  // CSS
  // ============================================================
  function injetarCSS(){
    if(document.getElementById('cc-styles'))return;
    const s=document.createElement('style');s.id='cc-styles';
    s.textContent=`
      .cc-cell-flex{display:flex;align-items:center;justify-content:space-between;gap:6px;width:100%;}
      .cc-cell-content{display:inline-flex;align-items:center;gap:5px;min-width:0;flex:1 1 auto;overflow:hidden;}
      .cc-cell-icons{display:inline-flex;align-items:center;gap:5px;flex-shrink:0;}

      /* Nome: não trunca; cursor "copy" indica que clicar copia */
      .cc-nome-text{flex-shrink:0;white-space:nowrap;cursor:copy;}

      /* Nota inline: preenche espaço até o ícone; sem borda tracejada */
      .cc-nota-inline-wrap{flex:1 1 0%;min-width:0;display:flex;align-items:center;overflow:hidden;}
      .cc-nota-inline{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#6c757d;font-size:.73rem;font-style:italic;cursor:text;}
      .cc-nota-inline:hover{color:#495057;}

      .cc-icon-btn{font-size:1rem;padding:0 3px;cursor:pointer;opacity:.65;transition:opacity .15s;display:inline-block;}
      .cc-icon-btn:hover{opacity:1;}

      ${SEL.ROWS}.${MARKER}{cursor:pointer;}
      ${SEL.ROWS}.${MARKER}:hover td{filter:brightness(.96);}
      tr.${ROW_CE}>td{background-color:${COR_CONCIL_E}!important;}
      tr.${ROW_CS}>td{background-color:${COR_CONCIL_S}!important;}

      /* Coluna Nome: cursor default (não confundir com pointer da linha) */
      ${SEL.ROWS}.${MARKER} ${SEL.COL_NOME}{cursor:default;}

      /* Editor de nota */
      .cc-nota-editor-wrap{padding:4px 6px;border-top:1px solid #e9ecef;background:#fafbfc;border-radius:0 0 4px 4px;}
      .cc-nota-editor-row{display:flex;align-items:flex-start;gap:5px;}
      .cc-nota-textarea{flex:1;padding:4px 7px;font-size:.8rem;border:1.5px solid ${COR_BLUE};border-radius:4px;resize:none;outline:none;font-family:inherit;line-height:1.4;height:32px;min-height:32px;max-height:70px;overflow-y:auto;box-shadow:0 0 0 2px rgba(33,87,217,.1);}
      .cc-nota-actions{display:flex;flex-direction:column;gap:3px;flex-shrink:0;}
      .cc-nota-del-btn{background:none;border:1px solid #dee2e6;cursor:pointer;font-size:.82rem;color:#6c757d;padding:4px 8px;border-radius:4px;transition:background .12s,color .12s;display:inline-flex;align-items:center;gap:3px;}
      .cc-nota-del-btn:hover{color:#dc3545;background:#fff0f0;border-color:#f5c6cb;}

      /* Totalizadores */
      .cc-totais{display:inline-flex;gap:18px;margin-left:24px;align-items:center;font-size:1rem;font-weight:700;}
      .cc-totais .cc-e{color:#28a745;}.cc-totais .cc-s{color:#dc3545;}.cc-totais .cc-t{color:#007bff;}.cc-totais .cc-i{color:#6c757d;font-style:italic;font-weight:500;}
      /* Ícone despesa: vermelho escuro por padrão, ainda mais escuro na linha consolidada */
      .cc-despesa{color:#b03a2e!important;}
      tr.${ROW_CS} .cc-despesa{color:#7b241c!important;}
      /* Bookmark e clone em linhas de saída consolidadas ficam mais escuros */
      tr.${ROW_CS} .cc-nota-btn{color:#7b241c!important;}
      tr.${ROW_CS} .cc-copy-btn{color:#7b241c!important;}


      .cc-toast{position:fixed;bottom:24px;right:24px;background:#28a745;color:#fff;padding:10px 16px;border-radius:4px;z-index:9999;opacity:0;transition:opacity .3s;pointer-events:none;font-size:14px;max-width:360px;}
      .cc-toast.show{opacity:1;}

      /* Topo */
      #cc-busca-area{display:inline-flex;gap:6px;align-items:center;margin-right:8px;}
      .cc-btn-periodo{background-color:${COR_BLUE}!important;border-color:${COR_BLUE}!important;color:#fff!important;margin-left:4px;}
      #cc-refresh-area{display:inline-flex;gap:6px;align-items:center;margin-left:12px;}
      #cc-refresh-area label{margin:0;font-size:.875rem;font-weight:500;}
      #cc-rf-inp{width:90px;text-align:center;}
      #cc-rf-inp.cc-err{border-color:#dc3545!important;}
      #cc-rf-inp[readonly]{background:#f8f9fa;font-family:ui-monospace,monospace;font-weight:600;color:#495057;}

      /* Headers ordenáveis */
      ${SEL.TH_NOME},${SEL.TH_DATA},${SEL.TH_VALOR}{cursor:pointer;user-select:none;white-space:nowrap;}
      ${SEL.TH_NOME}:hover,${SEL.TH_DATA}:hover,${SEL.TH_VALOR}:hover{background:rgba(0,0,0,.04);}
      .cc-sort-ind{display:inline;font-size:.7rem;margin-left:3px;opacity:.7;}

      /* Modal */
      #cc-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center;}
      #cc-modal{background:#fff;border-radius:10px;overflow:hidden;min-width:320px;max-width:400px;box-shadow:0 12px 40px rgba(0,0,0,.25);}
      #cc-modal .cc-mhd{background:${COR_BLUE};color:#fff;font-weight:700;font-size:1.05rem;text-align:center;padding:13px 20px;}
      #cc-modal .cc-mbody{padding:16px 20px;}
      .cc-sec-lbl{font-size:.67rem;font-weight:700;letter-spacing:.09em;color:#adb5bd;text-transform:uppercase;display:flex;align-items:center;gap:8px;margin-bottom:10px;}
      .cc-sec-lbl::after{content:'';flex:1;height:1px;background:#e9ecef;}
      .cc-mgroup{margin-bottom:13px;}.cc-mgroup:last-child{margin-bottom:0;}
      .cc-mgroup>label{font-weight:600;font-size:.74rem;text-transform:uppercase;letter-spacing:.06em;color:#6c757d;display:block;margin-bottom:7px;}
      .cc-hint{font-size:.74rem;color:#adb5bd;margin-top:5px;display:block;}
      .cc-fbtns{display:flex;gap:6px;flex-wrap:wrap;}
      .cc-fbtn{border:1.5px solid #ced4da;background:#fff;color:#495057;border-radius:6px;padding:5px 12px;font-size:.82rem;font-weight:500;cursor:pointer;transition:all .15s;white-space:nowrap;}
      .cc-fbtn:hover{border-color:${COR_BLUE};color:${COR_BLUE};}
      .cc-fbtn.on{background:${COR_BLUE};border-color:${COR_BLUE};color:#fff;}
      .cc-import-btn{background:none;border:1.5px solid #ced4da;color:#495057;border-radius:6px;padding:7px 14px;font-size:.875rem;cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:6px;}
      .cc-import-btn:hover{background:#f8f9fa;border-color:${COR_BLUE};color:${COR_BLUE};}
      #cc-modal .cc-mfoot{padding:12px 20px;background:#f8f9fa;border-top:1px solid #e9ecef;display:flex;justify-content:flex-end;gap:7px;}
      .cc-btn-ok{background:${COR_BLUE};border:1.5px solid ${COR_BLUE};color:#fff;border-radius:6px;padding:7px 18px;font-size:.875rem;font-weight:600;cursor:pointer;transition:background .15s;display:inline-flex;align-items:center;gap:5px;}
      .cc-btn-ok:hover{background:#1a47b3;}
      .cc-btn-ok:disabled{background:#a0b4e8;border-color:#a0b4e8;cursor:not-allowed;}
      .cc-btn-cl{background:#fff;border:1.5px solid #ced4da;color:#495057;border-radius:6px;padding:7px 18px;font-size:.875rem;font-weight:500;cursor:pointer;}
      .cc-btn-cl:hover{background:#f1f3f5;}
    `;
    document.head.appendChild(s);
  }

  // ============================================================
  // LAYOUT WRAPPER
  // ============================================================
  function wrapCell(td){
    let w=td.querySelector(':scope>.cc-cell-flex');if(w)return w;
    w=document.createElement('div');w.className='cc-cell-flex';
    const c=document.createElement('span');c.className='cc-cell-content';
    const i=document.createElement('span');i.className='cc-cell-icons';
    while(td.firstChild)c.appendChild(td.firstChild);
    w.appendChild(c);w.appendChild(i);td.appendChild(w);return w;
  }
  const cellContent=td=>wrapCell(td).querySelector(':scope>.cc-cell-content');
  const cellIcons=td=>wrapCell(td).querySelector(':scope>.cc-cell-icons');

  // Encapsula o text node do nome em span.cc-nome-text (flex-shrink:0)
  function wrapNomeText(tr){
    const td=tr.querySelector(SEL.COL_NOME);if(!td)return;
    const cnt=cellContent(td);if(!cnt||cnt.querySelector('.cc-nome-text'))return;
    const tn=[...cnt.childNodes].find(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim());
    if(!tn)return;
    const sp=document.createElement('span');sp.className='cc-nome-text';
    cnt.insertBefore(sp,tn);sp.appendChild(tn);
  }

  // ============================================================
  // CONCILIAÇÃO
  // ============================================================
  function hashLinha(tr){
    const d=tr.querySelector(SEL.COL_DATA)?.textContent.trim()||'';
    return`${d}|${getNome(tr)}|${getValor(tr)}|${tr.querySelector(SEL.COL_TIPO)?.textContent.trim()||''}`;
  }
  const isConcil=tr=>tr.classList.contains(ROW_CE)||tr.classList.contains(ROW_CS);
  function aplicarCor(tr){if(tr.classList.contains('table-success'))tr.classList.add(ROW_CE);else if(tr.classList.contains('table-danger'))tr.classList.add(ROW_CS);}
  const limparCor=tr=>tr.classList.remove(ROW_CE,ROW_CS);
  function salvarConcil(tr,on){
    const h=hashLinha(tr),d=tr.querySelector(SEL.COL_DATA)?.textContent.trim()||'';
    try{if(on)GM_setValue(PFX_CONCIL+h,{marked:true,savedAt:Date.now(),data:d});else GM_deleteValue(PFX_CONCIL+h);}catch{}
  }
  function restaurarConcil(tr){try{const v=GM_getValue(PFX_CONCIL+hashLinha(tr));if(v?.marked)aplicarCor(tr);}catch{}}
  function toggleConcil(tr){if(isConcil(tr)){limparCor(tr);salvarConcil(tr,false);}else{aplicarCor(tr);salvarConcil(tr,true);}}

  // Clique na coluna Nome: copia nome, NÃO pinta
  function bindCliqueNome(tr){
    const td=tr.querySelector(SEL.COL_NOME);
    if(!td||td.dataset.ccNomeCk==='1')return;td.dataset.ccNomeCk='1';
    td.addEventListener('click',async ev=>{
      ev.stopPropagation(); // impede propagação para a TR (sem pintar)
      if(ev.target.closest('.cc-nota-btn')||ev.target.closest('.cc-nota-inline-wrap')||ev.target.closest('.cc-nota-editor-wrap'))return;
      const nome=getNome(tr);if(!nome)return;
      // 1. Selecionar todo o texto do nome (feedback visual — texto fica azul selecionado)
      const sp=td.querySelector('.cc-nome-text');
      if(sp){
        try{
          const range=document.createRange();
          range.selectNodeContents(sp);
          const sel=window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }catch{}
      }
      // 2. Copiar para clipboard
      await clipboard(nome);
    });
  }

  // Clique no restante da linha (Tipo/Data/Valor): pinta/despinta
  function bindClique(tr){
    if(tr.dataset.ccCk==='1')return;tr.dataset.ccCk='1';
    tr.addEventListener('click',ev=>{
      // Clique na coluna Nome é tratado pelo listener da td (com stopPropagation)
      // Ícones de ação também usam stopPropagation; não chegam aqui.
      if(IGN_CLICK.some(c=>ev.target.closest?.('.'+c)))return;
      if(window.getSelection()?.toString())return;
      toggleConcil(tr);
    });
  }

  function limparConcilAntigas(){
    if(typeof GM_listValues==='undefined')return;
    try{const lim=Date.now()-TTL_DIAS*86400000;GM_listValues().forEach(k=>{if(!k.startsWith(PFX_CONCIL))return;const v=GM_getValue(k);if(!v?.savedAt){GM_deleteValue(k);return;}if((parseDtBR(v.data)?.getTime()??v.savedAt)<lim)GM_deleteValue(k);});}catch{}
  }

  // ============================================================
  // NOTAS
  // ============================================================
  function getNota(tr){try{const v=GM_getValue(PFX_NOTA+hashLinha(tr));return v?.texto||'';}catch{return'';}}
  function salvarNota(tr,txt){
    const h=hashLinha(tr);
    try{if(txt.trim())GM_setValue(PFX_NOTA+h,{texto:txt.trim(),savedAt:Date.now()});else GM_deleteValue(PFX_NOTA+h);}catch{}
  }
  function atualizarIconeNota(tr){
    const ic=tr.querySelector('.cc-nota-btn');if(!ic)return;
    const tem=!!getNota(tr);ic.style.opacity=tem?'1':'0.65';ic.title=tem?'Editar nota':'Adicionar nota';
  }
  function atualizarNotaInline(tr){
    const td=tr.querySelector(SEL.COL_NOME);if(!td)return;
    const cnt=cellContent(td);
    cnt.querySelector('.cc-nota-inline-wrap')?.remove();
    const nota=getNota(tr);if(!nota)return;
    const wrap=document.createElement('span');wrap.className='cc-nota-inline-wrap';wrap.title=nota;
    wrap.innerHTML=`<small class="cc-nota-inline">${escHtml(nota)}</small>`;
    wrap.addEventListener('click',ev=>{ev.stopPropagation();fecharEditor();abrirEditor(tr);});
    cnt.appendChild(wrap);
  }
  const fecharEditor=()=>document.querySelector('.cc-nota-editor-wrap')?.remove();

  function abrirEditor(tr){
    fecharEditor();
    const td=tr.querySelector(SEL.COL_NOME);if(!td)return;
    const notaAtual=getNota(tr);

    const wrap=document.createElement('div');wrap.className='cc-nota-editor-wrap';
    wrap.addEventListener('click',ev=>ev.stopPropagation());
    wrap.addEventListener('mousedown',ev=>ev.stopPropagation());

    const row=document.createElement('div');row.className='cc-nota-editor-row';
    const ta=document.createElement('textarea');ta.className='cc-nota-textarea';ta.value=notaAtual;ta.placeholder='Nota breve...';
    const actions=document.createElement('div');actions.className='cc-nota-actions';

    let salvo=false;
    let excluindo=false; // flag: usuário clicou em Excluir; blur não deve salvar

    // salvar: só persiste se o texto for não-vazio; vazio = fecha sem apagar
    const salvar=()=>{
      if(salvo||excluindo)return;
      salvo=true;
      const txt=ta.value.trim();
      if(txt)salvarNota(tr,txt);  // salva apenas se houver texto
      // se vazio: só fecha o editor sem apagar a nota existente
      wrap.remove();atualizarNotaInline(tr);atualizarIconeNota(tr);
    };

    if(notaAtual){
      const btnD=document.createElement('button');btnD.type='button';btnD.className='cc-nota-del-btn';btnD.title='Excluir nota';
      btnD.innerHTML='<i class="fa fa-trash-o"></i> Excluir';
      // mousedown: seta flag e previne blur; click: apaga de fato
      btnD.addEventListener('mousedown',ev=>{
        excluindo=true;        // informa salvar() para não interferir
        ev.preventDefault();   // evita que a textarea perca o foco (blur prematuro)
        ev.stopPropagation();
      });
      btnD.addEventListener('click',ev=>{
        ev.stopPropagation();
        salvo=true;excluindo=false;
        salvarNota(tr,'');     // apaga a nota do storage
        wrap.remove();atualizarNotaInline(tr);atualizarIconeNota(tr);
      });
      actions.appendChild(btnD);
    }

    row.appendChild(ta);if(notaAtual)row.appendChild(actions);
    wrap.appendChild(row);td.appendChild(wrap);
    ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);

    ta.addEventListener('keydown',ev=>{
      ev.stopPropagation();
      if(ev.key==='Enter'&&!ev.shiftKey){ev.preventDefault();salvar();}
      if(ev.key==='Escape'){salvo=true;wrap.remove();}
    });
    ta.addEventListener('blur',salvar);
  }

  function limparNotasAntigas(){
    if(typeof GM_listValues==='undefined')return;
    try{const lim=Date.now()-TTL_DIAS*86400000;GM_listValues().forEach(k=>{if(!k.startsWith(PFX_NOTA))return;const v=GM_getValue(k);if(!v?.savedAt||v.savedAt<lim)GM_deleteValue(k);});}catch{}
  }

  // ============================================================
  // ORDENAÇÃO
  // ============================================================
  function ordenar(){
    if(!sort.col)return;
    const tbody=document.querySelector(`${SEL.TABLE} tbody`);if(!tbody)return;
    [...tbody.querySelectorAll('tr')].sort((a,b)=>{
      let r=0;
      if(sort.col==='nome')r=getNome(a).toLowerCase().localeCompare(getNome(b).toLowerCase(),'pt-BR',{sensitivity:'base'});
      else if(sort.col==='data')r=(parseDtBR(a.querySelector(SEL.COL_DATA)?.textContent.trim())?.getTime()??0)-(parseDtBR(b.querySelector(SEL.COL_DATA)?.textContent.trim())?.getTime()??0);
      else if(sort.col==='valor')r=parseVal(getValor(a)||'0')-parseVal(getValor(b)||'0');
      return sort.dir==='asc'?r:-r;
    }).forEach(tr=>tbody.appendChild(tr));
    aplicarFiltros();
  }
  function atualizarSortUI(){
    [['1','nome'],['3','data'],['4','valor']].forEach(([idx,col])=>{
      const th=document.querySelector(`th[aria-colindex="${idx}"]`);if(!th)return;
      th.querySelectorAll('.cc-sort-ind').forEach(el=>el.remove());
      if(sort.col===col){
        const ind=document.createElement('span');ind.className='cc-sort-ind';ind.textContent=sort.dir==='asc'?'▲':'▼';
        (th.querySelector('div')||th.querySelector('span:not(.cc-sort-ind)')||th).appendChild(ind);
      }
    });
  }
  function resetSort(){sort.col=null;sort.dir=null;atualizarSortUI();}
  function bindHeaders(){
    [['1','nome'],['3','data'],['4','valor']].forEach(([idx,col])=>{
      const th=document.querySelector(`th[aria-colindex="${idx}"]`);
      if(!th||th.dataset.ccSb==='1')return;th.dataset.ccSb='1';
      th.addEventListener('click',()=>{
        if(sort.col===col)sort.dir=sort.dir==='asc'?'desc':'asc';else{sort.col=col;sort.dir=SORT_DEF[col];}
        ordenar();atualizarSortUI();
      });
    });
  }
  function bindAtualizar(){
    const btn=getBtnAtu();if(!btn||btn.dataset.ccAb==='1')return;btn.dataset.ccAb='1';
    btn.addEventListener('click',()=>resetSort());
  }

  // ============================================================
  // PERÍODO
  // ============================================================
  function aplicarPeriodo(tipo){
    const hoje=new Date(),ini=new Date(hoje);
    if(tipo==='15')ini.setDate(hoje.getDate()-15);else if(tipo==='mes')ini.setMonth(hoje.getMonth()-1);
    const i=document.querySelector(SEL.DT_INI),f=document.querySelector(SEL.DT_FIM);
    if(!i||!f){toast('Campos de data não encontrados',false);return;}
    fillVue(i,fmtData(ini));fillVue(f,fmtData(hoje));
    // Para o refresh antes do autoScroll (evita conflito durante o carregamento)
    stopRf();
    setTimeout(()=>document.querySelector(SEL.BTN_BUSCAR)?.click(),100);
  }
  function injetarPeriodo(container){
    if(document.getElementById('cc-btn-hoje'))return;
    [{id:'cc-btn-hoje',l:'Hoje',t:'hoje'},{id:'cc-btn-15d',l:'15 dias',t:'15'},{id:'cc-btn-mes',l:'Este Mês',t:'mes'}].forEach(p=>{
      const btn=document.createElement('button');btn.id=p.id;btn.type='button';btn.className='btn cc-btn-periodo';btn.textContent=p.l;
      btn.addEventListener('click',()=>aplicarPeriodo(p.t));container.appendChild(btn);
    });
  }

  // ============================================================
  // AUTO-REFRESH
  // ============================================================
  const fmtCd=s=>{s=Math.max(0,s);return`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
  function updCd(){const i=document.getElementById('cc-rf-inp');if(i)i.value=fmtCd(Math.ceil((nextRfTs-Date.now())/1000));}
  function setRfUI(on,min){
    const i=document.getElementById('cc-rf-inp'),ini=document.getElementById('cc-rf-ini'),par=document.getElementById('cc-rf-par');
    if(!i||!ini||!par)return;
    if(on){i.readOnly=true;ini.disabled=true;par.disabled=false;}
    else{i.readOnly=false;ini.disabled=false;par.disabled=true;i.value=min>0?String(min):'';}
  }
  function stopRf(){if(rfTimeout){clearTimeout(rfTimeout);rfTimeout=null;}if(rfInterval){clearInterval(rfInterval);rfInterval=null;}nextRfTs=0;}
  function fireRf(){try{GM_setValue(KEY_RF_INI,Date.now());}catch{}getBtnAtu()?.click();}
  function schedRf(){
    let min=0,on=false,ini=0;
    try{min=parseInt(GM_getValue(KEY_RF_MIN,0),10)||0;on=!!GM_getValue(KEY_RF_ON,false);ini=parseInt(GM_getValue(KEY_RF_INI,0),10)||0;}catch{}
    stopRf();if(!on||min<1){setRfUI(false,min);return;}
    const cy=min*60000,el=ini>0?Date.now()-ini:cy,rem=el>=cy?0:cy-el;
    nextRfTs=Date.now()+rem;rfTimeout=setTimeout(fireRf,rem);
    rfInterval=setInterval(updCd,1000);setRfUI(true,min);updCd();
  }
  function startRf(){
    const i=document.getElementById('cc-rf-inp');if(!i)return;
    const min=parseInt(String(i.value).replace(/\D/g,''),10);
    if(!min||min<1){i.classList.add('cc-err');toast('Digite um valor inteiro >= 1 minuto',false);setTimeout(()=>i.classList.remove('cc-err'),2000);return;}
    i.classList.remove('cc-err');
    try{GM_setValue(KEY_RF_MIN,min);GM_setValue(KEY_RF_ON,true);GM_setValue(KEY_RF_INI,Date.now());}catch{}
    schedRf();
  }
  function stopRfBtn(){
    stopRf();let min=0;
    try{GM_setValue(KEY_RF_ON,false);GM_deleteValue(KEY_RF_INI);min=parseInt(GM_getValue(KEY_RF_MIN,0),10)||0;}catch{}
    setRfUI(false,min);
  }
  function injetarRefresh(){
    const area=document.querySelector(SEL.ESQ);if(!area||document.getElementById('cc-refresh-area'))return;
    const w=document.createElement('span');w.id='cc-refresh-area';
    w.innerHTML=`<label for="cc-rf-inp">Refresh:</label><input id="cc-rf-inp" type="text" inputmode="numeric" class="form-control" placeholder="min" autocomplete="off"><button id="cc-rf-ini" class="btn btn-success" type="button">INICIAR</button><button id="cc-rf-par" class="btn btn-danger" type="button" disabled>PARAR</button>`;
    area.appendChild(w);
    document.getElementById('cc-rf-ini').addEventListener('click',startRf);
    document.getElementById('cc-rf-par').addEventListener('click',stopRfBtn);
    document.getElementById('cc-rf-inp').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();startRf();}});
    schedRf();
  }

  // ============================================================
  // FILTROS
  // ============================================================
  function injetarFiltros(){
    const cont=getContNativo();
    if(cont&&!document.getElementById('cc-btn-e')){
      const bE=document.createElement('button');bE.id='cc-btn-e';bE.type='button';bE.className='btn btn-success';
      bE.innerHTML='<i class="fa fa-arrow-up"></i> Entradas';
      bE.addEventListener('click',()=>{filtroSinal=filtroSinal==='e'?null:'e';updFiltroUI();aplicarFiltros();saveFiltros();});
      const bS=document.createElement('button');bS.id='cc-btn-s';bS.type='button';bS.className='btn btn-danger';
      bS.innerHTML='<i class="fa fa-arrow-down"></i> Saídas';
      bS.addEventListener('click',()=>{filtroSinal=filtroSinal==='s'?null:'s';updFiltroUI();aplicarFiltros();saveFiltros();});
      cont.appendChild(bE);cont.appendChild(bS);injetarPeriodo(cont);
    }
    const aDir=document.querySelector(SEL.DIR);
    if(aDir&&!document.getElementById('cc-busca-area')){
      const w=document.createElement('span');w.id='cc-busca-area';
      w.innerHTML=`<input type="text" id="cc-fn" class="form-control form-control-sm" style="width:200px;display:inline-block;" placeholder="Filtrar por nome (Enter)" autocomplete="off">`;
      aDir.insertBefore(w,aDir.firstChild);
      const inp=document.getElementById('cc-fn');
      inp.addEventListener('input',()=>{filtroNome=inp.value.trim().toLowerCase();saveFiltros();clearTimeout(debFiltro);debFiltro=setTimeout(aplicarFiltros,FILTRO_DEB);});
      inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();clearTimeout(debFiltro);filtroNome=inp.value.trim().toLowerCase();aplicarFiltros();saveFiltros();}});
    }
  }
  function updFiltroUI(){
    document.getElementById('cc-btn-e')?.classList.toggle('active',filtroSinal==='e');
    document.getElementById('cc-btn-s')?.classList.toggle('active',filtroSinal==='s');
    const inp=document.getElementById('cc-fn');if(inp&&inp.value!==filtroNome)inp.value=filtroNome;
  }
  function aplicarFiltros(){
    document.querySelectorAll(SEL.ROWS).forEach(tr=>{
      const nm=(getNome(tr)||'').toLowerCase(),v=parseVal(getValor(tr)||'0'),sn=v>=0?'e':'s';
      tr.classList.toggle(HIDDEN,!( (!filtroSinal||sn===filtroSinal)&&(!filtroNome||nm.includes(filtroNome)) ));
    });
    recalcTotais();
  }
  function saveFiltros(){try{localStorage.setItem(LS_FILTROS,JSON.stringify({filtroSinal,filtroNome}));}catch{}}
  function loadFiltros(){try{const o=JSON.parse(localStorage.getItem(LS_FILTROS)||'{}');filtroSinal=o.filtroSinal??null;filtroNome=o.filtroNome??'';}catch{}}
  function resetFiltros(){
    filtroSinal=null;filtroNome='';try{localStorage.removeItem(LS_FILTROS);}catch{}
    const inp=document.getElementById('cc-fn');if(inp)inp.value='';
    updFiltroUI();aplicarFiltros();
  }

  // ============================================================
  // ÍCONES
  // ============================================================
  function injetarNota(tr){
    const td=tr.querySelector(SEL.COL_NOME);if(!td)return;
    const ic=cellIcons(td);if(ic.querySelector('.cc-nota-btn'))return;
    const i=document.createElement('i');i.className='fa fa-bookmark cc-icon-btn cc-nota-btn';
    i.style.color=corLinha(tr);  // verde em entradas, vermelho em saídas
    const tem=!!getNota(tr);i.style.opacity=tem?'1':'0.65';i.title=tem?'Editar nota':'Adicionar nota';
    i.addEventListener('click',ev=>{ev.stopPropagation();abrirEditor(tr);});
    ic.appendChild(i);
  }
  function injetarCopiar(tr){
    const td=tr.querySelector(SEL.COL_VALOR);if(!td)return;
    const ic=cellIcons(td);if(ic.querySelector('.cc-copy-btn'))return;
    const i=document.createElement('i');i.className='fa fa-clone cc-icon-btn cc-copy-btn';
    i.style.color=corLinha(tr);  // verde em entradas, vermelho em saídas
    i.title='Copiar nome';
    i.addEventListener('click',async ev=>{
      ev.stopPropagation();const nm=getNome(tr);if(!nm)return;
      const ok=await clipboard(nm);
      if(ok){i.style.opacity='1';setTimeout(()=>{i.style.opacity='';},COPY_FB_MS);}
    });
    ic.appendChild(i);
  }
  function injetarReceita(tr){
    if(!tr.classList.contains('table-success'))return;
    const td=tr.querySelector(SEL.COL_VALOR);if(!td)return;
    const ic=cellIcons(td);if(ic.querySelector('.cc-receita'))return;
    const i=document.createElement('i');i.className='fa fa-plus-circle cc-icon-btn cc-receita';
    i.style.color=COR_ICONE;i.title='Verificar cliente (nova aba)';
    i.addEventListener('click',ev=>{ev.stopPropagation();const u=new URL(URL_CLIENTE);u.searchParams.set('nome',getNome(tr));window.open(u.toString(),'_blank','noopener');});
    ic.appendChild(i);
  }
  function injetarDespesa(tr){
    if(!tr.classList.contains('table-danger'))return;
    if((tr.querySelector(SEL.COL_TIPO)?.textContent.trim()||'')==='INVESTIMENTO')return;
    const td=tr.querySelector(SEL.COL_VALOR);if(!td)return;
    const ic=cellIcons(td);if(ic.querySelector('.cc-despesa'))return;
    const i=document.createElement('i');i.className='fa fa-plus-circle cc-icon-btn cc-despesa';
    // Cor definida via CSS (.cc-despesa e tr.ROW_CS .cc-despesa)
    i.title='Adicionar despesa (nova aba)';
    i.addEventListener('click',ev=>{
      ev.stopPropagation();
      try{localStorage.setItem(LS_DESPESA,JSON.stringify({nome:getNome(tr),valor:fmtAbsBR(parseVal(getValor(tr)||'0')),ts:Date.now()}));}catch{}
      window.open(URL_DESPESA,'_blank','noopener');
    });
    ic.appendChild(i);
  }

  // ============================================================
  // TOTALIZADORES
  // ============================================================
  function calcTotais(linhas){
    const inv=linhas.filter(l=>l.tipo==='INVESTIMENTO').reduce((s,l)=>s+l.valor,0);
    const ni=linhas.filter(l=>l.tipo!=='INVESTIMENTO');
    return{e:ni.filter(l=>l.valor>0).reduce((s,l)=>s+l.valor,0),s:ni.filter(l=>l.valor<0).reduce((s,l)=>s+l.valor,0),inv,get t(){return this.e+this.s;}};
  }
  function linhasVis(){
    return[...document.querySelectorAll(`${SEL.ROWS}:not(.${HIDDEN})`)].map(tr=>({
      tr,tipo:tr.querySelector(SEL.COL_TIPO)?.textContent.trim()||'',
      valor:parseVal(getValor(tr)||'0'),pintada:isConcil(tr),
    }));
  }
  function injetarTotais(){
    const td=document.querySelector(SEL.SALDO_TD);if(!td||td.querySelector('.cc-totais'))return;
    const sp=document.createElement('span');sp.className='cc-totais';
    sp.innerHTML=`<span class="cc-e">Entradas: <span data-cc="e">—</span></span><span class="cc-s">Saídas: <span data-cc="s">—</span></span><span class="cc-t">Total: <span data-cc="t">—</span></span><span class="cc-i" data-inv style="display:none">Investimentos: <span data-cc="inv">—</span></span><button class="btn btn-sm btn-outline-primary cc-exp-btn" type="button">Exportar ↓</button>`;
    td.appendChild(sp);sp.querySelector('.cc-exp-btn').addEventListener('click',abrirModal);
  }
  function recalcTotais(){
    const td=document.querySelector(SEL.SALDO_TD);if(!td||!td.querySelector('.cc-totais'))return;
    const {e,s,t,inv}=calcTotais(linhasVis());
    td.querySelector('[data-cc="e"]').textContent=fmtBRL(e);
    td.querySelector('[data-cc="s"]').textContent=fmtBRL(s);
    td.querySelector('[data-cc="t"]').textContent=fmtBRL(t);
    const wi=td.querySelector('[data-inv]');
    if(inv!==0){wi.style.display='';td.querySelector('[data-cc="inv"]').textContent=fmtBRL(inv);}else wi.style.display='none';
  }

  // ============================================================
  // HELPERS EXPORT
  // ============================================================
  const getFiltroNome=()=>document.getElementById('cc-fn')?.value?.trim()||'';
  const getPeriodo=()=>({di:document.querySelector(SEL.DT_INI)?.value?.trim()||null,df:document.querySelector(SEL.DT_FIM)?.value?.trim()||null});
  function resolverLinhas(pOn,nOn){
    const t=linhasVis();
    if(pOn&&!nOn)return t.filter(l=>l.pintada);
    if(!pOn&&nOn)return t.filter(l=>!l.pintada);
    return t;
  }
  function labelLinhas(pOn,nOn){
    if(pOn&&!nOn)return'Consolidados';if(!pOn&&nOn)return'Pendentes';
    if(pOn&&nOn)return'Consolidados e Pendentes';return'Todos';
  }

  // Nome do arquivo: "Relatório de Pagamentos - [Filtro] - DD-MM-YYYY.xlsx"
  function nomeArquivo(pOn,nOn){
    const filtro=labelLinhas(pOn,nOn);
    const data=fmtDataFN(new Date());
    return`Relatório de Pagamentos - ${filtro} - ${data}.xlsx`;
  }

  // ============================================================
  // EXCEL EXPORT
  // ============================================================
  function xlStyle(bg,bold=false,fg='000000'){
    return{font:{bold,color:{rgb:fg},sz:10},fill:{fgColor:{rgb:bg},patternType:'solid'},alignment:{vertical:'center'}};
  }
  function gerarXLSX(pOn,nOn,totSel){
    if(typeof XLSX==='undefined'){toast('SheetJS não carregado',false);return;}
    const linhas=resolverLinhas(pOn,nOn);
    if(!linhas.length&&!totSel){toast('Nenhuma transação no filtro',false);return;}
    try{
      const aoa=[['Data','Nome','Tipo','Valor','Status','Nota']];
      linhas.forEach(l=>{
        const d=l.tr.querySelector(SEL.COL_DATA)?.textContent.trim()||'';
        const tp=l.tr.querySelector(SEL.COL_TIPO)?.textContent.trim()||'';
        aoa.push([d,getNome(l.tr),tp,getValor(l.tr),l.pintada?'Consolidado':'Pendente',getNota(l.tr)]);
      });
      if(totSel){
        const {e,s,t,inv}=calcTotais(linhas.length?linhas:linhasVis());
        aoa.push([]);
        aoa.push(['Entradas','','',fmtBRL(e),'','']);
        aoa.push(['Saídas','','',fmtBRL(s),'','']);
        aoa.push(['Total','','',fmtBRL(t),'','']);
        if(inv!==0)aoa.push(['Investimentos','','',fmtBRL(inv),'','']);
      }
      const ws=XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols']=[{wch:12},{wch:35},{wch:0.1,hidden:true},{wch:13},{wch:14},{wch:40}];
      ws['!rows']=[{hpt:20}];
      const N=6;
      for(let r=0;r<aoa.length;r++){
        const row=aoa[r];if(!row||row.length===0)continue;
        const st=r===0?xlStyle(XL_HDR,true,'FFFFFF'):row[4]==='Consolidado'?xlStyle(XL_CONS):row[4]==='Pendente'?xlStyle(XL_PEND):xlStyle(XL_TOT,true);
        for(let c=0;c<N;c++){const ref=XLSX.utils.encode_cell({r,c});if(!ws[ref])ws[ref]={v:'',t:'s'};ws[ref].s={...st};}
      }
      const wb=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb,ws,'Extrato');
      const out=XLSX.write(wb,{bookType:'xlsx',type:'array',cellStyles:true});
      const blob=new Blob([out],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const url=URL.createObjectURL(blob);
      const a=Object.assign(document.createElement('a'),{href:url,download:nomeArquivo(pOn,nOn),style:'display:none'});
      document.body.appendChild(a);a.click();
      setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},1000);
      toast('Excel exportado!');
    }catch(err){
      console.error('[ExtratoEnriquecido] Erro XLSX:',err);
      toast('Erro ao gerar Excel: '+err.message,false);
    }
  }

  // ============================================================
  // EXCEL IMPORT — preserva nota existente se xlsx vazio
  // ============================================================
  function importarXLSX(){
    if(typeof XLSX==='undefined'){toast('SheetJS não carregado',false);return;}
    const input=document.createElement('input');input.type='file';input.accept='.xlsx,.xls';input.style.display='none';
    document.body.appendChild(input);
    input.addEventListener('change',()=>{
      const file=input.files?.[0];if(!file){input.remove();return;}
      const reader=new FileReader();
      reader.onload=e=>{
        try{
          const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});
          const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:''});
          let count=0;
          for(let i=1;i<rows.length;i++){
            const row=rows[i];if(!row||row.length<5)continue;
            const [d,nome,tipo,valor,status,nota]=row.map(c=>String(c??'').trim());
            if(!nome)continue;
            // Processar só quando há dado real: status Consolidado OU nota preenchida.
            // Linha "vazia" (status=Pendente sem nota, ou ambos vazios) → não toca no storage.
            const hasColor=status==='Consolidado';
            const hasNota=nota!=='';
            if(!hasColor&&!hasNota)continue;
            const h=`${d}|${nome}|${valor}|${tipo}`;
            try{
              // Consolidação: marca quando Consolidado; ignora Pendente/vazio (não apaga)
              if(hasColor)GM_setValue(PFX_CONCIL+h,{marked:true,savedAt:Date.now(),data:d});
              // Nota: atualiza só se a planilha traz valor; vazio = mantém nota existente
              if(hasNota)GM_setValue(PFX_NOTA+h,{texto:nota,savedAt:Date.now()});
              count++;
            }catch{}
          }
          // Re-aplicar nas linhas visíveis
          document.querySelectorAll(SEL.ROWS).forEach(tr=>{
            if(!tr.classList.contains(MARKER))return;
            limparCor(tr);restaurarConcil(tr);atualizarNotaInline(tr);atualizarIconeNota(tr);
          });
          toast(`${count} registro${count!==1?'s':''} importado${count!==1?'s':''}`);
        }catch(err){
          console.error('[ExtratoEnriquecido] Erro import:',err);
          toast('Erro ao ler o arquivo',false);
        }
        input.remove();
      };
      reader.readAsArrayBuffer(file);
    });
    input.click();
  }

  // ============================================================
  // WPP COPIAR
  // ============================================================
  async function gerarCopiar(pOn,nOn,totSel,incNotas,incHdr){
    const linhas=resolverLinhas(pOn,nOn);
    const {e,s,t,inv}=calcTotais(linhas.length?linhas:linhasVis());
    const partes=[];
    if(incHdr){
      partes.push('📊 *RELATÓRIO DE PAGAMENTOS*');
      const lb=labelLinhas(pOn,nOn);if(lb!=='Todos')partes.push(`🔍 Filtro: *${lb}*`);
      const{di,df}=getPeriodo();
      if(di&&df)partes.push(`📅 Período: *${di} a ${df}*`);else if(di)partes.push(`📅 A partir de *${di}*`);else if(df)partes.push(`📅 Até *${df}*`);
      const nm=getFiltroNome();if(nm)partes.push(`👤 Cliente: *${nm}*`);
      partes.push(WPP_SEP);
    }
    linhas.forEach(l=>{
      const d=l.tr.querySelector(SEL.COL_DATA)?.textContent.trim()||'';
      const n=parseVal(getValor(l.tr)||'0');
      partes.push(`${n>=0?'✅':'❌'} *${getNome(l.tr)}*`);
      partes.push(`${d} · ${fmtWpp(n)}`);
      if(incNotas){const nota=getNota(l.tr);if(nota)partes.push(`_${nota}_`);}
    });
    if(totSel){
      if(linhas.length>0)partes.push(WPP_SEP);
      partes.push(`💰 Entradas: *R$ ${fmtNumBR(e)}*`);
      partes.push(`🔴 Saídas: *-R$ ${fmtNumBR(Math.abs(s))}*`);
      partes.push(`🟢 Total: *R$ ${fmtNumBR(t)}*`);
      if(inv!==0)partes.push(`📊 Investimentos: *R$ ${fmtNumBR(inv)}*`);
    }
    if(!partes.length){toast('Nada a copiar',false);return;}
    const ok=await clipboard(partes.join('\n'));
    toast(ok?'Copiado!':'Falha ao copiar',ok);
  }

  // ============================================================
  // MODAL
  // ============================================================
  function abrirModal(){
    if(document.getElementById('cc-overlay'))return;
    const ov=document.createElement('div');ov.id='cc-overlay';
    ov.innerHTML=`
      <div id="cc-modal">
        <div class="cc-mhd">Exportar / Importar</div>
        <div class="cc-mbody">
          <div class="cc-sec-lbl">Exportar</div>
          <div class="cc-mgroup">
            <label>Linhas</label>
            <div class="cc-fbtns">
              <button class="cc-fbtn" data-k="p">Consolidado</button>
              <button class="cc-fbtn" data-k="n">Pendente</button>
            </div>
            <span class="cc-hint">Nenhum = todos</span>
          </div>
          <div class="cc-mgroup">
            <label>Incluir</label>
            <div class="cc-fbtns">
              <button class="cc-fbtn on" data-k="t">Totalizadores</button>
              <button class="cc-fbtn on" data-k="notas">Notas</button>
              <button class="cc-fbtn on" data-k="hdr">Cabeçalho</button>
            </div>
          </div>
          <div class="cc-sec-lbl" style="margin-top:14px">Importar</div>
          <div class="cc-mgroup">
            <button id="cc-importar" class="cc-import-btn" type="button">
              <i class="fa fa-upload"></i> Importar XLSX
            </button>
          </div>
        </div>
        <div class="cc-mfoot">
          <button id="cc-xl" class="cc-btn-ok" type="button"><i class="fa fa-file-excel-o"></i> Excel</button>
          <button id="cc-cp" class="cc-btn-ok" type="button"><i class="fa fa-whatsapp"></i> Copiar</button>
          <button id="cc-cl" class="cc-btn-cl" type="button">Fechar</button>
        </div>
      </div>
    `;
    document.body.appendChild(ov);
    const st={p:false,n:false,t:true,notas:true,hdr:true};
    ov.querySelectorAll('.cc-fbtn').forEach(btn=>{
      btn.classList.toggle('on',!!st[btn.dataset.k]);
      btn.addEventListener('click',()=>{
        st[btn.dataset.k]=!st[btn.dataset.k];btn.classList.toggle('on',st[btn.dataset.k]);
        const nada=!st.p&&!st.n&&!st.t;
        ov.querySelector('#cc-xl').disabled=nada;ov.querySelector('#cc-cp').disabled=nada;
      });
    });
    const fechar=()=>ov.remove();
    ov.addEventListener('click',e=>{if(e.target===ov)fechar();});
    ov.querySelector('#cc-cl').addEventListener('click',fechar);
    ov.querySelector('#cc-xl').addEventListener('click',()=>{gerarXLSX(st.p,st.n,st.t);fechar();});
    ov.querySelector('#cc-cp').addEventListener('click',async()=>{await gerarCopiar(st.p,st.n,st.t,st.notas,st.hdr);fechar();});
    ov.querySelector('#cc-importar').addEventListener('click',()=>{fechar();importarXLSX();});
  }

  // ============================================================
  // BUSCAR / LIMPAR
  // ============================================================
  const fimCarregado=()=>[...document.querySelectorAll('h5')].some(h=>h.textContent.toLowerCase().includes(FIM_TXT));
  function aguardarLinha(qtd,ms){
    return new Promise(res=>{
      const tb=document.querySelector(`${SEL.TABLE} tbody`);if(!tb)return res(false);
      let ok=false;const fim=v=>{if(!ok){ok=true;obs.disconnect();res(v);}};
      const obs=new MutationObserver(()=>{if(tb.querySelectorAll('tr').length>qtd)fim(true);});
      obs.observe(tb,{childList:true});setTimeout(()=>fim(false),ms);
    });
  }
  async function autoScroll(){
    const pos=window.scrollY;let usr=false,tmo=true;
    const onS=()=>{usr=true;},onK=e=>{if(['PageDown','PageUp','ArrowDown','ArrowUp','Home','End',' '].includes(e.key))usr=true;};
    window.addEventListener('wheel',onS,{passive:true});window.addEventListener('touchmove',onS,{passive:true});window.addEventListener('keydown',onK);
    try{
      const st=Date.now();
      while(Date.now()-st<SCROLL_TMO){
        if(fimCarregado()){tmo=false;break;}
        const tb=document.querySelector(`${SEL.TABLE} tbody`);if(!tb){tmo=false;break;}
        const qtd=tb.querySelectorAll('tr').length;
        window.scrollTo({top:document.body.scrollHeight,behavior:'instant'});
        if(!await aguardarLinha(qtd,SCROLL_WAIT)){tmo=!fimCarregado();break;}
      }
    }finally{window.removeEventListener('wheel',onS);window.removeEventListener('touchmove',onS);window.removeEventListener('keydown',onK);}
    if(!usr&&!tmo)window.scrollTo({top:pos,behavior:'smooth'});
  }
  function bindBuscar(){
    const btn=document.querySelector(SEL.BTN_BUSCAR);if(!btn||btn.dataset.ccIb==='1')return;btn.dataset.ccIb='1';
    btn.addEventListener('click',async()=>{
      resetSort();
      // Para o refresh para evitar que dispare durante o auto-scroll (que pode levar até 60s)
      stopRf();
      await new Promise(r=>setTimeout(r,800));
      await autoScroll();
      enriquecer();
      // Retoma o ciclo de refresh com o estado salvo
      schedRf();
    });
  }
  function bindLimpar(){
    const c=getContNativo();if(!c)return;
    const btn=[...c.querySelectorAll('button.btn-danger')].find(b=>b.textContent.trim()==='Limpar');
    if(!btn||btn.dataset.ccLb==='1')return;btn.dataset.ccLb='1';
    btn.addEventListener('click',()=>setTimeout(()=>resetFiltros(),50));
  }

  // ============================================================
  // ENRIQUECER
  // ============================================================
  function enriquecerLinha(tr){
    if(tr.classList.contains(MARKER))return;
    const tdN=tr.querySelector(SEL.COL_NOME),tdV=tr.querySelector(SEL.COL_VALOR);
    // Cache ANTES de qualquer wrapping
    if(tdN&&!tr.dataset.ccNome){const n=[...tdN.childNodes].find(x=>x.nodeType===Node.TEXT_NODE&&x.textContent.trim());tr.dataset.ccNome=n?n.textContent.trim():tdN.textContent.trim();}
    if(tdV&&!tr.dataset.ccValor)tr.dataset.ccValor=tdV.textContent.trim();

    injetarNota(tr);         // activa wrapCell em tdNome, injeta bookmark
    wrapNomeText(tr);        // encapsula text node em span.cc-nome-text
    bindCliqueNome(tr);      // clique em tdNome → copia nome (sem pintar)
    atualizarNotaInline(tr); // exibe nota ao lado do nome

    restaurarConcil(tr);
    bindClique(tr);          // clique no resto da linha → pinta

    injetarCopiar(tr);
    injetarReceita(tr);
    injetarDespesa(tr);

    tr.classList.add(MARKER);
  }

  function enriquecer(){
    const tb=document.querySelector(`${SEL.TABLE} tbody`);if(!tb)return;
    injetarTotais();bindBuscar();bindLimpar();bindAtualizar();bindHeaders();
    tb.querySelectorAll('tr').forEach(enriquecerLinha);
    if(sort.col)ordenar();else aplicarFiltros();
  }

  // ============================================================
  // MUTATION OBSERVER
  // ============================================================
  function observar(){
    const tgt=document.querySelector('section.content')||document.body;let pend=false;
    new MutationObserver(()=>{
      if(pend)return;pend=true;
      requestAnimationFrame(()=>{
        pend=false;
        const tb=document.querySelector(`${SEL.TABLE} tbody`);
        if(tb&&[...tb.querySelectorAll('tr')].some(tr=>!tr.classList.contains(MARKER)))enriquecer();
        if(!document.querySelector('.cc-totais')){injetarTotais();recalcTotais();}
        if(!document.getElementById('cc-btn-e')||!document.getElementById('cc-fn')||!document.getElementById('cc-btn-hoje')){injetarFiltros();updFiltroUI();}
        if(!document.getElementById('cc-refresh-area'))injetarRefresh();
        bindBuscar();bindLimpar();bindAtualizar();bindHeaders();
      });
    }).observe(tgt,{childList:true,subtree:true});
  }

  // ============================================================
  // PÁGINA: ADICIONAR PAGAMENTO
  // ============================================================
  async function preencherDespesa(){
    let raw;try{raw=localStorage.getItem(LS_DESPESA);}catch{return;}if(!raw)return;
    let p;try{p=JSON.parse(raw);}catch{localStorage.removeItem(LS_DESPESA);return;}
    if(!p.ts||Date.now()-p.ts>DESPESA_TTL){localStorage.removeItem(LS_DESPESA);return;}
    localStorage.removeItem(LS_DESPESA);
    try{fillVue(await waitEl('#nome',5000),p.nome);}catch{}
    try{fillVue(await waitEl('#valor',5000),p.valor);}catch{}
  }

  // ============================================================
  // INIT
  // ============================================================
  function init(){
    injetarCSS();
    if(location.pathname.includes('/banco_inter/extratos')){
      loadFiltros();limparConcilAntigas();limparNotasAntigas();
      waitEl(SEL.TABLE,10000)
        .then(()=>{injetarFiltros();injetarRefresh();updFiltroUI();enriquecer();observar();})
        .catch(()=>{injetarRefresh();observar();});
    }else if(location.pathname.includes('/movimentacoes_financeiras/adicionar_pagamento')){
      preencherDespesa();
    }
  }

  if(document.readyState==='complete'||document.readyState==='interactive')init();
  else document.addEventListener('DOMContentLoaded',init);
})();