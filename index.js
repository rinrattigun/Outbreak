// OUTBREAK — расширение для SillyTavern. Интерфейс и связка с ST.
import { DIFF, DIFF_TEXT, STAGE_RU, INF_RU, PART_RU, QUICK_ITEMS, DEFAULT_TIME_RE, DEFAULT_DAY_RE,
  newStore, replay, buildInject, parseTime, survival, flagsRu, infStage, canAmputate, ampChance, fmtTime, countCat } from './engine.js';

const MOD = 'outbreak';
const DEFAULTS = { theme: 'phosphor', enabled: true, suggest: true, panelOpen: false, depth: 1, timeRe: '', dayRe: '', swipeReroll: false, bigJumpH: 12, pos: null };
const RULES_LIMIT = 1200; // символов (~300 токенов)
const ctx = () => SillyTavern.getContext();
const $ = (s, r = document) => r.querySelector(s);
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let S = null;            // текущее вычисленное состояние
let timer = null;
const ui = { sel: null, modal: null };

// ───────── настройки и хранилище ─────────
function G() {
  const c = ctx();
  c.extensionSettings[MOD] = Object.assign({}, DEFAULTS, c.extensionSettings[MOD] || {});
  return c.extensionSettings[MOD];
}
const saveG = () => ctx().saveSettingsDebounced();
const store = () => { const md = ctx().chatMetadata; return md && md[MOD] ? md[MOD] : null; };
const saveStore = () => { try { return ctx().saveMetadata(); } catch (e) { console.warn('[Outbreak] save', e); } };
const opts = () => { const g = G(); return { suggest: g.suggest, timeRe: g.timeRe, dayRe: g.dayRe, swipeReroll: g.swipeReroll, bigJumpH: g.bigJumpH }; };
const toast = (m, t = 'info') => { try { window.toastr?.[t]?.(m, 'Outbreak'); } catch { /* */ } };

function currentParty() {
  const c = ctx();
  const names = [];
  try {
    if (c.groupId) {
      const g = c.groups.find((x) => String(x.id) === String(c.groupId));
      for (const av of g?.members || []) { const ch = c.characters.find((x) => x.avatar === av); if (ch) names.push(ch.name); }
    }
  } catch { /* */ }
  if (!names.length && c.name2) names.push(c.name2);
  const party = names.map((name) => ({ name }));
  // персона игрока тоже считается: HP, инвентарь, ранения
  if (c.name1 && !names.includes(c.name1)) party.push({ name: c.name1, isUser: true });
  return party;
}
// Чаты, запущенные до этой версии: добавить игрока один раз.
function ensureUser(st) {
  const c = ctx();
  if (st.userSynced) return;
  st.userSynced = true;
  if (c.name1 && !st.party.some((p) => p.name === c.name1) && !st.ops.some((o) => o.t === 'addChar' && o.isUser)) {
    st.ops.unshift({ t: 'addChar', name: c.name1, isUser: true, at: 0 });
  }
  saveStore();
}
function startStore(full) {
  const c = ctx();
  const party = currentParty();
  if (!party.length) { toast('Сначала откройте чат с персонажем.', 'warning'); return; }
  c.chatMetadata[MOD] = newStore(party, full ? 0 : c.chat.length, 'middle');
  c.chatMetadata[MOD].userSynced = true;
  saveStore(); refresh();
}
function addOp(op) {
  const st = store(); if (!st) return;
  st.ops.push({ ...op, at: ctx().chat.length });
  saveStore(); refresh();
}
function decide(id, v) {
  const st = store(); if (!st) return;
  st.decisions[id] = v;
  saveStore(); refresh();
}

// ───────── обновление ─────────
const schedule = () => { clearTimeout(timer); timer = setTimeout(() => refresh(), 120); };
function clearInject() { try { ctx().setExtensionPrompt(MOD, '', 1, G().depth, false, 0); } catch { /* */ } }
function refresh(upto) {
  const g = G();
  syncControls(); applyTheme(); applyLayout();
  if (!g.enabled) { clearInject(); S = null; showPanel(false); renderToasts(); return; }
  showPanel(g.panelOpen);
  const st = store();
  if (!st) { S = null; clearInject(); render(); renderToasts(); return; }
  try {
    ensureUser(st);
    S = replay(ctx().chat, st, { ...opts(), upto });
    if (!S.party.find((c) => c.id === ui.sel)) ui.sel = (S.party.find((c) => !c.dead) || S.party[0] || {}).id;
    ctx().setExtensionPrompt(MOD, buildInject(S, st), 1, g.depth, false, 0);
  } catch (e) { console.error('[Outbreak]', e); toast('Ошибка расчёта: ' + e.message, 'error'); }
  render(); renderToasts();
}
function setEnabled(v) {
  const g = G(); g.enabled = !!v; saveG();
  if (!v) { ui.modal = null; toast('Outbreak выключен: не считает и ничего не добавляет в промпт.'); }
  else toast('Outbreak включён.');
  refresh();
}

