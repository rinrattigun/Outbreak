// OUTBREAK — игровой движок (чистая логика, без DOM и без SillyTavern).
// Состояние НЕ хранится «как есть»: оно каждый раз пересчитывается из истории чата
// + ручных действий (store.ops) + решений игрока (store.decisions).
// Поэтому свайпы, правки, удаления сообщений и ветки не ломают учёт предметов.

// ───────────────────────── утилиты ─────────────────────────
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function hash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rnd(seed) {
  let t = (seed >>> 0) + 0x6D2B79F5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
// Без lookbehind (?<!…): он ломает разбор всего файла в iOS Safari < 16.4. Вместо него — «начало или не-буква».
const W = (s) => new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${s})(?![\\p{L}\\p{N}])`, 'iu');
const keyOf = (it) => String(it.en || it.name).toLowerCase();

// ───────────────────────── сложность ─────────────────────────
// ВСЕ числа — черновые, правятся здесь.
export const DIFF = {
  low: {
    id: 'low', label: 'Low', noiseMul: 0.5, decay: 1, infRate: 0.5,
    hungerH: 36, thirstH: 18, hungerDrain: 0.5, thirstDrain: 1, dmg: 0.7,
    biteInf: 0.6, scratchInf: 0.15, riskMul: 0.6,
    react: [0, 0, 0, 0, 0.05, 0.25], attack: 0.2, flee: 0.65, surv: 8,
    scarcity: 'supplies are fairly common',
  },
  middle: {
    id: 'middle', label: 'Middle', noiseMul: 1, decay: 1, infRate: 1.5,
    hungerH: 24, thirstH: 12, hungerDrain: 1, thirstDrain: 2, dmg: 1,
    biteInf: 0.9, scratchInf: 0.4, riskMul: 1,
    react: [0, 0, 0, 0.05, 0.2, 0.6], attack: 0.35, flee: 0.5, surv: 0,
    scarcity: 'supplies are moderate',
  },
  hard: {
    id: 'hard', label: 'Hard', noiseMul: 1, decay: 0.5, infRate: 3,
    hungerH: 16, thirstH: 8, hungerDrain: 2, thirstDrain: 3, dmg: 1.3,
    biteInf: 1, scratchInf: 0.6, riskMul: 1.4,
    react: [0, 0, 0.05, 0.3, 0.5, 0.8], attack: 0.5, flee: 0.35, surv: -8,
    scarcity: 'supplies are scarce; most searches turn up little',
  },
};
export const DIFF_TEXT = {
  low: 'Звуки слышны хуже, HP падает медленнее, заразиться и умереть сложнее. Нападение возможно при шуме 4–5.',
  middle: 'Громкие звуки хорошо слышны. Основная опасность — шум 5.',
  hard: 'Реакция зомби начинается уже при шуме 3, зомби активнее, ресурсов мало.',
};
export const STAGE_RU = ['Спокойно', 'Подозрение', 'Обнаружены', 'Погоня'];
export const STAGE_EN = ['calm', 'suspicious', 'detected', 'pursuit'];
const INF_STAGES = [0, 20, 40, 60, 80, 100];
export const infStage = (inf) => (inf <= 0 ? 0 : inf <= 20 ? 1 : inf <= 40 ? 2 : inf <= 60 ? 3 : inf <= 80 ? 4 : 5);
export const INF_RU = ['здоров', 'начальная', 'развитие', 'тяжёлая', 'критическая', 'терминальная'];
const INF_EN = ['', 'weakness, pain at the wound', 'fever, dizziness', 'high fever, shaking, confusion', 'delirium, disorientation, severe weakness', 'TERMINAL: fading consciousness, organ failure, will die and turn'];
export const ampChance = (inf) => (inf <= 20 ? 0.9 : inf <= 40 ? 0.65 : inf <= 60 ? 0.35 : inf <= 80 ? 0.1 : 0.01);

// ───────────────────────── время ─────────────────────────
export const DEFAULT_TIME_RE =
  '(?:время|time|clock|[\\u{1F550}-\\u{1F567}]|⏰|⌚)[^\\n]{0,30}?(\\d{1,2})[:：](\\d{2})\\s*([ap]\\.?m\\.?)?';
export const DEFAULT_DAY_RE = '(?:день|day)\\s*[#№:]?\\s*(\\d{1,3})';

export function parseTime(text, o = {}) {
  let re, dre;
  try { re = new RegExp(o.timeRe || DEFAULT_TIME_RE, 'giu'); } catch { re = new RegExp(DEFAULT_TIME_RE, 'giu'); }
  try { dre = new RegExp(o.dayRe || DEFAULT_DAY_RE, 'giu'); } catch { dre = new RegExp(DEFAULT_DAY_RE, 'giu'); }
  let last = null;
  for (const x of String(text).matchAll(re)) last = x;
  if (!last) return null;
  let h = +last[1], m = +last[2];
  const ap = String(last[3] || '').toLowerCase();
  if (ap.startsWith('p') && h < 12) h += 12;
  if (ap.startsWith('a') && h === 12) h = 0;
  if (!(h >= 0 && h <= 23 && m >= 0 && m <= 59)) return null;
  let day = null, dl = null;
  for (const x of String(text).matchAll(dre)) dl = x;
  if (dl) day = +dl[1];
  return { h, m, day };
}
export function fmtTime(S) {
  if (S.time.abs == null) return '';
  const a = S.time.abs, d = Math.floor(a / 1440) + (S.time.hasDay ? 0 : 1);
  const hh = String(Math.floor((a % 1440) / 60)).padStart(2, '0'), mm = String(a % 60).padStart(2, '0');
  return `Day ${d} ${hh}:${mm}`;
}
const fmtDur = (min) => (min >= 1440 ? `${(min / 1440).toFixed(1)} сут` : `${(min / 60).toFixed(1)} ч`);

// ───────────────────────── лексикон предметов ─────────────────────────
// [en, ru-название, категория, регулярка, кол-во по умолчанию]
const ITEM_DEFS = [
  ['canned food', 'Консервы', 'food', 'консерв\\p{L}*|тушён\\p{L}*|тушен\\p{L}*|canned (?:food|beans)|tinned food|cans? of (?:food|beans)', 1],
  ['snack bar', 'Батончик', 'food', 'батончик\\p{L}*|шоколад\\p{L}*|(?:protein|snack|energy|granola) bars?|chocolate', 1],
  ['crackers', 'Сухари', 'food', 'сухар\\p{L}*|крекер\\p{L}*|печень\\p{L}*|crackers?|biscuits?', 1],
  ['food', 'Еда', 'food', 'еду|еда|еды|провиант\\p{L}*|пайк\\p{L}*|food|rations?', 1],
  ['water', 'Вода', 'water', 'бутылк\\p{L}* (?:с )?вод\\p{L}*|вод(?:а|у|ы|е|ой)|water(?: bottles?)?', 1],
  ['juice', 'Сок', 'water', 'сок(?:а|у|ом)?|juice|cola|кол(?:а|у|ы)|soda|лимонад\\p{L}*', 1],
  ['bandage', 'Бинт', 'med', 'бинт\\p{L}*|bandages?|gauze|марл\\p{L}*', 1],
  ['antiseptic', 'Антисептик', 'med', 'антисептик\\p{L}*|перекис\\p{L}*|хлоргексидин\\p{L}*|йод(?:а|у|ом)?|antiseptic|disinfectant|peroxide|iodine', 1],
  ['painkillers', 'Обезболивающее', 'med', 'обезбол\\p{L}*|анальгин\\p{L}*|ибупрофен\\p{L}*|парацетамол\\p{L}*|painkillers?|ibuprofen|paracetamol|aspirin', 1],
  ['antibiotics', 'Антибиотики', 'med', 'антибиотик\\p{L}*|antibiotics?', 1],
  ['medkit', 'Аптечка', 'med', 'аптечк\\p{L}*|first[- ]aid(?: kit)?|med ?kit', 1],
  ['tourniquet', 'Жгут', 'med', 'жгут\\p{L}*|tourniquet', 1],
  ['pistol', 'Пистолет', 'weapon', 'пистолет\\p{L}*|револьвер\\p{L}*|pistol|handgun|revolver|glock', 1],
  ['shotgun', 'Дробовик', 'weapon', 'дробовик\\p{L}*|ружь\\p{L}*|ружьё|shotgun', 1],
  ['rifle', 'Винтовка', 'weapon', 'винтовк\\p{L}*|автомат(?:а|у|ом|ы)?|карабин\\p{L}*|rifle|carbine', 1],
  ['knife', 'Нож', 'weapon', 'нож(?:а|у|ом|и|ей|е)?|knife|knives|dagger|кинжал\\p{L}*', 1],
  ['bat', 'Бита', 'weapon', 'бит(?:а|у|ой|ы)|(?:baseball )?bats?|дубин\\p{L}*', 1],
  ['axe', 'Топор', 'weapon', 'топор\\p{L}*|axe|hatchet', 1],
  ['crowbar', 'Монтировка', 'weapon', 'монтировк\\p{L}*|лом(?:ик|а|ом)?|crowbar', 1],
  ['ammo', 'Патроны', 'weapon', 'патрон\\p{L}*|боеприпас\\p{L}*|обойм\\p{L}*|ammo|ammunition|bullets?|magazines?|clips?', 5],
];
export const LEX = ITEM_DEFS.map(([en, name, cat, p, q]) => ({ en, name, cat, q, re: new RegExp(`(?:^|[^\\p{L}\\p{N}])(${p})(?![\\p{L}\\p{N}])`, 'giu') }));
export const QUICK_ITEMS = ITEM_DEFS.map(([en, name, cat]) => ({ en, name, cat }));

const NUMW = { один: 1, одна: 1, одну: 1, одно: 1, пару: 2, пара: 2, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const QTY_RE = /(?:(\d+)|(один|одна|одну|одно|пару|пара|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|one|two|three|four|five|six|seven|eight|nine|ten))\s*(?:×|x|шт\.?)?\s*(?:[\p{L}]+\s+){0,1}$/iu;
function qtyBefore(s, pos, def) {
  const pre = s.slice(Math.max(0, pos - 20), pos);
  const m = pre.match(QTY_RE);
  if (!m) return def;
  const n = m[1] ? +m[1] : NUMW[m[2].toLowerCase()];
  return n > 0 && n < 1000 ? n : def;
}
export function detectItems(s) {
  const hits = [];
  for (const d of LEX) {
    d.re.lastIndex = 0;
    for (const m of s.matchAll(d.re)) {
      let def = d.q;
      const at = m.index + m[0].length - m[1].length;   // m[1] — само слово, без символа перед ним
      if (d.en === 'ammo' && /обойм|magazine|clip/i.test(m[1])) def = 10;
      hits.push({ en: d.en, name: d.name, cat: d.cat, qty: qtyBefore(s, at, def), at, end: at + m[1].length });
    }
  }
  hits.sort((a, b) => a.at - b.at);
  const out = [];
  for (const h of hits) {
    if (out.some((o) => h.at < o.end && h.end > o.at)) continue; // перекрытие
    if (out.some((o) => o.en === h.en)) continue;               // один предмет — один раз
    out.push(h);
  }
  return out;
}

// ───────────────────────── регулярки событий ─────────────────────────
const RX = {
  expl: W('взрыв\\p{L}*|взорва\\p{L}*|гранат\\p{L}*|explo\\p{L}*|grenade|blast|detonat\\p{L}*'),
  shot: W('выстрел\\p{L}*|стрел(?:яе\\p{L}*|яю\\p{L}*|ял\\p{L}*|ять)|пальн\\p{L}*|gunshots?|fires? (?:a |his |her |the )?(?:gun|pistol|rifle|shotgun|weapon|shot|round)|fired (?:a |his |her |the )?(?:gun|pistol|rifle|shotgun|weapon|shot|round|\\d+)|shoots?|opens? fire'),
  silenced: /глушител\p{L}*|suppress\p{L}*|silenc\p{L}*/iu,
  scream: W('крик\\p{L}*|кричи\\p{L}*|кричат|кричал\\p{L}*|закричал\\p{L}*|вопл\\p{L}*|заорал\\p{L}*|орёт|scream\\p{L}*|shout\\p{L}*|yell\\p{L}*|roar\\p{L}*'),
  glass: /разбил\p{L}* (?:\p{L}+ )?(?:стекл|окн|витрин)|разбитое стекло|стекл\p{L}* (?:разлетел|зазвен|разбил)|shatter\p{L}*|glass (?:break|broke|smash)|smash\p{L}* (?:the )?(?:window|glass)/iu,
  run: W('бег\\p{L}*|беж\\p{L}*|побеж\\p{L}*|рванул\\p{L}*|помчал\\p{L}*|sprint\\p{L}*|runs?|running|ran|dash\\p{L}*'),
  flee: W('убега\\p{L}*|убеж\\p{L}*|удира\\p{L}*|спасайс\\p{L}*|бежим|беги|бегите|flee\\p{L}*|run away|escap\\p{L}*|get out of here'),
  door: /хлопн\p{L}* (?:\p{L}+ )?двер|хлопок двери|дверь (?:хлопнул|грохнул)|slam\p{L}* (?:the )?door|door slam\p{L}*|грохот\p{L}*|выбил\p{L}* дверь|kick\p{L}* (?:the |in the )?door/iu,
  quiet: W('шёпот\\p{L}*|шепот\\p{L}*|шепч\\p{L}*|шепн\\p{L}*|тихо|тише|тихонько|крад\\p{L}*|осторожн\\p{L}*|затаи\\p{L}*|замер\\p{L}*|замир\\p{L}*|whisper\\p{L}*|quiet\\p{L}*|silent\\p{L}*|sneak\\p{L}*|tiptoe\\p{L}*|hush\\p{L}*'),
  hide: W('прята\\p{L}*|прячем\\p{L}*|прячусь|спрята\\p{L}*|укры\\p{L}*|hide|hiding|hid|conceal\\p{L}*|take cover'),
  search: W('обыск\\p{L}*|обыщ\\p{L}*|осматрива\\p{L}*|осмотр\\p{L}*|шарим|шарит|роюсь|роется|ищу|ищем|ищет|рыщ\\p{L}*|search\\p{L}*|loot\\p{L}*|rummag\\p{L}*|scaveng\\p{L}*|ransack\\p{L}*'),
  eat: W('съел\\p{L}*|ест|едят|ела|ем|поел\\p{L}*|перекус\\p{L}*|жуёт|жует|ate|eats?|eating|devours?|munch\\p{L}*'),
  drink: W('выпил\\p{L}*|пьёт|пьет|пью|пьют|глотн\\p{L}*|попил\\p{L}*|напил\\p{L}*|drank|drinks?|drinking|sips?|gulps?'),
  pill: /(?:принял\p{L}*|выпил\p{L}*|проглотил\p{L}*|took|swallow\p{L}*|popped) (?:a |the |his |her )?(?:\p{L}+ )?(?:таблетк|обезбол|антибиот|painkiller|pill|antibiotic)/iu,
  bandage: /перевяз\p{L}*|забинт\p{L}*|наложил\p{L}* (?:\p{L}+ )?(?:повязк|бинт|жгут)|bandag\p{L}*|dressed (?:the |his |her )?wound|applied (?:a |the )?(?:bandage|tourniquet)/iu,
  antisep: /обработал\p{L}*|обеззараз\p{L}*|промыл\p{L}*|смазал\p{L}* (?:\p{L}+ )?(?:перекис|антисептик|йод)|disinfect\p{L}*|cleaned (?:the |his |her )?wound|sterili\p{L}*/iu,
  take: W('взял\\p{L}*|берёт|берет|берут|забрал\\p{L}*|подобрал\\p{L}*|поднял\\p{L}*|схватил\\p{L}*|прихватил\\p{L}*|сунул\\p{L}* в (?:рюкзак|карман|сумку)|убрал\\p{L}* в (?:рюкзак|карман|сумку)|grabs?|grabbed|takes?|took|picks? up|picked up|pockets?|pocketed|stashed'),
  find: W('наш(?:ёл|ел|ла|ли)|находит|находят|обнаружил\\p{L}*|раздобыл\\p{L}*|found|finds?|discovers?|discovered'),
  give: W('передал\\p{L}*|отдал\\p{L}*|протянул\\p{L}*|вручил\\p{L}*|поделился|gave|hands?|handed|passes|passed|tosses|tossed'),
  zombie: /зомби|zombie|заражённ\p{L}*|заражен\p{L}*|infected|мертвец\p{L}*|ходяч\p{L}*|walker/iu,
};
const WOUNDS = [
  ['bite', W('укусил\\p{L}*|укушен\\p{L}*|куснул\\p{L}*|получил\\p{L}* укус\\p{L}*|вцепил\\p{L}* зубами|bitten|bit (?:him|her|them|into|down|his|the)|bites (?:him|her|them|into|down|his|the)|sank (?:its|his|her) teeth')],
  ['gunshot', W('прострелил\\p{L}*|прострелен\\p{L}*|пуля (?:попал|задел|угодил)\\p{L}*|получил\\p{L}* (?:пулев|огнестрел)\\p{L}*|(?:was |got )?shot in|bullet (?:hit|grazed|struck)')],
  ['fracture', W('сломал\\p{L}* (?:\\p{L}+ )?(?:ногу|руку|ребр\\p{L}*|кост\\p{L}*|лодыжк\\p{L}*)|подвернул\\p{L}* ногу|получил\\p{L}* перелом\\p{L}*|(?:broke|fractured) (?:his |her |a |the )?(?:leg|arm|rib|ankle|bone)')],
  ['cut', W('порезал\\p{L}*|разрезал\\p{L}*|получил\\p{L}* (?:порез|глубок\\p{L}* ран)\\p{L}*|slashed|gashed')],
  ['scratch', W('поцарапал\\p{L}*|оцарапал\\p{L}*|царапнул\\p{L}*|scratched|clawed (?:at )?(?:him|her|them|his|the)')],
];
// эти типы без указания части тела не предлагаем (слишком много ложных срабатываний)
const NEED_PART = new Set(['cut', 'scratch', 'fracture']);
// гипотезы, воспоминания, шрамы, старые раны, отрицания — не события
const HYP = /(?:^|[^\p{L}])(?:если|вдруг|может|мог бы|могла бы|чуть не|едва не|почти|боится|боялся|боялась|страх|вспомин\p{L}*|воспоминан\p{L}*|шрам\p{L}*|рубец|рубц\p{L}*|старый|старая|старое|старые|давно|когда-то|раньше|прошл\p{L}*|назад|if|might|could|would|almost|nearly|scar\p{L}*|old|memory|remember\p{L}*|used to|ago|without)(?![\p{L}])/iu;
// предмет просто описан как принадлежащий персонажу — это не находка
const POSS = /на поясу|за поясом|при себе|в кобуре|в ножнах|на ремне|за спиной|на бедре|висит|висел|висела|в рюкзаке|на плече|(?:его|её|ее|свой|своё|свою|их) (?:нож|пистолет|ружь|автомат|бит|топор|оружи|рюкзак)|on (?:his|her|their) (?:belt|hip|back|shoulder)|strapped|sheathed|holstered|(?:his|her|their) (?:knife|gun|pistol|rifle|bat|axe|weapon)|wearing|carrying|carries/iu;
const negated = (s, re) => {
  const m = re.exec(s); if (!m) return false;
  const pre = s.slice(Math.max(0, m.index - 20), m.index);
  return /(?:^|[^\p{L}])(?:не|ни|без|never|not|no|without|n't)\s+(?:\p{L}+\s+){0,2}$/iu.test(pre);
};
const COND = {
  faint: /обморок\p{L}*|потерял\p{L}* сознани\p{L}*|без сознания|faint\p{L}*|passed out|blacked out|lost consciousness|unconscious|knocked out/iu,
  weak: W('ослаб\\p{L}*|слабост\\p{L}*|обессил\\p{L}*|истощ\\p{L}*|измотан\\p{L}*|головокружен\\p{L}*|exhaust\\p{L}*|weakened|weakness|dizz\\p{L}*|lightheaded'),
  wake: /очнул\p{L}*|прихо(?:дит|дил\p{L}*) в себя|пришёл в себя|пришел в себя|пришла в себя|came to|woke up|wakes up|comes to|regained consciousness/iu,
};
const COND_RU = { faint: 'обморок', weak: 'слабость' };
const WOUND_RU = { bite: 'укус', gunshot: 'огнестрел', fracture: 'перелом', cut: 'порез', scratch: 'царапина', amputation: 'ампутация' };
const PARTS = [
  ['neck', /шея|шее|шеи|шею|горл\p{L}*|neck|throat/iu],
  ['head', /голов\p{L}*|лиц\p{L}*|head|face/iu],
  ['arm', /рук\p{L}*|кист\p{L}*|предплеч\p{L}*|запяст\p{L}*|плеч\p{L}*|ладон\p{L}*|пальц\p{L}*|\barm\b|hand|wrist|shoulder|finger/iu],
  ['leg', /ног\p{L}*|бедр\p{L}*|голен\p{L}*|икр\p{L}*|стоп\p{L}*|колен\p{L}*|лодыжк\p{L}*|\bleg\b|thigh|calf|foot|knee|ankle/iu],
  ['torso', /торс|живот\p{L}*|груд\p{L}*|спин\p{L}*|рёбр\p{L}*|ребр\p{L}*|торс|torso|chest|stomach|\bback\b|\bside\b|\brib/iu],
];
export const PART_RU = { neck: 'шея', head: 'голова', arm: 'рука', leg: 'нога', torso: 'торс' };
const LOC_RE = /(?:локация|место|location|📍)\s*[:：]?\s*([^\n|•·*]{2,60})/iu;

function stripBlocks(t) {
  return String(t)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, ' ')
    .replace(/<details[\s\S]*?<\/details>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_~`#>]+/g, '')
    .replace(/\r/g, '');
}
const LABELS = 'состояние|статус|событие|события|время|дата|день|локация|место|одежда|внешность|вид|мысли|мысль|настроение|погода|инвентарь|цель|цели|заметки|заметка|эмоции|окружение|снаряжение|статы|характеристики|status|state|event|events|time|date|day|location|place|clothes|clothing|outfit|appearance|mood|thoughts|weather|inventory|goal|goals|notes|emotions|surroundings|gear|stats|equipment';
const LABEL_RE = new RegExp(`^[^\\p{L}\\n]*(?:${LABELS})\\s*[:：(]`, 'iu');
function stripInfo(t) {
  return t.split('\n').filter((ln) => !(/[|│¦]/.test(ln) || LABEL_RE.test(ln) || /^\s*\[[^\]]{6,}\]\s*$/.test(ln))).join('\n');
}
const sentencesOf = (t) => t.replace(/([.!?…])\s+/g, '$1\n').split(/\n+/).map((s) => s.trim()).filter(Boolean);

