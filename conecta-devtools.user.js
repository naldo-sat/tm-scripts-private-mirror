// ==UserScript==
// @name         Conecta Devtools
// @namespace    http://tampermonkey.net/
// @version      3.5.0
// @updateURL    https://raw.githubusercontent.com/naldo-sat/tm-scripts-private-mirror/main/conecta-devtools.user.js
// @downloadURL  https://raw.githubusercontent.com/naldo-sat/tm-scripts-private-mirror/main/conecta-devtools.user.js
// @description  Captura estruturada para Claude Code — timeline dedup, navigation tracking, response schema, sem screenshot
// @author       Naldo Nascimento + AI Assistant
// @match        *://*/*
// @grant        none
// ==/UserScript==

/*
CHANGELOG v3.5.0
─────────────────────────────────────────────────────────────
1. REMOVIDO: screenshots (html2canvas @require + captureScreenshot + botões +📸)
2. NAVIGATION TRACKER: pushState/replaceState/popstate/hashchange + document.title
   → entradas {type:'nav'} na timeline
3. SUBMIT TRACKER: form submits com action/method/campos
4. DEDUP em 3 camadas:
   • Requests: mesma sig (method+path+bodyKeys) em <60s → merge com count
   • Clicks:   mesmo selector em <400ms → merge (double/triple click)
   • Inputs:   só o último valor por campo (sig = el+name+type)
5. RESPONSE SCHEMA por default (era opcional) — reduz tokens 10-50x
6. DICIONÁRIO `elements`: seletores únicos com text/bbox/count — Claude Code
   navega rápido sem varrer timeline inteira
7. FORMATO reestruturado: endpoints + elements + navigation + timeline separados
8. Cookies escondidos da UI (raro pra automação; ainda em CONFIG)
─────────────────────────────────────────────────────────────
*/

