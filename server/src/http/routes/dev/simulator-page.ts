/**
 * The simulator page (`GET /dev/simulador`): one self-contained HTML document (inline CSS and JS,
 * no build step), WhatsApp-like. It talks only to `/dev/simulador/api/*` and polls it.
 * The client script avoids template literals so it can live inside this TypeScript string.
 */
export const SIMULATOR_PAGE = String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ALZA · Simulador de WhatsApp</title>
<style>
  :root {
    --wa-green: #075e54; --wa-teal: #128c7e; --wa-light: #25d366; --chat-bg: #efeae2;
    --mine: #d9fdd3; --theirs: #ffffff; --tick-read: #34b7f1; --muted: #667781; --line: #e2ddd5;
    --panel: #ffffff; --page: #d1d7db; --text: #111b21; --danger: #b3261e;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         background: var(--page); color: var(--text); }
  .app { display: grid; grid-template-columns: 280px minmax(320px, 1fr) 360px; height: 100vh; gap: 0; }
  @media (max-width: 1100px) { .app { grid-template-columns: 1fr; height: auto; } .chat { height: 80vh; } }
  aside, .ledger { background: var(--panel); overflow-y: auto; padding: 14px; border-right: 1px solid var(--line); }
  .ledger { border-left: 1px solid var(--line); border-right: none; }
  h1 { font-size: 16px; margin: 0 0 4px; color: var(--wa-green); }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 18px 0 8px; }
  .hint { color: var(--muted); font-size: 12px; margin: 0 0 8px; }
  label { display: block; font-size: 12px; color: var(--muted); margin: 6px 0 2px; }
  input, select, button, textarea { font: inherit; }
  input[type=text], select { width: 100%; padding: 7px 9px; border: 1px solid #cfd4d7; border-radius: 8px; background: #fff; }
  button { cursor: pointer; border: none; border-radius: 8px; padding: 8px 12px; background: var(--wa-teal); color: #fff; font-weight: 600; }
  button.secondary { background: #e9edef; color: var(--text); }
  button:disabled { opacity: .5; cursor: default; }
  .row { display: flex; gap: 6px; align-items: center; }
  .row > * { flex: 1; }
  .row > button { flex: none; }
  .thumb { width: 100%; max-height: 180px; object-fit: contain; background: #f0f2f5; border-radius: 8px; margin-top: 6px; }
  .chat { display: flex; flex-direction: column; background: var(--chat-bg); min-width: 0; }
  .chat header { background: var(--wa-green); color: #fff; padding: 12px 16px; display: flex; align-items: center; gap: 12px; }
  .avatar { width: 36px; height: 36px; border-radius: 50%; background: var(--wa-light); display: grid; place-items: center; font-weight: 700; color: var(--wa-green); }
  .chat header .who { font-weight: 600; }
  .chat header .sub { font-size: 12px; opacity: .85; }
  .messages { flex: 1; overflow-y: auto; padding: 16px 6%; display: flex; flex-direction: column; gap: 4px; }
  .bubble { max-width: 75%; padding: 6px 9px 4px; border-radius: 8px; box-shadow: 0 1px .5px rgba(11,20,26,.13); position: relative; word-wrap: break-word; white-space: pre-wrap; }
  .mine { align-self: flex-end; background: var(--mine); border-top-right-radius: 0; }
  .theirs { align-self: flex-start; background: var(--theirs); border-top-left-radius: 0; }
  .meta { font-size: 11px; color: var(--muted); text-align: right; margin-top: 2px; display: flex; gap: 4px; justify-content: flex-end; align-items: center; }
  .tick { font-size: 13px; letter-spacing: -3px; color: var(--muted); }
  .tick.read { color: var(--tick-read); }
  .catalog { font-size: 10px; font-weight: 700; color: var(--wa-teal); margin-bottom: 2px; }
  .bubble img { max-width: 260px; max-height: 320px; display: block; border-radius: 6px; margin-bottom: 4px; }
  .bubble audio { width: 240px; display: block; }
  .buttons { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
  .buttons button { background: #fff; color: #027eb5; border-top: 1px solid var(--line); border-radius: 0; font-weight: 500; }
  .reply-link { font-size: 11px; color: var(--wa-teal); cursor: pointer; background: none; padding: 0; font-weight: 500; }
  .quote { font-size: 12px; border-left: 3px solid var(--wa-teal); padding: 2px 6px; margin-bottom: 4px; background: rgba(0,0,0,.04); border-radius: 4px; color: var(--muted); }
  .day { align-self: center; background: #fff; color: var(--muted); font-size: 12px; padding: 4px 10px; border-radius: 8px; margin: 8px 0; }
  .composer { padding: 8px 12px; background: #f0f2f5; display: flex; gap: 8px; align-items: center; }
  .composer input[type=text] { border-radius: 20px; padding: 10px 14px; border: none; }
  .composer .attach { background: none; color: var(--muted); font-size: 20px; padding: 4px 6px; }
  .replying { padding: 6px 12px; background: #e7f3ef; font-size: 12px; display: none; justify-content: space-between; }
  .empty { margin: auto; color: var(--muted); text-align: center; padding: 30px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  td, th { padding: 5px 4px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
  th { color: var(--muted); font-weight: 600; }
  .pill { display: inline-block; padding: 1px 6px; border-radius: 10px; font-size: 11px; background: #e9edef; }
  .pill.confirmed, .pill.recorded { background: #d9fdd3; }
  .pill.pending, .pill.open, .pill.in_web { background: #fff3c4; }
  .pill.failed, .pill.error, .pill.voided, .pill.superseded, .pill.duplicate { background: #fde2e1; }
  .amount { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .out { color: var(--danger); }
  .status { font-size: 12px; color: var(--muted); min-height: 16px; margin-top: 6px; }
</style>
</head>
<body>
<div class="app">
  <aside>
    <h1>Simulador de WhatsApp</h1>
    <p class="hint">Herramienta de desarrollo. Cada mensaje viaja como un webhook de Meta firmado por <code>POST /webhook/whatsapp</code>.</p>

    <h2>Celular</h2>
    <label for="phoneSelect">Elegir un número</label>
    <select id="phoneSelect"></select>
    <label for="phoneInput">u otro número</label>
    <div class="row"><input id="phoneInput" type="text" placeholder="987 654 321"><button id="usePhone" class="secondary">Usar</button></div>
    <div style="margin-top:8px"><button id="newPhone" class="secondary">Número nuevo (alta)</button></div>
    <p class="hint">Un número que ALZA no conoce: escribe «Hola ALZA» para empezar el alta completa.</p>

    <h2>Usuaria de prueba</h2>
    <p class="hint">Atajo: crea (o completa) una usuaria con alta completa y consentimiento, sin pasar por el alta.</p>
    <label for="bizName">Negocio</label><input id="bizName" type="text" value="Bodega de prueba">
    <label for="holderName">Titular de Yape o Plin</label><input id="holderName" type="text" value="Marta Quispe">
    <div style="margin-top:8px"><button id="createUser">Crear con este número</button></div>

    <h2>Del dataset</h2>
    <label for="datasetSelect">Captura o audio</label>
    <select id="datasetSelect"></select>
    <img id="datasetPreview" class="thumb" alt="" hidden>
    <div style="margin-top:8px"><button id="sendDataset">Enviar archivo</button></div>

    <h2>Subir</h2>
    <label for="imageFile">Imagen</label><input id="imageFile" type="file" accept="image/*">
    <label for="audioFile">Audio</label><input id="audioFile" type="file" accept="audio/*">
    <div class="status" id="status"></div>
  </aside>

  <section class="chat">
    <header>
      <div class="avatar">A</div>
      <div><div class="who">ALZA</div><div class="sub" id="chatSub">elige un número</div></div>
      <div style="flex:1"></div>
      <button id="resetChat" class="secondary" title="Borra solo esta vista (memoria)">Limpiar vista</button>
    </header>
    <div class="messages" id="messages"><div class="empty">Elige o crea un número para empezar.</div></div>
    <div class="replying" id="replying"><span id="replyingText"></span><button class="reply-link" id="cancelReply">cancelar</button></div>
    <div class="composer">
      <button class="attach" id="attachImage" title="Imagen">📎</button>
      <input id="textInput" type="text" placeholder="Escribe un mensaje" autocomplete="off">
      <button id="sendText">Enviar</button>
    </div>
  </section>

  <section class="ledger">
    <h1>Libro (vista de desarrollo)</h1>
    <p class="hint" id="userInfo">—</p>
    <h2>Mensajes entrantes</h2><div id="inboundTable"></div>
    <h2>Movimientos</h2><div id="entriesTable"></div>
    <h2>Dudas</h2><div id="doubtsTable"></div>
  </section>
</div>
<script>
(function () {
  var API = '/dev/simulador/api';
  var state = { phone: null, events: [], lastJson: '', replyTo: null };
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'class') node.className = attrs[k];
      else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }
  function setStatus(text) { $('status').textContent = text || ''; }
  function api(path, options) {
    return fetch(API + path, options).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) { var err = new Error(body.error || ('HTTP ' + res.status)); err.body = body; throw err; }
        return body;
      });
    });
  }
  function post(path, body) {
    return api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }
  function time(iso) {
    var d = new Date(iso);
    return d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima' });
  }

  function loadUsers(selectPhone) {
    return api('/users').then(function (data) {
      var select = $('phoneSelect');
      select.innerHTML = '';
      select.appendChild(el('option', { value: '', text: '— elige —' }));
      data.users.forEach(function (u) {
        var label = u.phone + (u.businessName ? ' · ' + u.businessName : '') + (u.onboardingStatus ? ' (' + u.onboardingStatus + ')' : '');
        select.appendChild(el('option', { value: u.phone, text: label }));
      });
      if (selectPhone) select.value = selectPhone;
    });
  }
  function normalizePhone(p) {
    p = (p || '').replace(/[\s\-().]/g, '');
    if (/^9\d{8}$/.test(p)) return '+51' + p;
    if (/^519\d{8}$/.test(p)) return '+' + p;
    return p;
  }
  function choosePhone(phone) {
    phone = phone ? normalizePhone(phone) : null;
    state.phone = phone; state.lastJson = ''; state.replyTo = null; showReplying();
    $('chatSub').textContent = phone ? 'escribiendo desde ' + phone : 'elige un número';
    refresh(); refreshLedger();
  }

  function tickNode(tick) {
    if (tick === 'sent') return el('span', { class: 'tick', text: '✓', title: 'enviado' });
    return el('span', { class: 'tick' + (tick === 'read' ? ' read' : ''), text: '✓✓', title: tick === 'read' ? 'leído' : 'entregado' });
  }
  function mediaUrl(id) { return API + '/media/' + encodeURIComponent(id); }
  function findEvent(waId) { for (var i = 0; i < state.events.length; i++) if (state.events[i].waMessageId === waId) return state.events[i]; return null; }
  function summary(ev) {
    var c = ev.content;
    if (c.type === 'text' || c.type === 'buttons') return c.body.slice(0, 60);
    if (c.type === 'image') return '📷 ' + (c.caption || 'imagen');
    if (c.type === 'audio') return '🎤 audio';
    if (c.type === 'interactive') return c.buttonTitle;
    return '';
  }
  function renderEvent(ev) {
    var c = ev.content, mine = ev.direction === 'inbound';
    var parts = [];
    if (!mine) parts.push(el('div', { class: 'catalog', text: ev.catalogId }));
    if (ev.replyToWaMessageId) {
      var quoted = findEvent(ev.replyToWaMessageId);
      parts.push(el('div', { class: 'quote', text: quoted ? summary(quoted) : 'mensaje citado' }));
    }
    if (c.type === 'image') {
      parts.push(el('img', { src: mediaUrl(c.mediaId), alt: 'imagen' }));
      if (c.caption) parts.push(el('div', { text: c.caption }));
    } else if (c.type === 'audio') {
      parts.push(el('audio', { controls: '', src: mediaUrl(c.mediaId) }));
    } else if (c.type === 'interactive') {
      parts.push(el('div', { text: '🔘 ' + c.buttonTitle }));
    } else {
      if (c.header) parts.push(el('div', { text: c.header, style: 'font-weight:600' }));
      parts.push(el('div', { text: c.body }));
      if (c.footer) parts.push(el('div', { text: c.footer, style: 'font-size:12px;color:#667781' }));
    }
    if (c.type === 'buttons') {
      parts.push(el('div', { class: 'buttons' }, c.buttons.map(function (b) {
        return el('button', { text: b.title, onclick: function () { sendButton(b, ev.waMessageId); } });
      })));
    }
    var meta = [el('span', { text: time(ev.at) })];
    if (mine) meta.push(tickNode(ev.tick));
    else meta.unshift(el('button', { class: 'reply-link', text: '↩ responder', onclick: function () { state.replyTo = ev; showReplying(); $('textInput').focus(); } }));
    parts.push(el('div', { class: 'meta' }, meta));
    return el('div', { class: 'bubble ' + (mine ? 'mine' : 'theirs') }, parts);
  }
  function render() {
    var box = $('messages');
    var atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    box.innerHTML = '';
    if (!state.events.length) { box.appendChild(el('div', { class: 'empty', text: state.phone ? 'Sin mensajes en esta vista. Manda una captura, un audio o un texto.' : 'Elige o crea un número para empezar.' })); return; }
    var lastDay = '';
    state.events.forEach(function (ev) {
      var day = new Date(ev.at).toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Lima' });
      if (day !== lastDay) { box.appendChild(el('div', { class: 'day', text: day })); lastDay = day; }
      box.appendChild(renderEvent(ev));
    });
    if (atBottom || state.justSent) { box.scrollTop = box.scrollHeight; state.justSent = false; }
  }
  function refresh() {
    if (!state.phone) { state.events = []; render(); return Promise.resolve(); }
    return api('/conversation?phone=' + encodeURIComponent(state.phone)).then(function (data) {
      var json = JSON.stringify(data.events);
      if (json === state.lastJson) return;
      state.lastJson = json; state.events = data.events; render();
    }).catch(function () {});
  }

  function pill(value) { return el('span', { class: 'pill ' + value, text: value }); }
  function table(headers, rows) {
    if (!rows.length) return el('p', { class: 'hint', text: 'Nada todavía.' });
    return el('table', null, [
      el('thead', null, [el('tr', null, headers.map(function (h) { return el('th', { text: h }); }))]),
      el('tbody', null, rows.map(function (cells) {
        return el('tr', null, cells.map(function (cell) { return el('td', null, [typeof cell === 'string' ? document.createTextNode(cell) : cell]); }));
      })),
    ]);
  }
  function refreshLedger() {
    if (!state.phone) return;
    api('/ledger?phone=' + encodeURIComponent(state.phone)).then(function (data) {
      $('userInfo').textContent = data.user
        ? (data.user.businessName || 'sin negocio') + ' · titular: ' + (data.user.holderName || '—') + ' · alta: ' + data.user.onboardingStatus
        : 'Este número todavía no existe en la base.';
      $('inboundTable').replaceChildren(table(['hora', 'tipo', 'estado', 'int.'], data.messages.map(function (m) {
        return [time(m.receivedAt), m.type, el('span', null, [pill(m.status), document.createTextNode(m.errorCode ? ' ' + m.errorCode : '')]), String(m.attempts)];
      })));
      $('entriesTable').replaceChildren(table(['día', 'monto', 'medio', 'tipo', 'etiqueta', 'estado'], data.entries.map(function (e) {
        return [e.businessDay.slice(5), el('span', { class: 'amount' + (e.direction === 'out' ? ' out' : ''), text: (e.direction === 'out' ? '−' : '+') + e.amount }),
          e.paymentMethod, e.category + (e.counterparty ? ' · ' + e.counterparty : ''), e.label, pill(e.status)];
      })));
      $('doubtsTable').replaceChildren(table(['día', 'tipo', 'prioridad', 'estado'], data.clarifications.map(function (d) {
        return [d.businessDay.slice(5), d.type, String(d.priority), pill(d.status)];
      })));
    }).catch(function () {});
  }

  function showReplying() {
    var bar = $('replying');
    if (state.replyTo) { bar.style.display = 'flex'; $('replyingText').textContent = 'Respondiendo a: ' + summary(state.replyTo); }
    else bar.style.display = 'none';
  }
  function send(body) {
    if (!state.phone) { setStatus('Primero elige un número.'); return Promise.resolve(); }
    body.phone = state.phone;
    if (state.replyTo && !body.replyTo) body.replyTo = state.replyTo.waMessageId;
    state.replyTo = null; showReplying();
    setStatus('Enviando…'); state.justSent = true;
    return post('/send', body).then(function (r) { setStatus('Webhook respondió ' + r.webhookStatus); loadUsers(state.phone); })
      .catch(function (err) { setStatus('Error: ' + err.message); })
      .then(function () { refresh(); setTimeout(refreshLedger, 400); });
  }
  function sendButton(button, replyTo) { send({ kind: 'button', buttonId: button.id, buttonTitle: button.title, replyTo: replyTo }); }
  function sendText() {
    var input = $('textInput'), text = input.value.trim();
    if (!text) return;
    input.value = '';
    send({ kind: 'text', text: text });
  }
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result).split(',')[1] || ''); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  function sendFile(input, kind) {
    var file = input.files && input.files[0];
    if (!file) return;
    readFile(file).then(function (b64) { input.value = ''; return send({ kind: kind, fileBase64: b64, mimeType: file.type || (kind === 'audio' ? 'audio/ogg' : 'image/jpeg') }); });
  }

  function loadDatasets() {
    api('/datasets').then(function (data) {
      var select = $('datasetSelect');
      select.innerHTML = '';
      var groups = [['Capturas', data.images], ['Audios', data.audios]];
      groups.forEach(function (g) {
        var group = el('optgroup', { label: g[0] });
        g[1].forEach(function (path) { group.appendChild(el('option', { value: path, text: path })); });
        select.appendChild(group);
      });
      previewDataset();
    });
  }
  function previewDataset() {
    var path = $('datasetSelect').value, img = $('datasetPreview');
    if (path && !/\.(ogg|opus|mp3|m4a)$/i.test(path)) { img.src = API + '/dataset-file?path=' + encodeURIComponent(path); img.hidden = false; }
    else img.hidden = true;
  }

  $('phoneSelect').addEventListener('change', function (e) { choosePhone(e.target.value || null); });
  $('usePhone').addEventListener('click', function () { var p = $('phoneInput').value.trim(); if (p) choosePhone(p); });
  $('newPhone').addEventListener('click', function () {
    // A random 9xx xxx xxx number that is not in the list: the webhook creates her as «new».
    var taken = {};
    Array.prototype.forEach.call($('phoneSelect').options, function (o) { taken[o.value] = true; });
    var phone;
    do { phone = '+519' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0'); } while (taken[phone]);
    $('phoneInput').value = phone;
    choosePhone(phone);
    $('textInput').value = 'Hola ALZA';
    $('textInput').focus();
    setStatus('Número nuevo: ' + phone + '. Envía «Hola ALZA» para empezar.');
  });
  $('createUser').addEventListener('click', function () {
    var phone = normalizePhone($('phoneInput').value.trim() || state.phone || '');
    if (!phone) { setStatus('Escribe un número primero.'); return; }
    post('/users', { phone: phone, businessName: $('bizName').value, holderName: $('holderName').value })
      .then(function (u) { setStatus('Usuaria lista: ' + u.phone); return loadUsers(u.phone).then(function () { choosePhone(u.phone); }); })
      .catch(function (err) { setStatus('Error: ' + err.message); });
  });
  $('sendText').addEventListener('click', sendText);
  $('textInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendText(); });
  $('datasetSelect').addEventListener('change', previewDataset);
  $('sendDataset').addEventListener('click', function () {
    var path = $('datasetSelect').value;
    if (!path) return;
    send({ kind: /\.(ogg|opus|mp3|m4a)$/i.test(path) ? 'audio' : 'image', datasetPath: path });
  });
  $('imageFile').addEventListener('change', function (e) { sendFile(e.target, 'image'); });
  $('audioFile').addEventListener('change', function (e) { sendFile(e.target, 'audio'); });
  $('attachImage').addEventListener('click', function () { $('imageFile').click(); });
  $('cancelReply').addEventListener('click', function () { state.replyTo = null; showReplying(); });
  $('resetChat').addEventListener('click', function () { if (state.phone) post('/reset', { phone: state.phone }).then(function () { state.lastJson = ''; refresh(); }); });

  loadUsers(); loadDatasets();
  setInterval(refresh, 1000);
  setInterval(refreshLedger, 2500);
})();
</script>
</body>
</html>`;