export function detectEvents(t) {
  const ev = { expl: RX.expl.test(t), shot: RX.shot.test(t), silenced: RX.silenced.test(t), scream: RX.scream.test(t),
    glass: RX.glass.test(t), run: RX.run.test(t), flee: RX.flee.test(t), door: RX.door.test(t),
    quiet: RX.quiet.test(t), hide: RX.hide.test(t), search: RX.search.test(t) };
  if (ev.flee) ev.run = true;
  return ev;
}

// ───────────────────────── персонажи / инвентарь ─────────────────────────
function mkChar(def, n) {
  return { id: 'c' + hash(def.name + '#' + n).toString(36), name: def.name, isUser: !!def.isUser,
    hp: 100, inf: 0, infLimb: null, infStopped: false, dead: false, cause: '', inv: [], wounds: [], lost: [],
    lastAte: null, lastDrank: null, antiUntil: 0, antibUntil: 0, painUntil: 0, hungry: false, thirsty: false,
    faint: false, faintAt: null, weak: false, weakAt: null };
}
const reCache = new Map();
function nameRe(name) {
  if (reCache.has(name)) return reCache.get(name);
  const n = name.trim();
  const stem = n.length > 5 ? n.slice(0, -2) : n.length > 3 ? n.slice(0, -1) : n;
  const re = new RegExp(`(?:^|[^\\p{L}])${esc(stem)}${n.length <= 3 ? '(?![\\p{L}])' : ''}`, 'iu');
  reCache.set(name, re);
  return re;
}
function namedIn(S, s) {
  const found = [];
  for (const c of S.party) {
    const m = nameRe(c.name).exec(s);
    if (m) found.push({ c, at: m.index });
  }
  return found.sort((a, b) => a.at - b.at).map((x) => x.c);
}
// Бот обращается к игроку словами «ты/вас/you» — для предложений с подтверждением считаем это упоминанием игрока.
const YOU_RE = /(?:^|[^\p{L}])(?:ты|тебя|тебе|тобой|вас|вам|вами|вы|you|your)(?![\p{L}])/iu;
function namedWithYou(S, s) {
  const n = namedIn(S, s).filter((c) => !c.dead);
  const u = S.party.find((c) => c.isUser && !c.dead);
  if (u && !n.includes(u) && YOU_RE.test(s)) n.push(u);
  return n;
}
function actorOf(S, msg, s, isUser) {
  if (isUser) return S.party.find((c) => c.isUser && !c.dead) || null;
  const named = namedIn(S, s).filter((c) => !c.dead);
  if (named.length) return named[0];
  const sp = S.party.find((c) => !c.isUser && !c.dead && c.name.toLowerCase() === String(msg.name || '').toLowerCase());
  if (sp) return sp;
  const alive = S.party.filter((c) => !c.dead);
  return alive.length === 1 ? alive[0] : null;
}
function addItem(o, def, qty) {
  const k = keyOf(def);
  const it = o.inv.find((x) => keyOf(x) === k);
  if (it) it.qty += qty; else o.inv.push({ name: def.name, en: def.en || null, cat: def.cat, qty });
}
function takeItem(o, k, qty = 1) {
  const it = o.inv.find((x) => keyOf(x) === k);
  if (!it || it.qty <= 0) return 0;
  const n = Math.min(qty, it.qty);
  it.qty -= n;
  if (it.qty <= 0) o.inv.splice(o.inv.indexOf(it), 1);
  return n;
}
const hasCat = (c, cat) => c.inv.some((i) => i.cat === cat && i.qty > 0);
const firstOfCat = (c, cat) => c.inv.find((i) => i.cat === cat && i.qty > 0);
export const countCat = (c, cats) => (c ? c.inv.filter((i) => cats.includes(i.cat)).reduce((a, i) => a + i.qty, 0) : 0);