// ───────── панель ─────────
const THEMES = { phosphor: 'Фосфор (зелёный)', amber: 'Янтарь', slate: 'Сталь (серо-синий)' };
function applyTheme() { const t = G().theme in THEMES ? G().theme : 'phosphor'; for (const id of ['ob-panel', 'ob-toasts']) { const e = $('#' + id); if (e) e.dataset.theme = t; } }
// телефон/планшет: узкий экран или сенсорный ввод без мыши
const isMobile = () => { try { return matchMedia('(max-width: 820px)').matches || (matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches); } catch { return window.innerWidth <= 820; } };
function applyLayout() {
  const m = isMobile(), p = $('#ob-panel'), t = $('#ob-toasts');
  if (p) { p.classList.toggle('ob-mobile', m); if (m) for (const k of ['left', 'top', 'right', 'bottom', 'width', 'height']) p.style[k] = ''; else { const g = G(); if (g.pos) { p.style.left = g.pos.x + 'px'; p.style.top = g.pos.y + 'px'; p.style.right = 'auto'; p.style.bottom = 'auto'; } } }
  if (t) t.classList.toggle('ob-mobile', m);
}
function showPanel(on) { const p = $('#ob-panel'); if (p) p.classList.toggle('ob-open', !!on); }
function togglePanel(force) {
  const g = G();
  if (!g.enabled) { toast('Outbreak выключен. Включите его в волшебной палочке.', 'warning'); return; }
  g.panelOpen = force ?? !g.panelOpen; saveG(); refresh();
}
const hpClass = (v) => (v >= 60 ? '' : v >= 30 ? 'm' : v >= 15 ? 'l' : 'c');
const sel = () => S && S.party.find((c) => c.id === ui.sel);