(function () {
    'use strict';

    const STORAGE_KEY = 'cd_state_v35';

    const CONFIG = {
        includeResponseSchema:  true,   // default ON — antes era OFF
        includeFullResponses:   false,
        includeXPath:           false,
        includeClickPosition:   true,
        includeElementDetails:  false,
        includeHeaders:         false,
        includeCookies:         false,  // escondido da UI
        includeNavigation:      true,
        dedupRequests:          true,
        dedupClicks:            true,
        dedupInputs:            true,
        dedupRequestWindowMs:   60000,  // requests iguais em <60s são mergidos
        dedupClickWindowMs:     400,    // clicks no mesmo selector em <400ms
        analyticsCookiePatterns: [
            '_ga','_gid','_gat','AMCV_','kndctr_','_gcl_',
            'fbp','_fb','fr','_hjid','_hjSession','optimizely','_vis_opt'
        ]
    };

    // =================================================================
    // PERSISTÊNCIA
    // =================================================================

    function saveState() {
        try {
            const apisObj = {};
            state.apis.forEach((val, key) => {
                apisObj[key] = {
                    count:          val.count,
                    actions:        Array.from(val.actions),
                    methods:        Array.from(val.methods),
                    params:         Array.from(val.params),
                    bodyKeys:       Array.from(val.bodyKeys),
                    responseSchema: val.responseSchema || null
                };
            });
            const elementsObj = {};
            state.elements.forEach((val, key) => {
                elementsObj[key] = val;
            });
            const snapshot = {
                capturing:      state.capturing,
                startTime:      state.startTime,
                requestCounter: state.requestCounter,
                requests:       state.requests,
                clicks:         state.clicks,
                inputs:         state.inputs,
                errors:         state.errors,
                submits:        state.submits,
                navigation:     state.navigation,
                session:        state.session,
                cookies:        state.cookies,
                pageInfo:       state.pageInfo,
                apis:           apisObj,
                elements:       elementsObj,
                counts:         state.counts,
                fileName:       state.fileName,
                _reloadCount:   state._reloadCount,
                _wasRestored:   state._wasRestored
            };
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
        } catch (e) {
            console.warn('[Conecta Devtools] Erro ao salvar estado:', e);
        }
    }

    function restoreState() {
        try {
            const raw = sessionStorage.getItem(STORAGE_KEY);
            if (!raw) return false;
            const snap = JSON.parse(raw);
            state.capturing      = snap.capturing      ?? false;
            state.startTime      = snap.startTime      ?? null;
            state.requestCounter = snap.requestCounter ?? 0;
            state.requests       = snap.requests       ?? [];
            state.clicks         = snap.clicks         ?? [];
            state.inputs         = snap.inputs         ?? [];
            state.errors         = snap.errors         ?? [];
            state.submits        = snap.submits        ?? [];
            state.navigation     = snap.navigation     ?? [];
            state.session        = snap.session        ?? {};
            state.cookies        = snap.cookies        ?? {};
            state.pageInfo       = snap.pageInfo       ?? {};
            state.counts         = snap.counts         ?? emptyCounts();
            state.fileName       = snap.fileName       ?? '';
            state._reloadCount   = snap._reloadCount   ?? 0;
            state._wasRestored   = snap._wasRestored   ?? false;
            state.apis = new Map();
            Object.entries(snap.apis || {}).forEach(([key, val]) => {
                state.apis.set(key, {
                    count:          val.count,
                    actions:        new Set(val.actions   || []),
                    methods:        new Set(val.methods   || []),
                    params:         new Set(val.params    || []),
                    bodyKeys:       new Set(val.bodyKeys  || []),
                    responseSchema: val.responseSchema || null
                });
            });
            state.elements = new Map();
            Object.entries(snap.elements || {}).forEach(([key, val]) => {
                state.elements.set(key, val);
            });
            return true;
        } catch (e) {
            console.warn('[Conecta Devtools] Erro ao restaurar estado:', e);
            return false;
        }
    }

    function clearState() {
        sessionStorage.removeItem(STORAGE_KEY);
    }

    function emptyCounts() {
        return { requests: 0, clicks: 0, inputs: 0, errors: 0, submits: 0, nav: 0 };
    }

    // =================================================================
    // ESTADO GLOBAL
    // =================================================================

    const state = {
        capturing: false, startTime: null, requestCounter: 0,
        requests: [], clicks: [], inputs: [], errors: [], submits: [], navigation: [],
        session: {}, cookies: {}, pageInfo: {},
        apis: new Map(),
        elements: new Map(),
        counts: emptyCounts(),
        fileName: '', _reloadCount: 0, _wasRestored: false
    };

    let currentTab = 'resumo';
    let expandedSections = new Set(['stats']);
    let expandedItems    = new Set();

    // =================================================================
    // ESTILOS
    // =================================================================

    const styles = `
        #cd-btn{position:fixed;bottom:20px;right:20px;z-index:999999;background:linear-gradient(135deg,#570a7d 0%,#3d0757 100%);color:#fff;border:none;border-radius:50px;padding:10px 16px;font:600 12px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;cursor:pointer;box-shadow:0 4px 15px rgba(87,10,125,.4);transition:all .2s ease;display:flex;align-items:center;gap:8px}
        #cd-btn:hover{transform:scale(1.05)}
        #cd-btn.rec{background:linear-gradient(135deg,#dc2626 0%,#991b1b 100%)}
        #cd-btn .dot{width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,.5)}
        #cd-btn.rec .dot{background:#fff;animation:cdBlink 1s infinite}
        #cd-btn .cd-restore-badge{font-size:9px;background:#fbbf24;color:#1e293b;padding:2px 6px;border-radius:8px;font-weight:700;margin-left:2px}
        @keyframes cdBlink{50%{opacity:.3}}
        #cd-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000000;display:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
        #cd-overlay.show{display:block}
        #cd-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:950px;max-width:95vw;max-height:90vh;background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.25);z-index:10000001;overflow:hidden;animation:cdSlideIn .3s ease;display:flex;flex-direction:column}
        @keyframes cdSlideIn{from{transform:translate(-50%,-50%) scale(.9);opacity:0}}
        .cd-header{padding:16px 20px;background:linear-gradient(135deg,#570a7d 0%,#3d0757 100%);display:flex;justify-content:space-between;align-items:center;cursor:move;user-select:none}
        .cd-header-left{display:flex;align-items:center;gap:12px}
        .cd-title{font-size:14px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.5px}
        .cd-version{font-size:10px;color:rgba(255,255,255,.7);background:rgba(255,255,255,.15);padding:2px 8px;border-radius:10px}
        .cd-optimized{font-size:9px;color:#4ade80;background:rgba(74,222,128,.2);padding:2px 6px;border-radius:8px;font-weight:600}
        .cd-restored-badge{font-size:9px;color:#fbbf24;background:rgba(251,191,36,.2);padding:2px 8px;border-radius:8px;font-weight:700}
        .cd-duration{font-size:11px;color:rgba(255,255,255,.8);background:rgba(255,255,255,.1);padding:4px 10px;border-radius:6px}
        .cd-header-btn{background:rgba(255,255,255,.2);border:none;font-size:18px;color:#fff;cursor:pointer;padding:4px 12px;border-radius:6px}
        .cd-header-btn:hover{background:rgba(255,255,255,.3)}
        .cd-tabs{display:flex;background:#f8fafc;border-bottom:1px solid #e2e8f0}
        .cd-tab{padding:12px 20px;background:transparent;border:none;border-bottom:2px solid transparent;color:#64748b;font-size:13px;font-weight:500;cursor:pointer;display:flex;align-items:center;gap:8px}
        .cd-tab:hover{color:#1e293b;background:#f1f5f9}
        .cd-tab.active{color:#570a7d;border-bottom-color:#570a7d;background:#fff}
        .cd-badge{background:#e2e8f0;color:#64748b;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
        .cd-tab.active .cd-badge{background:#570a7d;color:#fff}
        .cd-body{flex:1;overflow-y:auto;padding:20px;background:#fff}
        .cd-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:12px;margin-bottom:20px}
        .cd-stat{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;text-align:center}
        .cd-stat-value{font-size:24px;font-weight:700;color:#1e293b}
        .cd-stat-label{font-size:10px;color:#64748b;text-transform:uppercase;margin-top:4px;font-weight:600}
        .cd-section{background:#fff;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:12px;overflow:hidden}
        .cd-section-header{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:#f8fafc;cursor:pointer;user-select:none}
        .cd-section-header:hover{background:#f1f5f9}
        .cd-section-left{display:flex;align-items:center;gap:10px}
        .cd-section-title{font-size:12px;font-weight:600;color:#1e293b}
        .cd-section-count{font-size:10px;color:#64748b;background:#e2e8f0;padding:2px 8px;border-radius:10px}
        .cd-section-arrow{color:#94a3b8;font-size:12px;transition:transform .2s}
        .cd-section.expanded .cd-section-arrow{transform:rotate(180deg)}
        .cd-section-body{display:none;padding:12px 16px;border-top:1px solid #e2e8f0}
        .cd-section.expanded .cd-section-body{display:block}
        .cd-item{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:8px;overflow:hidden}
        .cd-item:last-child{margin-bottom:0}
        .cd-item-header{padding:10px 12px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;gap:10px}
        .cd-item-left{display:flex;align-items:center;gap:8px;flex:1;min-width:0}
        .cd-item-right{display:flex;align-items:center;gap:6px;flex-shrink:0}
        .cd-tag{font-size:9px;font-weight:600;padding:2px 6px;border-radius:3px;text-transform:uppercase;flex-shrink:0}
        .cd-tag.post{background:#dcfce7;color:#166534}
        .cd-tag.get{background:#dbeafe;color:#1e40af}
        .cd-tag.put{background:#fef3c7;color:#92400e}
        .cd-tag.delete{background:#fee2e2;color:#991b1b}
        .cd-tag.patch{background:#f3e8ff;color:#6b21a8}
        .cd-tag.click{background:#fef3c7;color:#92400e}
        .cd-tag.input{background:#dcfce7;color:#166534}
        .cd-tag.nav{background:#e0f2fe;color:#075985}
        .cd-tag.submit{background:#fce7f3;color:#9d174d}
        .cd-tag.xhr{background:#e0e7ff;color:#3730a3}
        .cd-tag.fetch{background:#fce7f3;color:#9d174d}
        .cd-endpoint{font-size:11px;color:#475569;font-family:'Consolas','Monaco',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .cd-status{font-size:9px;padding:2px 5px;border-radius:3px;font-weight:600}
        .cd-status.ok{background:#dcfce7;color:#166534}
        .cd-status.error{background:#fee2e2;color:#991b1b}
        .cd-time{font-size:9px;color:#94a3b8;font-family:monospace}
        .cd-count{font-size:9px;color:#fff;background:#570a7d;padding:2px 5px;border-radius:8px;font-weight:600}
        .cd-item-body{display:none;padding:12px;background:#fff;border-top:1px solid #e2e8f0}
        .cd-item.expanded .cd-item-body{display:block}
        .cd-code{background:#1e293b;border-radius:6px;padding:10px;font-family:'Consolas','Monaco',monospace;font-size:10px;color:#e2e8f0;overflow-x:auto;white-space:pre-wrap;word-break:break-all;max-height:250px;overflow-y:auto}
        .cd-code-label{font-size:9px;color:#64748b;margin-bottom:4px;font-weight:600;text-transform:uppercase}
        .cd-code-block{margin-bottom:10px}
        .cd-code-block:last-child{margin-bottom:0}
        .cd-api-grid{display:grid;gap:8px}
        .cd-api-item{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px}
        .cd-api-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
        .cd-api-endpoint{font-family:'Consolas',monospace;font-size:11px;color:#1e293b;word-break:break-all}
        .cd-api-count{font-size:10px;font-weight:600;color:#570a7d;background:#f3e8ff;padding:2px 8px;border-radius:10px}
        .cd-api-details{display:flex;flex-wrap:wrap;gap:6px;font-size:10px}
        .cd-api-tag{background:#e2e8f0;color:#475569;padding:2px 6px;border-radius:3px}
        .cd-session-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}
        .cd-session-item{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px}
        .cd-session-key{font-size:9px;color:#64748b;text-transform:uppercase;font-weight:600;margin-bottom:2px}
        .cd-session-value{font-size:11px;color:#1e293b;word-break:break-all;font-family:'Consolas',monospace}
        .cd-input{width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;font-family:'Consolas',monospace}
        .cd-input:focus{outline:none;border-color:#570a7d}
        .cd-input-suffix{display:flex;align-items:center}
        .cd-input-suffix .cd-input{border-radius:6px 0 0 6px;border-right:none}
        .cd-input-suffix-text{padding:8px 10px;background:#f1f5f9;border:1px solid #e2e8f0;border-left:none;border-radius:0 6px 6px 0;font-size:12px;font-family:'Consolas',monospace;color:#64748b;white-space:nowrap}
        .cd-footer{padding:14px 20px;background:#f8fafc;border-top:1px solid #e2e8f0;display:flex;justify-content:center;gap:10px;flex-wrap:wrap}
        .cd-btn{padding:8px 16px;border-radius:6px;border:none;font-size:12px;font-weight:600;cursor:pointer}
        .cd-btn-primary{background:linear-gradient(135deg,#570a7d 0%,#3d0757 100%);color:#fff}
        .cd-btn-primary:hover{box-shadow:0 4px 12px rgba(87,10,125,.3)}
        .cd-btn-secondary{background:#e2e8f0;color:#475569}
        .cd-btn-secondary:hover{background:#cbd5e1}
        .cd-btn-danger{background:#fee2e2;color:#991b1b}
        .cd-btn-danger:hover{background:#fecaca}
        .cd-empty{text-align:center;padding:30px 20px;color:#94a3b8}
        .cd-empty-text{font-size:13px}
        .cd-item.click{border-left:3px solid #f59e0b}
        .cd-item.request{border-left:3px solid #3b82f6}
        .cd-item.input{border-left:3px solid #10b981}
        .cd-item.nav{border-left:3px solid #0ea5e9}
        .cd-item.submit{border-left:3px solid #ec4899}
        .cd-params-list{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
        .cd-param-tag{font-size:9px;background:#e0e7ff;color:#3730a3;padding:2px 6px;border-radius:3px;font-family:monospace}
        .cd-timeline-item{display:flex;align-items:center;gap:8px;padding:6px 10px;background:#f8fafc;border-radius:4px;margin-bottom:4px;border-left:3px solid #e2e8f0;font-size:11px}
        .cd-timeline-item.request{border-left-color:#3b82f6}
        .cd-timeline-item.click{border-left-color:#f59e0b}
        .cd-timeline-item.input{border-left-color:#10b981}
        .cd-timeline-item.nav{border-left-color:#0ea5e9}
        .cd-timeline-item.submit{border-left-color:#ec4899}
        .cd-timeline-time{font-family:monospace;font-size:9px;color:#64748b;min-width:48px}
        .cd-timeline-endpoint{font-family:'Consolas',monospace;font-size:10px;color:#475569;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .cd-timeline-selector{font-family:'Consolas',monospace;font-size:10px;color:#2563eb;flex:1}
        .cd-timeline-text{font-size:10px;color:#d97706;font-style:italic}
        .cd-action-badge{font-size:8px;font-weight:600;padding:2px 5px;border-radius:3px;background:#f3e8ff;color:#6b21a8;text-transform:uppercase}
        .cd-item-index{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;background:#e2e8f0;border-radius:50%;font-size:9px;font-weight:600;color:#475569;flex-shrink:0}
        .cd-bbox-badge{font-size:9px;background:#e0f2fe;color:#0369a1;padding:2px 6px;border-radius:3px;font-family:monospace}
        .cd-reload-banner{background:#fffbeb;border:1px solid #fbbf24;border-radius:8px;padding:10px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px}
        .cd-reload-banner-text{font-size:11px;color:#92400e;flex:1}
        .cd-reload-banner-count{font-size:11px;font-weight:700;color:#92400e;background:#fde68a;padding:2px 8px;border-radius:6px}
        .cd-export-section{margin-bottom:20px}
        .cd-export-title{font-size:13px;font-weight:600;color:#1e293b;margin-bottom:12px}
        .cd-export-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin-bottom:16px}
        .cd-export-item{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;transition:all .15s}
        .cd-export-item:hover{border-color:#570a7d;background:#faf5ff}
        .cd-export-item.checked{border-color:#570a7d;background:#f3e8ff}
        .cd-export-item input[type=checkbox]{accent-color:#570a7d;width:16px;height:16px;cursor:pointer}
        .cd-export-item span{font-size:11px;color:#475569;cursor:pointer;flex:1}
        .cd-export-item.checked span{color:#570a7d;font-weight:500}
        .cd-export-info{background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px;margin-bottom:20px}
        .cd-export-info-text{font-size:11px;color:#166534;line-height:1.5}
        .cd-export-size{display:flex;align-items:center;justify-content:space-between;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:16px}
        .cd-export-size-label{font-size:11px;color:#64748b}
        .cd-export-size-value{font-size:14px;font-weight:600;color:#1e293b}
        .cd-filename-section{margin-bottom:8px}
        .cd-filename-label{font-size:11px;font-weight:500;color:#64748b;margin-bottom:6px}
    `;

    // =================================================================
    // UTILITÁRIOS
    // =================================================================

    function isRelevantUrl(url) {
        if (!url) return false;
        const str = url.toLowerCase();
        const exclude = ['analytics','tracking','pixel','gtm','ga.js','fbevents',
            '.js','.css','.png','.jpg','.gif','.svg','.woff','.ico','fonts.','cdn.'];
        if (exclude.some(e => str.includes(e))) return false;
        const include = ['/api/','/rest/','/v1/','/v2/','/graphql','action=','.json','ajax','service','endpoint'];
        return include.some(i => str.includes(i));
    }

    function formatTime(ms) {
        const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
        return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
    }

    function getElapsedTime() {
        return state.startTime ? formatTime(Date.now() - state.startTime) : '0s';
    }

    function parseAction(body) {
        if (!body) return null;
        try { const d = typeof body === 'string' ? JSON.parse(body) : body; return d.action || null; }
        catch { return null; }
    }

    function extractEndpointName(url) {
        try {
            const parts = new URL(url, window.location.origin).pathname.split('/').filter(Boolean);
            return parts[parts.length - 1] || url;
        } catch { return url; }
    }

    function extractPath(url) {
        try { return new URL(url, window.location.origin).pathname; }
        catch { return url; }
    }

    function extractParams(url) {
        const p = {};
        try { new URL(url, window.location.origin).searchParams.forEach((v, k) => p[k] = v); }
        catch {}
        return p;
    }

    function extractBodyKeys(body) {
        if (!body) return [];
        try { return Object.keys(typeof body === 'string' ? JSON.parse(body) : body); }
        catch { return []; }
    }

    function parseBody(body) {
        if (!body) return null;
        try { return typeof body === 'string' ? JSON.parse(body) : body; }
        catch { return body; }
    }

    function extractSessionData(url, body) {
        const keys = ['sessionId','acessLogin','remoteHost','remoteIp','externalId','token','userId'];
        if (url) {
            try {
                new URL(url, window.location.origin).searchParams
                    .forEach((v, k) => { if (keys.includes(k)) state.session[k] = v; });
            } catch {}
        }
        if (body) {
            try {
                const d = typeof body === 'string' ? JSON.parse(body) : body;
                keys.forEach(k => { if (d[k]) state.session[k] = d[k]; });
            } catch {}
        }
    }

    // Schema com bloat mitigation (arrays > 3 fatiados; profundidade 3)
    function extractSchema(obj, depth = 0) {
        if (depth > 3) return '...';
        if (Array.isArray(obj)) {
            if (obj.length === 0) return [];
            const schema = extractSchema(obj[0], depth + 1);
            if (obj.length > 3) {
                return [schema, `... [array com ${obj.length} itens]`];
            }
            return obj.slice(0, 3).map(item => extractSchema(item, depth + 1));
        }
        if (obj && typeof obj === 'object') {
            const schema = {};
            const keys   = Object.keys(obj);
            keys.slice(0, 10).forEach(key => {
                const val = obj[key];
                if (val === null)               schema[key] = 'null';
                else if (Array.isArray(val)) {
                    if (val.length > 3) schema[key] = [extractSchema(val[0], depth + 1), `... [array com ${val.length} itens]`];
                    else                schema[key] = val.map(i => extractSchema(i, depth + 1));
                }
                else if (typeof val === 'object') schema[key] = extractSchema(val, depth + 1);
                else                              schema[key] = typeof val;
            });
            if (keys.length > 10) schema['...'] = `+${keys.length - 10} fields`;
            return schema;
        }
        return typeof obj;
    }

    function mitigateTokenBloat(obj, depth = 0) {
        if (depth > 6 || obj === null || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) {
            if (obj.length === 0) return [];
            if (obj.length > 3) return [mitigateTokenBloat(obj[0], depth + 1), `... [array com ${obj.length} itens]`];
            return obj.map(i => mitigateTokenBloat(i, depth + 1));
        }
        const out = {};
        for (const key of Object.keys(obj)) out[key] = mitigateTokenBloat(obj[key], depth + 1);
        return out;
    }

    function filterCookies(cookies) {
        const filtered = {};
        Object.keys(cookies).forEach(key => {
            if (!CONFIG.analyticsCookiePatterns.some(p => key.toLowerCase().includes(p.toLowerCase())))
                filtered[key] = cookies[key];
        });
        return filtered;
    }

    function getDefaultFileName() {
        return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    }

    function formatBytes(bytes) {
        if (bytes < 1024)    return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(2) + ' MB';
    }

    function getXPath(element) {
        if (!element) return '';
        const parts = [];
        while (element && element.nodeType === Node.ELEMENT_NODE) {
            let index = 1, sibling = element.previousSibling;
            while (sibling) {
                if (sibling.nodeType === Node.ELEMENT_NODE && sibling.tagName === element.tagName) index++;
                sibling = sibling.previousSibling;
            }
            parts.unshift(`${element.tagName.toLowerCase()}[${index}]`);
            element = element.parentNode;
        }
        return '/' + parts.join('/');
    }

    // Signature de request para dedup: método + path + keys do body (não valores)
    function reqSignature(method, path, bodyKeys) {
        return `${method}|${path}|${(bodyKeys || []).slice().sort().join(',')}`;
    }

    // =================================================================
    // INTERCEPTORS
    // =================================================================

    function pushRequest(req) {
        // Dedup: se última request tem mesma sig e ainda dentro da janela, merge
        if (CONFIG.dedupRequests) {
            for (let i = state.requests.length - 1; i >= 0; i--) {
                const prev = state.requests[i];
                if (state.startTime + prev.t < Date.now() - CONFIG.dedupRequestWindowMs) break;
                if (prev.sig === req.sig && prev.status === req.status) {
                    prev.count = (prev.count || 1) + 1;
                    prev.lastT = req.t;
                    saveState();
                    return;
                }
            }
        }
        req.count = 1;
        state.requests.push(req);
        state.counts.requests++;
    }

    function setupNetworkInterceptor() {
        const origOpen      = XMLHttpRequest.prototype.open;
        const origSend      = XMLHttpRequest.prototype.send;
        const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

        XMLHttpRequest.prototype.open = function (method, url, ...args) {
            this._cdMethod = method; this._cdUrl = url; this._cdHeaders = {};
            return origOpen.apply(this, [method, url, ...args]);
        };

        XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
            if (this._cdHeaders) this._cdHeaders[name] = value;
            return origSetHeader.apply(this, [name, value]);
        };

        XMLHttpRequest.prototype.send = function (body) {
            if (state.capturing && isRelevantUrl(this._cdUrl)) {
                this._cdBody  = body;
                this._cdStart = Date.now();
                extractSessionData(this._cdUrl, body);

                this.addEventListener('load', () => {
                    const duration = Date.now() - this._cdStart;
                    const offset   = Date.now() - state.startTime;
                    let responseData = null;
                    try { responseData = JSON.parse(this.responseText); } catch {}

                    const path       = extractPath(this._cdUrl);
                    const endpoint   = extractEndpointName(this._cdUrl);
                    const params     = extractParams(this._cdUrl);
                    const action     = parseAction(body);
                    const bodyKeys   = extractBodyKeys(body);
                    const parsedBody = parseBody(body);
                    const sig        = reqSignature(this._cdMethod, path, bodyKeys);

                    updateApi(this._cdMethod, endpoint, action, params, bodyKeys, responseData);

                    pushRequest({
                        id: state.requestCounter++, t: offset, sig,
                        src: 'XHR', method: this._cdMethod, url: this._cdUrl,
                        path, params: Object.keys(params).length > 0 ? params : undefined,
                        action: action || undefined, headers: this._cdHeaders,
                        body: parsedBody, status: this.status, duration,
                        response: responseData, responseSize: this.responseText?.length || 0
                    });
                    saveState();
                    updateButton();
                });
            }
            return origSend.apply(this, [body]);
        };

        const origFetch = window.fetch;
        window.fetch = async function (input, init = {}) {
            const url    = typeof input === 'string' ? input : input.url;
            const method = init.method || 'GET';

            if (state.capturing && isRelevantUrl(url)) {
                const start = Date.now();
                const body  = init.body;
                extractSessionData(url, body);

                try {
                    const response = await origFetch.apply(this, [input, init]);
                    const clone    = response.clone();
                    const duration = Date.now() - start;
                    const offset   = Date.now() - state.startTime;
                    let responseData = null, responseSize = 0;
                    try {
                        const text = await clone.text();
                        responseSize = text.length;
                        responseData = JSON.parse(text);
                    } catch {}

                    const path       = extractPath(url);
                    const endpoint   = extractEndpointName(url);
                    const params     = extractParams(url);
                    const action     = parseAction(body);
                    const bodyKeys   = extractBodyKeys(body);
                    const parsedBody = parseBody(body);
                    const sig        = reqSignature(method, path, bodyKeys);

                    updateApi(method, endpoint, action, params, bodyKeys, responseData);

                    pushRequest({
                        id: state.requestCounter++, t: offset, sig,
                        src: 'Fetch', method, url, path,
                        params: Object.keys(params).length > 0 ? params : undefined,
                        action: action || undefined, headers: init.headers || {},
                        body: parsedBody, status: response.status, duration,
                        response: responseData, responseSize
                    });
                    saveState();
                    updateButton();
                    return response;
                } catch (error) {
                    state.errors.push({ t: Date.now() - state.startTime, type: 'fetch', url, msg: error.message });
                    state.counts.errors++;
                    throw error;
                }
            }
            return origFetch.apply(this, [input, init]);
        };
    }

    function updateApi(method, endpoint, action, params, bodyKeys, responseData) {
        const apiKey = `${method} /${endpoint}`;
        if (!state.apis.has(apiKey)) {
            state.apis.set(apiKey, {
                count: 0, actions: new Set(), methods: new Set(),
                params: new Set(), bodyKeys: new Set(), responseSchema: null
            });
        }
        const api = state.apis.get(apiKey);
        api.count++;
        api.methods.add(method);
        if (action) api.actions.add(action);
        Object.keys(params).forEach(p => api.params.add(p));
        (bodyKeys || []).forEach(k => api.bodyKeys.add(k));
        // Salva schema da primeira response bem-formada
        if (!api.responseSchema && responseData) {
            api.responseSchema = extractSchema(responseData);
        }
    }

    function setupClickInterceptor() {
        document.addEventListener('click', (e) => {
            if (!state.capturing) return;

            const target = e.target.closest(
                'button, a, [onclick], [role="button"], input[type="submit"], input[type="button"]'
            ) || e.target;

            if (target.closest('#cd-btn, #cd-overlay, #cd-modal')) return;

            const tagName = target.tagName?.toLowerCase() || 'unknown';
            const id      = target.id ? `#${target.id}` : '';
            const classes = target.className && typeof target.className === 'string'
                ? '.' + target.className.trim().split(/\s+/).slice(0, 3).join('.')
                : '';
            const text = target.textContent?.trim().substring(0, 50) || '';
            const selector = `${tagName}${id}${classes}`;

            let boundingBox;
            try {
                const r = target.getBoundingClientRect();
                boundingBox = {
                    x: Math.round(r.x), y: Math.round(r.y),
                    width:  Math.round(r.width),  height: Math.round(r.height),
                    top:    Math.round(r.top),    left:   Math.round(r.left)
                };
            } catch {}

            const t = Date.now() - state.startTime;

            // Dedup double/triple click no mesmo selector em <400ms
            if (CONFIG.dedupClicks && state.clicks.length > 0) {
                const last = state.clicks[state.clicks.length - 1];
                if (last.selector === selector && (t - last.t) < CONFIG.dedupClickWindowMs) {
                    last.count = (last.count || 1) + 1;
                    last.lastT = t;
                    saveState();
                    updateButton();
                    return;
                }
            }

            state.clicks.push({
                id:       state.requestCounter++,
                t, count: 1,
                selector,
                text:     text || undefined,
                xpath:    getXPath(target),
                boundingBox,
                element: {
                    tag:  tagName,
                    id:   target.id   || undefined,
                    name: target.name || undefined,
                    type: target.type || undefined
                }
            });

            // Registra no dicionário de elementos
            updateElementDict(selector, text, boundingBox);

            state.counts.clicks++;
            saveState();
            updateButton();
        }, true);
    }

    function updateElementDict(selector, text, boundingBox) {
        if (!state.elements.has(selector)) {
            state.elements.set(selector, { text: text || undefined, count: 0, boundingBox });
        }
        const el = state.elements.get(selector);
        el.count++;
        if (boundingBox) el.boundingBox = boundingBox; // atualiza pra bbox mais recente (elemento pode se mover)
    }

    function setupInputInterceptor() {
        document.addEventListener('change', (e) => {
            if (!state.capturing) return;
            const target = e.target;
            if (target.closest('#cd-overlay, #cd-modal')) return;
            const tagName = target.tagName?.toLowerCase();
            if (!['input','select','textarea'].includes(tagName)) return;

            const el   = `${tagName}${target.id ? '#' + target.id : ''}`;
            const type = target.type || 'text';
            const name = target.name || undefined;
            const value = target.type === 'password' ? '***' : (target.value?.substring(0, 100) || undefined);
            const sig  = `${el}|${name || ''}|${type}`;
            const t    = Date.now() - state.startTime;

            // Dedup: só mantém o último valor por campo
            if (CONFIG.dedupInputs) {
                for (let i = state.inputs.length - 1; i >= 0; i--) {
                    if (state.inputs[i].sig === sig) {
                        state.inputs[i].value = value;
                        state.inputs[i].lastT = t;
                        state.inputs[i].count = (state.inputs[i].count || 1) + 1;
                        saveState();
                        return;
                    }
                }
            }

            state.inputs.push({
                id: state.requestCounter++, t, sig, count: 1,
                el, type, name, value
            });
            state.counts.inputs++;
            saveState();
        }, true);
    }

    function setupSubmitInterceptor() {
        document.addEventListener('submit', (e) => {
            if (!state.capturing) return;
            const form = e.target;
            if (!form || form.tagName?.toLowerCase() !== 'form') return;
            if (form.closest('#cd-overlay, #cd-modal')) return;

            const fields = [];
            try {
                for (const el of form.elements) {
                    if (el.name) fields.push({
                        name: el.name,
                        type: el.type || undefined,
                        value: el.type === 'password' ? '***' : (String(el.value || '').substring(0, 100) || undefined)
                    });
                }
            } catch {}

            state.submits.push({
                id: state.requestCounter++,
                t: Date.now() - state.startTime,
                selector: `form${form.id ? '#' + form.id : ''}${form.name ? `[name="${form.name}"]` : ''}`,
                action: form.action || undefined,
                method: (form.method || 'GET').toUpperCase(),
                fields
            });
            state.counts.submits++;
            saveState();
        }, true);
    }

    function setupErrorInterceptor() {
        window.addEventListener('error', (e) => {
            if (!state.capturing) return;
            state.errors.push({ t: Date.now() - state.startTime, type: 'error', msg: e.message, file: e.filename });
            state.counts.errors++;
        });
        window.addEventListener('unhandledrejection', (e) => {
            if (!state.capturing) return;
            state.errors.push({ t: Date.now() - state.startTime, type: 'promise', msg: e.reason?.message || String(e.reason) });
            state.counts.errors++;
        });
    }

    function setupNavigationInterceptor() {
        let lastUrl = window.location.href;
        let lastTitle = document.title;

        function pushNav(kind, extra = {}) {
            if (!state.capturing) return;
            const to = window.location.href;
            if (to === lastUrl && kind !== 'title') return;
            state.navigation.push({
                t: Date.now() - state.startTime,
                kind, from: lastUrl, to,
                title: document.title !== lastTitle ? document.title : undefined,
                ...extra
            });
            state.counts.nav++;
            lastUrl = to;
            lastTitle = document.title;
            saveState();
        }

        const origPush    = history.pushState;
        const origReplace = history.replaceState;
        history.pushState    = function () { const r = origPush.apply(this, arguments);    pushNav('pushState');    return r; };
        history.replaceState = function () { const r = origReplace.apply(this, arguments); pushNav('replaceState'); return r; };
        window.addEventListener('popstate',   () => pushNav('popstate'));
        window.addEventListener('hashchange', () => pushNav('hashchange'));

        // Mudança de título (SPA muitas vezes atualiza title após routing)
        try {
            const titleEl = document.querySelector('head > title');
            if (titleEl) {
                new MutationObserver(() => {
                    if (!state.capturing) return;
                    if (document.title !== lastTitle) {
                        state.navigation.push({
                            t: Date.now() - state.startTime,
                            kind: 'title', from: lastTitle, to: document.title
                        });
                        state.counts.nav++;
                        lastTitle = document.title;
                        saveState();
                    }
                }).observe(titleEl, { childList: true, characterData: true, subtree: true });
            }
        } catch {}
    }

    // =================================================================
    // UI
    // =================================================================

    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = styles;
        document.head.appendChild(style);
    }

    let btnElement = null;

    function createButton() {
        const btn = document.createElement('button');
        btn.id = 'cd-btn';
        btn.innerHTML = '<span class="dot"></span><span class="label">Devtools</span>';
        btn.addEventListener('click', toggleCapture);
        document.body.appendChild(btn);
        btnElement = btn;
    }

    function updateButton() {
        if (!btnElement) return;
        const label = btnElement.querySelector('.label');
        btnElement.querySelector('.cd-restore-badge')?.remove();
        if (state.capturing) {
            btnElement.classList.add('rec');
            label.textContent = `REC ${getElapsedTime()} (${state.counts.requests})`;
            if (state._wasRestored) {
                const badge = document.createElement('span');
                badge.className   = 'cd-restore-badge';
                badge.textContent = 'CONT.';
                btnElement.appendChild(badge);
            }
        } else {
            btnElement.classList.remove('rec');
            label.textContent = 'Devtools';
        }
    }

    function toggleCapture() { state.capturing ? stopCapture() : startCapture(); }

    function startCapture() {
        state.capturing      = true;
        state.startTime      = Date.now();
        state.requestCounter = 0;
        state.requests = []; state.clicks = []; state.inputs = []; state.errors = [];
        state.submits = [];  state.navigation = [];
        state.apis     = new Map();
        state.elements = new Map();
        state.counts   = emptyCounts();
        state.fileName = getDefaultFileName();
        state._wasRestored  = false;
        state._reloadCount  = 0;

        state.pageInfo = {
            url:      window.location.href,
            title:    document.title,
            ts:       new Date().toISOString(),
            viewport: `${window.innerWidth}x${window.innerHeight}`
        };

        state.cookies = {};
        try {
            document.cookie.split(';').forEach(c => {
                const [k, v] = c.trim().split('=');
                if (k) state.cookies[k] = v || '';
            });
            state.cookies = filterCookies(state.cookies);
        } catch {}

        saveState();
        updateButton();
        state.updateInterval = setInterval(() => { saveState(); updateButton(); }, 1000);
        console.log('%c[Conecta Devtools v3.5] Captura iniciada', 'color:#570a7d;font-weight:bold');
    }

    function stopCapture() {
        state.capturing    = false;
        state._wasRestored = false;
        clearInterval(state.updateInterval);
        clearState();
        updateButton();
        console.log('%c[Conecta Devtools v3.5] Captura finalizada', 'color:#570a7d;font-weight:bold');
        console.log(`Requests: ${state.counts.requests} | Clicks: ${state.counts.clicks} | Nav: ${state.counts.nav} | APIs: ${state.apis.size}`);
        showModal();
    }

    function showModal() {
        let overlay = document.getElementById('cd-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'cd-overlay';
            document.body.appendChild(overlay);
        }

        const duration    = state.startTime ? formatTime(Date.now() - state.startTime) : '0s';
        const totalEvents = state.requests.length + state.clicks.length + state.inputs.length + state.navigation.length + state.submits.length;

        overlay.innerHTML = `
            <div id="cd-modal">
                <div class="cd-header">
                    <div class="cd-header-left">
                        <span class="cd-title">Conecta Devtools</span>
                        <span class="cd-version">v3.5</span>
                        <span class="cd-optimized">${CONFIG.includeFullResponses ? 'FULL+BLOAT_MIT' : 'LEAN'}</span>
                        ${state._wasRestored ? `<span class="cd-restored-badge">🔄 RESTAURADO</span>` : ''}
                        <span class="cd-duration">${duration}</span>
                    </div>
                    <button class="cd-header-btn" onclick="window.cdHide()">×</button>
                </div>
                <div class="cd-tabs">
                    <button class="cd-tab ${currentTab === 'resumo'   ? 'active' : ''}" data-tab="resumo">Resumo</button>
                    <button class="cd-tab ${currentTab === 'devtools' ? 'active' : ''}" data-tab="devtools">Timeline <span class="cd-badge">${totalEvents}</span></button>
                    <button class="cd-tab ${currentTab === 'exportar' ? 'active' : ''}" data-tab="exportar">Exportar</button>
                </div>
                <div class="cd-body" id="cd-content"></div>
                <div class="cd-footer">
                    <button class="cd-btn cd-btn-primary"   onclick="window.cdExportJSON()">Exportar JSON</button>
                    <button class="cd-btn cd-btn-primary"   onclick="window.cdExportMD()">Exportar MD</button>
                    <button class="cd-btn cd-btn-secondary" onclick="window.cdHide()">Fechar</button>
                    <button class="cd-btn cd-btn-danger"    onclick="window.cdDiscardAndReset()">Descartar</button>
                </div>
            </div>`;

        overlay.classList.add('show');
        overlay.querySelectorAll('.cd-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                currentTab = tab.dataset.tab;
                overlay.querySelectorAll('.cd-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                renderContent();
            });
        });

        setupDrag();
        renderContent();
    }

    function setupDrag() {
        const modal  = document.getElementById('cd-modal');
        const header = modal?.querySelector('.cd-header');
        if (!modal || !header) return;
        let dragging = false, sx, sy, sl, st;
        header.addEventListener('mousedown', e => {
            if (e.target.closest('.cd-header-btn')) return;
            dragging = true;
            const r = modal.getBoundingClientRect();
            sx = e.clientX; sy = e.clientY; sl = r.left; st = r.top;
            modal.style.transform = 'none';
            modal.style.left = sl + 'px'; modal.style.top = st + 'px';
        });
        document.addEventListener('mousemove', e => {
            if (!dragging) return;
            modal.style.left = Math.max(0, Math.min(sl + e.clientX - sx, innerWidth  - modal.offsetWidth))  + 'px';
            modal.style.top  = Math.max(0, Math.min(st + e.clientY - sy, innerHeight - modal.offsetHeight)) + 'px';
        });
        document.addEventListener('mouseup', () => dragging = false);
    }

    function hideModal() { document.getElementById('cd-overlay')?.classList.remove('show'); }

    // =================================================================
    // RENDER
    // =================================================================

    function renderContent() {
        const container = document.getElementById('cd-content');
        if (!container) return;
        switch (currentTab) {
            case 'resumo':   container.innerHTML = renderResumo();   break;
            case 'devtools': container.innerHTML = renderDevTools(); break;
            case 'exportar': container.innerHTML = renderExportar(); break;
        }
        setupEventListeners(container);
    }

    function setupEventListeners(container) {
        container.querySelectorAll('.cd-section-header').forEach(h => {
            h.addEventListener('click', () => {
                const sec = h.closest('.cd-section'), id = sec?.dataset.section;
                if (id) { expandedSections.has(id) ? expandedSections.delete(id) : expandedSections.add(id); sec.classList.toggle('expanded'); }
            });
        });
        container.querySelectorAll('.cd-item-header').forEach(h => {
            h.addEventListener('click', () => {
                const item = h.closest('.cd-item'), id = item?.dataset.id;
                if (id) { expandedItems.has(id) ? expandedItems.delete(id) : expandedItems.add(id); item.classList.toggle('expanded'); }
            });
        });
        const fn = container.querySelector('#cd-filename');
        if (fn) fn.addEventListener('input', e => state.fileName = e.target.value);
        if (currentTab === 'exportar') {
            const sv = container.querySelector('#cd-export-size-value');
            if (sv) sv.textContent = formatBytes(JSON.stringify(exportData()).length);
        }
    }

    function getUnifiedTimeline() {
        return [
            ...state.requests.map(r  => ({ ...r, _type: 'request' })),
            ...state.clicks.map(c    => ({ ...c, _type: 'click'   })),
            ...state.inputs.map(i    => ({ ...i, _type: 'input'   })),
            ...state.navigation.map(n=> ({ ...n, _type: 'nav'     })),
            ...state.submits.map(s   => ({ ...s, _type: 'submit'  }))
        ].sort((a, b) => a.t - b.t);
    }

    function renderResumo() {
        const events      = getUnifiedTimeline();
        const sessionKeys = Object.keys(state.session);
        const reloadCount = state._reloadCount || 0;

        return `
            ${reloadCount > 0 ? `
            <div class="cd-reload-banner">
                <span>🔄</span>
                <span class="cd-reload-banner-text">Sessão restaurada após <strong>${reloadCount} reload(s)</strong>.</span>
                <span class="cd-reload-banner-count">${events.length} eventos</span>
            </div>` : ''}
            <div class="cd-stats">
                <div class="cd-stat"><div class="cd-stat-value">${state.counts.requests}</div><div class="cd-stat-label">Requests</div></div>
                <div class="cd-stat"><div class="cd-stat-value">${state.counts.clicks}</div><div class="cd-stat-label">Clicks</div></div>
                <div class="cd-stat"><div class="cd-stat-value">${state.inputs.length}</div><div class="cd-stat-label">Inputs</div></div>
                <div class="cd-stat"><div class="cd-stat-value">${state.counts.nav}</div><div class="cd-stat-label">Nav</div></div>
                <div class="cd-stat"><div class="cd-stat-value">${state.counts.submits}</div><div class="cd-stat-label">Submits</div></div>
                <div class="cd-stat"><div class="cd-stat-value">${state.apis.size}</div><div class="cd-stat-label">APIs</div></div>
                <div class="cd-stat"><div class="cd-stat-value">${state.elements.size}</div><div class="cd-stat-label">Elementos</div></div>
                <div class="cd-stat"><div class="cd-stat-value">${state.counts.errors}</div><div class="cd-stat-label">Erros</div></div>
            </div>

            <div class="cd-section ${expandedSections.has('timeline') ? 'expanded' : ''}" data-section="timeline">
                <div class="cd-section-header">
                    <div class="cd-section-left"><span class="cd-section-title">Timeline Unificada</span><span class="cd-section-count">${events.length} eventos</span></div>
                    <span class="cd-section-arrow">▼</span>
                </div>
                <div class="cd-section-body">${renderTimelineRows(events)}</div>
            </div>

            <div class="cd-section ${expandedSections.has('apis') ? 'expanded' : ''}" data-section="apis">
                <div class="cd-section-header">
                    <div class="cd-section-left"><span class="cd-section-title">APIs Descobertas</span><span class="cd-section-count">${state.apis.size}</span></div>
                    <span class="cd-section-arrow">▼</span>
                </div>
                <div class="cd-section-body">${state.apis.size === 0
                    ? '<div class="cd-empty"><div class="cd-empty-text">Nenhuma API capturada</div></div>'
                    : `<div class="cd-api-grid">${renderAPIs()}</div>`}
                </div>
            </div>

            <div class="cd-section ${expandedSections.has('elements') ? 'expanded' : ''}" data-section="elements">
                <div class="cd-section-header">
                    <div class="cd-section-left"><span class="cd-section-title">Elementos Interativos</span><span class="cd-section-count">${state.elements.size}</span></div>
                    <span class="cd-section-arrow">▼</span>
                </div>
                <div class="cd-section-body">${state.elements.size === 0
                    ? '<div class="cd-empty"><div class="cd-empty-text">Nenhum elemento capturado</div></div>'
                    : renderElementDict()}
                </div>
            </div>

            <div class="cd-section ${expandedSections.has('session') ? 'expanded' : ''}" data-section="session">
                <div class="cd-section-header">
                    <div class="cd-section-left"><span class="cd-section-title">Session</span><span class="cd-section-count">${sessionKeys.length}</span></div>
                    <span class="cd-section-arrow">▼</span>
                </div>
                <div class="cd-section-body">
                    ${sessionKeys.length === 0
                        ? '<div class="cd-empty"><div class="cd-empty-text">Nenhum dado de sessão capturado</div></div>'
                        : `<div class="cd-session-grid">${sessionKeys.map(k =>
                            `<div class="cd-session-item"><div class="cd-session-key">${k}</div><div class="cd-session-value">${state.session[k]}</div></div>`
                          ).join('')}</div>`}
                </div>
            </div>

            <div class="cd-section ${expandedSections.has('pageinfo') ? 'expanded' : ''}" data-section="pageinfo">
                <div class="cd-section-header">
                    <div class="cd-section-left"><span class="cd-section-title">Page Info</span></div>
                    <span class="cd-section-arrow">▼</span>
                </div>
                <div class="cd-section-body">
                    <div class="cd-session-grid">${Object.entries(state.pageInfo).map(([k, v]) =>
                        `<div class="cd-session-item"><div class="cd-session-key">${k}</div><div class="cd-session-value">${v}</div></div>`
                    ).join('')}</div>
                </div>
            </div>`;
    }

    function renderTimelineRows(events) {
        if (events.length === 0) return '<div class="cd-empty"><div class="cd-empty-text">Nenhuma ação capturada</div></div>';
        return events.map(e => {
            const offset = `+${(e.t / 1000).toFixed(1)}s`;
            const cnt = (e.count && e.count > 1) ? `<span class="cd-count">×${e.count}</span>` : '';
            if (e._type === 'request') {
                return `<div class="cd-timeline-item request">
                    <span class="cd-timeline-time">${offset}</span>
                    <span class="cd-tag ${e.method.toLowerCase()}">${e.method}</span>
                    <span class="cd-timeline-endpoint">${e.path}</span>
                    ${e.action ? `<span class="cd-action-badge">${e.action}</span>` : ''}
                    <span class="cd-status ${e.status >= 200 && e.status < 300 ? 'ok' : 'error'}">${e.status}</span>
                    ${cnt}
                </div>`;
            }
            if (e._type === 'click') {
                return `<div class="cd-timeline-item click">
                    <span class="cd-timeline-time">${offset}</span>
                    <span class="cd-tag click">CLICK</span>
                    <span class="cd-timeline-selector">${e.selector}</span>
                    ${e.text ? `<span class="cd-timeline-text">"${e.text.substring(0, 20)}"</span>` : ''}
                    ${cnt}
                </div>`;
            }
            if (e._type === 'nav') {
                return `<div class="cd-timeline-item nav">
                    <span class="cd-timeline-time">${offset}</span>
                    <span class="cd-tag nav">${e.kind.toUpperCase()}</span>
                    <span class="cd-timeline-endpoint">${e.to}</span>
                </div>`;
            }
            if (e._type === 'submit') {
                return `<div class="cd-timeline-item submit">
                    <span class="cd-timeline-time">${offset}</span>
                    <span class="cd-tag submit">SUBMIT</span>
                    <span class="cd-timeline-selector">${e.selector}</span>
                    ${e.action ? `<span class="cd-timeline-endpoint">→ ${e.action}</span>` : ''}
                </div>`;
            }
            return `<div class="cd-timeline-item input">
                <span class="cd-timeline-time">${offset}</span>
                <span class="cd-tag input">INPUT</span>
                <span class="cd-timeline-selector">${e.el}</span>
                ${e.value ? `<span class="cd-timeline-text">"${String(e.value).substring(0, 20)}"</span>` : ''}
                ${cnt}
            </div>`;
        }).join('');
    }

    function renderAPIs() {
        let html = '';
        state.apis.forEach((info, key) => {
            const actions  = Array.from(info.actions);
            const params   = Array.from(info.params);
            const bodyKeys = Array.from(info.bodyKeys);
            html += `<div class="cd-api-item">
                <div class="cd-api-header"><span class="cd-api-endpoint">${key}</span><span class="cd-api-count">${info.count}x</span></div>
                <div class="cd-api-details">${actions.map(a => `<span class="cd-api-tag">action:${a}</span>`).join('')}</div>
                ${params.length   ? `<div class="cd-params-list"><span style="font-size:9px;color:#64748b;margin-right:4px">Params:</span>${params.map(p => `<span class="cd-param-tag">${p}</span>`).join('')}</div>` : ''}
                ${bodyKeys.length ? `<div class="cd-params-list"><span style="font-size:9px;color:#64748b;margin-right:4px">Body:</span>${bodyKeys.map(k => `<span class="cd-param-tag">${k}</span>`).join('')}</div>` : ''}
            </div>`;
        });
        return html;
    }

    function renderElementDict() {
        let html = '<div class="cd-api-grid">';
        state.elements.forEach((info, sel) => {
            html += `<div class="cd-api-item">
                <div class="cd-api-header">
                    <span class="cd-api-endpoint">${sel}</span>
                    <span class="cd-api-count">${info.count}x</span>
                </div>
                ${info.text ? `<div style="font-size:11px;color:#475569;margin-top:4px">"${info.text}"</div>` : ''}
                ${info.boundingBox ? `<div class="cd-params-list"><span class="cd-bbox-badge">${info.boundingBox.width}×${info.boundingBox.height}px @ (${info.boundingBox.x},${info.boundingBox.y})</span></div>` : ''}
            </div>`;
        });
        return html + '</div>';
    }

    function renderDevTools() {
        const events = getUnifiedTimeline();
        if (events.length === 0) return '<div class="cd-empty"><div class="cd-empty-text">Nenhuma ação capturada.</div></div>';

        return `<div style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #e2e8f0">
            <div style="font-size:14px;font-weight:600;color:#1e293b">Timeline Unificada</div>
            <div style="font-size:11px;color:#64748b;margin-top:4px">${events.length} eventos em ordem cronológica • Clique para expandir</div>
        </div>` + events.map((e, i) => {
            const offset = `+${(e.t / 1000).toFixed(1)}s`;
            const isExp  = expandedItems.has(`event-${i}`);
            const cnt    = (e.count && e.count > 1) ? `<span class="cd-count">×${e.count}</span>` : '';

            if (e._type === 'request') {
                return `<div class="cd-item request ${isExp ? 'expanded' : ''}" data-id="event-${i}">
                    <div class="cd-item-header">
                        <div class="cd-item-left">
                            <span class="cd-item-index">${i + 1}</span>
                            <span class="cd-tag ${e.src.toLowerCase()}">${e.src}</span>
                            <span class="cd-tag ${e.method.toLowerCase()}">${e.method}</span>
                            <span class="cd-endpoint">${e.path}</span>
                            ${e.action ? `<span class="cd-action-badge">${e.action}</span>` : ''}
                            ${cnt}
                        </div>
                        <div class="cd-item-right">
                            <span class="cd-status ${e.status >= 200 && e.status < 300 ? 'ok' : 'error'}">${e.status}</span>
                            <span class="cd-time">${e.duration}ms</span>
                            <span class="cd-time">${offset}</span>
                        </div>
                    </div>
                    <div class="cd-item-body">
                        <div class="cd-code-block"><div class="cd-code-label">URL</div><div class="cd-code">${e.url}</div></div>
                        ${e.params   ? `<div class="cd-code-block"><div class="cd-code-label">Params</div><div class="cd-code">${JSON.stringify(e.params, null, 2)}</div></div>` : ''}
                        ${e.body     ? `<div class="cd-code-block"><div class="cd-code-label">Body</div><div class="cd-code">${JSON.stringify(e.body, null, 2)}</div></div>` : ''}
                        ${e.response ? `<div class="cd-code-block"><div class="cd-code-label">Response (schema)</div><div class="cd-code">${JSON.stringify(extractSchema(e.response), null, 2)}</div></div>` : ''}
                    </div>
                </div>`;
            }

            if (e._type === 'click') {
                const bb = e.boundingBox;
                return `<div class="cd-item click ${isExp ? 'expanded' : ''}" data-id="event-${i}">
                    <div class="cd-item-header">
                        <div class="cd-item-left">
                            <span class="cd-item-index">${i + 1}</span>
                            <span class="cd-tag click">CLICK</span>
                            <span class="cd-endpoint">${e.selector}</span>
                            ${e.text ? `<span class="cd-timeline-text">"${e.text.substring(0, 25)}"</span>` : ''}
                            ${cnt}
                        </div>
                        <div class="cd-item-right">
                            ${bb ? `<span class="cd-bbox-badge">${bb.width}×${bb.height}px</span>` : ''}
                            <span class="cd-time">${offset}</span>
                        </div>
                    </div>
                    <div class="cd-item-body">
                        <div class="cd-code-block"><div class="cd-code-label">Selector</div><div class="cd-code">${e.selector}</div></div>
                        ${e.text ? `<div class="cd-code-block"><div class="cd-code-label">Text</div><div class="cd-code">${e.text}</div></div>` : ''}
                        ${bb ? `<div class="cd-code-block"><div class="cd-code-label">Bounding Box</div><div class="cd-code">${JSON.stringify(bb, null, 2)}</div></div>` : ''}
                        ${e.xpath ? `<div class="cd-code-block"><div class="cd-code-label">XPath</div><div class="cd-code">${e.xpath}</div></div>` : ''}
                    </div>
                </div>`;
            }

            if (e._type === 'nav') {
                return `<div class="cd-item nav ${isExp ? 'expanded' : ''}" data-id="event-${i}">
                    <div class="cd-item-header">
                        <div class="cd-item-left">
                            <span class="cd-item-index">${i + 1}</span>
                            <span class="cd-tag nav">${e.kind.toUpperCase()}</span>
                            <span class="cd-endpoint">${e.to}</span>
                        </div>
                        <div class="cd-item-right"><span class="cd-time">${offset}</span></div>
                    </div>
                    <div class="cd-item-body">
                        <div class="cd-code-block"><div class="cd-code-label">De</div><div class="cd-code">${e.from}</div></div>
                        <div class="cd-code-block"><div class="cd-code-label">Para</div><div class="cd-code">${e.to}</div></div>
                        ${e.title ? `<div class="cd-code-block"><div class="cd-code-label">Título</div><div class="cd-code">${e.title}</div></div>` : ''}
                    </div>
                </div>`;
            }

            if (e._type === 'submit') {
                return `<div class="cd-item submit ${isExp ? 'expanded' : ''}" data-id="event-${i}">
                    <div class="cd-item-header">
                        <div class="cd-item-left">
                            <span class="cd-item-index">${i + 1}</span>
                            <span class="cd-tag submit">SUBMIT</span>
                            <span class="cd-endpoint">${e.selector}</span>
                        </div>
                        <div class="cd-item-right"><span class="cd-time">${offset}</span></div>
                    </div>
                    <div class="cd-item-body">
                        ${e.action ? `<div class="cd-code-block"><div class="cd-code-label">Action</div><div class="cd-code">${e.action}</div></div>` : ''}
                        <div class="cd-code-block"><div class="cd-code-label">Method</div><div class="cd-code">${e.method}</div></div>
                        ${e.fields?.length ? `<div class="cd-code-block"><div class="cd-code-label">Fields</div><div class="cd-code">${JSON.stringify(e.fields, null, 2)}</div></div>` : ''}
                    </div>
                </div>`;
            }

            // input
            return `<div class="cd-item input ${isExp ? 'expanded' : ''}" data-id="event-${i}">
                <div class="cd-item-header">
                    <div class="cd-item-left">
                        <span class="cd-item-index">${i + 1}</span>
                        <span class="cd-tag input">INPUT</span>
                        <span class="cd-endpoint">${e.el}</span>
                        ${e.value ? `<span class="cd-timeline-text">"${String(e.value).substring(0, 25)}"</span>` : ''}
                        ${cnt}
                    </div>
                    <div class="cd-item-right"><span class="cd-time">${offset}</span></div>
                </div>
                <div class="cd-item-body">
                    <div class="cd-code-block"><div class="cd-code-label">Elemento</div><div class="cd-code">${e.el}</div></div>
                    ${e.name  ? `<div class="cd-code-block"><div class="cd-code-label">Name</div><div class="cd-code">${e.name}</div></div>` : ''}
                    ${e.value ? `<div class="cd-code-block"><div class="cd-code-label">Value</div><div class="cd-code">${e.value}</div></div>` : ''}
                </div>
            </div>`;
        }).join('');
    }

    function renderExportar() {
        return `
            <div class="cd-export-info" style="${CONFIG.includeFullResponses ? 'background:#fef2f2;border-color:#fca5a5;' : ''}">
                <div class="cd-export-info-text" style="${CONFIG.includeFullResponses ? 'color:#991b1b;' : ''}">
                    ${CONFIG.includeFullResponses
                        ? '<strong>MODO FULL + BLOAT MITIGATION:</strong> Responses incluídas com arrays > 3 itens automaticamente truncados.'
                        : '<strong>Exportação LEAN:</strong> Timeline dedup + endpoints + elements + navigation. Response schema por default.'}
                </div>
            </div>
            <div class="cd-export-section">
                <div class="cd-export-title">Dados extras</div>
                <div class="cd-export-grid">
                    ${[
                        ['includeResponseSchema',  'Response (Schema)'],
                        ['includeFullResponses',   'Response COMPLETA + Bloat Mitigation'],
                        ['includeHeaders',         'Headers das requisições'],
                        ['includeXPath',           'XPath dos elementos'],
                        ['includeClickPosition',   'Bounding Box dos clicks'],
                        ['includeElementDetails',  'Detalhes dos elementos'],
                        ['includeNavigation',      'Navegação (URL/title changes)'],
                        ['dedupRequests',          'Dedup de requests (polling)'],
                        ['dedupClicks',            'Dedup de clicks (double-click)'],
                        ['dedupInputs',            'Dedup de inputs (só último valor)']
                    ].map(([key, label]) => `
                        <label class="cd-export-item ${CONFIG[key] ? 'checked' : ''}">
                            <input type="checkbox" data-config="${key}" ${CONFIG[key] ? 'checked' : ''} onchange="window.cdToggleExport(this)">
                            <span>${label}</span>
                        </label>`).join('')}
                </div>
            </div>
            <div class="cd-export-size">
                <span class="cd-export-size-label">Tamanho estimado:</span>
                <span class="cd-export-size-value" id="cd-export-size-value">…</span>
            </div>
            <div class="cd-filename-section">
                <div class="cd-filename-label">Nome do arquivo</div>
                <div class="cd-input-suffix">
                    <input type="text" class="cd-input" id="cd-filename" value="${state.fileName}" placeholder="${getDefaultFileName()}">
                    <span class="cd-input-suffix-text">-devtools</span>
                </div>
            </div>`;
    }

    // =================================================================
    // EXPORT
    // =================================================================

    function getFileName() {
        return `${state.fileName?.trim() || getDefaultFileName()}-devtools`;
    }

    function cleanObject(obj) {
        if (!obj || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj.map(cleanObject);
        const cleaned = {};
        Object.keys(obj).forEach(key => {
            const val = obj[key];
            if (
                val !== undefined && val !== null && val !== '' &&
                !(Array.isArray(val) && val.length === 0) &&
                !(typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0)
            ) cleaned[key] = cleanObject(val);
        });
        return cleaned;
    }

    function exportData() {
        // ── Timeline consolidada ──
        const processedRequests = state.requests.map(r => {
            const req = {
                type:   'request',
                t:      r.t,
                sig:    r.sig,
                src:    r.src,
                method: r.method,
                path:   r.path,
                params: r.params,
                action: r.action,
                body:   r.body,
                status: r.status,
                count:  r.count > 1 ? r.count : undefined,
                lastT:  r.lastT
            };
            if (CONFIG.includeHeaders && r.headers && Object.keys(r.headers).length > 0) req.headers = r.headers;
            if (CONFIG.includeFullResponses && r.response)       req.response       = mitigateTokenBloat(r.response);
            else if (CONFIG.includeResponseSchema && r.response) req.responseSchema = extractSchema(r.response);
            return cleanObject(req);
        });

        const processedClicks = state.clicks.map(c => {
            const click = {
                type:     'click',
                t:        c.t,
                selector: c.selector,
                text:     c.text,
                count:    c.count > 1 ? c.count : undefined
            };
            if (CONFIG.includeXPath          && c.xpath)       click.xpath       = c.xpath;
            if (CONFIG.includeClickPosition  && c.boundingBox) click.boundingBox = c.boundingBox;
            if (CONFIG.includeElementDetails && c.element)     click.element     = c.element;
            return cleanObject(click);
        });

        const processedInputs = state.inputs.map(i => cleanObject({
            type:  'input',
            t:     i.t,
            sig:   i.sig,
            el:    i.el,
            itype: i.type,
            name:  i.name,
            value: i.value,
            count: i.count > 1 ? i.count : undefined
        }));

        const processedNav = CONFIG.includeNavigation
            ? state.navigation.map(n => cleanObject({
                type:  'nav',
                t:     n.t,
                kind:  n.kind,
                from:  n.from,
                to:    n.to,
                title: n.title
            }))
            : [];

        const processedSubmits = state.submits.map(s => cleanObject({
            type:     'submit',
            t:        s.t,
            selector: s.selector,
            action:   s.action,
            method:   s.method,
            fields:   s.fields
        }));

        const timeline = [
            ...processedRequests,
            ...processedClicks,
            ...processedInputs,
            ...processedNav,
            ...processedSubmits
        ].sort((a, b) => a.t - b.t);

        // ── Endpoints (agregado) ──
        const endpoints = {};
        state.apis.forEach((info, key) => {
            endpoints[key] = cleanObject({
                count:          info.count,
                methods:        Array.from(info.methods),
                actions:        Array.from(info.actions),
                params:         Array.from(info.params),
                bodyKeys:       Array.from(info.bodyKeys),
                responseSchema: info.responseSchema
            });
        });

        // ── Elements (dicionário) ──
        const elements = {};
        state.elements.forEach((info, sel) => {
            elements[sel] = cleanObject({
                text:        info.text,
                count:       info.count,
                boundingBox: CONFIG.includeClickPosition ? info.boundingBox : undefined
            });
        });

        const data = {
            meta: {
                tool:       'Conecta Devtools',
                version:    '3.5.0',
                mode:       CONFIG.includeFullResponses ? 'FULL+BLOAT_MITIGATION' : 'LEAN',
                exportedAt: new Date().toISOString(),
                duration:   state.startTime ? formatTime(Date.now() - state.startTime) : '0s',
                reloads:    state._reloadCount || 0,
                counts: {
                    requests: processedRequests.length,
                    clicks:   processedClicks.length,
                    inputs:   processedInputs.length,
                    nav:      processedNav.length,
                    submits:  processedSubmits.length,
                    errors:   (state.errors || []).length,
                    apis:     state.apis.size,
                    elements: state.elements.size,
                    timeline: timeline.length
                }
            },
            page:      state.pageInfo,
            session:   state.session,
            endpoints,
            elements,
            navigation: CONFIG.includeNavigation ? state.navigation : undefined,
            timeline,
            errors:    (state.errors || []).length > 0 ? state.errors : undefined
        };

        if (CONFIG.includeCookies && Object.keys(state.cookies || {}).length > 0) {
            data.cookies = state.cookies;
        }

        return cleanObject(data);
    }

    window.cdToggleExport = function (checkbox) {
        const key = checkbox.dataset.config;
        if (key && key in CONFIG) {
            CONFIG[key] = checkbox.checked;
            if (key === 'includeFullResponses'  && checkbox.checked) CONFIG.includeResponseSchema = false;
            if (key === 'includeResponseSchema' && checkbox.checked) CONFIG.includeFullResponses  = false;
            renderContent();
        }
    };

    window.cdExportJSON = function () {
        const data   = exportData();
        const json   = JSON.stringify(data, null, 2);
        const prefix = getFileName();

        const a = document.createElement('a');
        a.href     = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        a.download = `${prefix}.json`;
        a.click();
        URL.revokeObjectURL(a.href);

        console.log(`%c[Conecta Devtools] JSON: ${formatBytes(json.length)} — ${data.meta.counts.timeline} eventos`, 'color:#166534;font-weight:bold');
    };

    window.cdExportMD = function () {
        const data   = exportData();
        const prefix = getFileName();

        let md = `# Conecta Devtools — Relatório\n\n`;
        md += `**Versão:** ${data.meta.version} | **Modo:** ${data.meta.mode}\n`;
        md += `**Exportado:** ${data.meta.exportedAt} | **Duração:** ${data.meta.duration}\n`;
        if (data.meta.reloads > 0) md += `**Reloads durante captura:** ${data.meta.reloads}\n`;
        md += `**Página:** ${data.page?.url}\n\n`;

        md += `## Resumo\n\n| Métrica | Valor |\n|---|---|\n`;
        md += `| Requests | ${data.meta.counts.requests} |\n`;
        md += `| Clicks   | ${data.meta.counts.clicks}   |\n`;
        md += `| Inputs   | ${data.meta.counts.inputs}   |\n`;
        md += `| Nav      | ${data.meta.counts.nav}      |\n`;
        md += `| Submits  | ${data.meta.counts.submits}  |\n`;
        md += `| APIs     | ${data.meta.counts.apis}     |\n`;
        md += `| Elementos| ${data.meta.counts.elements} |\n`;
        md += `| Total timeline | ${data.meta.counts.timeline} |\n\n`;

        if (data.session && Object.keys(data.session).length > 0) {
            md += `## Session\n\n\`\`\`json\n${JSON.stringify(data.session, null, 2)}\n\`\`\`\n\n`;
        }

        if (data.endpoints && Object.keys(data.endpoints).length > 0) {
            md += `## Endpoints\n\n`;
            Object.entries(data.endpoints).forEach(([ep, info]) => {
                md += `### ${ep}\n- **Calls:** ${info.count}\n`;
                if (info.actions?.length)  md += `- **Actions:** ${info.actions.join(', ')}\n`;
                if (info.params?.length)   md += `- **Params:** ${info.params.join(', ')}\n`;
                if (info.bodyKeys?.length) md += `- **Body Keys:** ${info.bodyKeys.join(', ')}\n`;
                if (info.responseSchema) {
                    md += `- **Response Schema:**\n\`\`\`json\n${JSON.stringify(info.responseSchema, null, 2)}\n\`\`\`\n`;
                }
                md += '\n';
            });
        }

        if (data.elements && Object.keys(data.elements).length > 0) {
            md += `## Elementos\n\n| Seletor | Text | Count | BBox |\n|---|---|---|---|\n`;
            Object.entries(data.elements).forEach(([sel, info]) => {
                const bb = info.boundingBox ? `${info.boundingBox.width}×${info.boundingBox.height}@(${info.boundingBox.x},${info.boundingBox.y})` : '-';
                md += `| \`${sel}\` | ${info.text ? '"' + info.text.replace(/\|/g, '\\|') + '"' : '-'} | ${info.count} | ${bb} |\n`;
            });
            md += '\n';
        }

        if (data.timeline?.length > 0) {
            md += `## Timeline\n\n`;
            md += `> Eventos deduplicados em ordem cronológica\n\n`;
            data.timeline.forEach((event, i) => {
                const offset = `+${(event.t / 1000).toFixed(2)}s`;
                const cnt = event.count > 1 ? ` **×${event.count}**` : '';
                if (event.type === 'request') {
                    md += `### ${i + 1}. [REQUEST] ${event.method} ${event.path} — \`${offset}\`${cnt}\n`;
                    md += `- **Status:** ${event.status}\n`;
                    if (event.src)      md += `- **Src:** ${event.src}\n`;
                    if (event.action)   md += `- **Action:** ${event.action}\n`;
                    if (event.params)   md += `- **Params:** \`${JSON.stringify(event.params)}\`\n`;
                    if (event.body)     md += `- **Body:**\n\`\`\`json\n${JSON.stringify(event.body, null, 2)}\n\`\`\`\n`;
                    if (event.responseSchema) md += `- **Response Schema:**\n\`\`\`json\n${JSON.stringify(event.responseSchema, null, 2)}\n\`\`\`\n`;
                    else if (event.response) md += `- **Response:**\n\`\`\`json\n${JSON.stringify(event.response, null, 2)}\n\`\`\`\n`;
                } else if (event.type === 'click') {
                    md += `### ${i + 1}. [CLICK] \`${event.selector}\` — \`${offset}\`${cnt}\n`;
                    if (event.text)        md += `- **Text:** "${event.text}"\n`;
                    if (event.boundingBox) md += `- **BoundingBox:** ${event.boundingBox.width}×${event.boundingBox.height} @ (${event.boundingBox.x},${event.boundingBox.y})\n`;
                    if (event.xpath)       md += `- **XPath:** \`${event.xpath}\`\n`;
                } else if (event.type === 'input') {
                    md += `### ${i + 1}. [INPUT] \`${event.el}\` — \`${offset}\`${cnt}\n`;
                    if (event.name)  md += `- **Name:** ${event.name}\n`;
                    if (event.itype) md += `- **Type:** ${event.itype}\n`;
                    if (event.value) md += `- **Value:** ${event.value}\n`;
                } else if (event.type === 'nav') {
                    md += `### ${i + 1}. [NAV/${event.kind}] — \`${offset}\`\n`;
                    md += `- **De:** ${event.from}\n`;
                    md += `- **Para:** ${event.to}\n`;
                    if (event.title) md += `- **Título:** ${event.title}\n`;
                } else if (event.type === 'submit') {
                    md += `### ${i + 1}. [SUBMIT] \`${event.selector}\` — \`${offset}\`\n`;
                    if (event.action) md += `- **Action:** ${event.action}\n`;
                    md += `- **Method:** ${event.method}\n`;
                    if (event.fields?.length) md += `- **Fields:**\n\`\`\`json\n${JSON.stringify(event.fields, null, 2)}\n\`\`\`\n`;
                }
                md += '\n';
            });
        }

        if (data.errors?.length > 0) {
            md += `## Erros\n\n`;
            data.errors.forEach((err, i) => {
                md += `${i + 1}. \`[${err.type}]\` ${err.msg}${err.file ? ` — ${err.file}` : ''}\n`;
            });
        }

        const a = document.createElement('a');
        a.href     = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
        a.download = `${prefix}.md`;
        a.click();
        URL.revokeObjectURL(a.href);

        console.log(`%c[Conecta Devtools] MD exportado: ${data.meta.counts.timeline} eventos`, 'color:#166534;font-weight:bold');
    };

    window.cdHide = hideModal;

    window.cdDiscardAndReset = function () {
        if (!confirm('Tem certeza? Isso apagará todos os dados capturados.')) return;
        clearState();
        state.capturing    = false;
        state._wasRestored = false;
        state._reloadCount = 0;
        state.requests = []; state.clicks = []; state.inputs = []; state.errors = [];
        state.submits = [];  state.navigation = [];
        state.apis = new Map();
        state.elements = new Map();
        state.counts = emptyCounts();
        hideModal();
        updateButton();
        console.log('%c[Conecta Devtools] Estado descartado.', 'color:#dc2626;font-weight:bold');
    };

    // =================================================================
    // INIT
    // =================================================================

    function init() {
        console.log('%c[Conecta Devtools v3.5.0]', 'color:#570a7d;font-weight:bold;font-size:14px');
        console.log('%cTimeline dedup · Navigation · Elements dict · Response schema · Sem screenshot', 'color:#64748b');

        injectStyles();
        setupNetworkInterceptor();
        setupClickInterceptor();
        setupInputInterceptor();
        setupSubmitInterceptor();
        setupErrorInterceptor();
        setupNavigationInterceptor();
        createButton();

        const wasRestored = restoreState();
        if (wasRestored && state.capturing) {
            state._wasRestored  = true;
            state._reloadCount  = (state._reloadCount || 0) + 1;
            state.updateInterval = setInterval(() => { saveState(); updateButton(); }, 1000);
            console.log(`%c[Conecta Devtools v3.5] Sessão restaurada após reload #${state._reloadCount}`, 'color:#f59e0b;font-weight:bold');
        }

        updateButton();
    }

    document.readyState === 'loading'
        ? document.addEventListener('DOMContentLoaded', init)
        : init();
})();