function applyCond(S, c, k) {
  if (!c || c.dead || c[k]) return;
  c[k] = true; c[k + 'At'] = S.time.abs;
  const dmg = k === 'faint' ? 15 : 10;
  c.hp = Math.max(0, c.hp - dmg);
  S.events.push(`${c.name}: ${COND_RU[k]} (−${dmg} HP)`);
  if (c.hp <= 0) kill(S, c, COND_RU[k]);
}
function kill(S, c, cause) {
  if (c.dead) return;
  c.dead = true; c.hp = 0; c.cause = cause;
  S.events.push(`${c.name}: смерть (${cause})`);
}
function locObj(S) {
  const k = S.loc.name || '—';
  return (S.locs[k] ||= { inv: [], searches: 0 });
}

function useItem(S, c, k) {
  const it = c.inv.find((x) => keyOf(x) === k);
  if (!it || it.qty <= 0) return false;
  const now = S.time.abs;
  if (it.cat === 'food') { c.weak = false; if (now != null) c.lastAte = now; }
  else if (it.cat === 'water') { if (now != null) c.lastDrank = now; }
  else if (it.cat === 'med') {
    const stopBleed = () => c.wounds.forEach((w) => { if (w.bleeding) { w.bleeding = false; w.treated = true; } });
    if (k === 'bandage' || k === 'tourniquet') stopBleed();
    else if (k === 'medkit') { stopBleed(); c.hp = Math.min(100, c.hp + 15); if (now != null) c.antiUntil = now + 720; }
    else if (k === 'antiseptic') { if (now != null) c.antiUntil = now + 720; }
    else if (k === 'painkillers') { if (now != null) c.painUntil = now + 360; }
    else if (k === 'antibiotics') { if (now != null) c.antibUntil = now + 1440; }
  } else return false;
  takeItem(c, k, 1);
  return true;
}