function render() {
  const body = $('#ob-body'); if (!body) return;
  const t = $('#ob-time'); if (t) t.textContent = S ? fmtTime(S) : '';
  if (!S) {
    const hasChat = !!ctx().chatMetadata && (ctx().characterId !== undefined || ctx().groupId);
    body.innerHTML = hasChat
      ? `<div class="ob-empty"><p>В этом чате Outbreak ещё не запущен — он ничего не считает и не добавляет в промпт.</p>
         <button class="ob-btn ob-primary" data-act="start">Начать с этого места</button>
         <button class="ob-btn" data-act="startfull">Учесть всю историю чата</button></div>`
      : `<div class="ob-empty"><p>Откройте чат, чтобы начать.</p></div>`;
    renderModal(); return;
  }
  const c = sel();
  const n = Math.round(S.noise);
  const cls = n >= 5 ? 'x' : n >= 4 ? 'h' : n >= 3 ? 'm' : '';
  const seg = [1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on ' + cls : ''}"></i>`).join('');
  const surv = survival(S);
  const inf = c ? Math.round(c.inf) : 0;
  const infSeg = Array.from({ length: 10 }, (_, i) => `<i class="${i < Math.ceil(inf / 10) ? 'on' : ''}"></i>`).join('');
  const tags = c ? flagsRu(S, c) : [];
  const chars = S.party.map((p) => {
    const hp = Math.round(p.hp);
    return `<button class="ob-char ${p.id === ui.sel ? 'sel' : ''} ${p.dead ? 'dead' : ''}" data-act="sel" data-id="${h(p.id)}" title="Выбрать">
      <span class="n">${h(p.name)}</span>
      <div class="ob-hp"><i class="${hpClass(hp)}" style="width:${hp}%"></i>${p.inf > 0 && !p.infStopped ? `<u style="width:${Math.round(p.inf)}%"></u>` : ''}</div><small>${hp}</small></button>`;
  }).join('');
  body.innerHTML = `
  <div class="ob-grid">
    <div class="ob-col">
      <div class="ob-frame"><div class="ob-in">
        <h4 class="ob-h">Инвентарь</h4>
        <button class="ob-cat" data-act="inv" data-cat="food">Еда / вода <b>${countCat(c, ['food', 'water'])}</b></button>
        <button class="ob-cat" data-act="inv" data-cat="med">Медикаменты <b>${countCat(c, ['med'])}</b></button>
        <button class="ob-cat" data-act="inv" data-cat="weapon">Оружие <b>${countCat(c, ['weapon'])}</b></button>
        <div class="ob-owner">${c ? 'у: ' + h(c.name) : ''}</div>
      </div></div>
      <div class="ob-frame"><div class="ob-in">
        <div class="ob-row"><span>Шум</span><div class="ob-seg">${seg}</div><em>${n}/5</em></div>
        <div class="ob-row"><span>Активность</span><div class="ob-bar"><i style="width:${S.activity * 10}%"></i></div><em>${Math.round(S.activity)}/10 · ${STAGE_RU[S.stage]}</em></div>
        <div class="ob-row"><span>Шанс выжить</span><div class="ob-bar surv"><i style="width:${surv}%"></i></div><em>${surv}%</em></div>
      </div></div>
    </div>
    <div class="ob-col">
      <div class="ob-frame"><div class="ob-in"><h4 class="ob-h">Персонажи</h4><div class="ob-chars">${chars}</div></div></div>
      <div class="ob-frame ob-detail" data-act="char" title="Подробности"><div class="ob-in">
        ${c ? `<b>${h(c.name)}</b> · HP ${Math.round(c.hp)}${c.inf > 0 && !c.infStopped ? ` · заражение ${inf}% (${INF_RU[infStage(c.inf)]})` : ''}
        <div class="ob-tags">${tags.length ? h(tags.join(' · ')) : 'без отклонений'}</div>
        <div class="ob-infbar" title="Уровень заражения">${infSeg}</div>` : ''}
      </div></div>
      <div class="ob-btns"><button class="ob-btn" data-act="rules">Правила</button><button class="ob-btn" data-act="settings">Настройки</button></div>
    </div>
  </div>
  <div class="ob-foot">${h([...(S.events || []).slice(-4), S.timeNote ? '⏱ ' + S.timeNote : ''].filter(Boolean).join(' · '))}</div>`;
  renderModal();
}

// ───────── окна ─────────
const catsOf = (k) => (k === 'food' ? ['food', 'water'] : k === 'all' ? ['food', 'water', 'med', 'weapon'] : [k]);
function renderModal() {
  const m = $('#ob-modal'); if (!m) return;
  const M = ui.modal;
  if (!M || !S) { m.hidden = true; m.innerHTML = ''; return; }
  m.hidden = false;
  const close = `<button class="ob-ibtn" data-act="mclose" title="Закрыть">✕</button>`;
  if (M.type === 'inv') m.innerHTML = invHtml(M, close);
  else if (M.type === 'char') m.innerHTML = charHtml(M, close);
  else if (M.type === 'rules') m.innerHTML = rulesHtml(close);
  else if (M.type === 'settings') m.innerHTML = settingsHtml(close);
}
function invHtml(M, close) {
  const owners = [...S.party.map((c) => ({ id: c.id, name: c.name })), { id: 'loc', name: '📍 Локация' }];
  if (!owners.find((o) => o.id === M.owner)) M.owner = ui.sel;
  const o = M.owner === 'loc' ? (S.locs[S.loc.name || '—'] || { inv: [] }) : S.party.find((c) => c.id === M.owner);
  const cats = catsOf(M.cat);
  const items = (o ? o.inv : []).filter((i) => cats.includes(i.cat));
  const tabs = owners.map((x) => `<button class="ob-tab ${x.id === M.owner ? 'on' : ''}" data-act="iowner" data-id="${h(x.id)}">${h(x.name)}</button>`).join('');
  const ctabs = [['all', 'Все'], ['food', 'Еда/вода'], ['med', 'Медикаменты'], ['weapon', 'Оружие']].map(([k, n]) => `<button class="ob-tab ${M.cat === k ? 'on' : ''}" data-act="icat" data-cat="${k}">${n}</button>`).join('');
  const targets = S.party.filter((c) => !c.dead && c.id !== M.owner);
  const rows = items.map((i) => {
    const k = (i.en || i.name).toLowerCase();
    const acts = [];
    if (M.owner === 'loc') acts.push(`<button class="ob-sm" data-act="take" data-key="${h(k)}">Взять</button>`);
    else {
      if (i.cat !== 'weapon') acts.push(`<button class="ob-sm" data-act="use" data-key="${h(k)}">${i.cat === 'med' ? 'Применить' : i.cat === 'water' ? 'Выпить' : 'Съесть'}</button>`);
      if (targets.length) acts.push(`<select data-act="xfer" data-key="${h(k)}"><option value="">Передать…</option>${targets.map((t) => `<option value="${h(t.id)}">→ ${h(t.name)}</option>`).join('')}<option value="loc">→ бросить</option></select>`);
    }
    acts.push(`<button class="ob-sm" data-act="dec" data-key="${h(k)}">−</button><button class="ob-sm" data-act="inc" data-key="${h(k)}">+</button>`);
    return `<div class="ob-item"><div>${h(i.name)} <b>×${i.qty}</b></div><div class="ob-acts">${acts.join('')}</div></div>`;
  }).join('') || `<p class="ob-muted">Пусто.</p>`;
  return `<div class="ob-mh"><h3>Инвентарь</h3>${close}</div><div class="ob-tabs">${tabs}</div><div class="ob-tabs">${ctabs}</div>${rows}
  <div class="ob-sec">Добавить предмет</div>
  <div class="ob-tabs">${QUICK_ITEMS.map((q) => `<button class="ob-tab" data-act="quick" data-en="${h(q.en)}">${h(q.name)}</button>`).join('')}</div>
  <div class="ob-form"><input id="ob-add-name" placeholder="Название" list="ob-lex"><input id="ob-add-qty" type="number" min="1" value="1">
  <select id="ob-add-cat"><option value="food">Еда</option><option value="water">Вода</option><option value="med">Медикамент</option><option value="weapon">Оружие</option></select>
  <button class="ob-sm" data-act="addcustom">Добавить</button></div>
  <p class="ob-muted">Предметы из чата сначала попадают в «Локацию» и переходят в инвентарь кнопкой «Взять».</p>`;
}
function charHtml(M, close) {
  const c = S.party.find((x) => x.id === (M.id || ui.sel)); if (!c) return `<div class="ob-mh"><h3>Персонаж</h3>${close}</div>`;
  const wounds = c.wounds.map((w) => `<div class="ob-item"><div>${h(({ bite: 'Укус', scratch: 'Царапина', cut: 'Порез', gunshot: 'Огнестрел', fracture: 'Перелом', amputation: 'Ампутация' })[w.type] || w.type)}${w.part ? ' · ' + h(PART_RU[w.part] || w.part) : ''}</div><div class="ob-muted">${w.bleeding ? 'кровоточит' : w.treated ? 'обработана' : ''}</div></div>`).join('') || '<p class="ob-muted">Ран нет.</p>';
  const amp = canAmputate(c);
  return `<div class="ob-mh"><h3>${h(c.name)}</h3>${close}</div>
  <div class="ob-form"><label>HP <input id="ob-hp" type="number" min="0" max="100" value="${Math.round(c.hp)}"></label>
  <label>Заражение % <input id="ob-inf" type="number" min="0" max="100" value="${Math.round(c.inf)}"></label>
  <button class="ob-sm" data-act="applyvals" data-id="${h(c.id)}">Задать</button></div>
  <p class="ob-muted">${h(flagsRu(S, c).join(' · ') || 'без отклонений')}${c.infStopped ? ' · инфекция остановлена' : ''}</p>
  <div class="ob-sec">Раны</div>${wounds}
  <div class="ob-sec">Действия</div>
  <div class="ob-form">
    ${amp ? `<button class="ob-sm ob-danger" data-act="amp" data-id="${h(c.id)}">Ампутация (${PART_RU[c.infLimb]}) — шанс ${Math.round(ampChance(c.inf) * 100)}%</button>` : `<span class="ob-muted">Ампутация доступна, если заражение идёт от укуса руки/ноги.</span>`}
    <button class="ob-sm" data-act="cond" data-id="${h(c.id)}" data-k="faint" data-on="${c.faint ? 0 : 1}">${c.faint ? 'Очнулся' : 'Обморок'}</button>
    <button class="ob-sm" data-act="cond" data-id="${h(c.id)}" data-k="weak" data-on="${c.weak ? 0 : 1}">${c.weak ? 'Слабость прошла' : 'Ослаблен'}</button>
    ${c.dead ? `<button class="ob-sm" data-act="revive" data-id="${h(c.id)}">Воскресить</button>` : ''}
    <button class="ob-sm ob-danger" data-act="delchar" data-id="${h(c.id)}">Убрать из отряда</button>
  </div>`;
}
function rulesHtml(close) {
  const st = store(); const rules = st.rules || [];
  const used = rules.filter((r) => r.on).reduce((a, r) => a + r.text.length, 0);
  return `<div class="ob-mh"><h3>Правила</h3>${close}</div>
  <div class="ob-sec">Системные (всегда включены)</div>
  <p class="ob-muted">ИИ не отменяет травмы и не создаёт предметы · предметы из чата сначала лежат в локации · укусы, находки и передачи — только с вашего подтверждения · смерть — от события, не от низкого шанса · в погоне прятаться нельзя, только бежать.</p>
  <div class="ob-sec">Ваши правила · ${used}/${RULES_LIMIT} знаков (идут в промпт)</div>
  ${rules.map((r) => `<div class="ob-rule"><input type="checkbox" data-act="rtoggle" data-id="${h(r.id)}" ${r.on ? 'checked' : ''} title="Включено"><textarea data-act="redit" data-id="${h(r.id)}">${h(r.text)}</textarea><button class="ob-sm ob-danger" data-act="rdel" data-id="${h(r.id)}">✕</button></div>`).join('') || '<p class="ob-muted">Пока нет. Пример: «Зомби боятся огня».</p>'}
  <div class="ob-form"><textarea id="ob-rnew" placeholder="Новое правило мира"></textarea><button class="ob-sm" data-act="radd">Добавить</button></div>`;
}
function settingsHtml(close) {
  const st = store();
  const dd = Object.values(DIFF).map((d) => `<button class="ob-diff ${S.diff === d.id ? 'on' : ''}" data-act="diff" data-v="${d.id}"><b>${d.label}</b><small>${h(DIFF_TEXT[d.id])}</small></button>`).join('');
  return `<div class="ob-mh"><h3>Настройки</h3>${close}</div>
  <div class="ob-sec">Сложность</div>${dd}
  <div class="ob-sec">Оформление</div>
  <div class="ob-tabs">${Object.entries(THEMES).map(([k, n]) => `<button class="ob-tab ${G().theme === k ? 'on' : ''}" data-act="theme" data-v="${k}">${n}</button>`).join('')}</div>
  <div class="ob-sec">Время</div>
  <div class="ob-form"><span class="ob-muted">${S.time.abs == null ? 'Время ещё не найдено в чате.' : 'Сейчас: ' + h(fmtTime(S))}</span>
  <button class="ob-sm" data-act="adv" data-min="60">+1 ч</button><button class="ob-sm" data-act="adv" data-min="360">+6 ч</button><button class="ob-sm" data-act="adv" data-min="720">+12 ч</button></div>
  <p class="ob-muted">Обычно время берётся из инфоблока в ответе бота. Формат настраивается в панели расширений → Outbreak.</p>
  <div class="ob-sec">Локация и отряд</div>
  <div class="ob-form"><input id="ob-loc" placeholder="Название локации" value="${h(S.loc.name)}"><button class="ob-sm" data-act="setloc">Сменить</button></div>
  <div class="ob-form"><input id="ob-newchar" placeholder="Имя нового персонажа"><button class="ob-sm" data-act="addchar">Добавить в отряд</button></div>
  <div class="ob-sec">Ручная коррекция</div>
  <div class="ob-form"><label>Шум <input id="ob-noise" type="number" min="0" max="5" step="0.5" value="${S.noise}"></label>
  <label>Активность <input id="ob-act" type="number" min="0" max="10" value="${Math.round(S.activity)}"></label>
  <label>Стадия <select id="ob-stage">${STAGE_RU.map((n, i) => `<option value="${i}" ${S.stage === i ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
  <button class="ob-sm" data-act="applyscene">Задать</button><button class="ob-sm" data-act="escape">Оторвались</button></div>
  <div class="ob-sec">Служебное</div>
  <div class="ob-form"><button class="ob-sm" data-act="undo" ${st.ops.length ? '' : 'disabled'}>↶ Отменить последнее ручное действие</button>
  <button class="ob-sm ob-danger" data-act="reset">Сбросить Outbreak в этом чате</button></div>`;
}

// ───────── уведомления с подтверждением ─────────
function renderToasts() {
  const box = $('#ob-toasts'); if (!box) return;
  const list = G().enabled && S ? S.pending : [];
  box.innerHTML = list.map((p) => {
    const btns = p.cands.length > 1
      ? p.cands.map((c) => `<button data-act="dec-yes" data-id="${h(p.id)}" data-who="${h(c.id)}">${h(c.name)}</button>`).join('') + `<button data-act="dec-no" data-id="${h(p.id)}">✗</button>`
      : `<button data-act="dec-yes" data-id="${h(p.id)}" data-who="true">✓</button><button data-act="dec-no" data-id="${h(p.id)}">✗</button>`;
    return `<div class="ob-toast"><span>${h(p.text)}</span>${btns}</div>`;
  }).join('');
}

// ───────── обработка кликов ─────────
function onClick(e) {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act, st = store();
  if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.type === 'checkbox') return;
  const val = (id) => $('#' + id)?.value;
  switch (a) {
    case 'start': startStore(false); break;
    case 'startfull': startStore(true); break;
    case 'sel': ui.sel = el.dataset.id; render(); break;
    case 'inv': ui.modal = { type: 'inv', cat: el.dataset.cat === 'food' || el.dataset.cat === 'med' || el.dataset.cat === 'weapon' ? el.dataset.cat : 'all', owner: ui.sel }; renderModal(); break;
    case 'char': ui.modal = { type: 'char', id: ui.sel }; renderModal(); break;
    case 'rules': ui.modal = { type: 'rules' }; renderModal(); break;
    case 'settings': ui.modal = { type: 'settings' }; renderModal(); break;
    case 'mclose': ui.modal = null; renderModal(); break;
    case 'iowner': ui.modal.owner = el.dataset.id; renderModal(); break;
    case 'icat': ui.modal.cat = el.dataset.cat; renderModal(); break;
    case 'use': addOp({ t: 'use', who: ui.modal.owner, key: el.dataset.key }); break;
    case 'inc': addOp({ t: 'add', who: ui.modal.owner, ...itemDef(ui.modal.owner, el.dataset.key), qty: 1 }); break;
    case 'dec': addOp({ t: 'dec', who: ui.modal.owner, key: el.dataset.key, qty: 1 }); break;
    case 'take': { const to = ui.sel; addOp({ t: 'transfer', from: 'loc', to, key: el.dataset.key, qty: 1 }); break; }
    case 'quick': { const q = QUICK_ITEMS.find((x) => x.en === el.dataset.en); addOp({ t: 'add', who: ui.modal.owner, name: q.name, en: q.en, cat: q.cat, qty: q.en === 'ammo' ? 5 : 1 }); break; }
    case 'addcustom': { const name = (val('ob-add-name') || '').trim(); if (!name) break; const q = QUICK_ITEMS.find((x) => x.name.toLowerCase() === name.toLowerCase()); addOp({ t: 'add', who: ui.modal.owner, name: q ? q.name : name, en: q ? q.en : null, cat: q ? q.cat : val('ob-add-cat'), qty: +val('ob-add-qty') || 1 }); break; }
    case 'applyvals': addOp({ t: 'hp', who: el.dataset.id, v: +val('ob-hp') }); addOp({ t: 'inf', who: el.dataset.id, v: +val('ob-inf') }); break;
    case 'amp': addOp({ t: 'amputate', who: el.dataset.id, r: Math.random() }); break;
    case 'revive': addOp({ t: 'revive', who: el.dataset.id }); break;
    case 'delchar': if (confirm('Убрать персонажа из отряда?')) { addOp({ t: 'delChar', who: el.dataset.id }); ui.modal = null; } break;
    case 'diff': addOp({ t: 'diff', v: el.dataset.v }); break;
    case 'theme': G().theme = el.dataset.v; saveG(); applyTheme(); renderModal(); break;
    case 'adv': addOp({ t: 'adv', min: +el.dataset.min }); break;
    case 'setloc': addOp({ t: 'loc', name: (val('ob-loc') || '').trim() }); break;
    case 'addchar': { const n = (val('ob-newchar') || '').trim(); if (n) addOp({ t: 'addChar', name: n }); break; }
    case 'cond': addOp({ t: 'cond', who: el.dataset.id, k: el.dataset.k, on: el.dataset.on === '1' }); break;
    case 'applyscene': addOp({ t: 'noise', v: +val('ob-noise') }); addOp({ t: 'activity', v: +val('ob-act') }); addOp({ t: 'stage', v: +val('ob-stage') }); break;
    case 'escape': addOp({ t: 'escape' }); break;
    case 'undo': st.ops.pop(); saveStore(); refresh(); break;
    case 'reset': if (confirm('Удалить все данные Outbreak в этом чате?')) { delete ctx().chatMetadata[MOD]; saveStore(); ui.modal = null; refresh(); } break;
    case 'radd': { const t = (val('ob-rnew') || '').trim(); if (t) { st.rules.push({ id: 'r' + Date.now().toString(36), text: t, on: true }); saveStore(); render(); } break; }
    case 'rdel': st.rules = st.rules.filter((r) => r.id !== el.dataset.id); saveStore(); render(); refresh(); break;
    case 'dec-yes': decide(el.dataset.id, el.dataset.who === 'true' ? true : el.dataset.who); break;
    case 'dec-no': decide(el.dataset.id, false); break;
    default: break;
  }
}
function itemDef(owner, key) {
  const o = owner === 'loc' ? S.locs[S.loc.name || '—'] : S.party.find((c) => c.id === owner);
  const it = o && o.inv.find((i) => (i.en || i.name).toLowerCase() === key);
  return it ? { name: it.name, en: it.en, cat: it.cat } : { name: key, en: null, cat: 'food' };
}
function onChange(e) {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const st = store();
  if (el.dataset.act === 'xfer' && el.value) {
    addOp({ t: 'transfer', from: ui.modal.owner, to: el.value, key: el.dataset.key, qty: 1 });
  } else if (el.dataset.act === 'rtoggle') {
    const r = st.rules.find((x) => x.id === el.dataset.id); if (r) { r.on = el.checked; saveStore(); refresh(); }
  } else if (el.dataset.act === 'redit') {
    const r = st.rules.find((x) => x.id === el.dataset.id); if (r) { r.text = el.value.slice(0, 400); saveStore(); refresh(); }
  }
}

// ───────── сборка интерфейса ─────────
function buildPanel() {
  if ($('#ob-panel')) return;
  if (!$('#ob-font')) { const l = document.createElement('link'); l.id = 'ob-font'; l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap'; document.head.appendChild(l); }
  const p = document.createElement('div');
  p.id = 'ob-panel';
  p.innerHTML = `<div class="ob-head" id="ob-drag"><span class="ob-title">OUTBREAK</span><span class="ob-time" id="ob-time"></span>
    <button class="ob-ibtn ob-off" id="ob-power" title="Выключить Outbreak (не считать и не добавлять в промпт)">⏻</button>
    <button class="ob-ibtn" id="ob-close" title="Скрыть панель">✕</button></div>
    <div class="ob-body" id="ob-body"></div><div class="ob-modal" id="ob-modal" hidden></div>
    <datalist id="ob-lex">${QUICK_ITEMS.map((q) => `<option value="${h(q.name)}">`).join('')}</datalist>`;
  document.body.appendChild(p);
  const t = document.createElement('div'); t.id = 'ob-toasts'; document.body.appendChild(t); applyLayout();
  p.addEventListener('click', onClick); t.addEventListener('click', onClick);
  p.addEventListener('change', onChange);
  $('#ob-power').addEventListener('click', () => setEnabled(false));
  $('#ob-close').addEventListener('click', () => togglePanel(false));
  // перетаскивание
  const g = G();
  if (g.pos) { p.style.left = g.pos.x + 'px'; p.style.top = g.pos.y + 'px'; p.style.right = 'auto'; p.style.bottom = 'auto'; }
  let drag = null;
  $('#ob-drag').addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || isMobile()) return;   // на телефоне панель закреплена
    const r = p.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  });
  $('#ob-drag').addEventListener('pointermove', (e) => {
    if (!drag) return;
    const x = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - drag.dx)), y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.dy));
    p.style.left = x + 'px'; p.style.top = y + 'px'; p.style.right = 'auto'; p.style.bottom = 'auto';
  });
  $('#ob-drag').addEventListener('pointerup', () => {
    if (!drag) return; drag = null;
    const r = p.getBoundingClientRect(); G().pos = { x: Math.round(r.left), y: Math.round(r.top) }; saveG();
  });
  window.addEventListener('resize', () => {
    const r = p.getBoundingClientRect(); applyLayout(); if (!G().pos || isMobile()) return;
    const x = Math.max(0, Math.min(window.innerWidth - r.width, r.left)), y = Math.max(0, Math.min(window.innerHeight - 60, r.top));
    p.style.left = x + 'px'; p.style.top = y + 'px';
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.modal) { ui.modal = null; renderModal(); } });
}

// пункты в «волшебной палочке» (меню расширений)
function buildWand() {
  const menu = $('#extensionsMenu');
  if (!menu || $('#ob_wand_open')) return !!menu;
  menu.insertAdjacentHTML('beforeend', `
    <div id="ob_wand_open" class="list-group-item flex-container flexGap5 interactable" tabindex="0" title="Показать / скрыть панель Outbreak">
      <div class="fa-solid fa-biohazard extensionsMenuExtensionButton"></div><span>Outbreak: панель</span></div>
    <div id="ob_wand_toggle" class="list-group-item flex-container flexGap5 interactable" tabindex="0" title="Включить / выключить расширение целиком">
      <div class="fa-solid fa-toggle-on extensionsMenuExtensionButton" id="ob_wand_toggle_icon"></div><span id="ob_wand_toggle_label">Outbreak: выключить</span></div>`);
  $('#ob_wand_open').addEventListener('click', () => togglePanel());
  $('#ob_wand_toggle').addEventListener('click', () => setEnabled(!G().enabled));
  return true;
}
function buildDrawer() {
  const host = $('#extensions_settings2') || $('#extensions_settings');
  if (!host || $('#ob_drawer')) return !!host;
  const g = G();
  host.insertAdjacentHTML('beforeend', `
  <div id="ob_drawer" class="inline-drawer ob-set">
    <div class="inline-drawer-toggle inline-drawer-header"><b>Outbreak (зомби-апокалипсис)</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
    <div class="inline-drawer-content">
      <label><input type="checkbox" id="ob_set_enabled" ${g.enabled ? 'checked' : ''}> Расширение включено</label>
      <label><input type="checkbox" id="ob_set_suggest" ${g.suggest ? 'checked' : ''}> Предлагать находки, ранения и состояния из текста чата (с подтверждением)</label>
      <label><input type="checkbox" id="ob_set_reroll" ${g.swipeReroll ? 'checked' : ''}> Свайп перебрасывает кубики (иначе результат фиксирован)</label>
      <label>Глубина вставки в чат <input type="number" id="ob_set_depth" min="0" max="20" value="${g.depth}" style="width:70px"></label>
      <label>Скачок времени, требующий подтверждения (часов) <input type="number" id="ob_set_jump" min="1" max="240" value="${g.bigJumpH}" style="width:70px"></label>
      <div class="ob-muted">Регулярка времени (группы: 1 — часы, 2 — минуты; 3 — AM/PM). Пусто = стандартная.</div>
      <input type="text" id="ob_set_time" class="text_pole" placeholder="${h(DEFAULT_TIME_RE)}" value="${h(g.timeRe)}">
      <div class="ob-muted">Регулярка дня (группа 1 — номер дня). Пусто = «День N / Day N».</div>
      <input type="text" id="ob_set_day" class="text_pole" placeholder="${h(DEFAULT_DAY_RE)}" value="${h(g.dayRe)}">
      <div class="menu_button" id="ob_set_test" style="margin-top:8px">Проверить на последнем ответе бота</div>
    </div></div>`);
  const bind = (id, fn) => $('#' + id).addEventListener('change', (e) => { fn(e.target); saveG(); refresh(); });
  bind('ob_set_enabled', (el) => { G().enabled = el.checked; });
  bind('ob_set_suggest', (el) => { G().suggest = el.checked; });
  bind('ob_set_reroll', (el) => { G().swipeReroll = el.checked; });
  bind('ob_set_depth', (el) => { G().depth = +el.value || 0; });
  bind('ob_set_jump', (el) => { G().bigJumpH = +el.value || 12; });
  bind('ob_set_time', (el) => { G().timeRe = el.value.trim(); });
  bind('ob_set_day', (el) => { G().dayRe = el.value.trim(); });
  $('#ob_set_test').addEventListener('click', () => {
    const chat = ctx().chat; const last = [...chat].reverse().find((m) => !m.is_user && !m.is_system);
    if (!last) return toast('Нет ответа бота.', 'warning');
    const t = parseTime(last.mes, opts());
    if (!t) toast('Время не найдено. Настройте регулярку.', 'warning');
    else toast(`Найдено: ${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}${t.day != null ? ', день ' + t.day : ', день не найден'}`, 'success');
  });
  return true;
}
function syncControls() {
  const on = G().enabled;
  const ic = $('#ob_wand_toggle_icon'), lb = $('#ob_wand_toggle_label');
  if (ic) ic.className = `fa-solid ${on ? 'fa-toggle-on' : 'fa-toggle-off'} extensionsMenuExtensionButton`;
  if (lb) lb.textContent = on ? 'Outbreak: выключить' : 'Outbreak: включить';
  const cb = $('#ob_set_enabled'); if (cb) cb.checked = on;
}

// ───────── запуск ─────────
function init() {
  const c = ctx(); const ET = c.eventTypes || c.event_types || {};
  buildPanel();
  let tries = 0;
  const wire = () => { const a = buildWand(), b = buildDrawer(); syncControls(); if ((!a || !b) && tries++ < 40) setTimeout(wire, 500); };
  wire();
  const on = (name, fn) => { if (ET[name]) c.eventSource.on(ET[name], fn); };
  on('CHAT_CHANGED', () => { ui.modal = null; refresh(); });
  for (const n of ['MESSAGE_SENT', 'MESSAGE_RECEIVED', 'MESSAGE_SWIPED', 'MESSAGE_DELETED', 'MESSAGE_EDITED', 'MESSAGE_UPDATED', 'CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'GROUP_UPDATED']) on(n, schedule);
  // Перед каждой генерацией — синхронно пересчитать и обновить инжект.
  // При свайпе/регенерации последний ответ бота будет заменён, поэтому в расчёт он не входит.
  on('GENERATION_STARTED', (type) => {
    if (!G().enabled || !store()) return;
    const chat = ctx().chat; let upto = chat.length;
    if ((type === 'regenerate' || type === 'swipe') && upto > 0 && !chat[upto - 1].is_user) upto--;
    refresh(upto);
  });
  refresh();
}
if (typeof jQuery === 'function') jQuery(() => { try { init(); } catch (e) { console.error('[Outbreak] init', e); } });
else document.addEventListener('DOMContentLoaded', () => init());