// ───────────────────────── состояние ─────────────────────────
export function newStore(partyDefs, startAt = 0, diff = 'middle') {
  return { v: 1, seed: Math.floor(Math.random() * 1e9), startAt, diff, party: partyDefs, ops: [], decisions: {}, rules: [] };
}
function initState(store) {
  const P = DIFF[store.diff] || DIFF.middle;
  return { diff: P.id, P, time: { abs: null, hasDay: false }, noise: 0, activity: 0, stage: 0, quiet: 0,
    attack: false, escaped: false, searchDanger: false, searchNote: '',
    party: (store.party || []).map((d, i) => mkChar(d, i)), loc: { name: '' }, locs: {},
    pending: [], events: [], timeNote: '', seq: store.party ? store.party.length : 0,
    turn: { types: new Set(), done: new Set(), shots: {}, userNoise: 0, searched: false } };
}
const newTurn = () => ({ types: new Set(), done: new Set(), shots: {}, userNoise: 0, searched: false });
const R = (store, label, key) => rnd(hash(`${store.seed}|${label}|${key}`));

// ───────────────────────── ручные действия ─────────────────────────
function findChar(S, id) { return S.party.find((c) => c.id === id); }
function advanceTo(S, abs, store) {
  const prev = S.time.abs;
  if (prev == null) { S.time.abs = abs; initTimers(S); return; }
  if (abs <= prev) return;
  const dtMin = abs - prev, hours = dtMin / 60, P = S.P;
  S.time.abs = abs;
  for (const c of S.party) {
    if (c.dead) continue;
    if (c.faint && c.faintAt != null && abs - c.faintAt >= 120) c.faint = false;   // обморок проходит за ~2 ч
    if (c.weak && c.weakAt != null && abs - c.weakAt >= 360) c.weak = false;      // слабость — за ~6 ч
    if (c.lastAte == null) c.lastAte = prev;
    if (c.lastDrank == null) c.lastDrank = prev;
    // голод и жажда — только если давно не ели И еды/воды нет
    const overF = abs - (c.lastAte + P.hungerH * 60), overW = abs - (c.lastDrank + P.thirstH * 60);
    c.hungry = overF > 0; c.thirsty = overW > 0;
    if (overF > 0 && !hasCat(c, 'food')) c.hp -= P.hungerDrain * (Math.min(dtMin, overF) / 60);
    if (overW > 0 && !hasCat(c, 'water')) c.hp -= P.thirstDrain * (Math.min(dtMin, overW) / 60);
    // кровотечение
    for (const w of c.wounds) if (w.bleeding) c.hp -= (w.sev >= 2 ? 6 : 2) * P.dmg * hours;
    // заражение
    if (c.inf > 0 && !c.infStopped) {
      let rate = P.infRate;
      if (abs < c.antiUntil && c.inf <= 20) rate *= 0.5;
      if (abs < c.antibUntil) rate *= 0.5;
      c.inf = Math.min(100, c.inf + rate * hours);
      const st = infStage(c.inf);
      c.hp -= [0, 0, 0, 0.5, 1.5, 3][st] * hours;
    }
    c.hp = Math.max(0, c.hp);
    if (c.inf >= 100) kill(S, c, 'заражение — обращение');
    else if (c.hp <= 0) {
      const bleeding = c.wounds.some((w) => w.bleeding);
      kill(S, c, bleeding ? 'кровопотеря' : c.inf > 40 ? 'заражение' : c.hungry || c.thirsty ? 'истощение' : 'травмы');
    }
  }
}
function initTimers(S) { for (const c of S.party) { if (c.lastAte == null) c.lastAte = S.time.abs; if (c.lastDrank == null) c.lastDrank = S.time.abs; } }

function changeLoc(S, name) {
  if (!name || name === S.loc.name) return;
  const had = !!S.loc.name;
  S.loc.name = name;
  if (had) {
    S.activity = Math.max(0, S.activity - 3);
    S.noise = Math.max(0, S.noise - 1);
    if (S.stage > 0) S.stage--;
    S.events.push(`Локация: ${name}`);
  }
}

function applyOp(S, op, store) {
  const c = op.who && op.who !== 'loc' ? findChar(S, op.who) : null;
  const owner = op.who === 'loc' ? locObj(S) : c;
  switch (op.t) {
    case 'add': if (owner) addItem(owner, { name: op.name, en: op.en, cat: op.cat }, Math.max(1, op.qty | 0)); break;
    case 'dec': if (owner) takeItem(owner, op.key, op.qty || 1); break;
    case 'set': if (owner) { const it = owner.inv.find((x) => keyOf(x) === op.key); if (it) { it.qty = Math.max(0, op.qty | 0); if (!it.qty) owner.inv.splice(owner.inv.indexOf(it), 1); } } break;
    case 'use': if (c && !c.dead) useItem(S, c, op.key); break;
    case 'transfer': { const a = op.from === 'loc' ? locObj(S) : findChar(S, op.from), b = op.to === 'loc' ? locObj(S) : findChar(S, op.to);
      if (a && b) { const it = a.inv.find((x) => keyOf(x) === op.key); if (it) { const def = { name: it.name, en: it.en, cat: it.cat }; const n = takeItem(a, op.key, op.qty || 1); if (n) addItem(b, def, n); } } break; }
    case 'hp': if (c) { c.hp = clamp(op.v, 0, 100); if (c.hp > 0) { c.dead = false; c.cause = ''; } else kill(S, c, 'вручную'); } break;
    case 'inf': if (c) { c.inf = clamp(op.v, 0, 100); c.infStopped = false; } break;
    case 'cond': if (c) { if (op.on) applyCond(S, c, op.k); else c[op.k] = false; } break;
    case 'revive': if (c) { c.dead = false; c.cause = ''; c.hp = Math.max(c.hp, 30); if (c.inf >= 100) c.inf = 80; } break;
    case 'noise': S.noise = clamp(op.v, 0, 5); break;
    case 'activity': S.activity = clamp(op.v, 0, 10); break;
    case 'stage': S.stage = clamp(op.v, 0, 3); S.quiet = 0; break;
    case 'diff': S.diff = op.v; S.P = DIFF[op.v] || DIFF.middle; break;
    case 'addChar': S.party.push(mkChar({ name: op.name, isUser: !!op.isUser }, ++S.seq)); break;
    case 'delChar': S.party = S.party.filter((x) => x.id !== op.who); break;
    case 'loc': changeLoc(S, op.name); break;
    case 'adv': { const base = S.time.abs == null ? 480 : S.time.abs; advanceTo(S, base + Math.max(1, op.min | 0), store); if (S.time.abs == null) S.time.abs = base; break; }
    case 'time': { const abs = op.abs; if (S.time.abs == null) { S.time.abs = abs; initTimers(S); } else advanceTo(S, abs, store); break; }
    case 'escape': S.stage = Math.max(0, S.stage - 1); S.quiet = 0; break;
    case 'amputate': {
      if (!c || !canAmputate(c)) break;
      const ch = ampChance(c.inf), limb = c.infLimb;
      c.lost.push(limb);
      c.wounds.push({ type: 'amputation', part: limb, bleeding: true, sev: 2, treated: false });
      c.hp = Math.max(0, c.hp - Math.round(25 * S.P.dmg));
      c.infLimb = null;
      if (op.r < ch) { c.inf = 0; c.infStopped = true; S.events.push(`Ампутация удалась: ${c.name}`); }
      else S.events.push(`Ампутация не остановила инфекцию: ${c.name}`);
      if (c.hp <= 0) kill(S, c, 'операция');
      break;
    }
    default: break;
  }
}
export const canAmputate = (c) => !!c && !c.dead && !!c.infLimb && !c.infStopped && c.inf > 0 && !c.lost.includes(c.infLimb);

// ───────────────────────── зомби: шум, стадии, броски ─────────────────────────
function applyLoud(S, ev, only) {
  const P = S.P;
  const use = (k) => ev[k] && (!only || !S.turn.types.has(k));
  let gain = 0;
  if (use('shot')) { gain += ev.silenced ? 1 : 5; S.turn.types.add('shot'); }
  if (use('scream')) { gain += 3; S.turn.types.add('scream'); }
  if (use('glass')) { gain += 3; S.turn.types.add('glass'); }
  if (use('run')) { gain += 2; S.turn.types.add('run'); }
  if (use('door')) { gain += 2; S.turn.types.add('door'); }
  if (use('expl')) { S.noise = 5; S.turn.types.add('expl'); S.events.push('Взрыв: шум 5'); return true; }
  if (gain > 0) {
    const was = S.noise;
    S.noise = Math.min(5, S.noise + gain * P.noiseMul);
    S.events.push(`Шум ${was.toFixed(1).replace('.0', '')} → ${S.noise.toFixed(1).replace('.0', '')}`);
    return true;
  }
  return false;
}
function react(S, store, label, key) {
  const P = S.P;
  const base = P.react[clamp(Math.round(S.noise), 0, 5)];
  if (base <= 0) return;
  const chance = Math.min(0.95, base * (1 + S.activity * 0.05));
  if (R(store, 'react' + label, key) < chance) {
    if (S.stage === 3) {
      if (R(store, 'atk' + label, key) < Math.min(0.9, P.attack + S.activity * 0.03)) { S.attack = true; S.events.push('Зомби добрались до группы'); }
    } else {
      S.stage++;
      S.events.push(`Зомби: ${STAGE_RU[S.stage]}`);
    }
    S.activity = Math.min(10, S.activity + (S.stage >= 3 ? 2 : 1));
    S.quiet = 0;
  }
}
const locBase = (n) => (/аптек|pharm|drugstore/i.test(n) ? 10 : /участок|police|station|полици/i.test(n) ? 35 : /магазин|shop|store|market|супермаркет/i.test(n) ? 20 : /дом|квартир|house|apart|home/i.test(n) ? 15 : 20);

// ───────────────────────── обработка сообщений ─────────────────────────
function propose(S, store, p) {
  const d = store.decisions[p.id];
  if (d === undefined) { S.pending.push({ id: p.id, kind: p.kind, text: p.text, cands: (p.cands || []).map((c) => ({ id: c.id, name: c.name })), idx: p.idx }); return; }
  if (d === false) return;
  p.run(d);
}
function pickTarget(p, d) { return d === true ? p.cands[0] : p.cands.find((c) => c.id === d); }

function userPhase(S, msg, narr, i, store) {
  S.turn = newTurn();
  S.events = []; S.attack = false; S.escaped = false; S.searchDanger = false; S.searchNote = '';
  const P = S.P, ev = detectEvents(narr), key = `${i}:${hash(msg.mes || '')}`;
  // шум
  const loud = applyLoud(S, ev, false);
  if (loud) S.quiet = 0;
  else {
    if (ev.quiet || ev.hide) S.noise = Math.max(0, S.noise - P.decay * (ev.hide && S.stage < 3 ? 2 : 1));
    else if (S.noise > 1) S.noise = Math.max(1, S.noise - P.decay);
    else S.noise = Math.min(1, S.noise + P.noiseMul);
    S.quiet = S.noise <= 2 ? S.quiet + 1 : 0;
  }
  // затухание стадий и активности
  const need = [0, 2, 3, 5];
  if (S.stage > 0 && S.quiet >= need[S.stage]) { S.stage--; S.quiet = 0; S.events.push(`Зомби: ${STAGE_RU[S.stage]}`); }
  if (S.quiet > 0 && S.quiet % 2 === 0 && S.stage < 3) S.activity = Math.max(0, S.activity - (P.id === 'hard' ? 0.5 : 1));
  // поиск
  if (ev.search) {
    const L = locObj(S); L.searches++; S.turn.searched = true;
    const pct = (locBase(S.loc.name) + S.noise * 5 + S.activity * 3) * P.riskMul / 100;
    S.searchNote = `search #${L.searches}; ${P.scarcity}${L.searches >= 3 ? '; this place is mostly picked clean' : ''}`;
    if (R(store, 'search', key) < Math.min(0.9, pct)) {
      S.searchDanger = true; S.activity = Math.min(10, S.activity + 1); S.noise = Math.min(5, S.noise + 1);
      if (S.stage < 2) { S.stage++; S.events.push(`Поиск привлёк внимание: ${STAGE_RU[S.stage]}`); }
    }
  }
  // побег при погоне
  let skipReact = false;
  if (ev.flee && S.stage === 3) {
    const legs = S.party.some((c) => !c.dead && c.lost.includes('leg'));
    const ch = clamp(P.flee - S.activity * 0.03 - (legs ? 0.25 : 0), 0.05, 0.95);
    if (R(store, 'flee', key) < ch) { S.stage = 2; S.activity = Math.max(0, S.activity - 1); S.escaped = true; S.quiet = 0; skipReact = true; S.events.push('Оторвались от погони'); }
    else { S.attack = true; S.events.push('Побег не удался'); skipReact = true; }
  }
  if (!skipReact) react(S, store, 'u', key);
  S.turn.userNoise = S.noise;
  sentenceLoop(S, msg, narr, i, store, true, key);
}

function botPhase(S, msg, raw, narr, i, store, o) {
  const key = `${i}:${hash(raw)}`;
  const rkey = o.swipeReroll ? key : String(i); // «свайп не перебрасывает кубики»
  // время
  const t = parseTime(raw, o);
  if (!t) S.timeNote = 'в ответе нет времени';
  else {
    S.timeNote = '';
    const prev = S.time.abs;
    let abs;
    if (t.day != null) { abs = t.day * 1440 + t.h * 60 + t.m; S.time.hasDay = true; }
    else { const base = prev == null ? 0 : Math.floor(prev / 1440) * 1440; abs = base + t.h * 60 + t.m; if (prev != null && abs < prev) abs += 1440; }
    if (prev == null) { S.time.abs = abs; initTimers(S); }
    else if (abs < prev) S.timeNote = 'время назад — игнорирую';
    else if (abs > prev) {
      const dt = abs - prev;
      if (dt > (o.bigJumpH || 12) * 60) {
        propose(S, store, { id: `${key}:time`, kind: 'time', idx: i, cands: [], text: `Время скакнуло на ${fmtDur(dt)}. Принять? (голод, жажда и заражение продвинутся)`, run: () => advanceTo(S, abs, store) });
      } else advanceTo(S, abs, store);
    }
  }
  // локация из инфоблока
  const lm = raw.match(LOC_RE);
  if (lm) changeLoc(S, lm[1].replace(/[*_]/g, '').trim());
  // дополнительный шум из ответа бота (то, чего не было в сообщении игрока)
  const ev = detectEvents(narr);
  if (applyLoud(S, ev, true)) {
    S.quiet = 0;
    if (S.noise > S.turn.userNoise + 0.01) { react(S, store, 'b', rkey); S.turn.userNoise = S.noise; }
  }
  sentenceLoop(S, msg, narr, i, store, false, key);
}

function sentenceLoop(S, msg, narr, i, store, isUser, key) {
  const done = S.turn.done;
  let n = 0;
  const wTypes = new Set();
  for (const s of sentencesOf(narr)) {
    const hyp = HYP.test(s);
    // таблетки
    if (RX.pill.test(s)) {
      const c = actorOf(S, msg, s, isUser);
      const k = /антибиот|antibiotic/i.test(s) ? 'antibiotics' : 'painkillers';
      if (c && !done.has(`pill:${c.id}:${k}`)) { done.add(`pill:${c.id}:${k}`); useItem(S, c, k); }
      continue;
    }
    // перевязка / обработка
    if (RX.bandage.test(s) || RX.antisep.test(s)) {
      const named = namedIn(S, s).filter((c) => !c.dead);
      const target = named[0] || (S.party.filter((c) => !c.dead).length === 1 ? S.party.find((c) => !c.dead) : null);
      const k = RX.bandage.test(s) ? 'bandage' : 'antiseptic';
      if (target && !done.has(`med:${target.id}:${k}`)) {
        const owner = [target, ...named, ...S.party].find((c) => c && !c.dead && c.inv.some((x) => keyOf(x) === k && x.qty > 0));
        if (owner) {
          done.add(`med:${target.id}:${k}`);
          const it = owner.inv.find((x) => keyOf(x) === k);
          takeItem(owner, k, 1);
          if (k === 'bandage') target.wounds.forEach((w) => { if (w.bleeding) { w.bleeding = false; w.treated = true; } });
          else if (S.time.abs != null) target.antiUntil = S.time.abs + 720;
          void it;
        }
      }
      continue;
    }
    // еда / питьё
    const isEat = RX.eat.test(s) && !negated(s, RX.eat), isDrink = RX.drink.test(s) && !negated(s, RX.drink);
    if (isEat || isDrink) {
      const c = actorOf(S, msg, s, isUser);
      if (c) {
        const items = detectItems(s);
        const want = isDrink ? 'water' : 'food';
        const named = items.find((x) => x.cat === want && c.inv.some((y) => keyOf(y) === x.en && y.qty > 0));
        const it = named ? c.inv.find((y) => keyOf(y) === named.en) : firstOfCat(c, want);
        if (it && !done.has(`${want}:${c.id}`)) { done.add(`${want}:${c.id}`); useItem(S, c, keyOf(it)); }
      }
    }
    // выстрелы → патроны
    if (RX.shot.test(s) && !hyp && !negated(s, RX.shot)) {
      const c = actorOf(S, msg, s, isUser);
      if (c) {
        const m = s.match(/(?:^|[^\p{L}\p{N}])(\d+|дважды|трижды|два|три|двух|трёх|twice|thrice|two|three)(?:\s*(?:раз\p{L}*|выстрел\p{L}*|times|shots?)|(?![\p{L}\p{N}]))/iu);
        let cnt = 1;
        if (m) cnt = /^\d+$/.test(m[1]) ? +m[1] : /дважды|два|двух|twice|two/i.test(m[1]) ? 2 : 3;
        cnt = clamp(cnt, 1, 30);
        const prev = S.turn.shots[c.id] || 0;
        if (cnt > prev) { takeItem(c, 'ammo', cnt - prev); S.turn.shots[c.id] = cnt; }
      }
    }
    // обморок / слабость / приход в сознание
    {
      const who = isUser ? actorOf(S, msg, s, true) : (namedWithYou(S, s)[0] || actorOf(S, msg, s, false));
      if (who && COND.wake.test(s) && who.faint) who.faint = false;
      for (const k of ['faint', 'weak']) {
        if (!S.suggest || hyp || !who || who[k] || wTypes.has('c' + k) || !COND[k].test(s) || negated(s, COND[k])) continue;
        if (k === 'weak' && /\b(?:не|без)\s+слаб/iu.test(s)) continue;
        wTypes.add('c' + k);
        const cc = who;
        propose(S, store, { id: `${key}:${n++}`, kind: 'cond', idx: i, cands: [],
          text: `${cc.name}: ${COND_RU[k]}. Применить (−${k === 'faint' ? 15 : 10} HP)?`,
          run: () => applyCond(S, cc, k) });
      }
    }
    if (isUser) continue;

    // найдено / взято (нужно подтверждение)
    const take = RX.take.test(s) && !negated(s, RX.take), find = RX.find.test(s) && !negated(s, RX.find);
    if (take || find) {
      const items = detectItems(s);
      if (S.suggest && items.length && !hyp && !POSS.test(s)) {
        const alive = S.party.filter((c) => !c.dead);
        const named = namedWithYou(S, s);
        const a = named[0] || actorOf(S, msg, s, false);
        const cands = take ? (a ? [a] : alive) : [];
        const label = items.map((x) => `${x.name}${x.qty > 1 ? ' ×' + x.qty : ''}`).join(', ');
        const p = { id: `${key}:${n++}`, kind: take ? 'take' : 'find', idx: i, cands,
          text: take ? `${a ? a.name + ': взял' : 'Кто взял'} — ${label}?` : `Найдено: ${label}. Положить в локацию?`,
          run: (d) => {
            if (take) {
              const c = pickTarget({ cands }, d); if (!c) return;
              const L = locObj(S);
              for (const x of items) { takeItem(L, keyOf(x), x.qty); addItem(c, x, x.qty); }
            } else { const L = locObj(S); for (const x of items) addItem(L, x, x.qty); }
          } };
        void named;
        propose(S, store, p);
      }
      continue;
    }
    // передача
    if (RX.give.test(s)) {
      const named = namedIn(S, s).filter((c) => !c.dead);
      const items = detectItems(s);
      if (S.suggest && !hyp && named.length >= 2 && items.length) {
        const [from, to] = named, x = items[0];
        if (from.inv.some((y) => keyOf(y) === keyOf(x) && y.qty > 0)) {
          propose(S, store, { id: `${key}:${n++}`, kind: 'give', idx: i, cands: [],
            text: `${from.name} → ${to.name}: ${x.name}${x.qty > 1 ? ' ×' + x.qty : ''}?`,
            run: () => { const k = keyOf(x), it = from.inv.find((y) => keyOf(y) === k); if (!it) return; const def = { name: it.name, en: it.en, cat: it.cat }; const q = takeItem(from, k, x.qty); if (q) addItem(to, def, q); } });
        }
      }
      continue;
    }
    // ранения (нужно подтверждение)
    for (const [type, re] of WOUNDS) {
      if (!S.suggest || hyp || !re.test(s) || wTypes.has(type) || negated(s, re)) continue;
      if (type !== 'bite' && type !== 'scratch' && RX.zombie.test(s)) continue; // игрок бьёт зомби — не рана игрока
      const named = namedWithYou(S, s);
      const alive = S.party.filter((c) => !c.dead);
      const a = named[0] || (alive.length === 1 ? alive[0] : (!isUser && S.party.find((c) => !c.isUser && !c.dead && c.name.toLowerCase() === String(msg.name || '').toLowerCase())) || null);
      const cands = a ? [a] : alive;
      if (!cands.length) break;
      wTypes.add(type);
      const part = (PARTS.find(([, r]) => r.test(s)) || [null])[0];
      if (NEED_PART.has(type) && !part) continue;
      if (type === 'scratch' && !RX.zombie.test(s)) continue; // царапина веткой — не рана игрока
      const wid = `${key}:${n++}`;
      propose(S, store, { id: wid, kind: 'wound', idx: i, cands,
        text: `${a ? a.name : 'Кто'}: ${WOUND_RU[type]}${part ? ' (' + PART_RU[part] + ')' : ''}. Применить?`,
        run: (d) => { const c = pickTarget({ cands }, d); if (c) applyWound(S, c, type, part, R(store, 'w1', String(i) + type), R(store, 'w2', String(i) + type)); } });
      break;
    }
  }
}

function applyWound(S, c, type, part, r1, r2) {
  const P = S.P;
  if (c.dead) return;
  const T = { bite: [12, 18, true, 2], scratch: [3, 6, false, 1], cut: [8, 12, true, 1], gunshot: [20, 30, true, 2], fracture: [10, 15, false, 1] }[type];
  const dmg = Math.round((T[0] + (T[1] - T[0]) * r1) * P.dmg);
  c.hp = Math.max(0, c.hp - dmg);
  c.wounds.push({ type, part, bleeding: T[2], sev: T[3], treated: false });
  if (type === 'bite' && r2 < P.biteInf) {
    c.inf = Math.max(c.inf, Math.round(15 + 10 * r1)); c.infStopped = false;
    c.infLimb = part === 'arm' || part === 'leg' ? part : null;
  } else if (type === 'scratch' && r2 < P.scratchInf) {
    c.inf = Math.max(c.inf, Math.round(5 + 5 * r1)); c.infStopped = false;
    c.infLimb = part === 'arm' || part === 'leg' ? part : c.infLimb;
  }
  S.events.push(`${c.name}: −${dmg} HP (${WOUND_RU[type]})`);
  if ((type === 'gunshot' && part === 'head') || c.hp <= 0) kill(S, c, type === 'bite' ? 'укус' : 'ранение');
}

// ───────────────────────── воспроизведение ─────────────────────────
export function replay(chat, store, o = {}) {
  const S = initState(store);
  S.suggest = o.suggest !== false;
  const ops = (store.ops || []).map((op, idx) => ({ op, idx })).sort((a, b) => (a.op.at - b.op.at) || (a.idx - b.idx));
  let oi = 0;
  const start = store.startAt || 0, end = o.upto == null ? chat.length : o.upto;
  for (let i = start; i < end; i++) {
    while (oi < ops.length && ops[oi].op.at <= i) applyOp(S, ops[oi++].op, store);
    const msg = chat[i];
    if (!msg || msg.is_system) continue;
    const raw = String(msg.mes || '');
    const narr = stripInfo(stripBlocks(raw));
    if (msg.is_user) userPhase(S, msg, narr, i, store);
    else botPhase(S, msg, raw, narr, i, store, o);
  }
  while (oi < ops.length) applyOp(S, ops[oi++].op, store);
  // свежие неподтверждённые предложения — только из последних сообщений
  const lim = (o.upto == null ? chat.length : o.upto) - 3;
  S.pending = S.pending.filter((p) => p.idx >= lim);
  S.chatLen = chat.length;
  return S;
}

// ───────────────────────── производные величины ─────────────────────────
export function survival(S) {
  const al = S.party.filter((c) => !c.dead);
  if (!al.length) return 0;
  const hp = al.reduce((a, c) => a + c.hp, 0) / al.length;
  const inf = Math.max(...al.map((c) => c.inf));
  let v = 100 - (100 - hp) * 0.5 - inf * 0.3 - S.activity * 3.5 - S.stage * 8 + S.P.surv;
  const armed = al.some((c) => c.inv.some((i) => i.cat === 'weapon' && i.en !== 'ammo' && i.qty > 0));
  if (!armed) v -= 10;
  if (al.some((c) => c.lost.includes('leg'))) v -= 12;
  return clamp(Math.round(v), 0, 100);
}
export function flagsOf(S, c) {
  const f = [];
  if (c.dead) return ['dead'];
  if (c.faint) f.push('unconscious');
  if (c.weak) f.push('weakened');
  if (c.hp < 30) f.push('critical');
  if (c.wounds.some((w) => w.bleeding)) f.push('bleeding');
  if (c.hungry && !hasCat(c, 'food')) f.push('starving'); else if (c.hungry) f.push('hungry');
  if (c.thirsty && !hasCat(c, 'water')) f.push('dehydrated'); else if (c.thirsty) f.push('thirsty');
  if (c.lost.length) f.push('lost:' + c.lost.join('+'));
  if (S.time.abs != null && S.time.abs < c.painUntil) f.push('painkillers');
  return f;
}
const FLAG_RU = { unconscious: 'без сознания', weakened: 'ослаблен', critical: 'критическое', bleeding: 'кровотечение', hungry: 'голод', starving: 'голод, еды нет', thirsty: 'жажда', dehydrated: 'обезвоживание', painkillers: 'под обезболивающим' };
export function flagsRu(S, c) {
  return flagsOf(S, c).map((f) => (f.startsWith('lost:') ? 'потеряна: ' + f.slice(5).split('+').map((p) => PART_RU[p] || p).join(', ') : f === 'dead' ? 'мёртв (' + c.cause + ')' : FLAG_RU[f] || f));
}

// ───────────────────────── инжект для модели (английский) ─────────────────────────
const invLine = (c) => {
  const parts = c.inv.filter((i) => i.qty > 0).map((i) => `${i.en || i.name}${i.qty > 1 || i.en === 'ammo' ? ' x' + i.qty : ''}`);
  return parts.length ? parts.join(', ') : 'nothing';
};
export function buildInject(S, store, o = {}) {
  const P = S.P, L = [];
  L.push('[OUTBREAK — authoritative game state. Do not contradict it, undo injuries, invent supplies, or change numbers.]');
  const meta = [`Difficulty: ${P.label}`];
  if (S.time.abs != null) meta.push(`Time: ${fmtTime(S)}`);
  if (S.loc.name) meta.push(`Location: ${S.loc.name}`);
  L.push(meta.join('; '));
  L.push(`Noise: ${Math.round(S.noise)}/5; Zombies: ${STAGE_EN[S.stage]} (activity ${Math.round(S.activity)}/10); Survival odds ~${survival(S)}%`);
  const solo = S.party.length === 1;
  for (const c of S.party) {
    if (c.dead) { L.push(`${c.name}: DEAD (${c.cause})${/заражение|обращение/.test(c.cause) ? ' — has turned' : ''}`); continue; }
    const t = [`HP ${Math.round(c.hp)}`];
    const st = infStage(c.inf);
    if (c.inf > 0 && !c.infStopped) t.push(`infection ${Math.round(c.inf)}% (${INF_EN[st]})`);
    if (c.infStopped) t.push('infection stopped (amputation)');
    for (const f of flagsOf(S, c)) {
      if (f === 'critical') t.push('critical condition');
      else if (f === 'unconscious') t.push('unconscious (fainted)');
      else if (f === 'weakened') t.push('weakened, exhausted');
      else if (f === 'bleeding') t.push('bleeding');
      else if (f === 'hungry') t.push('hungry'); else if (f === 'starving') t.push('starving, no food');
      else if (f === 'thirsty') t.push('thirsty'); else if (f === 'dehydrated') t.push('dehydrated, no water');
      else if (f === 'painkillers') t.push('on painkillers');
      else if (f.startsWith('lost:')) t.push(f.slice(5).split('+').map((p) => `${p} lost`).join(', '));
    }
    const wnd = c.wounds.filter((w) => w.type !== 'amputation').slice(-3).map((w) => `${w.type}${w.part ? ' (' + w.part + ')' : ''}${w.bleeding ? ' bleeding' : w.treated ? ' dressed' : ''}`);
    if (wnd.length) t.push('wounds: ' + wnd.join(', '));
    L.push(`${c.name}: ${t.join('; ')}`);
    L.push(`${solo ? 'Inventory' : c.name + ' carries'}: ${invLine(c)}`);
  }
  const loc = S.locs[S.loc.name || '—'];
  if (loc && loc.inv.length) L.push(`Loose items here (not yet taken): ${invLine(loc)}`);
  // директивы — только то, что нужно сейчас
  const d = [];
  if (S.stage === 1) d.push('Zombies heard a sound and are drifting toward it; staying quiet or hiding may still help.');
  if (S.stage === 2) d.push('Zombies have located the group and are closing in; hiding works only with enough distance.');
  if (S.stage === 3) d.push('PURSUIT: zombies are on the group. Hiding is impossible; only fleeing works (running adds noise).');
  if (S.attack) d.push('This turn zombies reach the group and attack someone: narrate the contact and its consequence (injury or bite) clearly.');
  if (S.escaped) d.push('The group just broke away from the pursuers; the zombies lost them for now.');
  if (S.searchDanger) d.push('The search disturbed something: include a sign of danger (noise, movement), not yet an attack.');
  if (S.searchNote) d.push(`Search note: ${S.searchNote}.`);
  if (d.length) L.push(d.join(' '));
  const rules = (store.rules || []).filter((r) => r.on && r.text.trim());
  if (rules.length) {
    let txt = 'World rules: ' + rules.map((r) => r.text.trim().replace(/\s+/g, ' ')).join(' | ');
    if (txt.length > 1200) txt = txt.slice(0, 1200) + '…';
    L.push(txt);
  }
  L.push('[/OUTBREAK]');
  return L.join('\n');
}
