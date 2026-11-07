/* ---------- 今日のプリント（範囲の回をまたいで1日○問を決め、PDFにして、写真でまとめて◎付け） ---------- */
const DAYC = "daysAll";   // 回をまたいだ「今日の問題」
const MARU = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚";
const todayKey = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const todayLabel = () => { const d = new Date(); return `${d.getMonth() + 1}月${d.getDate()}日（${"日月火水木金土"[d.getDay()]}）`; };
let day = null, dayPhotos = [], dayMarks = null, dayBusy = false, dayMsg = "", downloads = null, assets = null, pdfUrl = "";
// 保存とアップロードの仕組みは、開いた時点で準備しておく（押してから待たせない）
const capReady = (async () => { if (!window.claude) return;
  try { downloads = await claude.use("downloads"); } catch (e) {}
  try { assets = await claude.use("assets"); } catch (e) {} })();
const dayValid = d => d && Array.isArray(d.items) && d.items.every(e => e && typeof e === "object" && e.k);
try { day = JSON.parse(localStorage.getItem("sansu-step-dayAll") || "null"); } catch (e) {}
if (!dayValid(day)) day = null;

// その日の問題を決める（数えるのは小問）
// - 範囲の回ぜんぶの系統から、1日に同じ系統は1問だけ。系統の「いまの1問」は 例題→類題→基本（→反復基本）の、まだ済んでいない最初
// - 「今週の回」から curShare 問、前の回の残りから残りの数。足りなければもう片方で埋める
// - どちらの中でも: ×だった問題 → 出せる練習・反復練習 → 新しい問題。前の回は古い回から
// 目標は偏差値50（60はねらわない）。予習ナビ「算数基礎」（Aコース基礎）に入っていない後半の例題の系統は、おすすめに出さない（2026-10-11 ユーザー）
// 記録は消さない・手で選ぶことはできる。OUT_UNIT＝系統ごと外す、SUB_ONLY＝その小問だけ出す
const OUT_UNIT = {4: ["U7", "U8"], 6: ["U8"], 7: ["U5"], 8: ["U3", "U6"], 9: ["U6"]};   // 第9回: 例題6（算数基礎に無い）   // 第8回: 例題3（算数基礎に無い）・例題6（難関校対策）
const SUB_ONLY = {6: {rei7: [0], rui7: [0]}};
function candidates(n) {
  const m = MS[n];
  const so = SUB_ONLY[n] || {};
  const isOk = q => so[q.id] ? so[q.id].every(i => m.subOk(q, i)) : m.itemOk(q);
  // 当面は例題・類題・基本まで（ユーザー 2026-10-05）。練習・反復練習は消さずに、おすすめに入れないだけ。手で選ぶことはできる
  const ren = PRACTICE_ON ? m.PRACTICE.filter(r => !m.itemOk(r) && m.ready(r)) : [];
  // 5年上の復習（前に習った単元）: 例題が1回で全部◎なら、その系統は身についているので類題・基本は出さない（2026-10-09 ユーザー）
  const enough = u => isReview(n) && u.steps.length > 1 && m.firstOk(u.steps[0]);
  // 今週の回など（5年下）: 例題が1回で全部◎なら、その系統の類題は飛ばして基本問題へ（2026-10-10 ユーザー了承）
  const skipRui = (u, p) => n < 100 && m.kind(p) === "類題" && m.firstOk(u.steps[0]);
  // ×だった例題は、次の日は「例題の解き方を見てから類題」。その次の日に例題をもう一度（2026-10-10 ユーザー）
  const lastT = p => Math.max(0, ...p.subs.map((_, i) => (m.last(p, i) || {}).t || 0));
  const pick = u => { const p = m.unitItems(u).find(q => !isOk(q) && !skipRui(u, q)); if (!p) return null;
    if (m.kind(p) === "例題" && m.itemTried(p)) { const r = u.steps.find(q => m.kind(q) === "類題");
      if (r && lastT(r) < lastT(p)) return Object.assign({p: r, rev: p.id}, isOk(r) ? {only: so[r.id] || r.subs.map((_, i) => i)} : so[r.id] ? {only: so[r.id]} : {}); }
    return so[p.id] ? {p, only: so[p.id].filter(i => !m.subOk(p, i))} : {p}; };
  const lines = m.UNITS.filter(u => !enough(u) && !(OUT_UNIT[n] || []).includes(u.id)).map(pick).filter(Boolean);
  const tag = x => ({k: n, p: x.p || x, retry: m.itemTried(x.p || x), rev: x.rev, only: x.only});
  return [...ren.map(p => tag({p})), ...lines.map(tag)];
}
// 5年上の復習の回（回の番号 200〜）。今日のプリントに1日2問まで混ぜる
const CALC = 211;   // 計算の練習（□を求める計算・分数の約分）。毎日 CALC_PER_DAY 問
const CALC_PER_DAY = 0;   // 2026-10-07 ユーザー: スペシャル計算を毎日やっているので出さない（データは残す。手で選べる）
const isReview = n => n >= 200 && n < 300 && n !== CALC;   // 300〜は週テスト（直しで出す）
const REVIEW_PER_DAY = 2;   // 2026-10-10: 組分け（5下第6〜10回）まで2問に減らす。テストのあと4問に戻す（10-07 は4問）
// テストの直し（回の番号 100〜199）: この順番で、毎日2問まで先に入れる。"問題id|小問の番号"（番号なし＝小問ぜんぶ）
// 組分け⑥（2026-10-06 ユーザー）: 基本だけ＝大問2（一行題）と各大問の(1)。(2)以降と大問8は出さない（消さない・手で選べる）
// 時計算5(1)・流水算4(1) は5年夏期講習のテキストが届いて、型を入れてから足す
const TEST_FIX = {
  // 週テスト第6回 b（10/10・50点）: 第4回の範囲の3問だけ（10/10当日に説明→解き直し。×なら翌日以降に出す）。
  // 第6回の範囲の4問（3(5)・3(6)・5(2)・6(2)）は直しで出さず、第6回の例題の系統（例題5・6・7）を進めて身につける（ユーザー 2026-10-10）
  306: ["t2-1", "t2-2", "t4|0"],
  106: ["t2-1", "t3|0", "t2-4", "t2-7", "t6|0", "t2-8", "t2-3"]};
const FIX_PER_DAY = 2;
// 予習ナビの②（週の2回目の授業）でやる問題。②の授業のあと〜週テストまでは、②を先に出す（2026-10-11 ユーザー）
// 先週（第6回）は②のあとの2日で、②の小問は6つだけ（5年上の復習16・①の残り10）。例題7は×のままテストになった
// 回ごとに、算数基礎の抜粋の「予習ナビ②」の問題と、その系統の類題・後ろの例題を書く
const PART2 = {6: ["rei5", "rui5", "kihon1-7", "kihon3", "kihon2", "rei6", "rui6", "kihon4", "rei7", "rui7", "rei8", "rui8"],
               7: ["rei5", "rui5", "rei6", "rui6", "kihon2", "kihon3", "kihon4"],
               8: ["rei2", "rui2", "kihon3", "kihon4", "rei4", "rui4"]};   // 第8回②（8_抜粋.pdf の予習ナビ②）
const PRACTICE_ON = false;   // 練習問題・反復練習をおすすめに入れるか（基本の1回目◎が8割をこえたら戻すかを司令塔が提案する）
// 前の回は「基本問題を、回をまぜて、じっくり」（ユーザー 2026-10-06）。◎の問題も、最後に解いてから日がたったものから出し直す
const MIX_KIHON = true;
// 組分けテスト第6回で落とした型の系統（先に出す）。回:系統
const FOCUS = new Set(["1:U2", "1:U3", "1:U6", "2:U1", "2:U2", "2:U5", "2:U6", "3:U2", "3:U3", "3:U4", "4:U1", "4:U4", "4:U5",
  "6:U5", "6:U6", "6:U7"]);   // 週テスト第6回で落とした第6回の系統（2026-10-10。U8坂道＝大問7は家で未着手）
function kihonMix() {
  const prevN0 = KAI_LIST.filter(n => n < 100 && n < SETTINGS.cur).sort((a, b) => b - a)[0];
  const ns = KAI_LIST.filter(n => n < 100 && n !== SETTINGS.cur && n !== prevN0);
  const lastT = (m, p) => Math.max(0, ...p.subs.map((_, i) => (m.last(p, i) || {}).t || 0));
  const lists = ns.map(n => { const m = MS[n];
    const ks = m.UNITS.flatMap(u => u.steps).filter(p => m.kind(p) === "基本問題" && !m.skipped(p));
    const focus = p => FOCUS.has(n + ":" + (m.UNIT_OF[p.id] || {}).id) ? 0 : 1;
    const ng = ks.filter(p => m.itemTried(p) && !m.itemOk(p)), todo = ks.filter(p => !m.itemTried(p)), ok = ks.filter(p => m.itemOk(p)).sort((a, b) => focus(a) - focus(b) || lastT(m, a) - lastT(m, b));
    return [...ng, ...todo, ...ok].map(p => ({k: n, p, retry: true, all: m.itemOk(p)})); });
  // 回を順番に1問ずつ取って、まぜる。同じ系統は1日1問
  const out = [], units = new Set();
  for (let r = 0; lists.some(l => l.length); r++) for (const l of lists) { const c = l.shift(); if (!c) continue;
    const u = MS[c.k].UNIT_OF[c.p.id], key = c.k + ":" + (u ? u.id : c.p.id); if (units.has(key)) continue; units.add(key); out.push(c); }
  return out;
}
// ★頼まなくても自動で選ぶ（2026-10-12 ユーザー「ロジックで勝手に最適なものが選ばれるように」「わざわざ別のセッションを開けるのが面倒」）
//  1. 1日の数: 日曜・祝日は24（3セット）、土曜は8（週テストの日）、ほかは設定の「1日の小問数」
//  2. 今週の回: 週テスト（土曜）のあとの日曜に1つ進める（その回のデータが入っているときだけ。組分けの週などは「今週の回」を手で選び直す）
//  3. 塾（予習ナビ）の日: 今週の回の日曜＝①、月曜＝②の問題を、算数基礎の順にセット1へ（小問は全部）
const HOLIDAYS = new Set(["2026-10-12", "2026-11-03", "2026-11-23", "2027-01-01", "2027-01-11", "2027-02-11", "2027-02-23", "2027-03-22"]);
const dayN = (d = new Date()) => d.getDay() === 0 || HOLIDAYS.has(todayKey()) ? 24 : d.getDay() === 6 ? 8 : SETTINGS.perDay;
const sundayOf = (d = new Date()) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0"); };
const CUR_FROM0 = {7: "2026-10-11"};
const CUR_SWITCH_HOUR = 0;   // ★2026-10-25 から日曜0時に切りかえ（ユーザー: 授業動画が0時に公開される。次の回は土曜の夜までに入れる）。前は17時
//    // ★次の回に切り替わるのは日曜の17時（塾が夕方から。2026-10-17 ユーザー「明日（10-18）の夕方からです」）   // curFrom が無いときの「その回を始めた日曜」
function autoCur() {
  const from = SETTINGS.curFrom || CUR_FROM0[SETTINGS.cur]; if (!from) return false;
  const sw = sundayOf(new Date(Date.now() - CUR_SWITCH_HOUR * 3600e3));   // 日曜の17時までは前の週あつかい
  const weeks = Math.floor((new Date(sw + "T00:00") - new Date(from + "T00:00")) / 864e5 / 7); if (weeks <= 0) return false;
  let n = SETTINGS.cur; for (let i = 0; i < weeks; i++) { const nx = KAI_LIST.filter(x => x < 100 && x > n).sort((a, b) => a - b)[0]; if (!nx) break; n = nx; }
  if (n === SETTINGS.cur) return false;
  SETTINGS.cur = n; SETTINGS.curFrom = sw; if (!SETTINGS.range.includes(n)) SETTINGS.range = [...SETTINGS.range, n];
  saveSettings(); return true;
}
// 塾でやる問題（5年下\算数基礎 の抜粋の順）。"id|小問" はその小問だけ
const JUKU = {
  6: [["rei1", "rei2", "rei3", "kihon1-1", "kihon1-2", "kihon1-3", "kihon1-4", "kihon1-5", "kihon1-6", "rei4"], ["kihon2", "rei5", "kihon1-7", "kihon3", "rei6", "kihon4", "rei7|0"]],
  7: [["rei1", "kihon1-1", "kihon1-2", "kihon1-3", "kihon1-4", "kihon1-5", "rei2", "rei3", "rei4"], ["kihon2", "kihon3", "kihon4", "rei6"]],
  8: [["kihon1-1", "kihon1-2", "kihon1-3", "rei1", "rei5", "kihon2"], ["rei2", "kihon3", "kihon4", "rei4"]],
  // 第9回（9_抜粋.pdf: ①＝例題1・基本1(3)・例題2・例題3・基本1(4)・基本3、②＝例題4・基本1(1)・例題5・基本1(2)・基本2）。
  //  2026-10-25 ユーザー「授業の問題は基本問題も入ってます」→ 授業の順に基本問題も（前は例題だけ）
  9: [["rei1", "kihon1-3", "rei2", "rei3", "kihon1-4", "kihon3"], ["rei4", "kihon1-1", "rei5", "kihon1-2", "kihon2"]]};   // 8_抜粋.pdf の順（2026-10-17）
function jukuItems(cur) {
  const wd = new Date().getDay();
  // 新しい形: 曜日ではなく進み具合で。①にまだ解いていない問題があれば①、無ければ②、両方済んだら無し（今日解いた分は今日のうちは残す）
  const untried = pt => JUKU[cur][pt].some(x => { const p = MS[cur].ITEMS[x.split("|")[0]]; return p && (!MS[cur].itemTried(p) || p.subs.some((_, i) => { const l = MS[cur].last(p, i); return l && isToday(l.t); })); });
  // ★2026-10-25 ユーザー: 授業の問題は日曜（①）と月曜（②）だけ。水〜金に持ちこさない（×の問題は例題の系統のほうで出る）
  const part = wd === 0 ? 0 : wd === 1 ? 1 : -1;
  if (part < 0 || !JUKU[cur] || !MS[cur] || (SETTINGS.curFrom || CUR_FROM0[cur]) !== sundayOf()) return [];
  return JUKU[cur][part].map(x => { const [id, si] = x.split("|"), p = MS[cur].ITEMS[id]; return p ? {k: cur, id, subs: si === undefined ? p.subs.map((_, i) => i) : [+si], juku: true} : null; }).filter(Boolean);
}
function planDay() {
  // 日曜・祝日は3セット（24問）。今週の回もその分ふやす（2026-10-10 ユーザー）
  autoCur();
  if (SYS_MODE) return planSystems();
  const N = dayN(), sunday = N >= 24, cur = SETTINGS.cur;
  const order = list => [...list.filter(c => c.retry), ...list.filter(c => !c.retry)];
  let curPool = order(SETTINGS.range.includes(cur) ? candidates(cur) : []);
  // ②の授業が終わったら（②の問題に1つでも記録があれば）、週テストまでは ②→①の× の順。5年上の復習とテストの直しは1日1問
  const p2 = new Set(PART2[cur] || []), m2 = MS[cur];
  const after2 = !!(m2 && p2.size && [...p2].some(id => m2.ITEMS[id] && m2.itemTried(m2.ITEMS[id])));
  if (after2) curPool = [...curPool.filter(c => p2.has(c.p.id)), ...curPool.filter(c => !p2.has(c.p.id))];
  const backPool = MIX_KIHON ? kihonMix() : order(SETTINGS.range.filter(n => n !== cur && !isReview(n)).flatMap(candidates));
  // 5年上の復習（回の番号 200〜）: 範囲の設定にかかわらず、毎日 REVIEW_PER_DAY 問だけ先に混ぜる（司令塔・ユーザー 2026-10-05）
  // 順番: 時計算 → 素因数分解（約数） → 流水算 → 5上第1回（約数の書き出し）。組分け⑥で落とした順・本人が自信のない順（2026-10-07）
  const REVIEW_ORDER = [202, 204, 205, 206, 207, 208, 209, 203, 210, 201];   // 2026-10-07: テストで落とした型を先に
  const rk = n => { const i = REVIEW_ORDER.indexOf(n); return i < 0 ? 99 : i; };
  // 回をまたいで1問ずつ順番に（同じ単元ばかりにならないように）
  const revLists = KAI_LIST.filter(isReview).sort((a, b) => rk(a) - rk(b)).map(n => order(candidates(n)));
  const revPool = []; for (let i = 0; revLists.some(l => l[i]); i++) revLists.forEach(l => { if (l[i]) revPool.push(l[i]); });
  const out = []; let total = 0;
  const JK = jukuItems(cur); JK.forEach(e => { out.push(e); total += itemW(e.k, e.id, e.subs.length); });
  const take = (pool, limit, maxItems) => {
    let got = 0;
    for (const c of pool) {
      if (maxItems && got >= maxItems) break;
      if (out.some(o => o.k === c.k && o.id === c.p.id)) continue;
      // all: ◎の問題の出し直し。いろいろな問題を出すため、小問は1つだけ（最後に解いてから日がたっている小問）
      const lt = i => (MS[c.k].last(c.p, i) || {}).t || 0;
      const due = c.only ? c.only : c.all ? [c.p.subs.map((_, i) => i).sort((a, b) => lt(a) - lt(b))[0]] : c.p.subs.map((_, i) => i).filter(i => !MS[c.k].subOk(c.p, i)).slice(0, c.cap || 99);
      const wt = itemW(c.k, c.p.id, due.length);
      if (!due.length || total + wt > limit) continue;
      out.push(Object.assign({k: c.k, id: c.p.id, subs: due}, c.rev ? {rev: c.rev} : {})); total += wt; got++;
    }
  };
  const fixPool = Object.entries(TEST_FIX).flatMap(([n, ids]) => !MS[n] ? [] : ids.map(x => { const [id, si] = x.split("|"); const p = MS[n].ITEMS[id];
    if (!p) return null; const subs = si === undefined ? p.subs.map((_, i) => i) : [+si];
    const due = subs.filter(i => !MS[n].subOk(p, i)); return due.length ? {k: +n, p, retry: true, only: due} : null; }).filter(Boolean));
  take(fixPool, N, after2 ? 1 : FIX_PER_DAY);
  // 5年上の復習は1問につき小問2つまで（(1)〜(4)の多い問題で枠を使い切らないように。残りの小問は次の日に。2026-10-08 ユーザー）
  revPool.forEach(c => { if (!c.p.w) c.cap = 2; });
  take(revPool, N, after2 ? 1 : REVIEW_PER_DAY);
  // 計算: □を求める計算と分数の計算を1日おきに交互（それぞれの系統の次の1問）
  if (MS[CALC] && CALC_PER_DAY) { const cl = order(candidates(CALC)); const d = new Date().getDate(); if (d % 2) cl.reverse(); take(cl, N, CALC_PER_DAY); }
  // 前の週の回（今週の回の1つ前）も、例題→類題→基本の続きを出す（終わっていないまま次の回に進むため。2026-10-10）
  const prevN = KAI_LIST.filter(n => n < 100 && n < cur).sort((a, b) => b - a)[0];
  const pf = c => FOCUS.has(c.k + ":" + (MS[c.k].UNIT_OF[c.p.id] || {}).id) ? 0 : 1;
  const prevPool = prevN ? order(candidates(prevN)).sort((a, b) => pf(a) - pf(b)) : [];   // テストで落とした系統を先に
  const curN = sunday ? Math.round(SETTINGS.curShare * 1.5) : SETTINGS.curShare;
  take(curPool, Math.min(N, total + Math.ceil(curN * 0.6) + (after2 ? 2 : 0)));   // ②のあとは、減らした復習・直しの分を今週の回へ
  take(prevPool, Math.min(N, total + Math.floor(curN * 0.4)));
  take(backPool, N);
  take(curPool, N);
  if (!JK.length) return pairSets(out, N);
  // 塾の日: セット1＝塾の問題（塾の順）。残りを8ずつのセットに（✕2回以上の系統の組み方もここで）
  const jw = JK.reduce((a, e) => a + itemW(e.k, e.id, e.subs.length), 0);
  let r = pairSets(out.filter(e => !e.juku), Math.max(0, N - jw));
  if (!r.some(e => typeof e.set === "number")) { let sn = 1, c = 0; r = r.map((e, i) => { const w = itemW(e.k, e.id, e.subs.length); if (c && c + w > SET_SIZE) { sn++; c = 0; } c += w; return Object.assign({}, e, {set: sn, ord: i + 1}); }); }
  return [...JK.map((e, i) => ({k: e.k, id: e.id, subs: e.subs, set: 1, ord: i + 1})), ...r.map(e => Object.assign({}, e, {set: e.set + 1, ord: 100 + e.ord}))];
}
// ★セットの組み方（ユーザー 2026-10-12）
//  1. ✕が2回以上（✕だった日の数）の系統があって、その日に2セット以上ある場合は、前のセットに例題、次のセットに同じ系統の類題
//     （セットごとに丸付けと解説をしてから次へ進む前提。印刷は1回）。類題には解き方ページ（rev）を付けない
//  2. それ以外は、その系統でできていない問題を1問（今までどおり）
const ngDaysOf = (m, p) => new Set(p.subs.flatMap((_, i) => (MS[m].ITEMS[p.id] ? (recOf(m)[MS[m].sk(p, i)] || []) : []).filter(x => !x.ok && x.t > 1e11).map(x => new Date(x.t).toDateString()))).size;
function pairSets(out, N) {
  if (N <= SET_SIZE) return out;
  const A = [], B = [], C = [];
  for (const e of out) {
    const m = MS[e.k], p = m.ITEMS[e.id], u = m.UNIT_OF[e.id];
    const rei = u && u.steps.find(q => m.kind(q) === "例題"), rui = u && u.steps.find(q => m.kind(q) === "類題");
    // 系統の✕＝例題と類題の✕だった日を合わせた数
    const sysNg = rei && rui ? new Set([rei, rui].flatMap(q => q.subs.flatMap((_, i) => (recOf(e.k)[m.sk(q, i)] || []).filter(x => !x.ok && x.t > 1e11).map(x => new Date(x.t).toDateString())))).size : 0;
    if (rei && rui && sysNg >= 2 && (e.id === rui.id || e.id === rei.id) && !A.some(x => x.k === e.k && x.id === rei.id)) {
      const ngSubs = rei.subs.map((_, i) => i).filter(i => !m.subOk(rei, i));
      A.push({k: e.k, id: rei.id, subs: ngSubs.length ? ngSubs : rei.subs.map((_, i) => i)});
      B.push({k: e.k, id: rui.id, subs: e.id === rui.id ? e.subs : rui.subs.map((_, i) => i)});
    } else C.push(e);
  }
  if (!A.length) return out;
  const w = e => itemW(e.k, e.id, e.subs.length), sum = L => L.reduce((a, e) => a + w(e), 0);
  // 1セット目: 例題（あふれたら2セット目の前へ）＋ほかの問題で8まで。2セット目: 類題＋ほかの問題。残りはそのあと
  const sets = [[], []]; let ci = 0;
  for (const e of A) { (sum(sets[0]) + w(e) <= SET_SIZE || !sets[0].length ? sets[0] : sets[1]).push(e); }
  const firstB = sets[1].length ? 2 : 1; while (sets.length <= firstB) sets.push([]);
  for (const e of B) sets[firstB].push(e);
  for (let s = 0; s < sets.length && ci < C.length; s++) while (ci < C.length && sum(sets[s]) + w(C[ci]) <= SET_SIZE) sets[s].push(C[ci++]);
  let rest = []; while (ci < C.length) rest.push(C[ci++]);
  // 1日の数を超えたら、ほかの問題の後ろから外す
  let all = sets.flat().concat(rest);
  while (sum(all) > N && rest.length) { rest.pop(); all = sets.flat().concat(rest); }
  for (let s = sets.length - 1; s >= 0 && sum(sets.flat()) > N; s--) for (let i = sets[s].length - 1; i >= 0 && sum(sets.flat()) > N; i--) {
    const e = sets[s][i]; if (!A.includes(e) && !B.includes(e)) sets[s].splice(i, 1); }
  let ord = 1; const res = [];
  sets.forEach((S, si) => S.forEach(e => res.push(Object.assign({}, e, {set: si + 1, ord: ord++}))));
  let rs = sets.length + 1, rc = 0;
  rest.forEach(e => { if (rc && rc + w(e) > SET_SIZE) { rs++; rc = 0; } rc += w(e); res.push(Object.assign({}, e, {set: rs, ord: ord++})); });
  return res;
}
// ★系統ごとのプリント（2026-10-15 ユーザーと決めた。前の planDay の組み方は残してある＝SYS_MODE を false にすると戻る）
//  - 2系統×2セット: セット1＝今週の回、セット2＝前の回の、×が多い系統を2つずつ。土曜はセット1だけ。日曜・祝日は3セット目＝過去の復習（5年上・テストの直し）
//  - 今週の回に×の系統がなくなったら、セット1は過去の回（前の回より古い回）の苦手な系統。塾の日は、セット1＝塾の問題（今までどおり）
//  - 1つの系統: 例題（一緒に）→ 類題（一人で）→ ×なら基本問題 → ×なら反復基本。前に◎の問題・小問は飛ばす。一人で◎が出たらその系統はおしまい
//  - プリントは系統ごとに 解説（easy_hyou.js の表で解くページ）→ 問題。表の箱は例題だけ（TOOL が "hi" の系統は表なし＝比だけ聞くので分数の逆で終わり）
const SYS_MODE = true;
const SYS_PER_SET = 2;
const TOOL = {"7:U4": "hi"};   // 系統ごとの道具。"hi"＝比だけ（表はいらない）。書いていない系統は表
const sysTool = (k, uid) => TOOL[k + ":" + uid] || "hyou";
// ★一人で◎が出た系統は、しばらく休ませる（2026-10-15 ユーザーと決めた「一人で◎が出たらその系統はおしまい」）
//  類題・基本問題・反復基本のどれかが、系統の最後の×より後に全部◎になっていて、それが CLEAR_DAYS 日以内なら、その系統は選ばない
const CLEAR_DAYS = 7;
function clearedRecently(n, u) {
  // ★1ページ目の例題（ヒントなし）が◎になったら休ませる（2026-10-16 ユーザー「一ページ目の例題（ノーヒントの例題）が〇になったときに」）
  //  例題の小問がぜんぶ最後に◎で、その◎が CLEAR_DAYS 日以内
  const m = MS[n], rei = u.steps.find(q => m.kind(q) === "例題"); if (!rei) return false;
  const so = SUB_ONLY[n] || {}, ix = rei.subs.map((_, i) => i).filter(i => !so[rei.id] || so[rei.id].includes(i));
  if (!ix.every(i => m.last(rei, i) && m.last(rei, i).ok)) return false;
  return ix.every(i => Date.now() - m.last(rei, i).t < CLEAR_DAYS * 864e5);
}
function weakUnits(n, avoid) {
  // ×が残っている系統を、×だった日の数が多い順に
  const m = MS[n]; if (!m || n >= 100) return [];
  const so = SUB_ONLY[n] || {};
  const okQ = q => so[q.id] ? so[q.id].every(i => m.subOk(q, i)) : m.itemOk(q);
  return m.UNITS.filter(u => !(OUT_UNIT[n] || []).includes(u.id) && !avoid.has(n + ":" + u.id))
    .map((u, ix) => { const ng = u.steps.filter(q => m.itemTried(q) && !okQ(q));
      return {k: n, u, ix, score: ng.reduce((a, q) => a + ngDaysOf(n, q), 0), ng: ng.length}; })
    .filter(x => x.ng > 0 && !clearedRecently(n, x.u)).sort((a, b) => b.score - a.score || a.ix - b.ix);
}
// ★基本問題は小問ごとに、使う考え方（例題の系統）で分ける（2026-10-15 ユーザー「基本問題が、例題の知識だけじゃ解けなかった」）
//  "kihonN": [小問0の系統, 小問1の系統, …]。反復基本（hanN）も同じ番号の基本問題にそろえる。書いていないものは問題の系統のまま
const SUB_SYS = {7: {"kihon2": ["U2", "U1"], "kihon3": ["U2", "U4"], "kihon1-4": ["U1"]}};
const baseId = id => id.startsWith("han") && !id.startsWith("hanren") ? "kihon" + id.slice(3) : id;
const subSys = (n, q, i) => ((SUB_SYS[n] || {})[baseId(q.id)] || [])[i] || (MS[n].UNIT_OF[q.id] || {}).id;
const KIHON_FIRST_FROM = "2026-11-05", KIHON2_FROM = "2026-11-06", KIHON3_FROM = "2026-11-07";
function ladder(n, u, set) {
  // ★1つの系統（2026-10-16 ユーザー）: 例題（問題だけ・まず一人で）→ 解き方＋穴埋め → 類題 → 例題をもう一度 → 同じ系統の基本問題（ほかの知識がいらないもの。無ければ類題をもう一度）
  const m = MS[n], so = SUB_ONLY[n] || {}, sys = u.id;
  const allSubs = q => q.subs.map((_, i) => i).filter(i => !so[q.id] || so[q.id].includes(i));
  const sysSubs = q => allSubs(q).filter(i => subSys(n, q, i) === u.id);
  const rei = u.steps.find(q => m.kind(q) === "例題"), rui = u.steps.find(q => m.kind(q) === "類題");
  const out = [];
  if (rei) out.push({k: n, id: rei.id, subs: allSubs(rei), set, how: "rei1", sys});
  if (rui) out.push({k: n, id: rui.id, subs: allSubs(rui), set, how: "rui", sys});
  if (rei) out.push({k: n, id: rei.id, subs: allSubs(rei), set, how: "rei2", sys});
  // 基本問題: この系統の考え方の小問がある基本問題（まだ◎でない小問がある問題を先に）。無ければ類題をもう一度
  const kihons = m.UNITS.flatMap(x => x.steps).filter(q => m.kind(q) === "基本問題" && sysSubs(q).length);
  const k0 = kihons.find(q => sysSubs(q).some(i => !m.subOk(q, i))) || kihons[0];
  // ★2026-10-22 から 例題をもう一度で終わり（ユーザー「例題→類題→例題までやってできなければ、もうやる気がしない」）。基本問題・類題をもう一度は出さない
  if (trialOn()) {
    // ★11/5 から 1問目は同じ系統の基本問題 → 類題 → 例題（2026-11-04 ユーザー「セット問題は1問目、例題ではなくて、基本問題」）。基本問題がない系統は今のまま
    // ★11/6 から 基本問題 → 類題 → 同じ系統の別の基本問題（まだ◎でない小問があるもの。無ければ2問）。例題は出さない（2026-11-06 ユーザー「基本→類題→基本でお願いします」）
    const reiOk = rei && allSubs(rei).every(i => m.last(rei, i) && m.last(rei, i).ok);
    // ★11/7〜 基本問題 → 類題（類題が 10/25 からずっと◎なら、例題を解き方ページを見ながら）→ 1問目の基本問題をやり直し（2026-11-06 ユーザー「とりあえずお勧めで」）
    if (todayKey() >= KIHON3_FROM && k0) { const rec = (q, i) => m.hist(q, i).filter(x => x.t >= KUMI_START).pop();
      const ruiOk = rui && allSubs(rui).every(i => rec(rui, i) && rec(rui, i).ok);
      const mid = rui && !ruiOk ? {k: n, id: rui.id, subs: allSubs(rui), set, how: "rui", sys} : rei ? {k: n, id: rei.id, subs: allSubs(rei), set, how: "together", sys} : rui ? {k: n, id: rui.id, subs: allSubs(rui), set, how: "rui", sys} : null;
      return [{k: n, id: k0.id, subs: sysSubs(k0), set, how: "kihon", sys}, ...(mid ? [mid] : []), {k: n, id: k0.id, subs: sysSubs(k0), set, how: "kihon2", sys}]; }
    if (todayKey() >= KIHON2_FROM && k0) { const k1 = kihons.find(q => q !== k0 && sysSubs(q).some(i => !m.subOk(q, i)));
      return [{k: n, id: k0.id, subs: sysSubs(k0), set, how: "kihon", sys}, ...(rui ? [{k: n, id: rui.id, subs: allSubs(rui), set, how: "rui", sys}] : []),
        ...(k1 ? [{k: n, id: k1.id, subs: sysSubs(k1), set, how: "kihon", sys}] : [])]; }
    if (todayKey() >= KIHON_FIRST_FROM && k0) return [{k: n, id: k0.id, subs: sysSubs(k0), set, how: "kihon", sys},
      ...(rui ? [{k: n, id: rui.id, subs: allSubs(rui), set, how: "rui", sys}] : []), ...(rei ? [{k: n, id: rei.id, subs: allSubs(rei), set, how: "rei1", sys}] : [])];
    // 基本問題がない系統は 類題 → 例題 の2問（2026-11-04 ユーザー「基本問題がなくてもせめて、類題から始めたら」）。11/6 から 前に◎の例題は出さない（類題だけ）
    // ★11/7〜 基本問題がない系統は 類題 → 同じ回の近い系統の類題 ×2（2026-11-06 ユーザー「類題→類題→類題」「近い系統の類題」）。近い＝例題の番号が近い順（次の番号を先に）
    if (todayKey() >= KIHON3_FROM && rui) { const ix = m.UNITS.indexOf(u), near = m.UNITS.map((x, j) => ({x, d: Math.abs(j - ix) * 2 - (j > ix ? 1 : 0)})).filter(o => o.x !== u).sort((a, b) => a.d - b.d)
        .map(o => o.x.steps.find(q => m.kind(q) === "類題")).filter(Boolean).slice(0, 2);
      return [rui, ...near].map(q => ({k: n, id: q.id, subs: allSubs(q), set, how: "rui", sys})); }
    if (todayKey() >= KIHON2_FROM && rui) return [{k: n, id: rui.id, subs: allSubs(rui), set, how: "rui", sys}, ...(rei && !reiOk ? [{k: n, id: rei.id, subs: allSubs(rei), set, how: "rei1", sys}] : [])];
    if (todayKey() >= KIHON_FIRST_FROM && rui && rei) return [{k: n, id: rui.id, subs: allSubs(rui), set, how: "rui", sys}, {k: n, id: rei.id, subs: allSubs(rei), set, how: "rei1", sys}];
    return out;
  }
  if (k0) out.push({k: n, id: k0.id, subs: sysSubs(k0), set, how: "kihon", sys});
  else if (rui) out.push({k: n, id: rui.id, subs: allSubs(rui), set, how: "rui2", sys});
  return out;
}
function reviewItems(set, limit) {
  // 過去の復習（日曜・祝日の3セット目）: テストの直し → 5年上の復習（前の planDay と同じ順）
  const out = []; let total = 0;
  const add = (k, p, subs) => { const w = itemW(k, p.id, subs.length); if (!subs.length || total + w > limit || out.some(o => o.k === k && o.id === p.id)) return; out.push({k, id: p.id, subs, set, how: "review"}); total += w; };
  Object.entries(TEST_FIX).forEach(([n, ids]) => { if (!MS[n]) return; ids.forEach(x => { const [id, si] = x.split("|"), p = MS[n].ITEMS[id]; if (!p) return;
    const subs = (si === undefined ? p.subs.map((_, i) => i) : [+si]).filter(i => !MS[n].subOk(p, i)); add(+n, p, subs); }); });
  const REVIEW_ORDER = [202, 204, 205, 206, 207, 208, 209, 203, 210, 201];
  REVIEW_ORDER.filter(n => MS[n]).forEach(n => candidates(n).forEach(c => add(n, c.p, c.p.subs.map((_, i) => i).filter(i => !MS[n].subOk(c.p, i)).slice(0, 2))));
  return out;
}
// ★一行問題（2026-10-15 ユーザー「過去の単元の一行問題…を何問かいれるのはどうでしょう」）: 毎日いちばん最初に ICHIGYO_PER_DAY 問
//  対象: 今週の回・前の回より古い回の 基本問題1(n)・反復基本1(n)、組分けの大問2。今週の回と前の回は系統の問題で出るので入れない
//  順: ×の問題 → まだ解いていない問題 → 前に◎だった問題の「同じ形で数がちがう」反復基本1（解いてから日がたった順）。同じ回からは1日1問
const ICHIGYO_PER_DAY = 4;
const ICHIGYO_SKIP = new Set(["3:han1-1"]);   // 画像に前の赤い書きこみがあり、答えが見えるかもしれない（2026-10-15）
// ★2026-10-25 ユーザー: 1〜2行で解ける系統は一行問題で何回も解き直す（多段の系統はセット）。セットには選ばない
const ICHI_UNITS = {6: ["U1", "U2", "U3"], 7: ["U1"], 8: ["U1"], 9: ["U1", "U2", "U4"]};
const isIchiUnit = (k, uid) => (ICHI_UNITS[k] || []).includes(uid);
// 解き直しの間かく: ×→次の日、◎→3日後、2回つづけて◎→7日後。まだ解いていない小問はすぐ
function ichiDue(m, q, i, now) {
  let h = m.hist(q, i); if (typeof d2Mode === "function" && d2Mode()) h = h.filter(x => x.t >= KUMI_START);   // ★大問2の日: 10/25 より前の◎×は見ない
  if (!h.length) return {due: 0, state: "todo"};
  const l = h[h.length - 1], d = 864e5, day0 = t => new Date(new Date(t).toDateString()).getTime();
  if (!l.ok) return {due: day0(l.t) + d, state: "ng", t: l.t};
  const two = h.length >= 2 && h[h.length - 2].ok;
  return {due: day0(l.t) + (two ? 7 : 3) * d, state: "ok", t: l.t};
}
function ichigyoItems(cur, prevN) {
  if (kumi2Mode()) return kumi2Items(cur, prevN);
  if (trialOn()) return ichigyoItems2(cur, prevN);
  return ichigyoItemsOld(cur, prevN);
}
// ★2026-10-25 ユーザー: セットの系統（第6〜9回・算数基礎にあるもの）が、あと2つクリア（例題が◎）したら
//  セットの日（授業の問題がない日）は「セット3つ＋一行問題8問（4問×2枚）」に切りかえる。10/25 の時点で残り9系統 → 7以下で切りかえ
const SET_BASE_REMAIN = 9, SET_SWITCH_AT = 7;
function setRemain() {
  let c = 0;
  [6, 7, 8, 9].forEach(n => { const m = MS[n]; if (!m) return;
    // クリア＝その系統の例題と類題が全部◎（10/25 にユーザーへ伝えた「残り9系統」と同じ数え方）
    m.UNITS.filter(u => !(OUT_UNIT[n] || []).includes(u.id) && !isIchiUnit(n, u.id)).forEach(u => {
      if (u.steps.some(q => ["例題", "類題"].includes(m.kind(q)) && !m.itemOk(q))) c++; }); });
  return c;
}
// ★2026-10-25 ユーザーが決めなおし: 切りかえは日付で。11/1〜11/10（組分けの週と旅行中）は毎日（火・土も）一行問題8問＋セット3つ。10/31までは今までどおり（一行4）
// ★10-27 ユーザー「セットが3つも進んだなら、セットを減らして一行問題を増やすに移行」→ 10/28 から前倒し。10/31（土・週テストの日）だけは今までどおり一行4だけ
const BIG_FROM = "2026-11-01", BIG_TO = "2026-11-10", BIG_SKIP = new Set(["2026-10-31"]);
const bigMode = () => trialOn() && todayKey() >= BIG_FROM && todayKey() <= BIG_TO && !BIG_SKIP.has(todayKey());
let ICHI_N = ICHIGYO_PER_DAY;   // その日の一行問題の数（planSystems が決める）
// 5年上の型（前回の組分けで落とした 約数・時計算・流水算・素因数分解）も一行問題の候補に（2026-10-25 ユーザー「これまでに習った全てが範囲」）
// ★10-25 ユーザー「組分けで平均を」→ 過去3回の組分けで大問2に毎回出た 場合の数・数列・食塩水・平均の速さ も足す（205 206 207 209 210）
//  ★同日 ユーザー「できていない範囲を重点的に」: 過去の組分けで落とした 往復の旅人算（第4回 4(1) 空らん）の 208 も。○だった 等差数列・差集め・通過算・水量 などは入れない
const UP5_ICHI = [201, 202, 203, 204, 205, 206, 207, 208, 209, 210];
// ★同日 ユーザー「できていた範囲も忘れていると思うので出してほしい。ただ、できていない範囲を重点的に」:
//  組分けで○だった 差集め算(212)・通過算(213)・水量の変化(214)・点の移動(215) も5年上の枠に。ただし回すのは少なめ（その回をやってから3日は、重点の回より後）
const UP5_LOW = [212, 213, 214, 215], UP5_ALL = [...UP5_ICHI, ...UP5_LOW];
function ichigyoItems2(cur, prevN) {
  const now = Date.now(), today0 = new Date(new Date().toDateString()).getTime();
  const cands = [];   // {k, q, si, st}
  const addQ = (n, q) => { const m = MS[n]; if (!m || m.skipped(q) || ICHIGYO_SKIP.has(n + ":" + q.id) || KINAI_AVOID_Q.has(n + ":" + q.id)) return;
    const so = (SUB_ONLY[n] || {})[q.id];
    q.subs.forEach((_, i) => { if (so && !so.includes(i)) return; const st = ichiDue(m, q, i, now); if (st.due <= today0 || st.state === "todo") cands.push({n, q, si: i, st}); }); };
  // 1) 1〜2行で解ける系統（第6〜9回の ICHI_UNITS）の 例題・類題・基本
  Object.entries(ICHI_UNITS).forEach(([k, us]) => { const m = MS[+k]; if (!m || +k > cur) return;
    m.UNITS.filter(u => us.includes(u.id)).forEach(u => u.steps.forEach(q => addQ(+k, q))); });
  // 2) 前からの一行問題（前の前より古い回の 基本問題1(n)・反復基本1(n)、組分けの大問2）
  KAI_LIST.filter(n => (n < 100 && n < cur && n !== prevN && !ICHI_UNITS[n]) || (n >= 100 && n < 200)).forEach(n => { const m = MS[n]; if (!m) return;
    const isOne = id => n < 100 ? /^(kihon|han)\d+-\d+$/.test(id) : /^t2-\d+$/.test(id);
    Object.values(m.ITEMS).filter(q => isOne(q.id)).forEach(q => addQ(n, q)); });
  // 3) 5年上（約数・時計算・流水算・素因数分解・場合の数・数列・食塩水・平均の速さ）の 基本問題
  UP5_ALL.forEach(n => { const m = MS[n]; if (!m) return; Object.values(m.ITEMS).filter(q => /^kihon/.test(q.id)).forEach(q => addQ(n, q)); });
  // 並び: ×（出す日が来た）→ まだ → ◎（出す日が来た・古い順）。1つの問題からは1日1小問
  // 前回の組分けで落とした5年上の型（約数・時計算・流水算）は、×のつぎに先に出す
  const rank = c => c.st.state === "ng" ? 0 : UP5_ALL.includes(c.n) ? 1 : c.st.state === "todo" ? 2 : 3;
  // 5年上は、いちばん長くやっていない回から（約数ばかり続かないように。10-25）
  const kaiT = {}; cands.forEach(c => { if (UP5_ALL.includes(c.n)) kaiT[c.n] = Math.max(kaiT[c.n] || 0, c.st.t || 0); });
  Object.keys(kaiT).forEach(n => { const m = MS[+n]; Object.values(m.ITEMS).forEach(q => q.subs.forEach((_, i) => { const l = m.last(q, i); if (l && l.t > kaiT[n]) kaiT[n] = l.t; })); });
  UP5_LOW.forEach(n => { if (n in kaiT) kaiT[n] = Math.max(kaiT[n], KUMI_START) + 3 * 864e5; });   // できていた型は少なめ
  cands.sort((a, b) => rank(a) - rank(b) || (rank(a) === 1 ? (kaiT[a.n] - kaiT[b.n]) || (a.n - b.n) : 0) || (a.st.t || 0) - (b.st.t || 0));
  const extra = [forcedIchigyo()].filter(Boolean).filter(e => !KINAI_AVOID_Q.has(e.k + ":" + e.id));
  const out = [], seen = new Set(extra.map(e => e.k + ":" + e.id));
  // 5年上と5年下で半分ずつ（8問なら4問ずつ。決まって出す問題は5年下に数える）（10-25 ユーザー「5年上〜下から幅広く」）
  //  ★ただし ×の問題（次の日に解き直す）が先。×が多い日も、5年上は最低 1問（8問の日は2問）残す（10-25 ×が枠に押し出されて出ていなかった）
  //  1日の中では同じ回から2問出さない（同じ単元ばかりにならないように）。片方が足りなければ、最後にもう片方で埋める
  const slots = ICHI_N - extra.length, up5Min = Math.max(1, Math.floor(ICHI_N / 4));
  const up5Max = Math.floor(ICHI_N / 2), dnMax = Math.max(0, ICHI_N - up5Max - extra.length); let up5N = 0, dnN = 0;
  const usedN = new Set(extra.map(e => e.k)), picked = [];
  const take = c => { seen.add(c.n + ":" + c.q.id); usedN.add(c.n); if (UP5_ALL.includes(c.n)) up5N++; else dnN++; picked.push(c); };
  // ★今の回（週テストの範囲）から2問、のこりは復習（2026-10-28 ユーザー「一行問題は9回から二問、復習から二問」）
  let curN = 0; for (const c of cands) { if (curN >= 2 || picked.length >= slots) break; if (c.n !== cur || seen.has(c.n + ":" + c.q.id)) continue; take(c); curN++; }
  for (const c of cands) { if (c.st.state !== "ng") break; if (picked.length >= slots - Math.max(0, up5Min - up5N)) break;
    if (seen.has(c.n + ":" + c.q.id) || usedN.has(c.n)) continue; take(c); }
  for (const pass of [0, 1, 2]) for (const c of cands) { if (picked.length >= slots) break; if (seen.has(c.n + ":" + c.q.id)) continue;
    const up5 = UP5_ALL.includes(c.n);
    if (pass < 2 && (up5 ? up5N >= up5Max : dnN >= dnMax)) continue;
    if (pass === 0 && usedN.has(c.n)) continue;
    take(c); }
  // 最初の1問は前に◎の問題（つまずかないものから。2026-10-21）。選んだ中にあれば先頭へ（そのために枠は取らない）
  const okI = picked.findIndex(c => c.st.state === "ok"); if (okI > 0) picked.unshift(picked.splice(okI, 1)[0]);
  picked.forEach(c => out.push({k: c.n, id: c.q.id, subs: [c.si], set: 0, how: "ichigyo"}));
  out.splice(Math.min(1, out.length), 0, ...extra);
  return out;
}
// ★組分けの大問2の本番形式（2026-10-30 ユーザー「一行問題8問を、組分けの大問2の本番形式にする」）: 一行問題8問を、本番と同じ (1)〜(8)・問題2枚（4問ずつ）＋解答用紙1枚に
//  KUMI2_FROM の日から KUMI2_TO まで（BIG_SKIP の日は除く）。中身は4つの枠から（数は KUMI2_QUOTA。案・ユーザー確認中）
//   A 組分け⑦の範囲（第6〜10回）の一行題 ／ B 前の組分けで落とした型（約数・時計算・流水算・素因数分解・往復の旅人算）
//   C 組分けの大問2に毎回出る型（場合の数・数列・食塩水・平均の速さ）／ D 組分け⑥の大問2で×だった問題の解き直し
let KUMI2_FROM = "2026-10-30", KUMI2_TO = "2026-11-10";   // ★2026-10-30 ユーザー「今日の分をこの8問＋セット3つで」→ 今日から（10/31 は BIG_SKIP で一行4のまま）
// ★2026-10-31 ユーザー「はい」（旅行の紙と同じ分け方に）: A 第6〜10回 3・B と C（5年上）あわせて2・E 5年下 第1〜5回 2・D 組分け 1
//   前回の組分けでは前の範囲（5年上）が大問2に出たので、5年下 第1〜5回も入れる。第6〜10回はセットでもやるので少なめ
const KUMI2_QUOTA = {A: 3, B: 1, C: 1, E: 2, D: 1};   // ★5年上は B から1問・C から1問（2026-10-31 ユーザー。合わせて2問だと B ばかりで C が10日で1問だった）
const KUMI2_QG = g => g;
const KUMI2_E = [1, 2, 3, 4, 5], KUMI2_E_SKIP = new Set(["3:han1-1"]);   // 3-反1(1) は赤い書きこみ
const KUMI2_SKIP = new Set(["202:kihon4"]);
// ★大問2の日は 組分け⑥の大問2(8)（3量のつるかめ算）を出さない（2026-11-04 ユーザー「はい」。大問2の(7)(8)は正答率が低く、組分けでは飛ばしてよい型。11/2〜11/4 と3回×）
const D2_SKIP = new Set(["106:t2-8"]);   // 画像に前の赤い書きこみ（日付・印）が多い（2026-10-30 見本で気づいた）
const SKIP_1107 = new Set(["106:t2-5", "106:t2-6"]);   // ★11/7 は組分け⑥2(5)(6)を外して入れかえ（2026-11-06 ユーザー。11/6 と同じ）
const KUMI2_B = [201, 202, 203, 204, 208], KUMI2_C = [205, 206, 207, 209, 210];
// ★組分けの大問2の日（11/4〜11/7。2026-11-03 ユーザー「流水算などを入れつつ組分けの大問2が取れるように」「◎×は組分けの対策が始まってから（10/25〜）」）
//  一行8問＝ ×のやり直し2まで → 大問2の単元を回ごとに順番に4〜5問（10/25 から まだ → × → ◎で日がたった順）→ のこりは 組分け⑥・第6〜9回の一行。
//  単元の順: 前の組分け（第4〜6回）の大問2で落とした型が先。◎×は 10/25 以降の記録だけで見る（それより前の◎は「まだ」と同じ）
// ★11/8（組分けの日）も大問2寄り・数はふだんどおり（2026-11-06 ユーザー「11/8も大問2寄り」「ふだんどおり」）
const D2_FROM = "2026-11-04", D2_TO = "2026-11-08", D2_NG_MAX = 2, D2_MIN = 4, D2_MAX = 5;
const D2_KAI = [203, 202, 205, 206, 207, 209, 210, 201, 204, 208, 213, 214, 212, 215];   // 流水・時計・場合の数×2・数列・濃さ・平均の速さ・約数×2・旅人算・通過算・水量・差集め・点の移動
const d2Mode = () => kumi2Mode() && todayKey() >= D2_FROM && todayKey() <= D2_TO;
const kumi2Mode = () => trialOn() && todayKey() >= KUMI2_FROM && todayKey() <= KUMI2_TO && !BIG_SKIP.has(todayKey());
// ★大問2の日の一行8問（kumi2Items から）
function kumi2D2(cands, picked, seen, usedN, take, cur) {
  const has = c => seen.has(c.n + ":" + c.q.id), d2 = c => D2_KAI.includes(c.n), cnt = f => picked.filter(f).length;
  const st = c => ({ng: 0, todo: 1, ok: 2})[c.st.state], lv1 = c => /^(kihon|han)1(-|$)/.test(c.q.id);
  // 1) ×のやり直し（新しい×から）2問まで
  for (const c of cands.filter(x => x.st.state === "ng").sort((a, b) => (b.st.t || 0) - (a.st.t || 0))) { if (picked.length >= D2_NG_MAX) break; if (!has(c)) take(c); }
  // 2) 大問2の単元を回ごとに順番に（D2_MAX まで）。回の順は D2_KAI。1日に同じ回からは1問（足りなければ2周め）。回の中は まだ → × → ◎で日がたった順
  //    回の順: 10/25 から一度も解いていない回 → 最後に解いた日が古い回（4日でひと通り回るように）。同じなら D2_KAI の順
  const lastK = n => Math.max(0, ...Object.values(MS[n].ITEMS).flatMap(q => q.subs.map((_, i) => { const l = MS[n].last(q, i); return l && l.t >= KUMI_START ? l.t : 0; })));
  const order = [...D2_KAI].filter(n => MS[n]).sort((a, b) => lastK(a) - lastK(b) || D2_KAI.indexOf(a) - D2_KAI.indexOf(b));
  for (const pass of [0, 1]) for (const n of order) { if (cnt(d2) >= D2_MAX || picked.length >= 8) break;
    if (pass === 0 && picked.some(x => x.n === n)) continue;
    // ★基本1は大問2よりやさしい（2026-11-04 ユーザー「1行問題がやさしすぎる。組分けの大問2を見て」）。例題・類題・基本2から先を使う。
    //   基本1しかない回（212〜215）は番号の大きい（あとの）問題から。小問はあとの小問から（大問2は最後の小問の形）
    const pool = cands.filter(x => x.n === n && !has(x)), hard = pool.filter(x => !lv1(x)), num = x => +((x.q.id.match(/(\d+)$/) || [0, 0])[1]);
    const c = (hard.length ? hard : pool).sort((a, b) => st(a) - st(b) || (lv1(a) ? num(b) - num(a) : 0) || b.si - a.si || (a.st.t || 0) - (b.st.t || 0))[0]; if (c) take(c); }
  // 3) のこり: 組分け⑥（D）→ 第6〜9回・第10回の一行（A）→ 5下第1〜5回（E）。×→まだ→◎の順（cands の並び）
  for (const g of ["D", "A", "E"]) for (const c of cands) { if (picked.length >= 8) break; if (c.g === g && !has(c) && !d2(c)) take(c); }
  for (const c of cands) { if (picked.length >= 8) break; if (!has(c) && !(d2(c) && lv1(c) && c.st.state !== "ng")) take(c); }
  for (const c of cands) { if (picked.length >= 8) break; if (!has(c)) take(c); }
}
function kumi2Items(cur, prevN) {
  const now = Date.now(), today0 = new Date(new Date().toDateString()).getTime(), cands = [];
  const addQ = (g, n, q, onlyNg) => { const m = MS[n]; if (!m || m.skipped(q) || ICHIGYO_SKIP.has(n + ":" + q.id) || KUMI2_SKIP.has(n + ":" + q.id) || KINAI_AVOID_Q.has(n + ":" + q.id) || (d2Mode() && D2_SKIP.has(n + ":" + q.id)) || (todayKey() === "2026-11-07" && SKIP_1107.has(n + ":" + q.id))) return;
    const so = (SUB_ONLY[n] || {})[q.id];
    // ★きのう（か今日）その問題のどれかの小問を解いていたら、×の小問のほかは出さない（同じ問題が何日も続かないように。2026-10-31 ユーザー「はい」）
    const lastQ = Math.max(0, ...q.subs.map((_, i) => (m.last(q, i) || {}).t || 0)), recent = lastQ >= today0 - 86400000;
    q.subs.forEach((_, i) => { if (so && !so.includes(i)) return; const st = ichiDue(m, q, i, now); if ((recent || onlyNg) && st.state !== "ng") return; if (st.due <= today0 || st.state === "todo") cands.push({g, n, q, si: i, st}); }); };
  // A: 第6〜9回の1〜2行の系統（ICHI_UNITS）＋第10回（総合）の基本問題1(n)・3(n)
  Object.entries(ICHI_UNITS).forEach(([k, us]) => { const m = MS[+k]; if (!m) return; m.UNITS.filter(u => us.includes(u.id)).forEach(u => u.steps.forEach(q => addQ("A", +k, q))); });
  if (MS[10]) Object.values(MS[10].ITEMS).filter(q => /^kihon\d+-\d+$/.test(q.id)).forEach(q => addQ("A", 10, q));
  KUMI2_B.forEach(n => MS[n] && Object.values(MS[n].ITEMS).filter(q => /^kihon/.test(q.id)).forEach(q => addQ("B", n, q)));
  KUMI2_C.forEach(n => MS[n] && Object.values(MS[n].ITEMS).filter(q => /^kihon/.test(q.id)).forEach(q => addQ("C", n, q)));
  if (d2Mode()) D2_KAI.forEach(n => MS[n] && Object.values(MS[n].ITEMS).filter(q => !q.nankan && !(/^kihon/.test(q.id) && (KUMI2_B.includes(n) || KUMI2_C.includes(n)))).forEach(q => addQ(n >= 212 ? "L" : KUMI2_B.includes(n) ? "B" : "C", n, q)));
  // D: 組分け⑥の大問2で、まだ◎になっていない問題（×→まだ解いていない）。◎の問題も日がたったら
  if (MS[106]) Object.values(MS[106].ITEMS).filter(q => /^t2-\d+$/.test(q.id)).forEach(q => addQ("D", 106, q));
  // E: 5年下 第1〜5回の基本問題1(n)・反復基本1(n)（旅行用の一行問題の冊子の E と同じ）
  KUMI2_E.forEach(n => MS[n] && Object.values(MS[n].ITEMS).filter(q => /^(kihon|han)\d+-\d+$/.test(q.id) && !q.nankan && !KUMI2_E_SKIP.has(n + ":" + q.id)).forEach(q => addQ("E", n, q)));
  // R: 5年下 第1〜10回の 基本問題1(n)・反復基本1(n)・1〜2行の系統で ×のもの。上の枠に入っていなくても、×ならやり直しに出す
  //  （2026-11-01 ユーザー。10/31 に×だった 第8回 基本1-2 が、旅行中の枠の外で二度と出なくなっていた）
  KAI_LIST.filter(n => n >= 1 && n <= 10).forEach(n => MS[n] && Object.values(MS[n].ITEMS).filter(q => /^(kihon|han)\d+-\d+$/.test(q.id) && !q.nankan && !KUMI2_E_SKIP.has(n + ":" + q.id)).forEach(q => addQ("R", n, q, true)));
  Object.entries(ICHI_UNITS).forEach(([k, us]) => { const m = MS[+k]; if (!m) return; m.UNITS.filter(u => us.includes(u.id)).forEach(u => u.steps.forEach(q => addQ("R", +k, q, true))); });
  const rank = c => c.st.state === "ng" ? 0 : c.st.state === "todo" ? 1 : 2;
  cands.sort((a, b) => rank(a) - rank(b) || (a.st.t || 0) - (b.st.t || 0));
  const picked = [], seen = new Set(), usedN = new Set();
  const take = c => { seen.add(c.n + ":" + c.q.id); usedN.add(c.n); picked.push(c); };
  // ★×のやり直しを、枠より先に4問まで（2026-11-01 ユーザー「四問で」）。新しい×（きのう×）から。のこりを下の枠で選ぶ
  const NG_MAX = 4;
  if (d2Mode()) kumi2D2(cands, picked, seen, usedN, take, cur);
  else {
  for (const c of cands.filter(x => x.st.state === "ng").sort((a, b) => (b.st.t || 0) - (a.st.t || 0))) { if (picked.length >= NG_MAX) break; if (!seen.has(c.n + ":" + c.q.id)) take(c); }
  // 週テストの前（今の回が第9回のあいだ）は、A のうち2問を今の回から（8問をこえない）
  let curN = 0; for (const c of cands) { if (curN >= 2 || picked.length >= 8) break; if (c.g !== "A" || c.n !== cur || seen.has(c.n + ":" + c.q.id)) continue; take(c); curN++; }
  for (const g of ["D", "B", "C", "E", "A"]) { const want = KUMI2_QUOTA[g] - picked.filter(c => KUMI2_QG(c.g) === g).length;
    for (const pass of [0, 1]) for (const c of cands) { if (picked.length >= 8 || picked.filter(x => KUMI2_QG(x.g) === g).length >= KUMI2_QUOTA[g]) break;
      if (KUMI2_QG(c.g) !== g || seen.has(c.n + ":" + c.q.id) || (pass === 0 && usedN.has(c.n))) continue; take(c); }
    void want; }
  // 枠が埋まらなければ、ほかの枠の残りで8問に
  for (const c of cands) { if (picked.length >= 8) break; if (!seen.has(c.n + ":" + c.q.id)) take(c); }
  }
  // 並び: 本番のように、前に◎の問題（つまずかない）→ まだ → × の順
  picked.sort((a, b) => [2, 1, 0][rank(a)] - [2, 1, 0][rank(b)]);
  return picked.slice(0, 8).map(c => ({k: c.n, id: c.q.id, subs: [c.si], set: 0, how: "ichigyo", kumi: c.g}));
}
function ichigyoItemsOld(cur, prevN) {
  const lastT = (m, q) => Math.max(0, ...q.subs.map((_, i) => (m.last(q, i) || {}).t || 0));
  const ng = [], todo = [], old = [];
  KAI_LIST.filter(n => (n < 100 && n < cur && n !== prevN) || (n >= 100 && n < 200)).forEach(n => { const m = MS[n]; if (!m) return;
    const isOne = id => n < 100 ? /^kihon\d+-\d+$/.test(id) : /^t2-\d+$/.test(id);
    Object.values(m.ITEMS).filter(q => isOne(q.id) && !m.skipped(q) && !ICHIGYO_SKIP.has(n + ":" + q.id) && !KINAI_AVOID_Q.has(n + ":" + q.id)).forEach(q => {
      if (m.itemTried(q) && !m.itemOk(q)) ng.push({n, q});
      else if (!m.itemTried(q)) todo.push({n, q});
      else { const h = m.ITEMS["han" + q.id.slice(5)], t = Math.max(lastT(m, q), h ? lastT(m, h) : 0);
        old.push({n, q: h && !ICHIGYO_SKIP.has(n + ":" + h.id) && (!m.itemTried(h) || lastT(m, h) < lastT(m, q)) ? h : q, t}); } }); });
  old.sort((a, b) => a.t - b.t);
  const out = [], kais = new Set();
  // ★入れる問題（2026-10-24 ユーザー）: 週テストで落とした1〜2行の型（なおしのB）を1日1問、◎になるまで。数は増やさず4問のうち（計算は混ぜない。スペシャル計算は別に続ける）
  const extra = trialOn() ? [forcedIchigyo()].filter(Boolean).filter(e => !KINAI_AVOID_Q.has(e.k + ":" + e.id)) : [];
  const nFill = ICHIGYO_PER_DAY - extra.length;
  // お試しの3日: 最初の1問は前に◎の問題（つまずかないものから）
  for (const x of trialOn() && old.length ? [old[0], ...ng, ...todo, ...old.slice(1)] : [...ng, ...todo, ...old]) { if (out.length >= nFill) break; if (kais.has(x.n)) continue; kais.add(x.n);
    // ★答えは1問に1つ（小問は1つだけ）: ×の小問 → まだの小問 → 解いてから日がたった小問（2026-10-16 ユーザー「一行問題が多い。答えるのが4問くらいに」）
    const m = MS[x.n], q = x.q, ix = q.subs.map((_, i) => i), lt = i => (m.last(q, i) || {}).t || 0;
    const si = ix.find(i => m.last(q, i) && !m.subOk(q, i)) ?? ix.find(i => !m.last(q, i)) ?? ix.sort((a, b) => lt(a) - lt(b))[0];
    out.push({k: x.n, id: q.id, subs: [si], set: 0, how: "ichigyo"}); }
  out.splice(Math.min(1, out.length), 0, ...extra);   // 前に◎の1問（つまずかないもの）のあと
  return out;
}
// 週テストで落とした「1〜2行で解ける型」（なおしプリントのB。予習シリーズの同じ型）。上から1日1問、FORCE_FROM のあとに◎になったら次へ
//  週テスト第8回（10-24）: 3(2)→基本1(1)② ／ 3(3)→基本1(2)② ／ 3(5)→基本3(2) ／ 5→基本4(2)。(2)だけのときは紙に(1)の答えが出る
const ICHIGYO_FORCE = [[8, "kihon1-1", 1], [8, "kihon1-2", 1], [8, "kihon3", 1], [8, "kihon4", 1]], FORCE_FROM = new Date("2026-10-24T00:00:00").getTime();
function forcedIchigyo() {
  for (const [k, id, si] of ICHIGYO_FORCE) { const m = MS[k], q = m && m.ITEMS[id]; if (!q) continue;
    const l = m.last(q, si); if (l && l.ok && l.t > FORCE_FROM && !isToday(l.t)) continue;
    return {k, id, subs: [si], set: 0, how: "ichigyo"}; }
  return null;
}
// 計算を1問（使っていない。2026-10-24 ユーザーが取り消し「一行問題4問の中に計算を混ぜない」）
function calcIchigyo() {
  const wd = new Date().getDay(); if (wd === 2 || wd === 6) return null;
  const m = MS[CALC]; if (!m) return null;
  const lt = q => Math.max(0, ...q.subs.map((_, i) => (m.last(q, i) || {}).t || 0));
  const qs = Object.values(m.ITEMS).filter(q => !m.skipped(q));
  const q = qs.find(q => m.itemTried(q) && !m.itemOk(q)) || qs.find(q => !m.itemTried(q)) || qs.sort((a, b) => lt(a) - lt(b))[0]; if (!q) return null;
  const ix = q.subs.map((_, i) => i), si = ix.find(i => m.last(q, i) && !m.subOk(q, i)) ?? ix.find(i => !m.last(q, i)) ?? ix.sort((a, b) => ((m.last(q, a) || {}).t || 0) - ((m.last(q, b) || {}).t || 0))[0];
  return {k: CALC, id: q.id, subs: [si], set: 0, how: "ichigyo"};
}
const SYS_COUNT = 4;
// ★3日だけのお試し（2026-10-21〜23。司令塔経由でユーザー承認「なかなか子供がやる気にならず」）:
//  1日 約8問＝1枚目 一行問題4問（最初の1問は前に◎の問題）、2枚目 系統1つ（例題→類題→例題をもう一度→基本。できたところでおしまい。ユーザー「どのみち途中でできていれば終わりなので残して」）
//  塾の日も同じ形（塾の問題は、今週の回のその日の系統として出す）。各ページの下に「おしまい」。系統の先頭に「先に動画を見よう」
//  ★2026-10-21 からこれが毎日の形（ユーザー「子供に聞いたところ、やっぱり動画を見たい…一行問題＋動画の問題＋いつものセットを4問に」）:
//   一行問題4問 ＋ 動画の問題（予習ナビの授業動画で扱う塾の問題。①が済んだら②。両方済んだら無し）＋ 系統1つ（例題→類題→例題をもう一度→基本）
//  前の形（4系統）に戻すときは TRIAL_FROM を先の日にする（記録はさわらない）
const TRIAL_FROM = "2026-10-21";
const trialOn = () => todayKey() >= TRIAL_FROM;
const sysVideo = (k, sys) => { const m = MS[k], u = m && m.UNITS.find(x => x.id === sys); const rei = u && u.steps.find(q => m.kind(q) === "例題");
  const v = rei && ((window.VIDEOS || {})[k] || {})[rei.id]; return v && v.id ? {no: rei.no, len: v.len || "", url: v.url} : null; };
const probVideo = (k, id) => { const v = ((window.VIDEOS || {})[k] || {})[id]; return v && v.id ? {len: v.len || "", url: v.url} : null; };
// ▶動画のボタン（data-vid）を押すと、画面の上に動画を出す（2026-10-21 ユーザー「動画へのリンクではないんですか？」）
//  一覧は記録が変わるたびに描き直すので、動画は一覧の外（body の上）に出す
document.addEventListener("click", ev => { const b = ev.target.closest && ev.target.closest("[data-vid]"); if (!b) return; ev.preventDefault(); ev.stopPropagation();
  let ov = document.getElementById("vidov"); if (ov) ov.remove();
  ov = document.createElement("div"); ov.id = "vidov"; ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px";
  ov.innerHTML = `<video controls autoplay playsinline style="max-width:100%;max-height:80vh;background:#000"></video><button class="primary" style="margin-top:12px">とじる</button>`;
  ov.querySelector("video").src = furl(b.dataset.vid); ov.querySelector("button").onclick = () => ov.remove(); document.body.appendChild(ov); }, true);
const PRIO_SYS = ["6:U7", "7:U4", "7:U6"];   // 週テスト第7回（10/17）でできなかった: 平均の速さ・追いこしの速さの比・グラフ
const PRIO_FROM = new Date("2026-10-19T12:00:00").getTime();
function prioDone(n, u) {
  const m = MS[n], rei = u.steps.find(q => m.kind(q) === "例題"); if (!rei) return true;
  const so = SUB_ONLY[n] || {}, ix = rei.subs.map((_, i) => i).filter(i => !so[rei.id] || so[rei.id].includes(i));
  return ix.every(i => { const l = m.last(rei, i); return l && l.ok && l.t > PRIO_FROM; });
}
// ★機内用の1日分（2026-10-22。旅行 10/31〜11/10 の行き帰りの機内はネットがなくアプリが開けない）: 今日の系統・一行問題と重ならない1日分を先に作って印刷する
let KINAI_AVOID = new Set(), KINAI_AVOID_Q = new Set(), kinai = null;   // kinai = settings/kinai {items, t, from}
async function makeKinai() {
  KINAI_AVOID = new Set((day && day.items || []).filter(e => e.sys).map(e => e.k + ":" + e.sys)); KINAI_AVOID_Q = new Set((day && day.items || []).filter(e => e.how === "ichigyo").map(e => e.k + ":" + e.id));
  let items; try { items = sortList(planDay()); } finally { KINAI_AVOID = new Set(); KINAI_AVOID_Q = new Set(); }
  kinai = {items, t: Date.now(), from: todayKey()};
  if (db) { try { await db.doc("settings/kinai").set(kinai); } catch (e) {} }
  await makePdf({entries: entriesOf(items), name: `算数プリント_機内用_${todayKey()}.pdf`, msg: "機内用の1日分を保存しました。印刷して持っていこう。"});
}
// ★オフライン用ファイル（2026-11-08 ユーザー「オフラインファイルを作成するを押すと作られる」「ファイルは2日で」）
//  1日目＝今日のプリント、2日目＝機内用と同じ作り（1日目の系統・一行問題と重ならない）。問題のデータ・絵・今の記録を1つの JSON に入れる
//  入れ物ページ（GitHub Pages の sansu-offline。問題は入っていない）に読み込むと、ネットなしで同じ画面が使える。設計: 回答_オフラインで使う仕組み_2026-11-08.md
let offPrev = null;   // {d1, d2}（作る前に親に見せる2日分）
const offItem = e => Object.assign({k: e.k, id: e.id, subs: e.subs}, typeof e.ord === "number" ? {ord: e.ord} : {}, typeof e.set === "number" ? {set: e.set} : {}, e.rev ? {rev: e.rev} : {}, e.how ? {how: e.how} : {}, e.sys ? {sys: e.sys} : {}, e.han ? {han: true} : {}, e.sno ? {sno: e.sno} : {});
const nextDate = s => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
function offPreview() {
  if (!day || !day.items.length) { dayMsg = "先に今日のプリントを作ってね（それが1日目になります）。"; return renderToday(); }
  KINAI_AVOID = new Set(day.items.filter(e => e.sys).map(e => e.k + ":" + e.sys)); KINAI_AVOID_Q = new Set(day.items.filter(e => e.how === "ichigyo").map(e => e.k + ":" + e.id));
  let items; try { items = sortList(planDay()); } finally { KINAI_AVOID = new Set(); KINAI_AVOID_Q = new Set(); }
  offPrev = {d1: {date: day.date, created: day.created || Date.now(), items: day.items.map(offItem)}, d2: {date: nextDate(day.date), created: Date.now(), items: sortList(items.map(offItem))}};
  renderToday();
}
function offListHtml(d, label) {
  return `<p><b>${label}（${esc(d.date.slice(5).replace("-", "/"))}・${d.items.length}問）</b><br>` + d.items.map((e, i) => { const p = MS[e.k] && MS[e.k].ITEMS[e.id];
    return `${i + 1}. ${esc(kaiName(e.k))} ${esc(p ? p.no : e.id)}${e.subs.length < ((p && p.subs) || []).length ? "（" + e.subs.map(j => j + 1).join("・") + "）" : ""}`; }).join("<br>") + `</p>`;
}
async function makeOffline() {
  await capReady; if (!downloads) { dayMsg = "この画面では保存できません。ブラウザで claude.ai を開いてね。"; return renderToday(); }
  const {d1, d2} = offPrev; dayBusy = true; dayMsg = "オフライン用ファイルを作っています…"; renderToday();
  try {
    const files = {}, base = u => u.split("?")[0].replace(/^\/?_blob\//, "");
    const want = /(^|\/)(data_|keys|figs_|lecture_)[^\/]*\.js$/;
    const urls = [...document.scripts].map(s => s.getAttribute("src") || "").filter(u => want.test(base(u)));
    (window.HEAVY || []).forEach(u => urls.push(furl(u)));
    // 絵の束: 2日分の問題（と答えの絵）が入っている束だけ
    const man = window.IMGMAN || {f: [], m: {}}, need = new Set(), ids = new Set([...d1.items, ...d2.items].map(e => e.k + "/" + e.id));
    for (const [kk, i] of Object.entries(man.m)) if (ids.has(kk.replace(/\/a_(.*)_\d+$/, "/$1"))) need.add(i);
    need.forEach(i => urls.push(furl(man.f[i])));
    let n = 0;
    for (const u of urls) { const r = await fetch(u); if (!r.ok) throw new Error("読めないファイル: " + base(u)); files[base(u)] = await r.text(); if (++n % 5 === 0) { dayMsg = `オフライン用ファイルを作っています…（${n}/${urls.length}）`; renderToday(); } }
    const ls = {"sansu-step-kai": String(KAI_NO), "sansu-step-skip": JSON.stringify([...SKIP]), "sansu-step-settings": JSON.stringify(SETTINGS)};
    KAI_LIST.forEach(k => { ls[lsRec(k)] = JSON.stringify(recOf(k)); });
    const js = JSON.stringify({app: "sansu-step", kind: "offline", v: 1, created: Date.now(), days: [d1, d2], files, ls});
    await downloads.save({filename: `算数_オフライン_${d1.date.slice(5)}と${d2.date.slice(5)}.json`, data: new Blob([js], {type: "application/json"})});
    dayMsg = `保存しました（${(js.length / 1048576).toFixed(1)}MB）。iPad のホーム画面の「算数オフライン」で、このファイルを読み込んでね。`; offPrev = null;
  } catch (e) { dayMsg = e && e.code === "declined" ? "保存をやめました。" : "作れませんでした: " + ((e && e.message) || e); }
  dayBusy = false; renderToday();
}
// オフラインでつけた記録を足す（足すだけ。消さない・上書きしない。同じ問題の同じ時刻の記録は2回入れない）
let offRecs = null;   // 読み込んだ記録ファイル（足す前に親に見せる）
function offRecCount(o) { let add = 0, ok = 0; for (const [k, m] of Object.entries(o.recs || {})) for (const [key, arr] of Object.entries(m)) { const have = new Set((recOf(+k)[key] || []).map(x => x.t)); arr.forEach(x => { if (!have.has(x.t)) { add++; if (x.ok) ok++; } }); } return {add, ok}; }
async function offRecLoad(file) {
  try { const o = JSON.parse(await file.text()); if (!o || o.app !== "sansu-step" || o.kind !== "recs") throw new Error("算数オフラインの記録ファイルではありません");
    offRecs = o; const c = offRecCount(o); dayMsg = c.add ? "" : "足す記録はありませんでした（もう入っています）。"; if (!c.add) offRecs = null; }
  catch (e) { offRecs = null; dayMsg = "読めませんでした: " + ((e && e.message) || e); }
  renderToday();
}
async function offRecMerge() {
  const o = offRecs; offRecs = null; let add = 0;
  for (const [ks, m] of Object.entries(o.recs || {})) { const k = +ks; if (!KAI_LIST.includes(k)) continue; const R = recOf(k);
    for (const [key, arr] of Object.entries(m)) { const before = R[key] || [], have = new Set(before.map(x => x.t)), extra = arr.filter(x => x && typeof x.t === "number" && !have.has(x.t));
      if (!extra.length) continue; const after = before.concat(extra).sort((a, b) => a.t - b.t); add += extra.length;
      if (window.logRecChange) logRecChange(k, key, before.length ? before : null, after, "オフラインの記録を足す");
      R[key] = after; if (k !== KAI_NO) RECS[k] = R;
      try { localStorage.setItem(lsRec(k), JSON.stringify(R)); } catch (e) {}
      if (db) { try { await db.doc(recc(k) + "/" + key).set({tries: after}); } catch (e) {} } } }
  for (const [date, marks] of Object.entries(o.rei2 || {})) { if (!marks || !Object.keys(marks).length) continue;
    if (db) { try { const d = await db.doc("rei2rec/" + date).get(); const old = d.exists && d.data().marks || {}; await db.doc("rei2rec/" + date).set({marks: Object.assign({}, marks, old), t: Date.now()}); } catch (e) {} } }
  dayMsg = `オフラインの記録を ${add} 件 足しました。`; render();
}
function planSystems() {
  const cur = SETTINGS.cur, d = new Date(), wd = d.getDay(), holiday = wd === 0 || HOLIDAYS.has(todayKey());
  const prevN = KAI_LIST.filter(n => n < 100 && n < cur).sort((a, b) => b - a)[0];
  const older = KAI_LIST.filter(n => n < 100 && n < (prevN || cur)).sort((a, b) => b - a);
  const used = new Set(KINAI_AVOID), items = [];
  // ★2026-10-26 ユーザー「やったことない問題が2問もあるとやる気が起きない」: まだ例題を一度もやっていない系統は、セットに1日1つまで
  const isNewSys = w => !w.u.steps.some(q => MS[w.k].kind(q) === "例題" && q.subs.some((_, i) => MS[w.k].last(q, i)));
  let newN = 0; const recentLeft = [];
  const sysRecent = (k, u) => Math.max(0, ...u.steps.flatMap(q => q.subs.map((_, i) => (MS[k].last(q, i) || {}).t || 0))) >= new Date(new Date().toDateString()).getTime() - 2 * 864e5;
  const pickSys = (ns, max, ngOnly) => { const got = [];
    if (trialOn()) {   // ★2026-10-23 から: 回の順ではなく、いちばん長くやっていない×の系統から（今週の回ばかりになり、第6・7回の×が後回しになっていた。ユーザー承認）
      const lastT = w => Math.max(0, ...w.u.steps.flatMap(q => q.subs.map((_, i) => (MS[w.k].last(q, i) || {}).t || 0)));
      // 例題の無い系統（総合回の「第◯回の復習」）はセットにできないので外す（2026-10-25 第10回を入れたとき）
      // ★2026-10-25 ユーザー「昨日やってできなかった奴が優先」: 前にやった日（ふつうは昨日）に×だった系統を先に。そのあとは、いちばん長くやっていない順
      //  （前は .sort が注釈の中に入っていて、回の順のまま選ばれていた）
      const ngT = w => Math.max(0, ...w.u.steps.flatMap(q => q.subs.map((_, i) => { const l = MS[w.k].last(q, i); return l && !l.ok ? l.t || 0 : 0; })));
      // ★今の回で、まだ一度もやっていない系統も候補に（weakUnits は×のある系統だけなので、第9回 例題5が出てこなかった。2026-10-28）
      const fresh = MS[cur] ? MS[cur].UNITS.filter(u => !(OUT_UNIT[cur] || []).includes(u.id) && !used.has(cur + ":" + u.id)).map((u, ix) => ({k: cur, u, ix})).filter(isNewSys) : [];
      const all = [...ns.flatMap(n => weakUnits(n, used)), ...(ns.includes(cur) ? fresh : [])].filter(w => w.u.steps.some(q => MS[w.k].kind(q) === "例題") && !isIchiUnit(w.k, w.u.id));   // 一行問題で回す系統はセットにしない
      const today0 = new Date(new Date().toDateString()).getTime();
      const lastDay = Math.max(0, ...all.map(lastT).filter(t => t < today0));   // 今日より前で、いちばん最近やった日
      const day0 = lastDay ? new Date(new Date(lastDay).toDateString()).getTime() : today0;
      const isNg = w => { const t = ngT(w); return t >= day0 && t < today0; };
      all.sort((a, b) => (isNg(b) - isNg(a)) || (isNg(a) ? ngT(b) - ngT(a) : lastT(a) - lastT(b)));
      // ★組分けの週（旅行・11/1〜11/10）は、きのうとおととい やった系統を後ろに回す（2026-10-31 ユーザー「セット問題はもっと幅広く出してください」）
      //  半分まちがえると同じ3つが毎日出ていた（10日シミュレーション）。×が残っていれば3日目にまた出る。ほかに無ければ、やった系統でも出す
      //  きのう・おとといの系統はいったん外し（recentLeft）、復習の系統で埋めても足りないときだけ使う
      if (kumi2Mode()) { const recent = w => lastT(w) >= today0 - 2 * 864e5; all.filter(recent).forEach(w => { if (!recentLeft.some(x => x.k === w.k && x.u.id === w.u.id)) recentLeft.push(w); }); all.splice(0, all.length, ...all.filter(w => !recent(w))); }
      for (const w of all) { if (got.length >= max) break; if (ngOnly && !isNg(w)) break;
        if (isNewSys(w)) { if (newN >= 1) continue; newN++; }
        got.push(w); used.add(w.k + ":" + w.u.id); }
      return got; }
    for (const n of ns) { for (const w of weakUnits(n, used)) { if (got.length >= max) break; got.push(w); used.add(n + ":" + w.u.id); } if (got.length >= max) break; }
    return got; };
  const JK0 = jukuItems(cur), BIG = (bigMode() || kumi2Mode()) && !JK0.length;   // セット3つ＋一行8の日（大問2の本番形式の日も）
  ICHI_N = BIG ? 8 : ICHIGYO_PER_DAY;
  items.push(...ichigyoItems(cur, prevN));   // 一行問題（いちばん最初）
  // ★火曜と土曜は一行問題4問だけ（2026-10-24 ユーザー「火曜と土曜のスペシャル計算をやめて、代わりに一行問題に」。土は週テスト＋一行問題。セット・塾の問題は作らない）
  if (trialOn() && !BIG && (wd === 2 || wd === 6)) return items.map((e, i) => Object.assign(e, {ord: i + 1}));
  // 塾の日は塾の問題（テキストの順）
  const JK = jukuItems(cur), TR = trialOn(), NS = TR && JK.length && wd !== 0 ? 1 : BIG ? 3 : SYS_COUNT;   // 2026-10-25 ユーザー: 平日は 授業の問題＋一行4＋セット1つ、日曜はセット4つ。授業の問題がない日は4つ（10-22「塾のない日は4セット」）   // 塾（動画）の問題がある日は系統1つ、無い日は4つ（2026-10-22 ユーザー「塾のない日は4セットです」）
  const jkItems = JK.map(e => ({k: e.k, id: e.id, subs: e.subs, set: 1, how: "juku", sys: (MS[e.k].UNIT_OF[e.id] || {}).id}));
  if (!TR) items.push(...jkItems);   // 新しい形では塾の問題はセットのあと（下）
  // 系統セット: 毎日 SYS_COUNT 系統（2026-10-19 ユーザー「4系統やりますよね？」）
  //  ★週テストでできなかった系統（PRIO_SYS）を先に。1ページ目の例題が PRIO_FROM より後に◎になるまで毎日入れる（2026-10-19 ユーザー「できていなかったところは明日から重点的に」）
  // ★昨日（前にやった日）に×だった系統は、週テストの系統（PRIO_SYS）よりも先（2026-10-25 ユーザー「昨日やってできなかった奴が優先」）
  const nsAll = [cur, ...(prevN ? [prevN] : []), ...older], ngFirst = TR ? pickSys(nsAll, NS, true) : [];
  const prio = PRIO_SYS.map(x => x.split(":")).filter(([k, uid]) => MS[+k] && MS[+k].UNITS.some(u => u.id === uid))
    .map(([k, uid]) => ({k: +k, u: MS[+k].UNITS.find(u => u.id === uid)})).filter(w => !prioDone(w.k, w.u) && !KINAI_AVOID.has(w.k + ":" + w.u.id) && !used.has(w.k + ":" + w.u.id) && !(kumi2Mode() && sysRecent(w.k, w.u))).slice(0, NS - ngFirst.length);   // 組分けの週は、きのう・おととい やった系統は週テストの系統でも後回し（2026-10-31）
  prio.forEach(w => used.add(w.k + ":" + w.u.id));
  const rest = pickSys(nsAll, Math.max(0, NS - ngFirst.length - prio.length));
  [...ngFirst, ...prio, ...rest].forEach(w => items.push(...ladder(w.k, w.u, 2)));
  // ★組分けの週: ×の系統だけで3つにならない日は、前に◎になって日がたった系統（第6〜10回）で埋める（2026-10-31 ユーザー「2」。全部◎だとセットの無い日が出ていた）
  //  1週間以上たった系統を先に、足りなければ3日以上たった系統。いちばん長くやっていない順。まだやったことのない系統は入れない
  if (kumi2Mode() && ngFirst.length + prio.length + rest.length < NS) {
    const today0 = new Date(new Date().toDateString()).getTime(), lastT = w => Math.max(0, ...w.u.steps.flatMap(q => q.subs.map((_, i) => (MS[w.k].last(q, i) || {}).t || 0)));
    const pool = KAI_LIST.filter(n => n >= 6 && n <= 10 && MS[n]).flatMap(n => MS[n].UNITS.map(u => ({k: n, u})))
      .filter(w => !(OUT_UNIT[w.k] || []).includes(w.u.id) && !used.has(w.k + ":" + w.u.id) && !isIchiUnit(w.k, w.u.id) && w.u.steps.some(q => MS[w.k].kind(q) === "例題") && !isNewSys(w) && !sysRecent(w.k, w.u))
      .sort((a, b) => lastT(a) - lastT(b));
    const need = NS - ngFirst.length - prio.length - rest.length;
    [...pool.filter(w => lastT(w) < today0 - 7 * 864e5), ...pool.filter(w => lastT(w) >= today0 - 7 * 864e5), ...recentLeft.filter(w => !used.has(w.k + ":" + w.u.id))].slice(0, need)
      .forEach(w => { used.add(w.k + ":" + w.u.id); items.push(...ladder(w.k, w.u, 2)); });
  }
  // セット3: 日曜・祝日は過去の復習
  if (holiday && !TR) items.push(...reviewItems(3, SET_SIZE));
  // 系統ごとに番号（sno）とセット番号を分ける。一覧の見出しもページも系統ごとに区切れるように
  const ladderHow = ["rei1", "rui", "rei2", "kihon", "rui2", "kihon2", "together"], keys = [];
  items.forEach(e => { if (!ladderHow.includes(e.how)) return; const kk = e.k + ":" + e.sys; if (!keys.includes(kk)) keys.push(kk); e.sno = keys.indexOf(kk) + 1; e.set = 1 + e.sno; });
  // ★新しい形の並び: 一行問題 → セット（系統） → 塾（授業動画）の問題（2026-10-21 ユーザー「一行問題、セット問題、塾の問題の順番に」）
  // ★2026-10-25 から並びは 授業の問題 → 一行問題 → セット（ユーザー）。授業の問題は set -1 でいちばん前
  if (TR && jkItems.length) { jkItems.forEach(e => { e.set = -1; }); items.unshift(...jkItems); }
  return items.map((e, i) => Object.assign(e, {ord: i + 1}));
}
const entriesOf = items => (Array.isArray(items) ? items : []).map(e => ({k: +e.k, m: MS[+e.k], p: MS[+e.k] && MS[+e.k].ITEMS[e.id], rev: e.rev, how: e.how, sys: e.sys, han: e.han, kumi: e.kumi, set: e.set, sno: e.sno, subs: (Array.isArray(e.subs) ? e.subs : []).map(Number)}))
  .filter(e => e.p).map(e => ({...e, subs: e.subs.filter(i => i >= 0 && i < e.p.subs.length).length ? e.subs.filter(i => i >= 0 && i < e.p.subs.length) : e.p.subs.map((_, i) => i)}));
const dayEntries = () => entriesOf(day && day.items);
// 今日のプリントでの、この問題の小問（index.html が「(1)の答え」を画面に出すのに使う。2026-10-22）
window.todaySubsOf = (k, id) => { const e = day && Array.isArray(day.items) && day.items.find(x => +x.k === +k && x.id === id); return e ? e.subs.map(Number) : null; };
const subName = (p, i) => p.subs[i] || "";
// プリントに出す「これまで」: 長い順に候補を返す（入らなければ短いほうを使う）
function histLine(e) {
  const a = e.subs.flatMap(i => (recOf(e.k)[e.m.sk(e.p, i)] || []).map(x => ({x, sn: e.subs.length > 1 ? subName(e.p, i) : ""}))).filter(r => r.x.t > 1e11).sort((p, q) => p.x.t - q.x.t);
  if (!a.length) return ["はじめて"];
  // ★×の回数は「×だった日」の数（同じ日に(1)(2)とも×でも1回。2026-10-12 ユーザー「(1)と(2)を間違えたのはそれぞれ一回なので2回カウントはおかしい」）
  const md = t => { const d = new Date(t); return (d.getMonth() + 1) + "/" + d.getDate(); };
  const ng = new Set(a.filter(r => !r.x.ok).map(r => new Date(r.x.t).toDateString())).size;
  const marks = k => a.slice(-k).map(r => md(r.x.t) + r.sn + (r.x.ok ? "◎" : "×")).join(" ");
  const tail = ng ? `（×${ng}回）` : "";
  return [`これまで ${marks(5)}${tail}`, `これまで ${marks(3)}${tail}`, `これまで ${marks(1)}${tail}`, ng ? `×${ng}回` : "◎"];
}
// 授業動画（予習ナビ 算数基礎）がある問題: 算数基礎の抜粋（5年下/算数基礎/N_抜粋.pdf）に入っている例題・基本問題には全部動画がある（2026-10-11 ユーザー）。
// 回ごとに「動画が無い」ものだけを書く（"id" は問題ごと、"id|小問" はその小問だけ）。ここに無い回は、まだ調べていない（印を出さない）
const VIDEO_NO = {4: ["rei7", "rei8"], 5: [], 6: ["rei8", "rei7|1"], 7: ["rei5"], 8: ["rei3", "rei6"]};
const hasVideo = (k, id, subs) => { const no = VIDEO_NO[k]; if (!no || !/^(rei|kihon)\d/.test(id) || no.includes(id)) return false; return subs.some(i => !no.includes(id + "|" + i)); };
const VMARK = "▶動画";
const entryLabel = e => `${kaiName(e.k)} ` + e.p.no + (e.subs.length < e.p.subs.length ? " " + e.subs.map(i => subName(e.p, i)).join("") + "だけ" : "") + (hasVideo(e.k, e.p.id, e.subs) ? " " + VMARK : "");
// 数え方: 問題に w（何問と数えるか）があればそれを使う。秒で終わる小問がたくさんある問題（素因数分解など）を1問ずつ数えないため（2026-10-08 ユーザー）
const itemW = (k, id, nSubs) => { const p = MS[k] && MS[k].ITEMS[id]; if (!p || !p.w) return nSubs; return Math.max(1, Math.round(p.w * nSubs / p.subs.length)); };
const howTag = e => e.how && HOWS[e.how] ? `<span class="note">（${HOWS[e.how][0]}${e.sys && MS[e.k] && MS[e.k].UNITS.find(x => x.id === e.sys) ? "・" + MS[e.k].UNITS.find(x => x.id === e.sys).label + "の系統" : ""}${e.how === "together" ? "・◎×はつけない" : isAgain2(e) ? "・2回目は別に記録" : ""}）</span>` : "";
// ★「×だったら」の問題は、×のときだけ解くやり直し用。数は別に出す（2026-10-15 ユーザー「16問もないですよね？やりなおしをするってなったと思います」）
// 系統ごとのプリントは問題の数で数える（小問の数ではない）
const mainCount = es => { const b = es.filter(e => e.how === "ifng"); return es.some(e => e.how) ? `${es.length - b.length}問（×だったら＋${b.length}問）` : `${countSubs(es)}問`; };
const countSubs = es => es.reduce((a, e) => a + itemW(e.k, e.p ? e.p.id : e.id, e.subs.length), 0);
// 子どもの画面は「今日の分」だけ: 今日つけた◎×だけを出す（前の日の◎×は出さない。2026-10-08 ユーザー）
const isToday = t => t && new Date(t).toDateString() === new Date().toDateString();
const todayMarkK = (m, p, i) => { const l = m.last(p, i); return l && isToday(l.t) ? (l.ok ? "◎" : "×") : "・"; };
const markK = (m, p, i) => m.skipped(p) ? "－" : m.last(p, i) ? (m.subOk(p, i) ? "◎" : "×") : "・";
const triesK = (k, p, i) => recOf(k)[MS[k].sk(p, i)] || [];
const markToday = (k, m, p, i) => { if (m.skipped(p)) return "－"; const a = triesK(k, p, i), l = a[a.length - 1]; return l && isToday(l.t) ? (l.ok ? "◎" : "×") : "・"; };
const prevMark = (k, p, i) => { const a = triesK(k, p, i).filter(x => !isToday(x.t)), l = a[a.length - 1]; if (!l) return "";
  const d = new Date(l.t); return `<small class="prevm">前${l.ok ? "◎" : "×"}${d.getMonth() + 1}/${d.getDate()}</small>`; };
async function cycleToday(k, p, i) { const key = MS[k].sk(p, i), arr = triesK(k, p, i), l = arr[arr.length - 1], by = MODE === "child" ? "kid" : "hand";
  if (!l || !isToday(l.t)) return writeRec(k, key, arr.concat([{ok: true, t: Date.now(), by}]), "今日のプリント");
  if (l.ok) return writeRec(k, key, arr.slice(0, -1).concat([Object.assign({}, l, {ok: false, by})]), "今日のプリント");
  return writeRec(k, key, arr.length > 1 ? arr.slice(0, -1) : null, "今日のプリント"); }
let REI2 = {}, REI2_T = 0;   // 今日の2回目の例題の◎×・最後に書いた時刻
const r2key = (k, id, i) => k + ":" + id + ":" + i;
const isAgain2 = e => e.how === "rei2" || e.how === "kihon2";   // 同じ日の2回目（◎×は REI2 に別に記録。11/7〜 基本問題のやり直しも）
const r2mark = (k, id, i) => { const v = REI2[r2key(k, id, i)]; return v === true ? "◎" : v === false ? "×" : "・"; };
async function cycleRei2(k, id, i) {
  const kk = r2key(k, id, i), v = REI2[kk];
  if (v === undefined) REI2[kk] = true; else if (v === true) REI2[kk] = false; else delete REI2[kk];
  try { localStorage.setItem("sansu-step-rei2-" + todayKey(), JSON.stringify(REI2)); } catch (e) {}
  REI2_T = Date.now(); if (db) { try { await db.doc("rei2rec/" + todayKey()).set({marks: REI2, t: REI2_T}); } catch (e) {} }
}
try { REI2 = JSON.parse(localStorage.getItem("sansu-step-rei2-" + todayKey()) || "{}"); } catch (e) {}
// ★2回目の例題も、1回目と同じように問題の画面を開いて◎×をつける（2026-10-20 ユーザー「上の例題と下の例題の見た目と機能を合わせて」）
//  開くときに「2回目モード」にしておき、問題の画面の◎×は REI2 に入れる（rec* には書かない）
async function setRei2(k, id, i, ok) {
  REI2[r2key(k, id, i)] = ok;
  try { localStorage.setItem("sansu-step-rei2-" + todayKey(), JSON.stringify(REI2)); } catch (e) {}
  REI2_T = Date.now(); if (db) { try { await db.doc("rei2rec/" + todayKey()).set({marks: REI2, t: REI2_T}); } catch (e) {} }
}
const setRei2Mode = (k, id) => { try { if (k) localStorage.setItem("sansu-step-rei2mode", JSON.stringify({k, id, date: todayKey()})); else localStorage.removeItem("sansu-step-rei2mode"); } catch (e) {} };
const rei2Mode = () => { try { const v = JSON.parse(localStorage.getItem("sansu-step-rei2mode") || "null"); return v && v.date === todayKey() ? v : null; } catch (e) { return null; } };
window.rei2Active = p => { const v = rei2Mode(); return !!(v && v.k === KAI_NO && v.id === p.id); };
window.setRei2 = setRei2; window.r2mark = r2mark;
// 区切り（一行問題・塾のプリント・1問目・2問目…）ごとに分ける。how の無い日は前の形（セット）のまま
const STEP_LABEL = {rei1: "例題（まず一人で）", rui: "類題", rei2: "例題（もう一度）", kihon: "基本問題", rui2: "類題（もう一度）"};
function boxGroups(list) {
  const out = [];
  list.forEach(e => { const key = e.how === "ichigyo" ? "i" : e.how === "juku" ? "j" : e.sno ? "s" + e.sno : "x" + (e.set || 0);
    let g = out.find(x => x.key === key); if (!g) { g = {key, items: []}; out.push(g); } g.items.push(e); });
  return out;
}
function boxTitle(g) {
  const e = g.items[0], u = e.sys && MS[e.k] && MS[e.k].UNITS.find(x => x.id === e.sys);
  if (e.how === "ichigyo") return "一行問題";
  if (e.how === "juku") return "塾のプリント" + (e.k ? `　${kaiName(e.k)}` : "");
  if (e.sno) { const vd = null;   // 系統は塾の問題ではないので「先に動画を見よう」は出さない（2026-10-22 ユーザー）
    return `${e.sno}問目` + (u ? `　${kaiName(e.k)} ${u.label}の系統（${esc(u.name)}）` : "") + (vd ? `　<button class="link" data-vid="${esc(vd.url)}">▶ 先に動画を見よう（${esc(vd.no)}の解説 ${esc(vd.len)}）</button>` : ""); }
  return setName(e.set);
}
const rowName = e => STEP_LABEL[e.how] ? `${STEP_LABEL[e.how]}　${esc(e.p.no)}` : `${kaiName(e.k)} ${esc(e.p.no)}` + (e.how === "juku" && e.sys && MS[e.k] ? `<span class="note">（${(MS[e.k].UNITS.find(x => x.id === e.sys) || {}).label || ""}の系統）</span>` : "");
const rowVid = e => { const v = e.how === "juku" && trialOn() && probVideo(e.k, e.p.id); return v ? ` <button class="link" data-vid="${esc(v.url)}">▶ 動画 ${esc(v.len)}</button>` : ""; };
async function saveDay() {
  try { localStorage.setItem("sansu-step-dayAll", JSON.stringify(day)); } catch (e) {}
  if (db && day) { try { await db.doc(DAYC + "/current").set(day); } catch (e) {} }
}

// 始めた日の並びを新しい形（一行問題 → セット → 塾の問題）に。塾の問題のセット番号をセットのあとにする（記録はさわらない）
// ★今日の日付のプリントで、アプリの記録（db）から読んだあとだけ。端末に残っていた古い日のプリントで上書きした事故のため（2026-10-21）
let dayFromDb = false;
function jukuLast() {
  if (!day || !Array.isArray(day.items) || !trialOn() || !dayFromDb || day.date !== todayKey()) return;
  const jk = day.items.filter(e => e.how === "juku"), others = day.items.filter(e => e.how && e.how !== "juku" && e.how !== "ichigyo");
  if (!jk.length || !others.length) return;
  // 2026-10-25 から授業の問題はいちばん前（set -1）
  if (jk.every(e => (e.set ?? 0) < 0)) return;
  const ordMin = Math.min(...day.items.map(e => e.ord ?? 0));
  jk.forEach((e, i) => { e.set = -1; e.ord = ordMin - jk.length + i; }); sortList(day.items); saveDay();
}
// 子どもの画面: 今日のプリントの一覧。押すとその問題（答え合わせ・解説・◎×）が開く
function renderKid(el) {
  let h = `<div class="th"><h2>今日のプリント</h2><span class="note">${day && day.date && day.date !== todayKey() ? day.date.slice(5).replace("-", "/") + " に決めた問題" : todayLabel()}</span></div>`;
  if (!day) { el.innerHTML = h + `<p class="note">今日のプリントは、まだ用意されていません。おうちの人に用意してもらってね。</p>`; return; }
  jukuLast();
  const es = dayEntries();
  const done = es.filter(e => e.subs.every(i => { const l = e.m.last(e.p, i); return l && isToday(l.t); })).length;
  h += `<p class="note">${es.length}問のうち ${done}問 答え合わせずみ。問題を押して、答え合わせと解説をしよう。</p>`;
  if (es.some(e => e.how)) {
    h += `${es.some(e => e.how === "ichigyo" || (e.set || 0) >= 1) ? `<div class="row"><button class="primary" id="icsopen">今日の問題を画面で解く</button></div>` : ""}`;
    h += boxGroups(es).map(g => `<div class="tbox"><h3 class="lh">${boxTitle(g)}</h3><ul class="trows">${g.items.map(e => {
      if (isAgain2(e)) return `<li><button class="link" data-gok2="${e.k}|${e.p.id}">${rowName(e)}</button><span class="kst">${e.subs.map(i => r2mark(e.k, e.p.id, i)).join("")}</span></li>`;
      return `<li><button class="link" data-gok="${e.k}|${e.p.id}">${rowName(e)}</button>${rowVid(e)}<span class="kst">${e.subs.map(i => todayMarkK(e.m, e.p, i)).join("")}</span></li>`; }).join("")}</ul></div>`).join("");
    el.innerHTML = h;
    el.querySelectorAll("[data-gok]").forEach(b => b.onclick = () => { const [k, id] = b.dataset.gok.split("|"); setRei2Mode(null); goToAny(+k, id); });
    if (el.querySelector("#icsopen")) el.querySelector("#icsopen").onclick = icsOpen;
    el.querySelectorAll("[data-gok2]").forEach(b => b.onclick = () => { const [k, id] = b.dataset.gok2.split("|"); setRei2Mode(+k, id); goToAny(+k, id); });
    return;
  }
  h += `<ul class="klist">${es.map((e, j) => { try {
    const on = e.k === KAI_NO && e.p.id === curId;
    if (isAgain2(e)) return `<li><div class="kr2"><span class="kno">${MARU[j]}</span><span>${esc(entryLabel(e))}${howTag(e)}</span> ${e.subs.map(i => `<button class="cyc" data-cyc2="${e.k}|${e.p.id}|${i}">${esc(subName(e.p, i))}${r2mark(e.k, e.p.id, i)}</button>`).join("")}</div></li>`;
    const st = e.subs.map(i => todayMarkK(e.m, e.p, i)).join("");
    return `<li><button class="${on ? "on" : ""}" data-gok="${e.k}|${e.p.id}"><span class="kno">${MARU[j]}</span><span>${esc(entryLabel(e))}${howTag(e)}</span><span class="kst">${st}</span></button></li>`;
  } catch (err) { SHOWERR.push("kid " + e.k + ":" + e.p.id + " " + err.message); return ""; } }).join("")}</ul>`;
  el.innerHTML = h;
  el.querySelectorAll("[data-gok]").forEach(b => b.onclick = () => { const [k, id] = b.dataset.gok.split("|"); goToAny(+k, id); });
  el.querySelectorAll("[data-cyc2]").forEach(b => b.onclick = async () => { const [k, id, i] = b.dataset.cyc2.split("|"); await cycleRei2(+k, id, +i); renderKid(el); });
}
function kidNext(p) {
  const es = dayEntries(), r2 = rei2Mode() && window.rei2Active(p);
  const j = r2 ? es.findIndex(e => e.k === KAI_NO && e.p.id === p.id && isAgain2(e)) : es.findIndex(e => e.k === KAI_NO && e.p.id === p.id), nx = es[j + 1];
  setRei2Mode(nx && isAgain2(nx) ? nx.k : null, nx && isAgain2(nx) ? nx.p.id : null);
  // 次が2回目の例題なら一覧へ（問題の画面で◎×をつけると、1回目の記録に上書きされるため。一覧のボタンでつける）
  if (nx) goToAny(nx.k, nx.p.id); else { curId = null; resetWork(); render(); window.scrollTo(0, 0); }
}
// 図の説明を前もって作る（親が今日を始めたとき）。1問ずつ順に。保存先は index.html の図の説明と同じ
let prep = null;   // {done, total, fail}
function vizTargetOf(e) {
  const key = ((window.KEYS || {})[e.k] || {})[e.p.id];
  const t = key ? e.p : ((e.m.UNIT_OF[e.p.id] || {}).steps || [e.p])[0];
  return {t, key: ((window.KEYS || {})[e.k] || {})[t.id], ck: e.k + "_" + t.id};
}
async function hasViz(ck, t) {
  try { if (vizUsable(t, JSON.parse(localStorage.getItem("sansu-viz-" + ck) || "null"))) return true; } catch (e) {}
  if (db) { try { const d = await db.doc("viz/" + ck).get(); if (d.exists && d.data().json && vizUsable(t, JSON.parse(d.data().json))) { try { localStorage.setItem("sansu-viz-" + ck, d.data().json); } catch (e) {} return true; } } catch (e) {} }
  return false;
}
async function prepareViz() {
  if (!sample || prep && prep.running) return;
  const seen = new Set(), list = [];
  for (const e of dayEntries()) { const v = vizTargetOf(e); if (v.key && !seen.has(v.ck)) { seen.add(v.ck); list.push(v); } }
  prep = {done: 0, total: list.length, fail: 0, running: true}; renderToday();
  // 3問ずつ同時に作る
  let next = 0, stop = false;
  const one = async v => {
    if (await hasViz(v.ck, v.t)) return;
    try {
      let imgs = [];
      if (canImg && !v.t.fig) { try { imgs = [await (await fetch(await imgReady(v.t.img))).blob()]; } catch (e) {} }
      const d = await sample.json(vizPromptFor(v.t, v.key, "", imgs.length > 0), imgs.length ? {images: imgs} : {});
      if (lectOf(v.t)) d.lect = true;
      if (v.t.fig && v.t.fig.vizVer) d.vizVer = v.t.fig.vizVer;
      if (!vizUsable(v.t, d)) throw 0;
      const js = JSON.stringify(d);
      try { localStorage.setItem("sansu-viz-" + v.ck, js); } catch (e) {}
      if (db) { try { await db.doc("viz/" + v.ck).set({json: js, t: Date.now()}); } catch (e) {} }
    } catch (e) { prep.fail++; if (e && e.code === "rate_limited") stop = true; }
  };
  const worker = async () => { while (!stop && next < list.length) { const v = list[next++]; await one(v); prep.done++; renderToday(); } };
  await Promise.all([worker(), worker(), worker()]);
  prep.running = false; renderToday();
}
// 親が選ぶ: おすすめ（planDay）をもとに、外す・◎にする・足す
let preDraft = null;   // settings/draft の中身（担当が用意したもの）
let draft = null, lastDraftJs = null, draftSeen = false;   // [{k,id,subs}]（始める前の選択。この端末とアプリに保存）。draftSeen: アプリの下書きを1回読んだか
try { const v = localStorage.getItem("sansu-step-draft"); if (v) { draft = JSON.parse(v); lastDraftJs = v; } } catch (e) {}
function saveDraft() {
  const js = JSON.stringify(draft || []); if (js === lastDraftJs) return; lastDraftJs = js;
  try { localStorage.setItem("sansu-step-draft", js); } catch (e) {}
  // ★アプリの下書きを読む前は書かない（開いた直後に空で上書きして、用意した下書きが消えていた。2026-11-06）
  if (db && draftSeen) db.doc("settings/draft").set({items: draft || [], t: Date.now()}).catch(() => {});
}
const dueSubs = (m, p) => p.subs.map((_, i) => i).filter(i => !m.subOk(p, i));
// 今の今日の問題の一覧（始めたあとは day、始める前は候補）
const curList = () => day ? day.items : (draft || (draft = []));
const inToday = (k, id) => curList().some(e => e.k === k && e.id === id);
async function toggleToday(k, id) {
  const L = curList(), j = L.findIndex(e => e.k === k && e.id === id), m = MS[k], p = m.ITEMS[id];
  if (j >= 0) L.splice(j, 1);
  else { const subs = dueSubs(m, p); L.push({k, id, subs: subs.length ? subs : p.subs.map((_, i) => i)}); }
  lastAct = `${j >= 0 ? "外した" : "入れた"}：${kaiName(k)} ${p.no}`;
  sortList(L);
  if (day) { await saveDay(); if (j < 0) prepareViz(); }
  render();
}
// 並び順: テキスト（予習シリーズ）のページ順 → 演習問題集のページ順（同じページは上から）
function sortList(L) {
  const key = e => { const p = MS[e.k] && MS[e.k].ITEMS[e.id]; const c = (p && p.crop) || [0, 0];
    return [(p && p.src === "enshu") ? 1 : 0, c[0], c[1]]; };
  // ord があるもの（塾の順番などで並べた日）はその順番を先に。ord のないものはその後ろに本の順で（2026-10-07 ユーザー）
  const od = e => typeof e.ord === "number" ? e.ord : 1e9;
  // ★set（セットの番号）があれば、まずセットの順に（本の順で並べるとセットがまざり、4セットに分かれていた。2026-10-11）
  const st = e => typeof e.set === "number" ? e.set : 1e9;
  L.sort((a, b) => { const x = key(a), y = key(b); return st(a) - st(b) || od(a) - od(b) || x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
  return L;
}
// 小問1つだけを入れる／外す
async function toggleTodaySub(k, id, i) {
  const L = curList(), e = L.find(x => x.k === k && x.id === id);
  if (!e) L.push({k, id, subs: [i]});
  else { e.subs = e.subs.includes(i) ? e.subs.filter(x => x !== i) : [...e.subs, i].sort((a, b) => a - b); if (!e.subs.length) L.splice(L.indexOf(e), 1); }
  { const p = MS[k].ITEMS[id]; lastAct = `${subInToday(k, id, i) ? "入れた" : "外した"}：${kaiName(k)} ${p.no} ${subName(p, i)}`; }
  sortList(L);
  if (day) { await saveDay(); prepareViz(); }
  render();
}
const subInToday = (k, id, i) => curList().some(e => e.k === k && e.id === id && e.subs.includes(i));
window.inToday = inToday; window.toggleToday = toggleToday;
let pickOpen = null;   // 開いている回
// 問題の中身を、選ぶ画面のその場で開く（答えは出さない。2026-10-10 ユーザー「選択しても問題の中身を見ることができません」）
const PEEK = new Set();   // 中身を開いている問題 "回|id"
const peekBtn = (n, id) => { const o = PEEK.has(n + "|" + id);
  return `<button class="peekb${o ? " on" : ""}" data-peek="${n}|${id}" aria-expanded="${o}" title="問題の中身を見る（答えは出ません）">${o ? "▲中身" : "🔍中身"}</button>`; };
const peekHtml = (n, items) => items.filter(p => PEEK.has(n + "|" + p.id)).map(p =>
  `<figure class="peek"><figcaption>${kaiName(n)} ${esc(p.no)}<button class="ghost mini" data-peek="${n}|${p.id}">とじる</button></figcaption><img src="${imgSrc(p.img)}" alt="${esc(p.no)}の問題"></figure>`).join("");
const togglePeek = v => { PEEK.has(v) ? PEEK.delete(v) : PEEK.add(v); };
// 今日の紙の問題数を、画面の下にいつも出す（どこを見ていても、押したら何が起きたか分かるように。2026-10-10）
let lastAct = "";
function renderBar() {
  let b = document.getElementById("todaybar");
  const pk = typeof pickToday !== "undefined" && pickToday && typeof dashOpen !== "undefined" && dashOpen;
  if (MODE !== "parent" || (day && !pk)) { if (b) b.remove(); document.body.classList.remove("hasbar"); return; }
  if (!b) { b = document.createElement("div"); b.id = "todaybar"; b.setAttribute("role", "status"); document.body.append(b); }
  document.body.classList.add("hasbar");
  const L = curList().filter(e => MS[e.k] && MS[e.k].ITEMS[e.id]);
  b.innerHTML = `<span class="tbn">今日の紙：<b>${mainCount(L)}</b>（小問${L.reduce((a, e) => a + e.subs.length, 0)}）</span><span class="tba" aria-live="polite">${esc(lastAct)}</span><button class="ghost mini" id="tbtop">一覧へ</button>`;
  b.querySelector("#tbtop").onclick = () => document.getElementById("today").scrollIntoView({behavior: "smooth"});
}
window.renderBar = renderBar;
function pickerHtml() {
  const open = pickOpen ?? SETTINGS.cur;
  return `<div class="picker"><p class="note">押すと今日に入れる／もう一度で外す。(1)(2)…がある問題は小問ごとに選べます。📌が今日の問題です。「🔍中身」で問題の中身を見られます（答えは出ません）。</p>${KAI_LIST.map(n => { const m = MS[n];
    const SYM = {first: "◎", redo: "○", ng: "×", todo: "・", skip: "－"};
    const chip = p => { const st = p.subs.map((_, i) => m.subState(p, i)); const w = ["ng", "todo", "redo", "first", "skip"].find(k => st.includes(k)) || "todo";
      const lab = p.no.replace("基本問題", "基本").replace("練習問題", "練習");
      if (p.subs.length === 1) { const td = inToday(n, p.id);
        return `<span class="pitem"><button class="dchip s-${w}${td ? " intoday" : ""}" data-pick="${n}|${p.id}" aria-pressed="${td}">${td ? "📌" : ""}${esc(lab)} <b>${SYM[st[0]]}</b></button>${peekBtn(n, p.id)}</span>`; }
      // 小問が2つ以上: 小問ごとのボタン
      return `<span class="pgrp${inToday(n, p.id) ? " intoday" : ""}"><span class="pgl">${esc(lab)}</span>${p.subs.map((sn, i) => { const on = subInToday(n, p.id, i);
        return `<button class="dchip s-${st[i]}${on ? " on" : ""}" data-psub="${n}|${p.id}|${i}" aria-pressed="${on}">${on ? "📌" : ""}${esc(sn)}${SYM[st[i]]}</button>`; }).join("")}${peekBtn(n, p.id)}</span>`; };
    return `<details class="dk" data-pk="${n}" ${n === open ? "open" : ""}><summary>${kaiName(n)} ${esc(m.title.replace(/^(第\d+回|組分け\S*|5上第\d+回)\s*/, ""))}</summary>
      ${m.UNITS.map(u => `<div class="du"><div class="duh"><span>${esc(u.label)}　${esc(u.name)}</span></div><div class="chips">${[...u.steps, ...u.extra].map(chip).join("")}</div>${peekHtml(n, [...u.steps, ...u.extra])}</div>`).join("")}
      ${m.PRACTICE.length ? `<div class="du"><div class="duh"><span>練習問題・反復練習</span></div><div class="chips">${m.PRACTICE.map(chip).join("")}</div>${peekHtml(n, m.PRACTICE)}</div>` : ""}</details>`;
  }).join("")}</div>`;
}
function addOptions() {
  const inDraft = new Set(curList().map(e => e.k + ":" + e.id));
  return KAI_LIST.map(n => { const m = MS[n];
    const its = [...m.UNITS.flatMap(u => [...u.steps, ...u.extra]), ...m.PRACTICE].filter(p => !m.itemOk(p) && !inDraft.has(n + ":" + p.id));
    return `<optgroup label="${kaiName(n)}">${its.map(p => `<option value="${n}|${p.id}">${kaiName(n)} ${esc(p.no)}${m.itemTried(p) ? "（×あり）" : ""}</option>`).join("")}</optgroup>`;
  }).join("");
}
// ★組分け（11/8）までの見通し（2026-10-25 ユーザー「何問できて何点くらいを目指せるか、アプリで分かるように」）
//  目安の出し方: 組分けで取りにいく17問（計算3・一行題8・各大問の(1)6）のうち、計算3は取れる（前回3/3）として、
//  残り14問は「一行問題の候補で◎の割合」と同じだけ取れると考える。点は1問8点。偏差値は前回2回（96点→46.6、56点→38.6）から出した目安
const KUMI_DAY = "2026-11-08", KUMI_START = new Date("2026-10-25T00:00:00").getTime();
function ichiPool() {
  const out = [];
  const add = (n, q) => { const m = MS[n]; if (!m || m.skipped(q) || ICHIGYO_SKIP.has(n + ":" + q.id)) return; const so = (SUB_ONLY[n] || {})[q.id];
    q.subs.forEach((_, i) => { if (!so || so.includes(i)) out.push({m, q, i}); }); };
  Object.entries(ICHI_UNITS).forEach(([k, us]) => { const m = MS[+k]; if (!m) return; m.UNITS.filter(u => us.includes(u.id)).forEach(u => u.steps.forEach(q => add(+k, q))); });
  KAI_LIST.filter(n => n < 6 || (n >= 100 && n < 200)).forEach(n => { const m = MS[n]; if (!m) return;
    const isOne = id => n < 100 ? /^(kihon|han)\d+-\d+$/.test(id) : /^t2-\d+$/.test(id); Object.values(m.ITEMS).filter(q => isOne(q.id)).forEach(q => add(n, q)); });
  UP5_ALL.forEach(n => { const m = MS[n]; if (!m) return; Object.values(m.ITEMS).filter(q => /^kihon/.test(q.id)).forEach(q => add(n, q)); });
  return out;
}
function kumiHtml() {
  if (!trialOn() || todayKey() > KUMI_DAY) return "";
  const pool = ichiPool(), tot = pool.length;
  const okN = pool.filter(x => { const l = x.m.last(x.q, x.i); return l && l.ok; }).length;
  const doneN = pool.reduce((a, x) => a + x.m.hist(x.q, x.i).filter(t => t.t >= KUMI_START).length, 0);
  // 組分けの前の日までの一行問題の予定（今日をふくむ。10/31までは1日4、11/1からは8）
  let plan = 0;
  for (let d = new Date(new Date().toDateString()); d < new Date(KUMI_DAY + "T00:00:00"); d.setDate(d.getDate() + 1)) {
    const k = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); plan += k >= BIG_FROM && !BIG_SKIP.has(k) ? 8 : ICHIGYO_PER_DAY; }
  const est = p => { const q = 3 + Math.round(14 * p), pts = q * 8, dev = Math.round((38.6 + (pts - 56) * 0.2) * 10) / 10; return {q, pts, dev}; };
  const now = est(tot ? okN / tot : 0);
  // 予定どおり解くと: これから解く問題の6割が◎になると考えた目安（×のやり直しも数に入る）
  const fut = est(tot ? Math.min(1, (okN + plan * 0.6) / tot) : 0);
  const days = Math.round((new Date(KUMI_DAY + "T00:00:00") - new Date(new Date().toDateString())) / 864e5);
  return `<details class="dk" open><summary><b>組分け（11/8）まであと${days}日</b>　見通し</summary>
    <div class="note" style="line-height:1.7">
    一行問題：組分けまでの予定 <b>あと${plan}問</b>（10/25から解いた数 ${doneN}問）<br>
    一行問題の候補 ${tot}問のうち ◎ <b>${okN}問</b>（${tot ? Math.round(okN / tot * 100) : 0}%）<br>
    セット：第6〜9回で残っている系統 <b>${setRemain()}</b> / ${SET_BASE_REMAIN}<br>
    取りにいく17問（計算3・一行題8・各大問の(1)6）のうち取れそうな数：今 <b>${now.q}問・約${now.pts}点</b>（偏差値の目安 ${now.dev}）→ 予定どおり進むと <b>${fut.q}問・約${fut.pts}点</b>（目安 ${fut.dev}）<br>
    <span style="font-size:.9em">目安の出し方：計算3問は取れるとして、残り14問は一行問題の候補の◎の割合だけ取れると考えた。これから解く問題は6割が◎になる前提。偏差値は前回の組分け2回の点数からの目安で、前回は17問中7問・56点（38.6）。</span>
    </div></details>`;
}
function renderToday() {
  const el = document.getElementById("today"); if (!el) return;
  if (MODE === "child") return renderKid(el);
  let h = `<div class="th"><h2>今日のプリント</h2><span class="note">${day && day.date && day.date !== todayKey() ? day.date.slice(5).replace("-", "/") + " に決めた問題" : todayLabel()}</span></div>` + kumiHtml();
  if (!day) {
    if (!draft) draft = [];
    // ◎の小問は外す（全部◎の問題は、もう一度やらせるために足したものとして全部残す）
    draft = draft.filter(e => MS[e.k] && MS[e.k].ITEMS[e.id]).map(e => { if (["together", "rei1", "rei2", "rui", "rui2", "kihon", "kihon2"].includes(e.how)) return e;   // 例題・類題は小問ぜんぶ。★セットの基本問題も◎の小問を外さない（2026-11-06 ユーザー「セット問題ならできてても、外さなくていい」）
      const m = MS[e.k], p = m.ITEMS[e.id], due = e.subs.filter(i => !m.subOk(p, i)); return {...e, subs: due.length ? due : e.subs}; });
    saveDraft();
    const preview = draft.map(e => ({k: e.k, m: MS[e.k], p: MS[e.k].ITEMS[e.id], subs: e.subs, how: e.how, sys: e.sys, sno: e.sno, set: e.set}));
    if (preview.some(e => e.how)) h += boxGroups(preview).map(g => `<div class="tbox"><h3 class="lh">${boxTitle(g)}</h3><ul class="trows">${g.items.map(e => `<li>${rowName(e)}${rowVid(e)}<button class="ghost mini" data-drm="${preview.indexOf(e)}">外す</button></li>`).join("")}</ul></div>`).join("");
    else h += `<ol class="plist dlist">${preview.map((e, j) => `<li><span class="pno">${MARU[j]}</span>${esc(entryLabel(e))}${howTag(e)}<span class="note">${itemW(e.k, e.p.id, e.subs.length)}問${e.subs.length > 1 && e.p.w ? "（小問" + e.subs.length + "）" : ""}${e.m.itemTried(e.p) ? "・もう一度" : ""}</span>
      <button class="ghost mini" data-drm="${j}">外す</button></li>`).join("") || `<li class="note">まだ問題がありません。下から押して選んでね。</li>`}</ol>`;
    // 始めるボタンは、区切りの箱で出すときも出す（箱の形の日に出ていなかった。2026-10-21）
    if (kinai && kinai.items && kinai.items.length) h += `<div class="row"><button class="ghost" id="kinaiuse">機内用の分（${esc(kinai.from.slice(5).replace("-", "/"))} に作った ${kinai.items.length}問）を入れる</button><span class="note">機内で解いた分の◎×をつけるとき</span></div>`;
    h += `<div class="row"><button class="primary" id="mkday" ${preview.length ? "" : "disabled"}>この${mainCount(preview)}で今日を始める</button>${preview.length ? `<button class="ghost" id="clear">全部外す</button>` : ""}</div>
    ${pickerHtml()}
    <details class="dk"><summary>おすすめで選ぶ（回・問題数を決めて自動で）</summary><div class="setrow">
      <label>範囲 ${KAI_LIST.map(n => `<span class="ck"><input type="checkbox" id="rg${n}" data-rg="${n}" ${SETTINGS.range.includes(n) ? "checked" : ""}><label for="rg${n}">${kaiName(n)}</label></span>`).join("")}</label>
      <label for="curk">今週の回 <select id="curk">${SETTINGS.range.map(n => `<option value="${n}" ${n === SETTINGS.cur ? "selected" : ""}>${kaiName(n)}</option>`).join("")}</select></label>
      <label for="perday">1日の小問数（月〜金） <input id="perday" type="number" min="1" max="30" value="${SETTINGS.perDay}"></label>
      <label for="cursh">そのうち今週の回から <input id="cursh" type="number" min="0" max="${SETTINGS.perDay}" value="${SETTINGS.curShare}"></label>
    </div>
    <p class="note">自動: 日曜・祝日は24問・土曜は8問。今週の回は、週テストのあとの日曜に1つ進みます（次の回のデータが入っていれば）。今週の回の日曜は塾①、月曜は塾②の問題がセット1に入ります。</p>
    <p class="note">${SYS_MODE ? "系統ごと: セット1＝今週の回、セット2＝前の回の、×が多い系統を2つずつ（土曜はセット1だけ、日曜・祝日はセット3＝過去の復習）。1つの系統は 例題（一緒に）→ 類題（一人で）→ ×なら基本 → ×なら反復基本。プリントは系統ごとに 解き方 → 問題。" : `テストの直し2問・5年上の復習4問・今週の回${SETTINGS.curShare}問・前の回の基本（残り）。短い小問の多い問題はまとめて数えます。1日に同じ系統は1問だけ、×だった問題が先です。`}</p>
    <div class="row"><button class="ghost" id="reset">おすすめを入れる</button></div></details>`;
  } else {
    jukuLast();
    if (day.items.length > 1) { const before = JSON.stringify(day.items); sortList(day.items); if (JSON.stringify(day.items) !== before && dayFromDb && day.date === todayKey()) saveDay(); }
    const es = dayEntries();
    const marked = es.reduce((a, e) => a + e.subs.filter(i => markToday(e.k, e.m, e.p, i) !== "・").length, 0);
    const good = es.reduce((a, e) => a + e.subs.filter(i => markToday(e.k, e.m, e.p, i) === "◎").length, 0);
    h += `<p class="note">今日は ${mainCount(es)}（小問 ${es.reduce((a, e) => a + e.subs.length, 0)}）。◎ ${good}　× ${marked - good}　まだ ${es.reduce((a, e) => a + e.subs.length, 0) - marked}</p>`;
    // ★セットごとに分けて出す（2026-10-12 ユーザー）。番号①②…は通し
    const liOf = (e, j) => {
      const p = e.p;
      const st = isAgain2(e) ? e.subs.map(i => `<button class="cyc" data-cyc2="${e.k}|${p.id}|${i}" title="2回目（別に記録・判断には使わない）">${esc(subName(p, i))}${r2mark(e.k, p.id, i)}</button>`).join("")
        : e.subs.map(i => `<button class="cyc" data-cytk="${e.k}|${p.id}|${i}" title="今日の結果。押すと ◎→×→まだ と切り替わる（前の日の記録は変わらない）">${esc(subName(p, i))}${markToday(e.k, e.m, p, i)}${prevMark(e.k, p, i)}</button>`).join("");
      const mk = dayMarks && dayMarks[e.k + ":" + p.id];
      const need = mk && mk.some(x => x.correct == null);
      return `<li><span class="pno">${MARU[j]}</span><button class="link" data-gok="${e.k}|${p.id}">${kaiName(e.k)} ${esc(p.no)}${howTag(e)}${hasVideo(e.k, p.id, e.subs) ? ` <span class="note">${VMARK}</span>` : ""}</button><span class="pst">${st}</span>${
        need ? `<span class="note">${mk.map(x => `${esc(p.subs[x.i] || "")} 「${esc(x.read ?? "読めない")}」`).join("　")}</span>` : ""}<button class="ghost mini" data-trm="${j}">外す</button></li>`;
    };
    if (es.some(e => e.how)) {
      h += boxGroups(es).map(g => `<div class="tbox"><h3 class="lh">${boxTitle(g)}</h3><ul class="trows">${g.items.map(e => { const j = es.indexOf(e), p = e.p;
        const st = isAgain2(e) ? e.subs.map(i => `<button class="cyc" data-cyc2="${e.k}|${p.id}|${i}" title="2回目（別に記録・判断には使わない）">${esc(subName(p, i))}${r2mark(e.k, p.id, i)}</button>`).join("")
          : e.subs.map(i => `<button class="cyc" data-cytk="${e.k}|${p.id}|${i}" title="今日の結果。押すと ◎→×→まだ と切り替わる（前の日の記録は変わらない）">${esc(subName(p, i))}${markToday(e.k, e.m, p, i)}${prevMark(e.k, p, i)}</button>`).join("");
        return `<li><button class="link" data-${isAgain2(e) ? "gok2" : "gok"}="${e.k}|${p.id}">${rowName(e)}</button>${rowVid(e)}<span class="pst">${st}</span><button class="ghost mini" data-trm="${j}">外す</button></li>`; }).join("")}</ul></div>`).join("");
    } else {
    const setGroups = splitSets(es.map(e => ({e})));
    h += setGroups.map((S, si) => {
      const ses = S.map(L => L.e);
      const sAll = ses.reduce((a, e) => a + e.subs.length, 0), sMarked = ses.reduce((a, e) => a + e.subs.filter(i => e.m.last(e.p, i)).length, 0), sGood = ses.reduce((a, e) => a + e.subs.filter(i => e.m.subOk(e.p, i)).length, 0);
      const head = setGroups.length > 1 ? `<h3 class="lh">セット${si + 1}（${countSubs(ses)}問）<span class="note">　◎ ${sGood}　× ${sMarked - sGood}　まだ ${sAll - sMarked}</span></h3>` : "";
      return head + `<ol class="plist">${ses.map(e => liOf(e, es.indexOf(e))).join("")}</ol>`;
    }).join("");
    }
    h += `<div class="row"><select id="addp2" aria-label="問題を足す"><option value="">＋ 問題を足す…</option>${addOptions()}</select><span class="note">足したら、PDFを保存し直してね。</span></div>`;
    h += `<div class="row">
      <button id="pdf" class="primary" ${dayBusy ? "disabled" : ""}>今日のプリントをPDFで保存</button>
      ${es.some(e => e.how === "ichigyo" || (e.set || 0) >= 1) ? `<button class="primary" id="icsopen">今日の問題を画面で解く</button>` : ""}
      ${sample && canImg ? `<label class="btn">解いたプリントの写真をえらぶ（何枚でも）<input id="dph" type="file" accept="image/*" multiple></label>
      <button id="dgrade" ${dayPhotos.length && !dayBusy ? "" : "disabled"}>まとめて◎付け${dayPhotos.length ? `（写真${dayPhotos.length}枚）` : ""}</button>`
      : `<span class="note">写真で◎付けするには、ブラウザで claude.ai を開いてね。</span>`}
      <button class="ghost" id="redo">${day && day.date && day.date !== todayKey() ? "今日のプリントを新しく作る" : "今日の問題を決め直す"}</button>
      <button class="ghost" id="kinai" ${dayBusy ? "disabled" : ""} title="今日の分と重ならない1日分を先に作ってPDFに（機内などネットがないとき用）">機内用の1日分を作る（PDF）</button></div>`;
    h += `<div class="row"><button class="ghost" id="offmk" ${dayBusy ? "disabled" : ""}>オフライン用ファイルを作る（2日分）</button>
      <label class="btn ghost">オフラインの記録を読み込む<input id="offrec" type="file" accept=".json,application/json" hidden></label></div>`;
    if (offPrev) h += `<div class="sheet" style="padding:10px;margin:6px 0">${offListHtml(offPrev.d1, "1日目")}${offListHtml(offPrev.d2, "2日目")}
      <div class="row"><button class="primary" id="offgo" ${dayBusy ? "disabled" : ""}>この2日分でファイルを作る</button><button class="ghost" id="offno">やめる</button></div></div>`;
    if (offRecs) { const c = offRecCount(offRecs); h += `<div class="sheet" style="padding:10px;margin:6px 0"><p>オフラインの記録：足す記録 ${c.add} 件（◎${c.ok}・×${c.add - c.ok}）。今の記録は消しません。</p>
      <div class="row"><button class="primary" id="offadd">足す</button><button class="ghost" id="offaddno">やめる</button></div></div>`; }
    h += timesHtml(es);
    h += `<p class="note">図の説明: ${!sample ? "この画面では作れません" : prep ? (prep.running ? `準備中 ${prep.done}/${prep.total}` : `準備できました（${prep.total - prep.fail}/${prep.total}）${prep.fail ? `　<button class="ghost mini" id="prepv">足りない分を作る</button>` : ""}`) : `<button class="ghost mini" id="prepv">今日の分を準備する</button>`}</p>`;
    h += `<p class="note">◎×は押すと切り替わります（まだ → ◎ → × → まだ）。答えがアプリに入っていない問題は読み取った答えを出すので、解答編で確かめて押してね。</p>`;
  }
  if (dayMsg) h += `<p class="comment">${esc(dayMsg)}</p>`;
  if (pdfUrl && day) h += `<p><a class="btn primary" href="${esc(furl(pdfUrl))}" target="_blank" rel="noopener">PDFを開く（印刷用）</a></p>`;
  el.innerHTML = h;
  const q = s => el.querySelector(s);
  el.querySelectorAll("[data-rg]").forEach(c => c.onchange = async () => {
    const n = +c.dataset.rg; SETTINGS.range = c.checked ? [...SETTINGS.range, n] : SETTINGS.range.filter(x => x !== n); await saveSettings(); render(); });
  if (q("#curk")) q("#curk").onchange = async e => { SETTINGS.cur = +e.target.value; SETTINGS.curFrom = sundayOf(); await saveSettings(); render(); };
  if (q("#perday")) q("#perday").onchange = async e => { SETTINGS.perDay = +e.target.value; await saveSettings(); render(); };
  if (q("#cursh")) q("#cursh").onchange = async e => { SETTINGS.curShare = +e.target.value; await saveSettings(); render(); };
  el.querySelectorAll("[data-drm]").forEach(b => b.onclick = () => { const e = draft[+b.dataset.drm]; if (e && MS[e.k] && MS[e.k].ITEMS[e.id]) lastAct = `外した：${kaiName(e.k)} ${MS[e.k].ITEMS[e.id].no}`; draft.splice(+b.dataset.drm, 1); renderToday(); });
  el.querySelectorAll("[data-dok]").forEach(b => b.onclick = async () => { const e = draft[+b.dataset.dok], m = MS[e.k], p = m.ITEMS[e.id];
    for (const i of e.subs) await addTry(e.k, p, i, {ok: true, t: Date.now(), by: "parent"}); draft.splice(+b.dataset.dok, 1); render(); });
  if (q("#addp")) q("#addp").onchange = e => { if (!e.target.value) return; const [k, id] = e.target.value.split("|"), m = MS[+k], p = m.ITEMS[id];
    draft.push({k: +k, id, subs: dueSubs(m, p)}); renderToday(); };
  if (q("#reset")) q("#reset").onclick = () => { draft = sortList(planDay()); render(); };
  el.querySelectorAll("details[data-pk]").forEach(d => d.ontoggle = () => { if (d.open) pickOpen = +d.dataset.pk; });
  el.querySelectorAll("[data-psub]").forEach(b => b.onclick = () => { const [k, id, i] = b.dataset.psub.split("|"); pickOpen = +k; toggleTodaySub(+k, id, +i); });
  el.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => { const [k, id] = b.dataset.pick.split("|"); pickOpen = +k; toggleToday(+k, id); });
  el.querySelectorAll("[data-peek]").forEach(b => b.onclick = () => { togglePeek(b.dataset.peek); renderToday(); });
  if (q("#clear")) q("#clear").onclick = () => { draft = []; render(); };
  el.querySelectorAll("[data-trm]").forEach(b => b.onclick = async () => { day.items.splice(+b.dataset.trm, 1); await saveDay(); render(); });
  if (q("#addp2")) q("#addp2").onchange = e => { if (e.target.value) { const [k, id] = e.target.value.split("|"); toggleToday(+k, id); } };
  if (q("#mkday")) q("#mkday").onclick = async () => { day = {date: todayKey(), items: sortList(draft.map(e => Object.assign({k: e.k, id: e.id, subs: e.subs}, typeof e.ord === "number" ? {ord: e.ord} : {}, typeof e.set === "number" ? {set: e.set} : {}, e.rev ? {rev: e.rev} : {}, e.how ? {how: e.how} : {}, e.sys ? {sys: e.sys} : {}, e.han ? {han: true} : {}, e.sno ? {sno: e.sno} : {}))), created: Date.now()}; dayTimes = null; draft = []; saveDraft(); pickOpen = null; dayMsg = ""; await saveDay(); render(); prepareViz(); };
  if (q("#redo")) q("#redo").onclick = async () => {
    // 前の日のプリントなら、昨日の問題は持ちこまずに「おすすめ」で新しく選ぶ（同じ問題がまた出ていた。2026-10-09 ユーザー）。今日のプリントの決め直しなら、今の問題から選び直す
    const oldDay = day && day.date && day.date !== todayKey();
    // 前の日のプリントのあと: 担当が用意した下書き（前の日のプリントより新しいもの）があればそれ、無ければおすすめ
    // ★今日のプリントの決め直しでも、担当が今日のプリントより後に用意した下書きがあればそれ（2026-10-11）
    const usePre = !!(day && preDraft && preDraft.items.length && preDraft.t > (day.created || 0));
    draft = usePre ? sortList(preDraft.items.map(e => ({...e}))) : oldDay ? sortList(planDay()) : (day ? day.items : []).map(e => ({...e})); day = null; dayMarks = null; dayPhotos = []; try { localStorage.removeItem("sansu-step-dayAll"); } catch (e) {} if (db) { try { await db.doc(DAYC + "/current").delete(); await db.doc(DAYC + "/" + todayKey()).delete(); } catch (e) {} } render(); };
  if (q("#pdf")) q("#pdf").onclick = () => makePdf();
  if (q("#icsopen")) q("#icsopen").onclick = icsOpen;
  if (q("#kinai")) q("#kinai").onclick = () => makeKinai();
  if (q("#offmk")) q("#offmk").onclick = () => offPreview();
  if (q("#offgo")) q("#offgo").onclick = () => makeOffline();
  if (q("#offno")) q("#offno").onclick = () => { offPrev = null; renderToday(); };
  if (q("#offrec")) q("#offrec").onchange = e => { if (e.target.files[0]) offRecLoad(e.target.files[0]); };
  if (q("#offadd")) q("#offadd").onclick = () => offRecMerge();
  if (q("#offaddno")) q("#offaddno").onclick = () => { offRecs = null; renderToday(); };
  if (q("#kinaiuse")) q("#kinaiuse").onclick = () => { draft = sortList(kinai.items.map(e => ({...e}))); saveDraft(); render(); };
  el.querySelectorAll("[data-tm]").forEach(x => x.onchange = () => { const [k, w] = x.dataset.tm.split("|"); saveTime(k, w, x.value); });
  if (day && dayTimes === null && db) { dayTimes = {}; loadTimes(); }
  if (q("#prepv")) q("#prepv").onclick = () => prepareViz();
  if (q("#dph")) q("#dph").onchange = e => { dayPhotos = [...e.target.files]; dayMsg = ""; renderToday(); };
  if (q("#dgrade")) q("#dgrade").onclick = gradeDay;
  el.querySelectorAll("[data-cyc2]").forEach(b => b.onclick = async () => { const [k, id, i] = b.dataset.cyc2.split("|"); await cycleRei2(+k, id, +i); render(); });
  el.querySelectorAll("[data-cytk]").forEach(b => b.onclick = async () => { const [k, id, i] = b.dataset.cytk.split("|"); await cycleToday(+k, MS[+k].ITEMS[id], +i); render(); });
  el.querySelectorAll("[data-cyck]").forEach(b => b.onclick = async () => { const [k, id, i] = b.dataset.cyck.split("|"); await cycleSubK(+k, MS[+k].ITEMS[id], +i); render(); });
  el.querySelectorAll("[data-gok]").forEach(b => b.onclick = () => { const [k, id] = b.dataset.gok.split("|"); setRei2Mode(null); goToAny(+k, id); });
  el.querySelectorAll("[data-gok2]").forEach(b => b.onclick = () => { const [k, id] = b.dataset.gok2.split("|"); setRei2Mode(+k, id); goToAny(+k, id); });
  renderBar();
}

/* ---- PDF（A4・150dpi相当のキャンバスに描いて、1ページずつ貼る） ---- */
const PW = 1240, PH = 1754, PM = 80;
const SET_SIZE = 8;   // 小問8つで1セット（8問ごとに休憩。ユーザー 2026-10-07）
const FONT = '"BIZ UDPGothic","Hiragino Sans","Yu Gothic",sans-serif';
const loadImg = src => new Promise((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ng; i.src = src; });
function newPage(title, sub) {
  const c = document.createElement("canvas"); c.width = PW; c.height = PH;
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, PW, PH); g.fillStyle = "#111";
  g.font = `700 30px ${FONT}`; g.fillText(title, PM, 90);
  g.font = `400 22px ${FONT}`; g.fillStyle = "#555"; g.fillText(sub, PM, 126); g.fillStyle = "#111";
  g.strokeStyle = "#999"; g.lineWidth = 2; g.beginPath(); g.moveTo(PM, 145); g.lineTo(PW - PM, 145); g.stroke();
  return {c, g};
}
// 1枚目の右上に「はじめ・おわり」の時刻の欄（かかった時間を見るため。ユーザー 2026-10-05）
function timeBoxes(g) {
  // タイマーで測るので「かかった時間 □ 分」だけ（2026-10-10 ユーザー）
  const bw = 150, bh = 48, x = PW - PM - bw - 40, y = 30;
  g.save(); g.strokeStyle = "#222"; g.lineWidth = 2; g.fillStyle = "#111"; g.font = `700 22px ${FONT}`;
  g.fillText("かかった時間", x - 150, y + 32); g.strokeRect(x, y, bw, bh); g.fillText("分", x + bw + 8, y + 32);
  g.restore();
}
// プリントのセット分け（PDF と時間の記録で同じ区切りを使う）。xs は {e} の並び
function splitSets(xs) {
  const sets = []; let cur = [], cnt = 0;
  // 塾の日など、問題に set（セットの番号）が付いている日はその区切りで（塾の分／その他）
  const setOf = L => { const it = day && day.items.find(x => +x.k === L.e.k && x.id === L.e.p.id); return it && typeof it.set === "number" ? it.set : null; };
  if (xs.some(L => setOf(L) !== null)) xs.forEach(L => { const sn = setOf(L); if (cur.length && sn !== setOf(cur[0])) { sets.push(cur); cur = []; } cur.push(L); });
  else xs.forEach(L => { const n = itemW(L.e.k, L.e.p.id, L.e.subs.length); if (cur.length && cnt + n > SET_SIZE) { sets.push(cur); cur = []; cnt = 0; } cur.push(L); cnt += n; });
  if (cur.length) sets.push(cur);
  return sets;
}
// セットごとの「はじめ・おわり」の時刻を入れる（プリントに書いた時刻。db の times/<日付> に保存。2026-10-10 ユーザー）
let dayTimes = null;   // {set1: {s: "19:05", e: "19:30"}, …}
async function loadTimes() { if (!db || !day) return; try { const d = await db.doc("times/" + day.date).get(); dayTimes = d.exists ? d.data() : {}; renderToday(); } catch (e) {} }
async function saveTime(key, which, v) {
  dayTimes = dayTimes || {}; dayTimes[key] = Object.assign({}, dayTimes[key] || {}, {[which]: v});
  if (db && day) { try { await db.doc("times/" + day.date).set(Object.assign({}, dayTimes, {t: Date.now()})); } catch (e) {} }
}
function timesHtml(es) {
  const sets = splitSets(es.map(e => ({e})));
  const tv = (k, w) => esc(((dayTimes || {})[k] || {})[w] || "");
  return `<details class="dk"${dayTimes && Object.keys(dayTimes).some(k => k.startsWith("set")) ? "" : ""}><summary>かかった時間を入れる（セットごと・分）</summary><div class="times">${sets.map((S, i) => {
    const k = "set" + (i + 1), n = S.reduce((a, L) => a + itemW(L.e.k, L.e.p.id, L.e.subs.length), 0);
    return `<div class="row"><b>セット${i + 1}（${n}問）</b> かかった時間 <input type="number" min="0" max="300" inputmode="numeric" style="width:5em" data-tm="${k}|min" value="${tv(k, "min")}"> 分</div>`; }).join("")}</div>
    <p class="note">入れるとすぐ保存されます。毎週月曜のふり返りで、1セットにかかった時間を見ます。</p></details>`;
}
// ★系統ごとのプリント（2026-10-15）: 系統ごとに 解説ページ → 問題（1問1ページ。やること・表の箱は例題だけ・式・答え）
const HOWS = {rei1: ["例題・まず一人で", "#e8962f", "#fff4e3"], rui: ["類題・一人で", "#3f86d6", "#e8f1fd"], rei2: ["例題をもう一度", "#8a5cc2", "#f1eafa"], kihon2: ["1問目をもう一度", "#8a5cc2", "#f1eafa"], kihon: ["基本問題・一人で", "#2f7d4f", "#e3f2e8"], rui2: ["類題をもう一度", "#3f86d6", "#e8f1fd"],
  together: ["一緒に", "#e8962f", "#fff4e3"], alone: ["一人で", "#3f86d6", "#e8f1fd"], ifng: ["×だったら", "#d04a4a", "#fdeaea"],
  juku: ["塾の問題", "#3f86d6", "#e8f1fd"], review: ["復習", "#3f86d6", "#e8f1fd"], ichigyo: ["一行問題", "#2f7d4f", "#e3f2e8"]};
const setName = v => v === 0 ? "一行問題" : `セット${v || 1}`;
const blockName = e => e.how === "ichigyo" ? "一行問題" : e.how === "juku" ? "塾のプリント" : ["rei1", "rui", "rei2", "kihon", "rui2", "kihon2", "together"].includes(e.how) && e.sys ? `${e.sno || 1}問目` : setName(e.set);
function howLines(e) {
  const p = e.p, hi = sysTool(e.k, e.sys) === "hi", part = e.subs.length < p.subs.length;
  const names = e.subs.map(i => subName(p, i)).join("");
  const DONE = "一人で◎なら、この系統はおしまい。次の系統へ。";
  const tool = hi ? "表はいらない。比だけなら、同じ道のりを何分で進んだか → 分数の逆で終わり。追いかける問題は線分図。"
    : "表は自分で書く（左に 速さ・時間・道のり、上に人の名前）。表を書いてから式。差や和は線分図。";
  const ka = (((window.KEYS || {})[p.kai] || {})[p.id] || {}).a || [], first = Math.min(...e.subs);
  const prev = []; for (let i = 0; i < first; i++) if (ka[i]) prev.push(`${subName(p, i)} ${ka[i]}`);
  const L = [], su = e.sys && (e.m.UNITS.find(x => x.id === e.sys) || {}).label;
  if (su && ["alone", "ifng", "rui", "kihon", "rui2"].includes(e.how)) L.push(`${su}と同じ考え方で解く問題。`);
  if (false && e.how === "rei1" && trialOn() && sysVideo(e.k, e.sys)) L.push("先に解説の動画を見てから、解いてみよう。", "分からなかったら、次の解き方ページを見ながら、ワークシートを埋めて解こう。");
  else if (e.how === "rei1") L.push("まず一人で解いてみよう（表や線分図は自分で書く）。", "分からなかったら、次の解き方ページを見ながら、ワークシートの表を埋めて解こう。");
  else if (e.how === "rui") L.push(tool, "解き方ページは見ないで。");
  else if (isAgain2(e)) L.push("解き方ページもワークシートも見ないで、もう一度。", tool);
  else if (e.how === "kihon" || e.how === "rui2") L.push(tool, "解き方ページは見ないで。");
  else if (e.how === "together") L.push(...(hi ? ["速さの比だけ聞かれているので、表はいらない。同じ道のりを何分で進んだかを出して、分数の逆で終わり。", "前の解き方ページを見ながら一緒に。"]
    : ["前の解き方ページを見ながら、表を書いて解こう（表の箱は下）。", "速さの比は時間の分数の逆。比は①②で書く。差や和は線分図。"]));
  else if (e.how === "alone") L.push(tool, (part ? names + "だけ解く（ほかの小問はできている）。" : "") + "解き方ページは見ないで。", DONE);
  else if (e.how === "ifng") L.push(e.han ? "同じ形で数がちがう問題。おうちの人と一緒に。" : "前の問題が×だったら。解き方ページをもう一度見てから、一人で。", tool, DONE);
  else if (e.how === "juku") L.push("塾（予習ナビ）でやった問題。一人で。");
  else L.push("過去の復習。一人で。");
  // ◎×のつけ方（2026-10-15 ユーザーと決めた）
  if (e.how === "rei1") L.push("丸付け: 一人で合っていたら◎、分からなかったら×（この◎で、この系統はしばらくおやすみ）。");
  else if (e.how === "rei2") L.push("丸付け: 2回目は別に記録する（この系統をおやすみにするかは、1回目の例題で決める）。");
  else if (e.how === "kihon2") L.push("丸付け: 2回目は別に記録する（次に出す問題は、1回目の◎×で決める）。");
  else if (e.how === "together") L.push("◎×はつけない（練習）。");
  else if (e.how !== "juku" && e.how !== "review" && e.how !== "rei1") L.push("丸付け: 一人で合っていたら◎。途中で解き方や答えを見たら×。");
  if (prev.length) L.push("前の小問の答え: " + prev.join("　"));
  return L;
}
// (2)だけなど、前の小問を出さないときの「前の小問の答え」（(1)の答えがないと解けないため。2026-10-22 ユーザー「(1)の答えを乗せてください」）
function prevAnsText(e) {
  const ka = (((window.KEYS || {})[e.k] || {})[e.p.id] || {}).a || [], first = Math.min(...e.subs), out = [];
  for (let i = 0; i < first; i++) if (ka[i]) out.push(`${subName(e.p, i) || "(" + (i + 1) + ")"}の答え ${ka[i]}`);
  return out.join("　");
}
// その日の問題の絵・答えの絵の束を先に読む（画像は使うときに読む作り。model.js の imgPreload。2026-10-31）
const imgPreloadEntries = es => Promise.all(es.map(e => window.imgPreload ? imgPreload(e.k, [e.p.id, e.rev].filter(Boolean)) : null));
async function sysPages(es) {
  await imgPreloadEntries(es);
  const pages = [], W = PW - 2 * PM, TOP = 165, BOTTOM = PH - 40;
  const wrap = (g, t, x, y, maxW, lh) => { let line = ""; for (const ch of t) { if (g.measureText(line + ch).width > maxW) { g.fillText(line, x, y); y += lh; line = ""; } line += ch; } if (line) { g.fillText(line, x, y); y += lh; } return y; };
  const fit = (pg, im, y, maxH) => { let w = W, h = im.height * W / im.width; if (h > maxH) { h = maxH; w = im.width * h / im.height; } pg.g.drawImage(im, PM, y, w, h); return y + h; };
  const imgs = await Promise.all(es.map(e => loadImg(imgSrc(e.p.img)).catch(() => null)));
  let prevKey = null; const setFirst = {};
  // ★問題の絵のすぐ上に赤字の一言（2026-10-30 ユーザー「弟の速さを聞かれているのに兄の速さを答えて×」→ 10/31 のプリントから）
  const ASK = "聞かれていることに 線を引こう（だれの・なにを）", ASK_H = 36;
  const askLine = (g, x, y) => { g.save(); g.font = `700 24px ${FONT}`; g.fillStyle = "#c0392b"; g.fillText(ASK, x, y + 24); g.restore(); return y + ASK_H; };
  // 一行問題: 1ページにまとめる（問題・答えの□）
  const one1 = es.map((e, k) => ({e, k})).filter(x => x.e.how === "ichigyo");
  // ★一行問題: 図は本の幅のまま（小さくしない）。入りきらなければ2枚目へ（2026-10-25 ユーザー「印刷した図が小さすぎて見えなかった」。前は4問を1枚に押しこんでいた）
  // ★組分けの大問2の本番形式（kumi2Items）: 問題の紙（4問ずつ・(1)〜(8)・答えの□なし）＋最後に解答用紙1枚。図は本の幅のまま
  if (one1.length && one1.every(x => x.e.kumi)) {
    const IMG_MAX = 520, WORK = 170, LBL = 76, avail = BOTTOM - TOP - 60;
    const need = one1.map(({e, k}) => { const im = imgs[k], pa = prevAnsText(e); let h = im ? im.height * (W - LBL) / im.width : 0; if (h > IMG_MAX) h = IMG_MAX;
      return {h, pa, total: 12 + (pa ? 36 : 0) + (e.subs.length < e.p.subs.length ? 38 : 0) + ASK_H + h + WORK}; });
    const groups = []; let cur = [], used = 0;
    one1.forEach((x, i) => { if (cur.length && (cur.length >= 4 || used + need[i].total > avail)) { groups.push(cur); cur = []; used = 0; } cur.push(i); used += need[i].total; });
    if (cur.length) groups.push(cur);
    groups.forEach((grp, gi) => {
      const pg = newPage("2　次の問いに答えなさい。", gi ? "（つづき）" : "組分けテストの大問2と同じ形。答えは 最後の解答用紙に書こう。"), g = pg.g; pages.push(pg); pg.kumiLab = "大問2-" + (gi + 1);
      if (!gi) { g.save(); g.font = `700 26px ${FONT}`; g.fillStyle = "#111"; g.textAlign = "right"; g.fillText("はじめ　　　時　　　分", PW - PM, 70); g.restore(); setFirst[0] = true; }
      const extra = Math.max(0, (avail - grp.reduce((a, i) => a + need[i].total, 0)) / grp.length);
      let y = TOP + 20;
      grp.forEach(oi => { const {e, k} = one1[oi], nd = need[oi];
        g.font = `700 30px ${FONT}`; g.fillStyle = "#111"; g.fillText(`(${oi + 1})`, PM, y + 30);
        let yy = y; const part = e.subs.length < e.p.subs.length;
        // 本の問題に小問がいくつもあるときは、どれを答えるかを書く（2026-10-30）
        if (part) { g.font = `700 26px ${FONT}`; g.fillStyle = "#c0392b"; g.fillText(`${e.subs.map(i => subName(e.p, i)).join("")}だけ 答えよう`, PM + LBL, yy + 28); g.fillStyle = "#111"; yy += 38; }
        if (nd.pa) { g.font = `700 24px ${FONT}`; g.fillStyle = "#1c6b78"; g.fillText(nd.pa, PM + LBL, yy + 26); g.fillStyle = "#111"; yy += 36; }
        yy = askLine(g, PM + LBL, yy);
        const im = imgs[k]; if (im) { const h = nd.h, w = im.width * h / im.height; g.drawImage(im, PM + LBL, yy + 4, w, h); }
        y += nd.total + extra; });
    });
    // 解答用紙（本番と同じく (1)〜(8) の箱。下の小さい字は丸付け用の出どころ）
    const pg = newPage("2　解答用紙", "答えだけを書こう。単位も わすれずに。"), g = pg.g; pages.push(pg); pg.kumiLab = "解答用紙";
    g.save(); g.font = `700 26px ${FONT}`; g.fillStyle = "#111"; g.textAlign = "right"; g.fillText("おわり　　　時　　　分", PW - PM, 70); g.restore();
    const bw = (W - 60) / 2, bh = 150;
    one1.forEach(({e}, oi) => { const col = oi % 2, row = Math.floor(oi / 2), x = PM + col * (bw + 60), y = TOP + 50 + row * (bh + 90);
      g.lineWidth = 3; g.strokeStyle = "#222"; g.strokeRect(x, y, bw, bh); g.beginPath(); g.moveTo(x + 70, y); g.lineTo(x + 70, y + bh); g.stroke();
      g.font = `700 30px ${FONT}`; g.fillStyle = "#111"; g.fillText(`(${oi + 1})`, x + 12, y + 50);
      g.font = `400 20px ${FONT}`; g.fillStyle = "#888"; g.fillText(`${kaiName(e.k)} ${e.p.no}` + (e.subs.length < e.p.subs.length ? " " + e.subs.map(i => subName(e.p, i)).join("") : ""), x, y + bh + 30); });
  } else if (one1.length) {
    const IMG_MAX = 560, WORK = 110, ANS = 90;
    const need = one1.map(({e, k}) => { const im = imgs[k], pa = prevAnsText(e); let h = im ? im.height * W / im.width : 0; if (h > IMG_MAX) h = IMG_MAX;
      return {h, pa, total: 44 + (pa ? 36 : 0) + ASK_H + h + 10 + WORK + ANS}; });
    const groups = []; let cur = [], used = 0;
    one1.forEach((x, i) => { if (cur.length && used + need[i].total > BOTTOM - TOP - 10) { groups.push(cur); cur = []; used = 0; } cur.push(i); used += need[i].total; });
    if (cur.length) groups.push(cur);
    groups.forEach((grp, gi) => {
      const pg = newPage(`一行問題（${one1.length}問）` + (gi ? "　つづき" : ""), "式は1つ。サッと解いて、答えを□に。"), g = pg.g; pages.push(pg);
      if (!gi) { timeBoxes(g); setFirst[0] = true; }
      const extra = Math.max(0, (BOTTOM - TOP - 10 - grp.reduce((a, i) => a + need[i].total, 0)) / grp.length);
      let y = TOP + 10;
      grp.forEach(oi => { const {e, k} = one1[oi], nd = need[oi], slot = nd.total + extra;
        g.font = `700 30px ${FONT}`; g.fillStyle = "#111"; g.fillText(`${MARU[oi]} ${kaiName(e.k)} ${e.p.no}` + (e.subs.length < e.p.subs.length ? `　${e.subs.map(i => subName(e.p, i)).join("")}だけ` : ""), PM, y + 30);
        let yy = y + 44;
        if (nd.pa) { g.font = `700 24px ${FONT}`; g.fillStyle = "#1c6b78"; g.fillText(nd.pa, PM + 20, yy + 24); g.fillStyle = "#111"; yy += 36; }
        yy = askLine(g, PM, yy);
        const im = imgs[k]; if (im) { const h = nd.h, w = im.width * h / im.height; g.drawImage(im, PM, yy, w, h); yy += h + 10; }
        // 答えの□は小問の数だけ（右から並べる）
        const ns = e.subs.length, bw = Math.min(300, (W - 160) / ns - 50); g.font = `700 26px ${FONT}`; g.fillStyle = "#111";
        g.fillText("答え", PW - PM - ns * (bw + 50) - 70, y + slot - 40); g.lineWidth = 2; g.strokeStyle = "#222";
        e.subs.forEach((si, i) => { const x = PW - PM - (ns - i) * (bw + 50) + 50; if (ns > 1) g.fillText(subName(e.p, si), x - 44, y + slot - 40); g.strokeRect(x, y + slot - 82, bw, 64); });
        y += slot; });
    });
  }
  if (trialOn()) return trialPages(es, imgs, pages, {W, TOP, BOTTOM, fit, wrap, askLine, ASK_H});
  for (let k = 0; k < es.length; k++) {
    if (es[k].how === "ichigyo") continue;
    const e = es[k], u = e.m.UNIT_OF[e.p.id], key = (e.set || 1) + ":" + e.k + ":" + (e.sys || e.p.id);
    const sysU = u || (e.m.UNIT_OF[e.p.id]);   // 塾の問題も系統を書く
    const title = `${blockName(e)}　${kaiName(e.k)}` + (sysU ? ` ${sysU.label}の系統` : ""), sub = sysU ? sysU.name : "";
    // 系統の始まり（例題）の前に解説: easy_hyou.js の「表で解く」ページ（無ければやさしい説明、それも無ければ本の解き方）
    if (key !== prevKey && e.how === "together") {   // 前の形（一緒に）の日だけ: 例題の前に解き方
      const ez = ((window.EASY || {})[e.k] || {})[e.p.id];
      const srcs = ez ? (ez.printImgs || ez.imgs) : (e.p.ans || []).map((_, i) => imgSrc(`img/${e.k}/a_${e.p.id}_${i}.png`));
      const ims = (await Promise.all(srcs.map(s => loadImg(s).catch(() => null)))).filter(Boolean);
      if (ez) ims.forEach(im => { const pg = newPage(title + "　解き方", "答えが見えます。読んで考え方を確かめてから、次のページの問題へ"); pages.push(pg); fit(pg, im, TOP, BOTTOM - TOP); });
      else if (ims.length) { let pg = newPage(title + "　解き方（本）", "答えが見えます。読んで考え方を確かめてから、次のページの問題へ"); pages.push(pg); let y = TOP;
        if (imgs[k]) y = fit(pg, imgs[k], y, 420) + 20;
        for (const im of ims) { const h = im.height * W / im.width; if (y + Math.min(h, BOTTOM - TOP) > BOTTOM) { pg = newPage(title + "　解き方（本・つづき）", ""); pages.push(pg); y = TOP; } y = fit(pg, im, y, BOTTOM - y) + 16; } }
    }
    prevKey = key;
    // 問題のページ
    const pg = newPage(title, sub), g = pg.g; pages.push(pg);
    if (!setFirst[e.set || 1]) { setFirst[e.set || 1] = true; timeBoxes(g); }
    const [hl, hc, hf] = HOWS[e.how] || HOWS.alone, part = e.subs.length < e.p.subs.length;
    let y = TOP + 44;
    g.font = `700 38px ${FONT}`; g.fillStyle = "#111"; { const blk = es.filter(x => blockName(x) === blockName(e) && (x.sno || 0) === (e.sno || 0)); var posLabel = e.sno ? "" : `${blk.indexOf(e) + 1}問目`; }
    g.fillText((posLabel ? posLabel + "　" : "") + e.p.no + (part ? " " + e.subs.map(i => subName(e.p, i)).join("") : ""), PM, y);
    g.font = `700 26px ${FONT}`; const tw = g.measureText(hl).width + 40; g.fillStyle = hc; g.fillRect(PW - PM - tw, y - 34, tw, 44); g.fillStyle = "#fff"; g.fillText(hl, PW - PM - tw + 20, y - 3);
    y += 18;
    if (imgs[k]) { y = askLine(g, PM, y); y = fit(pg, imgs[k], y, 470) + 18; }
    // やること
    const L = howLines(e); g.font = `400 25px ${FONT}`;
    const lineCount = L.reduce((a, t) => a + Math.max(1, Math.ceil(g.measureText(t).width / (W - 50))), 0);
    const bh = 64 + lineCount * 36;
    g.fillStyle = hf; g.fillRect(PM, y, W, bh); g.strokeStyle = hc; g.lineWidth = 3; g.strokeRect(PM, y, W, bh);
    g.font = `700 26px ${FONT}`; g.fillStyle = hc; g.fillText(`やること（${hl}）`, PM + 20, y + 38);
    g.font = `400 25px ${FONT}`; g.fillStyle = "#222"; let ty = y + 76; L.forEach(t => { ty = wrap(g, t, PM + 24, ty, W - 50, 36); });
    y += bh + 18;
    // 表の箱（例題だけ。比だけの系統は無し）
    const table = e.how === "together" && sysTool(e.k, e.sys) !== "hi";   // 新しい形（rei1）は表の箱なし（穴埋めが表）
    if (table) { const rh = 54, lw = W * 0.18, cw = (W - lw) / 3, rows = ["", "速さ", "時間", "道のり"];
      g.font = `700 24px ${FONT}`; g.fillStyle = "#333"; g.fillText("表（上の行に人の名前。分かっている数を入れて、？を決める）", PM, y + 26); y += 40;
      rows.forEach((r, i) => { for (let j = 0; j < 4; j++) { const x = j ? PM + lw + cw * (j - 1) : PM, w = j ? cw : lw;
        g.fillStyle = (i === 0 || j === 0) ? "#e8f1fd" : "#fff"; g.fillRect(x, y + i * rh, w, rh); g.strokeStyle = "#8a96a8"; g.lineWidth = 2; g.strokeRect(x, y + i * rh, w, rh); }
        if (r) { g.fillStyle = "#111"; g.font = `700 26px ${FONT}`; g.fillText(r, PM + (lw - g.measureText(r).width) / 2, y + i * rh + 36); } });
      y += rh * 4 + 20; }
    // 式（と表）の欄 → 答え
    const ay = BOTTOM - 100;
    g.strokeStyle = "#9fb0c8"; g.lineWidth = 2; g.strokeRect(PM, y, W, ay - 16 - y);
    g.font = `400 22px ${FONT}`; g.fillStyle = "#7a8698"; g.fillText(table || (e.how !== "together" && sysTool(e.k, e.sys) !== "hi" && e.how !== "review" && e.how !== "juku") ? (table ? "式（表の数を使って）" : "表と式（まず表を書く）") : "式", PM + 16, y + 32);
    g.font = `700 28px ${FONT}`; g.fillStyle = "#111"; g.fillText("答え", PM, ay + 50);
    const n = e.subs.length, bw = Math.min(300, (W - 110) / n - 70);
    e.subs.forEach((si, i) => { const x = PM + 90 + i * (bw + 70); g.font = `700 26px ${FONT}`; g.fillText(subName(e.p, si) || "", x, ay + 50); g.lineWidth = 2; g.strokeStyle = "#222"; g.strokeRect(x + 56, ay + 6, bw, 70); });
    // 例題（まず一人で）のあと: 解き方ページ → 穴埋め（easy_hyou.js の printImgs・ana。無ければやさしい説明か本の解き方）
    // 塾の問題も、やさしい説明（解き方＋ワークシート）がある問題はそのあとに（2026-10-19 司令塔「わかりやすい解説の準備」）
    if (e.how === "rei1" || (e.how === "juku" && ((window.EASY || {})[e.k] || {})[e.p.id])) {
      const ez = ((window.EASY || {})[e.k] || {})[e.p.id];
      const srcs = ez ? (ez.printImgs || ez.imgs) : (e.p.ans || []).map((_, i) => imgSrc(`img/${e.k}/a_${e.p.id}_${i}.png`));
      const ims = (await Promise.all(srcs.map(s => loadImg(s).catch(() => null)))).filter(Boolean);
      ims.forEach(im => { const pg2 = newPage(title + "　解き方", "分からなかったら読もう（答えが見えます）。読んだら次のページの穴埋めへ"); pages.push(pg2); fit(pg2, im, TOP, BOTTOM - TOP); });
      const anas = ez && ez.ana ? (await Promise.all(ez.ana.map(s => loadImg(s).catch(() => null)))).filter(Boolean) : [];
      anas.forEach(im => { const pg3 = newPage(title + "　ワークシート", "解き方ページを見ながら、表と（　）を埋めて、自分で解こう"); pages.push(pg3); fit(pg3, im, TOP, BOTTOM - TOP); });
    }
  }
  return pages;
}
// お試しの3日（TRIAL_FROM〜TRIAL_TO）のプリント: 系統1つを1枚に（例題→類題→例題をもう一度→基本。できたところでおしまい）。各ページの下に「おしまい」
//  例題をもう一度・類題をもう一度は、前のページの問題を見て解くので問題の絵は出さない
//  解き方ページとワークシートは、例題のすぐ後ろ（例題 → 解き方 → ワークシート → 類題。2026-10-21 ユーザー「明日から戻してほしい」）
async function trialPages(es, imgs, pages, {W, TOP, fit, askLine, ASK_H}) {
  const foot = (pg, t) => { const g = pg.g; g.save(); g.font = `700 30px ${FONT}`; g.fillStyle = "#1c6b78"; g.textAlign = "center"; g.fillText(t, PW / 2, PH - 14); g.restore(); };
  const sysE = es.map((e, k) => ({e, k})).filter(x => x.e.how !== "ichigyo");
  const snos = [...new Set(sysE.map(x => x.e.sno || 0))], lastSno = snos[snos.length - 1];
  pages.forEach((pg, i) => foot(pg, i < pages.length - 1 ? "つぎの紙へ" : snos.length ? "この1枚で おしまい" : "今日は これで おしまい"));   // 一行問題が2枚になる日もある
  pages.forEach((pg, i) => { pg.lab = pg.kumiLab || "一行-" + (i + 1); });
  const ichPages = pages.splice(0), jkPages = [];   // 授業の問題が先の日は、授業の問題 → 一行問題 → セット の順に並べ直す
  const jkFirst = es.length && es[0].how === "juku";
  for (const sn of snos) { const pStart = pages.length;
    const grp = sysE.filter(x => (x.e.sno || 0) === sn), e0 = grp[0].e;
    const su = e0.m.UNITS.find(x => x.id === e0.sys) || e0.m.UNIT_OF[e0.p.id], vd = sysVideo(e0.k, e0.sys);
    // 1つの系統は2ページ: 表＝例題・類題、次＝例題をもう一度・基本（または類題をもう一度）。1ページに4問では式を書く所がなくなるため
    const cut = grp.findIndex(x => isAgain2(x.e)), juku = e0.how === "juku";
    // 動画の問題（塾の問題）は1ページに2問ずつ
    // 系統: 1問1枚。例題 → 解き方・ワークシート → 類題 → 例題をもう一度 → 基本（または類題をもう一度）（2026-10-21 ユーザー「別の紙のがいいです」）
    const sysParts = () => grp.map(x => [x]);
    const parts = juku ? grp.reduce((a, x, i) => (i % 2 ? a[a.length - 1].push(x) : a.push([x]), a), []) : sysParts();
    for (let pi = 0; pi < parts.length; pi++) { const part = parts[pi];
      const pg = newPage(`${blockName(e0)}　${kaiName(e0.k)}` + (su && !juku ? ` ${su.label}の系統` : ""), (juku ? "予習ナビの授業動画で やった問題。動画を見てから解こう" : (su ? su.name + "　" : "") + "上から順に。できたら そこで おしまい")), g = pg.g; pages.push(pg);
      if (!pi) timeBoxes(g);
      let y = TOP;
      if (false && vd && !pi && !juku) {   // 系統の「先に動画を見よう」は出さない（2026-10-22 ユーザー「塾の問題じゃないので、先に動画見なくていい」）
       g.fillStyle = "#fff4e3"; g.fillRect(PM, y, W, 64); g.strokeStyle = "#e8962f"; g.lineWidth = 3; g.strokeRect(PM, y, W, 64);
        g.font = `700 28px ${FONT}`; g.fillStyle = "#b5651d"; g.fillText(`▶ 先に動画を見よう：${vd.no}の解説（${vd.len}）。見てから下の問題へ`, PM + 20, y + 42);
        g.font = `400 22px ${FONT}`; g.fillStyle = "#555"; g.fillText("動画は、アプリの「今日のプリント」で ▶ を押すと見られます", PM + 20, y + 92); y += 112; }
      const again = e => isAgain2(e) || e.how === "rui2";   // 前に出た問題をもう一度（絵は出さない）
      const wt = x => 1, slot0 = (PH - 60 - y) / part.reduce((a, x) => a + wt(x), 0);
      part.forEach(x => { const {e, k} = x, slot = slot0 * wt(x);
        const [hl, hc] = HOWS[e.how] || HOWS.alone, sp = e.subs.length < e.p.subs.length;
        g.font = `700 34px ${FONT}`; g.fillStyle = "#111"; g.fillText(e.p.no + (sp ? " " + e.subs.map(i => subName(e.p, i)).join("") : ""), PM, y + 36);
        g.font = `700 24px ${FONT}`; const tw = g.measureText(hl).width + 36; g.fillStyle = hc; g.fillRect(PW - PM - tw, y + 6, tw, 42); g.fillStyle = "#fff"; g.fillText(hl, PW - PM - tw + 18, y + 36);
        const pv = juku && probVideo(e.k, e.p.id);   // 動画の問題: 解説動画があれば一言（アプリで ▶ を押す）
        if (pv) { g.font = `700 22px ${FONT}`; g.fillStyle = "#b5651d"; g.fillText(`▶ 解説動画 ${pv.len}（アプリの今日のプリントで ▶ を押す）`, PM + 300, y + 34); }
        let yy = y + 54; const pa = prevAnsText(e);
        if (pa) { g.font = `700 24px ${FONT}`; g.fillStyle = "#1c6b78"; g.fillText(pa, PM, yy + 24); g.fillStyle = "#111"; yy += 36; }
        // 例題をもう一度も問題の絵を出す（1問1枚になったので場所がある。2026-10-24 ユーザー「二回目の例題に問題が入ってない」）
        if (again(e)) { g.font = `400 24px ${FONT}`; g.fillStyle = "#555"; g.fillText(`解き方を見ないで もう一度`, PM, yy + 24); yy += 40; }
        if (imgs[k]) { yy = askLine(g, PM, yy); yy = fit(pg, imgs[k], yy, Math.max(120, slot - 54 - 84 - 260 - ASK_H)) + 10; }   // 式を書く所を 260 は残す
        const ay = y + slot - 84;
        g.strokeStyle = "#9fb0c8"; g.lineWidth = 2; g.strokeRect(PM, yy, W, Math.max(40, ay - 8 - yy));
        g.font = `400 22px ${FONT}`; g.fillStyle = "#7a8698"; g.fillText(sysTool(e.k, e.sys) !== "hi" ? "表と式" : "式", PM + 14, yy + 28);
        g.font = `700 26px ${FONT}`; g.fillStyle = "#111"; g.fillText("答え", PM, ay + 46);
        const n = e.subs.length, bw = Math.min(280, (W - 110) / n - 70);
        e.subs.forEach((si, i) => { const bx = PM + 80 + i * (bw + 70); g.font = `700 24px ${FONT}`; g.fillText(subName(e.p, si) || "", bx, ay + 46); g.lineWidth = 2; g.strokeStyle = "#222"; g.strokeRect(bx + 52, ay + 8, bw, 60); });
        y += slot; });
      foot(pg, pi < parts.length - 1 ? (juku ? "つぎの紙へ" : "できたら ここで おしまい。まだなら 次の紙へ") : sn === lastSno ? "今日は これで おしまい" : "この1枚で おしまい");
      // 例題の紙のすぐ後ろに、その例題の解き方ページとワークシート
      for (const {e} of part.filter(x => x.e.how === "rei1" || (x.e.how === "together" && x.e.sys))) await helpPages(e);
      // ★例題の1回目がない系統（類題が先）は、類題の解き方・ワークシートがあれば類題のすぐ後ろに（2026-10-30 ユーザー「類題5のワークシートが欲しい」）
      if (!grp.some(x => x.e.how === "rei1")) for (const {e} of part.filter(x => x.e.how === "rui" && (((window.EASY || {})[x.e.k] || {})[x.e.p.id] || {}).ana)) await helpPages(e);
    }
    // ★ページ番号: セットごとに「①-1」「①-2」…（2026-10-29 ユーザー「セットごとに ①-1ページみたいなかんじで」）。授業の問題は「授業-1」
    const setNo = snos.filter(s => sysE.some(x => (x.e.sno || 0) === s && x.e.how !== "juku")).indexOf(sn);
    pages.slice(pStart).forEach((pg, i) => { pg.lab = (juku ? "授業" : MARU[setNo]) + "-" + (i + 1); });
    if (grp[0].e.how === "juku") jkPages.push(...pages.splice(pStart));   // 授業の問題の紙はいったん取り分ける
  }
  pages.concat(ichPages, jkPages).forEach(pg => { if (!pg.lab) return; const g = pg.g; g.save(); g.font = `700 34px ${FONT}`; g.fillStyle = "#111"; g.textAlign = "left"; g.fillText(pg.lab, PM, PH - 14); g.restore(); });
  // 並び: 授業の問題が先の日は 授業の問題 → 一行問題 → セット。そうでなければ 一行問題 → セット → 授業の問題（前の形）
  pages.splice(0, 0, ...(jkFirst ? [...jkPages, ...ichPages] : ichPages));
  if (!jkFirst) pages.push(...jkPages);
  // ★一行問題の答え（おうちの方用）を最後に1枚（2026-10-25 ユーザー「一行問題の答えはつけてください」。機内などアプリが開けないときの答え合わせ用）
  const ich = es.filter(e => e.how === "ichigyo");
  // ★2026-10-29 ユーザー「最後の一行問題の答えいらないです」→ 出さない
  if (false && ich.length) { const pg = newPage("一行問題の答え（おうちの方用）", "子どもに見せないでね。アプリが開けないときの答え合わせ用"), g = pg.g; pages.push(pg); let y = TOP + 20;
    ich.forEach((e, oi) => { const ka = (((window.KEYS || {})[e.k] || {})[e.p.id] || {}).a || [];
      const ans = e.subs.map(i => (e.subs.length > 1 || e.p.subs.length > 1 ? (subName(e.p, i) || "") + " " : "") + (ka[i] || "（本の答えを見てね）")).join("　");
      g.font = `700 30px ${FONT}`; g.fillStyle = "#111"; g.fillText(`${MARU[oi]} ${kaiName(e.k)} ${e.p.no}`, PM, y + 30);
      g.font = `700 32px ${FONT}`; g.fillStyle = "#c0392b"; g.fillText("答え　" + ans, PM + 40, y + 78); y += 120; }); }
  return pages;
  async function helpPages(e) {
    const ez = ((window.EASY || {})[e.k] || {})[e.p.id], su = e.m.UNITS.find(x => x.id === e.sys), title = `${kaiName(e.k)} ${e.p.no}` + (su ? `（${su.label}の系統）` : "");
    const srcs = ez ? (ez.printImgs || ez.imgs) : (e.p.ans || []).map((_, i) => imgSrc(`img/${e.k}/a_${e.p.id}_${i}.png`));
    const ims = (await Promise.all(srcs.map(s => loadImg(s).catch(() => null)))).filter(Boolean);
    ims.forEach(im => { const pg2 = newPage(title + "　解き方", "分からなかったら読もう（答えが見えます）。読んだら次のワークシートへ"); pages.push(pg2); fit(pg2, im, TOP, PH - 40 - TOP); });
    const anas = ez && ez.ana ? (await Promise.all(ez.ana.map(s => loadImg(s).catch(() => null)))).filter(Boolean) : [];
    anas.forEach(im => { const pg3 = newPage(title + "　ワークシート", "解き方ページを見ながら、表と（　）を埋めて解こう。そのあと次の類題へ"); pages.push(pg3); fit(pg3, im, TOP, PH - 40 - TOP); });
  }
}
async function makePdf(opt) {
  if (window.loadHeavy) await loadHeavy();   // 解き方・ワークシートのページに使う（開くときは読んでいない）
  opt = opt && opt.entries ? opt : {};
  if (!window.jspdf) { dayMsg = "PDFを作る部品が読みこめませんでした。ページを開き直してね。"; return renderToday(); }
  dayBusy = true; dayMsg = "PDFを作っています…"; renderToday();
  try {
    try { await document.fonts.ready; } catch (e) {}
    if (!opt.entries) jukuLast();
    const es = opt.entries || dayEntries();
    await imgPreloadEntries(es);
    // 系統ごとのプリント（how のある日）は sysPages。それ以外は前の作り方
    const pages = es.some(e => e.how) ? await sysPages(es) : await (async () => {
    const imgs = await Promise.all(es.map(e => loadImg(imgSrc(e.p.img))));
    // 昨日×の例題の解き方（本の解き方の画像）。類題の前のページに出す
    // 2026-10-12 ユーザー「問題がないので意味が分からない」「やさしい解き方のほうで」→ 例題の問題 ＋ やさしい説明（easy_0N.js。無いときだけ本の解き方）
    const revImgs = await Promise.all(es.map(e => { const q = e.rev && e.m.ITEMS[e.rev]; if (!q) return null;
      const ez = ((window.EASY || {})[e.k] || {})[q.id];
      // やさしい説明のページには問題がのっているので、そのまま（printImgs＝「きまり」のページなし）。無いときは 問題 ＋ 本の解き方
      if (ez) return Promise.all((ez.printImgs || ez.imgs).map(src => loadImg(src).catch(() => null))).then(a => ({ez: true, a}));
      const srcs = (q.ans || []).map((_, i) => imgSrc(`img/${e.k}/a_${q.id}_${i}.png`));
      if (!srcs.length) return null;
      return Promise.all([q.img ? loadImg(imgSrc(q.img)).catch(() => null) : null, ...srcs.map(src => loadImg(src).catch(() => null))]).then(a => ({ez: false, a})); }));
    const pages = [];
    const head = `算数 ${todayLabel()}`;
    // 1問ずつ: 問題 → その下に「式・考え方」の枠と、小問ごとの答えの□
    // ページ割り: 2問入るなら2問（画像は高さ360まで縮め、余った分は式の枠に足す）。
    // 1問だけのページは、画像を縮めず、式の枠をページの下まで広げる
    const W = PW - 2 * PM, fw = 300, fh = 84, gap = 22, IH = 360, BH0 = 316, TOP = 165, BOTTOM = PH - 40;
    const lay = es.map((e, k) => {
      const n = e.subs.length, slot = fw + 112 + gap, perRow = Math.max(1, Math.min(n, Math.floor((W - 32 + gap) / slot))), rows = Math.ceil(n / perRow);
      const fullH = imgs[k].height * W / imgs[k].width;
      return {e, k, perRow, rows, fullH, smallH: Math.min(fullH, IH), bhMin: BH0 + (rows - 1) * (fh + 10)};
    });
    const need = (L, small) => 48 + (small ? L.smallH : L.fullH) + 12 + L.bhMin + 28;
    // セット: 小問 SET_SIZE ごとに区切る（1つの問題の(1)(2)…は分けない）。セットの始まりは新しいページ（2026-10-07 ユーザー）
    const sets = splitSets(lay);
    const groups = [];   // [{grp, set, first}]
    sets.forEach((S, si) => { let gi = 0, first = true;
      while (gi < S.length) {
        const two = gi + 1 < S.length && need(S[gi], true) + need(S[gi + 1], true) <= BOTTOM - TOP;
        groups.push({grp: two ? [S[gi], S[gi + 1]] : [S[gi]], set: si, first, n: S.reduce((a, L) => a + itemW(L.e.k, L.e.p.id, L.e.subs.length), 0)}); gi += two ? 2 : 1; first = false; } });
    groups.forEach(({grp, set, first, n}, gix) => {
      const multi = sets.length > 1;
      const title = multi ? `セット${set + 1}／${sets.length}（${n}問）${first ? "" : "つづき"}` : (gix ? "今日のプリント（つづき）" : "今日のプリント");
      // この中に「昨日まちがえた例題」の類題があれば、その前に例題の解き方のページ
      grp.forEach(L => { const ri = revImgs[L.k]; if (!ri) return; const q = L.e.m.ITEMS[L.e.rev];
        const rp = newPage(`昨日まちがえた ${kaiName(L.e.k)} ${q.no}`, "解き方を読んで、考え方を確かめよう。そのあと次のページの" + L.e.p.no + "を、何も見ずに解こう。"); pages.push(rp);
        // 1枚目＝問題（見出し「問題」）、そのあと説明。入らなければ次のページへ
        let cur = rp, yy = TOP + 10; const avail = BOTTOM - TOP - 10;
        ri.a.forEach((im, ix) => { if (!im) return;
          if (ri.ez) {}
          else if (ix === 0) { cur.g.font = `700 30px ${FONT}`; cur.g.fillStyle = "#111"; cur.g.fillText("問題", PM, yy + 28); yy += 40; }
          else if (ix === 1) { cur.g.font = `700 30px ${FONT}`; cur.g.fillStyle = "#111"; cur.g.fillText("解き方", PM, yy + 28); yy += 40; }
          let ww = W, hh = im.height * W / im.width; if (hh > avail - 40) { hh = avail - 40; ww = im.width * hh / im.height; }
          if (yy + hh > BOTTOM) { cur = newPage(`昨日まちがえた ${kaiName(L.e.k)} ${q.no}（つづき）`, ""); pages.push(cur); yy = TOP + 10; }
          cur.g.drawImage(im, PM, yy, ww, hh); yy += hh + 20; }); });
      const pg = newPage(title, head + (gix ? "" : "　式も書こう。答えは□に。わからない問題はとばして、最後にもどろう。")); pages.push(pg);
      if (first) timeBoxes(pg.g);
      const g = pg.g, single = grp.length === 1;
      // 1問だけ: 画像は本の大きさ（入りきらないときだけ縮める）
      const ihs = grp.map(L => single ? Math.min(L.fullH, BOTTOM - TOP - 48 - 12 - L.bhMin - 28) : L.smallH);
      const extra = (BOTTOM - TOP) - grp.reduce((a, L, j) => a + 48 + ihs[j] + 12 + L.bhMin + 28, 0);
      let y = TOP;
      grp.forEach((L, j) => {
        const {e, k, perRow, rows} = L, p = e.p, ih = ihs[j], iw = W * ih / L.fullH;
        const bh = L.bhMin + Math.max(0, Math.floor(extra / grp.length));
        g.font = `700 40px ${FONT}`; g.fillStyle = "#111"; g.fillText(MARU[k], PM, y + 38);
        g.font = `700 28px ${FONT}`; g.fillText(entryLabel(e) + (e.rev ? "（昨日の例題の練習）" : ""), PM + 54, y + 34);
        // これまでの記録（いつ◎×だったか・×の回数）を右上に小さく
        { g.font = `700 28px ${FONT}`; const lw = g.measureText(entryLabel(e)).width;
          g.font = `400 20px ${FONT}`; g.fillStyle = "#555"; g.textAlign = "right";
          const hs = histLine(e); let txt = hs[0];
          for (let cut = 1; PM + 54 + lw + 24 + g.measureText(txt).width > PW - PM && cut < hs.length; cut++) txt = hs[cut];
          g.fillText(txt, PW - PM, y + 34); g.textAlign = "left"; g.fillStyle = "#111"; }
        g.drawImage(imgs[k], PM, y + 48, iw, ih);
        const top = y + 48 + ih + 12;
        g.strokeStyle = "#222"; g.lineWidth = 3; g.strokeRect(PM, top, W, bh);
        g.font = `700 26px ${FONT}`; g.fillText(MARU[k], PM + 12, top + 34);
        g.font = `400 20px ${FONT}`; g.fillStyle = "#777"; g.fillText("式・考え方", PM + 50, top + 31); g.fillStyle = "#111";
        // テストの直し: 先に読むヒント（答えの数字は入っていない）。「説明 → 何も見ずに解き直す」の順にするため
        const hint = (((window.KEYS || {})[p.kai] || {})[p.id] || {}).hint;
        if (hint) { g.font = `700 22px ${FONT}`; g.fillStyle = "#1c6b78"; let hx = PM + 180, hy = top + 31;
          g.fillText("ヒント", hx, hy); g.font = `400 21px ${FONT}`; g.fillStyle = "#222";
          let line = "", lx = hx + 80;
          for (const ch of hint) { if (g.measureText(line + ch).width > PW - PM - 20 - lx) { g.fillText(line, lx, hy); hy += 30; line = ""; lx = hx; } line += ch; }
          if (line) g.fillText(line, lx, hy); g.fillStyle = "#111"; }
        // 前の小問だけ済んでいて(2)などだけ出すとき: 前の小問の答えを書いておく（(1)の答えがないと解けないため。2026-10-09 ユーザー）
        { const first = Math.min(...e.subs), ka = (((window.KEYS || {})[p.kai] || {})[p.id] || {}).a || [];
          const prev = []; for (let i = 0; i < first; i++) if (ka[i]) prev.push(`${subName(p, i) || "(" + (i + 1) + ")"} ${ka[i]}`);
          if (prev.length) { const py = top + (hint ? 31 + 30 * 3 : 31) + (hint ? 0 : 0);
            g.font = `700 21px ${FONT}`; g.fillStyle = "#1c6b78"; const lab = "前の問題の答え", lx0 = PM + (hint ? 50 : 180);
            const yy = hint ? py : top + 31; g.fillText(lab, lx0, yy); g.font = `400 21px ${FONT}`; g.fillStyle = "#222";
            g.fillText(prev.join("　").slice(0, 60), lx0 + 170, yy); g.fillStyle = "#111"; } }
        e.subs.forEach((si, i) => {
          const sname = subName(p, si), r = Math.floor(i / perRow), c = i % perRow;
          const x = PW - PM - 16 - (perRow - c) * (fw + 112 + gap) + gap, yy = top + bh - 14 - (rows - r) * (fh + 10) + 10;
          g.font = `700 28px ${FONT}`; g.fillText(sname || "答え", x, yy + 52);
          g.lineWidth = 2; g.strokeRect(x + 106, yy, fw, fh);
        });
        y = top + bh + 28;
      });
    });
    return pages; })();
    const {jsPDF} = window.jspdf;
    const pdf = new jsPDF({unit: "mm", format: "a4"});
    pages.forEach((p, i) => { if (i) pdf.addPage(); pdf.addImage(p.c.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, 210, 297); });
    const blob = pdf.output("blob");
    await capReady;
    let saved = false, why = "";
    if (downloads) {
      try { await downloads.save({filename: opt.name || `算数プリント_${todayKey()}.pdf`, data: blob}); saved = true; dayMsg = opt.msg || "保存しました。印刷して始めよう！"; }
      catch (e) { why = e && e.code; if (why === "declined") { dayMsg = "保存をやめました。"; saved = true; } }
    }
    if (!saved) {
      // 保存できない画面では、PDFをアプリに置いて開けるようにする（ブラウザのPDF表示から印刷）
      if (assets) {
        try {
          try { const old = localStorage.getItem("sansu-step-pdfid"); if (old) await assets.delete(old).catch(() => {}); } catch (e) {}
          const r = await assets.upload(new Blob([blob], {type: "application/pdf"}), {type: "application/pdf"});
          try { localStorage.setItem("sansu-step-pdfid", r.id); } catch (e) {}
          pdfUrl = r.url; dayMsg = "PDFができました。下の「PDFを開く」から開いて印刷してね。";
        } catch (e) { dayMsg = "PDFを保存できませんでした（" + ((e && e.code) || why || "原因不明") + "）。"; }
      } else dayMsg = "この画面ではPDFを保存できません（" + (why || "保存の機能が使えない画面") + "）。ブラウザで claude.ai を開いてね。";
    }
  } catch (e) {
    dayMsg = "PDFを作れませんでした（" + ((e && (e.code || e.message)) || "原因不明") + "）。もう一度押してね。";
  }
  dayBusy = false; renderToday();
}

/* ---- 解いたプリントの写真で、まとめて◎付け ---- */
async function gradeDay() {
  dayBusy = true; dayMsg = "◎付けしています…（1分くらいかかることがあります）"; renderToday();
  const es = dayEntries();
  const keyOf = e => ((window.KEYS || {})[e.k] || {})[e.p.id];
  const list = es.map((e, j) => {
    const key = keyOf(e);
    return `${MARU[j]} ${e.p.no}\n` + e.subs.map(i => `  ${subName(e.p, i) || "答え"}: ` + (key ? `正しい答え「${key.a[i]}」` : "（正しい答えなし。読み取りだけ）")).join("\n");
  }).join("\n");
  const prompt = `あなたは小学5年生の算数の丸付けをする先生です。写真は、子どもが解いたプリントです。
プリントには問題ごとに、丸数字（①②…）と問題文が印刷され、その下に「式・考え方」の枠があります。枠の右下の□に、小問ごとの答えが書いてあります。問題文の中の数字は答えではありません。

【問題と本の正しい答え】
${list}

【やること】
- 丸数字で問題を見分け、小問ごとに□の中の答えを読み取る。
- 「正しい答え」がある小問は、それと同じかどうかを判定する。自分で解き直して判定を変えてはいけない。
- 比は順番も同じでなければ×。約分していない比は◎。単位を書き忘れただけなら◎。答えが複数ある問題は、全部そろっていて余分がないときだけ◎。
- 「正しい答えなし」の小問は、読み取りだけして correct を null にする。
- 読み取れない小問は read を null、correct を null にする。当て推量で判定しない。

次のJSONだけを返してください:
{"items":[{"no":"①","subs":[{"sub":"(1)","read":"子どもの答え","correct":true}]}],"comment":"子どもへの一言。やさしく1〜2文"}`;
  try {
    const r = await sample.json(prompt, {images: dayPhotos.slice(0, 20)});
    const got = Array.isArray(r && r.items) ? r.items : [];
    dayMarks = {};
    for (const [j, e] of es.entries()) {
      const it = got.find(x => x && x.no === MARU[j]) || got[j] || {subs: []};
      const subs = Array.isArray(it.subs) ? it.subs : [];
      const mk = e.subs.map((i, jj) => {
        const s = subName(e.p, i);
        const m = subs.find(x => x && x.sub === (s || "答え")) || subs[jj] || {};
        return {i, read: m.read ?? null, correct: keyOf(e) ? (m.correct === true ? true : m.correct === false ? false : null) : null};
      });
      dayMarks[e.k + ":" + e.p.id] = mk;
      if (isAgain2(e)) { for (const m of mk) if (m.correct !== null) REI2[r2key(e.k, e.p.id, m.i)] = m.correct; REI2_T = Date.now(); if (db) { try { await db.doc("rei2rec/" + todayKey()).set({marks: REI2, t: REI2_T}); } catch (e2) {} } continue; }
      for (const m of mk) if (m.correct !== null) await addTry(e.k, e.p, m.i, {ok: m.correct, t: Date.now(), by: "claude", read: m.read});
    }
    const ng = Object.values(dayMarks).filter(mk => mk.some(m => m.correct === false)).length;
    dayMsg = (typeof r.comment === "string" ? r.comment + "　" : "") + (ng ? `×の問題は、問題名を押すと解説が見られるよ。明日のプリントにもまた入ります。` : "");
  } catch (e) {
    dayMsg = e.code === "rate_limited" ? "少し待ってから、もう一度押してね。" : e.code === "image_rejected" ? "送れない写真がありました。撮り直してね。" : "◎付けできませんでした。もう一度押してね。";
  }
  dayBusy = false; render();
}

/* ---- 押しても見ている場所を動かさない・開いたパネルを閉じない（2026-10-10 ユーザー「選んだり外したりすると画面が移動したりパネルが閉じたりして使いづらい」）----
   押すたびに全体を描き直す作りはそのまま。描き直す前に ①#today・#dash の details の開閉 ②押したボタン（無ければ画面に見えている先頭のボタン）の画面上の位置 を覚え、
   描き直したあとに戻す。押したボタンが同じ高さに残るので、上の一覧が1行ふえても見ている場所はずれない */
const VIEW = {open: {}, click: null, depth: 0};
const VIEW_BOX = "#today, #dash";
const detKey = d => { const s = d.closest("#today, #dash"); const sm = d.querySelector(":scope > summary");
  return (s ? s.id : "") + ":" + (d.dataset.key || d.id || (sm ? sm.textContent : "").trim().split(/[\s　（(]/)[0]); };
const anchorOf = el => { if (!el) return null;
  const a = [...el.attributes].find(x => x.name.startsWith("data-") && x.name !== "data-key") || (el.id ? {name: "id", value: el.id} : null);
  if (!a) return null; const sel = a.name === "id" ? "#" + CSS.escape(a.value) : `[${a.name}="${CSS.escape(a.value)}"]`;
  const all = [...document.querySelectorAll(sel)]; return {sel, idx: Math.max(0, all.indexOf(el)), top: el.getBoundingClientRect().top}; };
const visible = el => el && el.getClientRects().length > 0;
document.addEventListener("click", e => { const t = e.target.closest && e.target.closest("[data-psub],[data-pick],[data-peek],[data-dsel],[data-drm],[data-trm],[data-cyck],[data-cytk],[data-uskip],[data-logkai],[data-dact],button[id],summary");
  if (t && t.closest(VIEW_BOX)) VIEW.click = {el: t, t: Date.now()}; }, true);
function keepView(fn) {
  return function (...args) {
    if (VIEW.depth++) { try { return fn.apply(this, args); } finally { VIEW.depth--; } }
    let anchors = [];
    try {
      document.querySelectorAll("#today details, #dash details").forEach(d => VIEW.open[detKey(d)] = d.open);
      const c = VIEW.click && Date.now() - VIEW.click.t < 15000 && document.contains(VIEW.click.el) ? VIEW.click.el : null;
      const sum = c && c.tagName === "SUMMARY" ? c : null;   // summary を押したときは、その details の中ではなく summary そのものを目印に
      const first = [...document.querySelectorAll("#today [data-psub], #today [data-pick], #today [data-drm], #dash [data-dsel], #today summary, #dash summary")]
        .find(x => { const r = x.getBoundingClientRect(); return r.height && r.top >= 0 && r.top < innerHeight; });
      anchors = [sum ? null : anchorOf(c), first ? anchorOf(first) : null].filter(Boolean);
    } catch (e) {}
    try { return fn.apply(this, args); }
    finally {
      VIEW.depth--;
      try {
        document.querySelectorAll("#today details, #dash details").forEach(d => { const k = detKey(d); if (k in VIEW.open && d.open !== VIEW.open[k]) d.open = VIEW.open[k]; });
        for (const a of anchors) { const el = document.querySelectorAll(a.sel)[a.idx];
          if (visible(el)) { const dy = el.getBoundingClientRect().top - a.top; if (Math.abs(dy) > 1) window.scrollBy(0, dy); break; } }
      } catch (e) {}
    }
  };
}
window.keepView = keepView;
renderToday = keepView(renderToday);

/* ---- つなぎこみ ---- */
const _renderBase = render;
// どこかで止まっても、ほかの部分は出す。エラーは画面に小さく出す（原因を調べるため）
window.SHOWERR = window.SHOWERR || [];
const safe = (name, f) => { try { f(); } catch (e) { SHOWERR.push(name + ": " + (e && e.message)); console.error(e); showErr(); } };
function showErr() { let b = document.getElementById("errbox"); if (!b) { b = document.createElement("p"); b.id = "errbox"; b.className = "note diag"; document.querySelector(".wrap").append(b); }
  b.textContent = "（表示のエラー: " + [...new Set(SHOWERR)].slice(-3).join(" / ") + "）"; }
window.addEventListener("error", e => { SHOWERR.push((e.message || "") + " @" + ((e.filename || "").split("/").pop()) + ":" + e.lineno); showErr(); });
render = keepView(function () { safe("main", _renderBase); safe("today", renderToday); if (window.renderDash) safe("dash", renderDash); });
render();   // まずこの端末の保存で出す（アプリの保存先は後から届く）
(async () => {
  if (!window.claude) return;
  const d = await claude.use("db").catch(() => null);
  if (d) {
    // 前の版の保存先（日付の文書）しか無ければ、それを読む
    try { const cur = await d.doc(DAYC + "/current").get(); if (!cur.exists) { const old = await d.doc(DAYC + "/" + todayKey()).get(); if (old.exists && dayValid(old.data())) { day = JSON.parse(JSON.stringify(old.data())); await d.doc(DAYC + "/current").set(day); } } } catch (e) {}
    let autoPrep = false;
    d.doc(DAYC + "/current").onSnapshot(s => { if (!autoPrep && s.exists && MODE === "parent") { autoPrep = true; setTimeout(() => { if (day && sample) prepareViz(); }, 1500); } if (s.exists && dayValid(s.data())) { day = JSON.parse(JSON.stringify(s.data())); if (!s.metadata || !s.metadata.fromCache) dayFromDb = true; try { localStorage.setItem("sansu-step-dayAll", JSON.stringify(day)); } catch (e) {} } else if (!s.metadata.fromCache) day = null; if (!dayBusy) render(); }, () => {});
    // 担当が前もって用意した下書き（ROLE.md「プリントを用意する」）。前の日のプリントが残っていても覚えておき、「新しく作る」で使う（2026-10-11）
    d.doc("rei2rec/" + todayKey()).onSnapshot(s => { if (s.exists && s.data().marks && (s.data().t || 0) >= REI2_T) { REI2 = JSON.parse(JSON.stringify(s.data().marks)); if (!dayBusy) render(); } }, () => {});
    d.doc("settings/kinai").onSnapshot(s => { kinai = s.exists && Array.isArray(s.data().items) ? s.data() : null; if (!dayBusy) render(); }, () => {});
    d.doc("settings/draft").onSnapshot(s => { draftSeen = true; if (s.exists && Array.isArray(s.data().items)) preDraft = {items: s.data().items, t: s.data().t || 0}; if (!s.exists || day) return; const it = s.data().items; const js = JSON.stringify(it || []);
      if (Array.isArray(it) && js !== lastDraftJs) { draft = JSON.parse(js); lastDraftJs = js; try { localStorage.setItem("sansu-step-draft", js); } catch (e) {} if (!dayBusy) renderToday(); } }, () => {});
  }
  render();
})();

/* ---- 一行問題を画面で解く（2026-10-31 ユーザー「一行問題は画面でできるように」「問題の下に解答欄」「丸付けは全部終わってから」） ----
   問題の絵の下に 式の欄と答えの欄。ペンで書く（指は画面を動かす。「指で書く」で指でも書ける）。
   書いたものはこの端末に、その日の分だけ残す。丸付けは「全部おわった」のあとに、答えを見て ◎× を押す（今日の記録をつける） */
const ICS = {open: false, grade: false, pen: "#111", erase: false, finger: false, ink: {}, undo: [], cv: [], show: new Set(), ans: new Set()};
const icsKey = () => "sansu-ichi-ink-" + ((day && day.date) || todayKey());
// 画面で解く問題: 一行問題とセット（set が 1 以上）の問題。紙のプリントと同じ順（2026-11-01 ユーザー「セット問題もタブレットで」）
const icsEntries = () => dayEntries().filter(e => e.how === "ichigyo" || (e.set || 0) >= 1);
// 書いたものの名前。同じ問題を例題1回目と2回目で2度解くので、セットの問題は形とセットも入れる（一行問題は前のまま）
const icsId = e => e.k + ":" + e.p.id + ":" + e.subs.join(".") + (e.how === "ichigyo" ? "" : ":" + e.how + (e.set || 0));
// ◎×: 例題の2回目は REI2（rec* には書かない）、一緒には つけない、ほかは今日の記録（紙の写真の◎付けと同じ分け方）
const icsNow = (e, i) => { if (isAgain2(e)) { const v = REI2[r2key(e.k, e.p.id, i)]; return v === true ? 1 : v === false ? 0 : -1; }
  const l = e.m.last(e.p, i); return l && isToday(l.t) ? (l.ok ? 1 : 0) : -1; };
const icsMarkable = e => e.how !== "together";
const icsWs = e => { const ez = ((window.EASY || {})[e.k] || {})[e.p.id]; return ez && ez.ana ? ez.ana : []; };
const icsIds = e => [icsId(e)].concat(icsWs(e).map((_, j) => icsId(e) + ":ws" + j));
// 前の日に×だった例題の読む欄。紙のプリントの「昨日まちがえた 例題」のページと同じ中身で、その類題の前に出す（2026-11-01 ユーザー）
function icsRev(e) { const q = e.rev && e.m.ITEMS[e.rev]; if (!q) return "";
  const ez = ((window.EASY || {})[e.k] || {})[q.id];
  const srcs = ez ? (ez.printImgs || ez.imgs) : [imgSrc(q.img)].concat((q.ans || []).map((_, i) => imgSrc(`img/${e.k}/a_${q.id}_${i}.png`)));
  return `<div class="icsQ" style="border-color:#e8962f"><h3 style="color:#c0392b">昨日まちがえた ${esc(kaiName(e.k) + " " + q.no)}</h3>
    <p style="margin:0 0 6px;font-size:17px">解き方を読んで、考え方を確かめよう。そのあと次の ${esc(e.p.no)} を、何も見ずに解こう。</p>
    ${srcs.map(s => `<img src="${s}" alt="${esc(q.no)}の解き方" style="display:block;width:100%;margin-top:8px;border:1px solid #ccc;border-radius:4px;background:#fff">`).join("")}</div>`; }
function icsLoad() { try { ICS.ink = JSON.parse(localStorage.getItem(icsKey()) || "{}"); } catch (e) { ICS.ink = {}; } }
function icsSave(id) { try { localStorage.setItem(icsKey(), JSON.stringify(ICS.ink)); } catch (e) {} if (id) icsDbSave(id); }
// 書いたものは保存の場所（db）にも1問ずつ置く。iPad のアプリの中では、端末の保存が開き直すと消えていた（2026-11-01）
const icsDocId = id => "ink/" + encodeURIComponent(icsKey() + "|" + id).replace(/[%.]/g, "_");
const icsTimers = {};
function icsDbSave(id) { clearTimeout(icsTimers[id]); icsTimers[id] = setTimeout(() => { if (db) db.doc(icsDocId(id)).set({s: JSON.stringify(ICS.ink[id] || []), t: Date.now()}).catch(() => {}); }, 800); }
async function icsDbLoad(es) { if (!db) return false; let got = false;
  await Promise.all(es.flatMap(icsIds).map(async id => { if ((ICS.ink[id] || []).length) return;
    try { const d = await db.doc(icsDocId(id)).get(); if (d.exists && d.data().s) { const a = JSON.parse(d.data().s); if (a.length) { ICS.ink[id] = a; got = true; } } } catch (x) {} }));
  if (got) { try { localStorage.setItem(icsKey(), JSON.stringify(ICS.ink)); } catch (x) {} } return got; }
// 今日の ◎× をつける（今日もうついていればつけ直し、なければ足す。前の日の記録はさわらない）
async function icsMark(k, p, i, ok) {
  const key = MS[k].sk(p, i), arr = recOf(k)[key] || [], l = arr[arr.length - 1];
  const by = MODE === "child" ? "kid" : "hand";
  if (l && isToday(l.t)) return writeRec(k, key, arr.slice(0, -1).concat([Object.assign({}, l, {ok, by})]), "画面の一行問題");
  return writeRec(k, key, arr.concat([{ok, t: Date.now(), by}]), "画面の一行問題");
}
function icsOpen() { icsLoad(); ICS.open = true; ICS.grade = false; ICS.undo = []; ICS.show = new Set(); ICS.ans = new Set(); icsRender();
  if (icsEntries().some(e => e.rev)) imgPreloadEntries(icsEntries()).then(() => { if (ICS.open) icsRender(); });
  // 昨日×の例題の欄はやさしい説明（easy_*）を使う。その日だけ、開いたあとで読む（2026-11-06）
  if (icsEntries().some(e => e.rev) && window.loadHeavy && !window.heavyDone) loadHeavy().then(() => { if (ICS.open) icsRender(); });
  icsDbLoad(icsEntries()).then(g => { if (g && ICS.open) ICS.cv.forEach(c => c.draw()); }); }
function icsClose() { ICS.open = false; const o = document.getElementById("ichiScr"); if (o) o.remove(); document.body.style.overflow = ""; render(); }
// 解説（この画面の中に出す）: 保護者の画面の「3 解説」と同じものを全部出す（2026-11-02 ユーザー「省略されてそうなので全部入れて」。前は1つ見つかったら終わりだった）
//  やさしい説明・動画はその問題のものだけ／本の解答・解き方の文・図は、その問題に無ければ系統の例題／板書はその問題→同じ型→系統の例題
const icsExTargets = e => { const u = e.m.UNIT_OF[e.p.id], t = u && u.steps[0]; return t && t.id !== e.p.id ? [e.p, t] : [e.p]; };
function icsExpl(e) {
  const K = (window.KEYS || {})[e.k] || {}, EZ = (window.EASY || {})[e.k] || {}, LI = (window.LECTIMG || {})[e.k] || {}, FG = (window.FIGS || {})[e.k] || {}, VI = (window.VIDEOS || {})[e.k] || {};
  const p = e.p, ex = icsExTargets(e)[1] || p, of = q => q.id === p.id ? "" : `（${esc(q.no || "例題")}）`;
  const img = (src, alt) => `<img src="${src}" alt="${esc(alt)}" style="display:block;width:100%;max-width:900px;margin-top:8px;border:1px solid #ccc;border-radius:4px;background:#fff">`;
  const head = t => `<div style="margin-top:14px;font-size:18px;font-weight:700;color:#1c6b78;border-bottom:2px solid #1c6b78">${t}</div>`;
  const parts = [];
  const ez = EZ[p.id]; if (ez && ez.imgs && ez.imgs.length) parts.push(head("やさしい説明") + ez.imgs.map(s => img(s, "やさしい説明")).join(""));
  const fq = [p, ex].find(q => FG[q.id] && FG[q.id].length);
  if (fq) parts.push(head("図で見る" + of(fq)) + FG[fq.id].map((f, j) => `<div style="margin-top:8px;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--sheet);color:var(--ink)"><div style="font-size:16px;line-height:1.7"><b>${j + 1}/${FG[fq.id].length}</b>　${esc(f.t)}</div><div class="fs">${f.svg}</div></div>`).join(""));
  const hq = [p, ex].find(q => (K[q.id] || {}).how);
  if (hq) parts.push(head("解き方" + of(hq)) + `<div style="white-space:pre-wrap;line-height:1.8;margin-top:6px;font-size:17px">${esc(K[hq.id].how)}</div>`);
  const aq = [p, ex].find(q => (q.ans || []).length);
  if (aq) parts.push(head("本の解答" + of(aq)) + aq.ans.map((_, i) => img(imgSrc(`img/${e.k}/a_${aq.id}_${i}.png`), "本の解答")).join(""));
  const twin = id => id.startsWith("hanren") ? id.slice(3) : id.startsWith("han") ? "kihon" + id.slice(3) : id;
  const lq = [p, e.m.ITEMS[twin(p.id)], ex].find(q => q && LI[q.id]);
  if (lq) { const L = LI[lq.id]; parts.push(head("授業の板書" + of(lq)) + (Array.isArray(L) ? L : L.imgs).map(s => img(s, "授業の板書")).join("")); }
  const v = VI[p.id]; if (v && v.id) parts.push(head("解説動画" + (v.len ? `<span style="font-weight:400;font-size:15px">　${esc(v.len)}</span>` : "")) + `<video controls playsinline preload="none" style="display:block;width:100%;max-width:900px;margin-top:8px" src="${esc(furl(v.url || "/_blob/" + encodeURIComponent(v.id)))}"></video>`);
  if (!parts.length) return `<p class="note">この問題の解説はありません。</p>`;
  return `<div class="icsExpl">${parts.join("")}</div>`; }
function icsRender() {
  const es = icsEntries();
  let o = document.getElementById("ichiScr");
  const keepY = o ? o.querySelector(".icsBody").scrollTop : 0;
  const ckey = c => c.dataset.ics + "|" + (c.dataset.ws || "") + "|" + (c.dataset.part || "");
  const keepH = {}; if (o) o.querySelectorAll("canvas[data-ics]").forEach(c => { keepH[ckey(c)] = c.style.height; });
  const keepS = {}; if (o) o.querySelectorAll(".icsPinS[data-pin]").forEach(d => { keepS[d.dataset.pin] = d.scrollTop; });
  if (!o) { o = document.createElement("div"); o.id = "ichiScr"; document.body.appendChild(o); }
  document.body.style.overflow = "hidden";
  const tool = (id, lab, on) => `<button class="${on ? "primary" : "ghost"}" id="${id}">${lab}</button>`;
  const doneN = es.filter(e => !icsMarkable(e) || e.subs.every(i => icsNow(e, i) >= 0)).length;
  o.innerHTML = `<style>
    #ichiScr{position:fixed;inset:0;z-index:9999;background:var(--paper);display:flex;flex-direction:column;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
    #ichiScr canvas,#ichiScr img{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-user-drag:none}
    #ichiScr .icsBar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 12px;background:var(--sheet);border-bottom:2px solid var(--line)}
    #ichiScr .icsBar button{padding:8px 12px;font-size:16px}
    #ichiScr .icsBody{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:12px}
    #ichiScr .icsQ{max-width:900px;margin:0 auto 22px;background:#fff;color:#111;border:2px solid var(--line);border-radius:10px;padding:10px}
    #ichiScr .icsQ h3{margin:0 0 6px;font-size:22px;color:#111}
    #ichiScr canvas{display:block;width:100%;touch-action:none;border-radius:6px}
    #ichiScr .icsAns{margin-top:8px;padding:8px;border-radius:8px;background:#fdf3e1;color:#111;font-size:18px}
    #ichiScr .icsAns button{margin-left:6px;font-size:17px;padding:6px 12px}
    #ichiScr .icsAns .on{outline:3px solid #c0392b}
    #ichiScr .icsEnd{max-width:900px;margin:0 auto 40px;text-align:center}
    #ichiScr .icsSec{max-width:900px;margin:18px auto 10px;font-size:22px;font-weight:700;color:#fff;background:#1c6b78;border-radius:8px;padding:6px 12px}
    #ichiScr .icsEnd button{font-size:19px;padding:12px 22px}
    #ichiScr .icsPin{position:-webkit-sticky;position:sticky;top:-12px;z-index:3;background:#fff;margin:0 -10px;padding:6px 10px 6px;border-bottom:3px solid #1c6b78;box-shadow:0 4px 6px rgba(0,0,0,.12);max-height:40vh;display:flex;flex-direction:column;box-sizing:border-box}
    #ichiScr .icsPinS{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch}
  </style>
  <div class="icsBar">
    <b style="margin-right:6px">今日の問題（${es.length}問）</b>
    ${tool("icsK", "黒", !ICS.erase && ICS.pen === "#111")}${tool("icsR", "赤", !ICS.erase && ICS.pen === "#c0392b")}${tool("icsE", "消しゴム", ICS.erase)}
    ${tool("icsU", "1つ戻る", false)}${tool("icsF", ICS.finger ? "指で書く：オン" : "指で書く：オフ", ICS.finger)}
    <span style="flex:1"></span>${tool("icsX", "とじる", false)}
  </div>
  <div class="icsBody">
    ${es.length ? "" : `<p class="note">今日のプリントに、画面で解く問題（一行問題・セット）はありません。</p>`}
    ${es.map((e, n) => { const part = e.subs.length < e.p.subs.length, pa = prevAnsText(e), ka = (((window.KEYS || {})[e.k] || {})[e.p.id] || {}).a || [];
      const sec = n === 0 || (es[n - 1].set || 0) !== (e.set || 0) ? `<div class="icsSec">${esc(setName(e.set || 0))}</div>` : "";
      const ichi = e.how === "ichigyo", hw = HOWS[e.how];
      const title = ichi ? `(${es.slice(0, n + 1).filter(x => x.how === "ichigyo").length})` : `${e.sno ? e.sno + "問目　" : ""}<span style="color:${hw ? hw[1] : "#111"}">${esc(hw ? hw[0] : "")}</span>　${esc(kaiName(e.k) + " " + e.p.no)}`;
      return `${sec}${icsRev(e)}<div class="icsQ"><div class="icsPin"><h3>${title}${part ? `<span style="color:#c0392b;font-size:18px">　${esc(e.subs.map(i => subName(e.p, i)).join(""))}だけ 答えよう</span>` : ""}${e.how === "ifng" ? `<span style="color:#c0392b;font-size:16px">　×だったときだけ</span>` : ""}</h3>
      ${pa ? `<div style="color:#1c6b78;font-weight:700">${esc(pa)}</div>` : ""}
      <div class="icsPinS" data-pin="${n}"><canvas data-ics="${n}" data-part="q"></canvas></div></div>
      <canvas data-ics="${n}" data-part="a"></canvas>
      ${ICS.grade || ICS.ans.has(n) ? `<div class="icsAns">${e.subs.map(i => { const now = icsNow(e, i);
        return `<div>${subName(e.p, i) ? esc(subName(e.p, i)) + " " : ""}正しい答え <b>${esc(ka[i] || "（本の解答を見てね）")}</b>
          ${icsMarkable(e) ? `<button class="ghost ${now === 1 ? "on" : ""}" data-icsm="${n}|${i}|1">◎</button><button class="ghost ${now === 0 ? "on" : ""}" data-icsm="${n}|${i}|0">×</button>` : `<span class="note">（一緒に解く問題なので ◎×はつけない）</span>`}</div>`; }).join("")}
        <div style="margin-top:4px"><button class="link" style="color:#1c6b78" data-icsgo="${n}">${ICS.show.has(n) ? "解説をとじる" : "解説を見る"}</button></div>
        ${ICS.show.has(n) ? icsExpl(e) : ""}</div>
        ${ICS.show.has(n) ? icsWs(e).map((_, j) => `<div style="margin-top:10px;font-size:18px;font-weight:700;color:#1c6b78">ワークシート（解き方を見ながら、表と（　）を埋めよう）</div><canvas data-ics="${n}" data-ws="${j}"></canvas>`).join("") : ""}` : `<div style="margin-top:8px;text-align:right"><button class="primary" style="font-size:18px;padding:8px 18px" data-icsa="${n}">答えを見る</button></div>`}
      </div>`; }).join("")}
    <div class="icsEnd">${ICS.grade ? `<p>${doneN} / ${es.length}問 丸付けずみ</p><button class="primary" id="icsX2">おわり（とじる）</button>`
      : `<button class="primary" id="icsG">全部おわった → 丸付け</button>`}</div>
  </div>`;
  const body = o.querySelector(".icsBody");
  o.onselectstart = ev => ev.preventDefault();
  const set = (id, f) => { const b = o.querySelector("#" + id); if (b) b.onclick = f; };
  const tools = () => { const on = (id, v) => { const b = o.querySelector("#" + id); if (b) b.className = v ? "primary" : "ghost"; };
    on("icsK", !ICS.erase && ICS.pen === "#111"); on("icsR", !ICS.erase && ICS.pen === "#c0392b"); on("icsE", ICS.erase); on("icsF", ICS.finger);
    const f = o.querySelector("#icsF"); if (f) f.textContent = ICS.finger ? "指で書く：オン" : "指で書く：オフ"; };
  set("icsK", () => { ICS.pen = "#111"; ICS.erase = false; tools(); });
  set("icsR", () => { ICS.pen = "#c0392b"; ICS.erase = false; tools(); });
  set("icsE", () => { ICS.erase = true; tools(); });
  set("icsF", () => { ICS.finger = !ICS.finger; tools(); });
  set("icsU", () => { const u = ICS.undo.pop(); if (!u) return; ICS.ink[u.id] = u.before; icsSave(u.id); ICS.cv.forEach(c => c.id === u.id && c.draw()); });
  set("icsX", icsClose); set("icsX2", icsClose);
  // 1回目で文字を変え、2回目で丸付けへ。confirm() は iPad のアプリの中では出ずに「いいえ」になる（2026-11-01）
  set("icsG", ev => { const b = ev.currentTarget; if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "もう一度押すと 答えが出ます"; return; } ICS.grade = true; icsRender(); });
  o.querySelectorAll("[data-icsa]").forEach(b => b.onclick = () => { ICS.ans.add(+b.dataset.icsa); icsRender(); });
  o.querySelectorAll("[data-icsm]").forEach(b => b.onclick = async () => { const [n, i, ok] = b.dataset.icsm.split("|"), e = es[+n];
    if (isAgain2(e)) await setRei2(e.k, e.p.id, +i, ok === "1"); else await icsMark(e.k, e.p, +i, ok === "1");
    // 解説とワークシートは ×のときだけ開く。×がなければ閉じる（2026-11-03 ユーザー「できなかった時に出せませんか」。書いたものは ICS.ink に残る）
    if (e.subs.some(j => icsNow(e, j) === 0)) { if (!ICS.show.has(+n)) { if (window.loadHeavy) { await loadHeavy(); await icsDbLoad([e]); } await imgPreloadEntries([e]); if (window.imgPreload) await imgPreload(e.k, icsExTargets(e).map(q => q.id)); ICS.show.add(+n); } }
    else ICS.show.delete(+n);
    icsRender(); });
  o.querySelectorAll("[data-icsgo]").forEach(b => b.onclick = async () => { const n = +b.dataset.icsgo, e = es[n];
    if (ICS.show.has(n)) ICS.show.delete(n); else { b.textContent = "よみこみ中…"; if (window.loadHeavy) { await loadHeavy(); await icsDbLoad([e]); } await imgPreloadEntries([e]); if (window.imgPreload) await imgPreload(e.k, icsExTargets(e).map(q => q.id)); ICS.show.add(n); }
    const y = o.querySelector(".icsBody").scrollTop; icsRender(); o.querySelector(".icsBody").scrollTop = y; });
  ICS.cv = [];
  o.querySelectorAll("canvas[data-ics]").forEach(cv => { const h = keepH[ckey(cv)]; if (h) cv.style.height = h; });
  o.querySelectorAll(".icsPinS[data-pin]").forEach(d => { if (keepS[d.dataset.pin]) d.scrollTop = keepS[d.dataset.pin]; });
  o.querySelectorAll("canvas[data-ics]").forEach(cv => { if (cv.dataset.part !== "a") icsCanvas(cv, es[+cv.dataset.ics], body, cv.dataset.ws); });
  body.scrollTop = keepY;
}
// 1問ぶんの紙: 赤字の一言 → 問題の絵 → 式と考え方（方眼） → 答えの欄。線は 幅を1とした座標で残す（画面の大きさが変わってもずれない）
// 2026-11-03 紙を「上の問題（帯・画面の上に止まる）」と「下の解答欄」の2枚に分けて見せる。線の座標・保存の形は前と同じ（1枚の紙の座標）
async function icsCanvas(cv, e, body, ws) {
  if (ws != null) return icsWsCanvas(cv, e, body, +ws);
  const n = cv.dataset.ics, o = cv.closest("#ichiScr"), cvA = o && o.querySelector(`canvas[data-ics="${n}"][data-part="a"]`), band = cv.closest(".icsPinS");
  const id = icsId(e), im = await imgReady(e.p.img).then(loadImg).catch(() => null);
  if (!cv.isConnected) return;
  // 小問ごとに「式と考え方」と「答え」。1問だけのとき（一行問題）は前と同じ形（書いた線の位置がずれないように）
  const ANS_TOP = ((day && day.date) || todayKey()) >= "2026-11-04";
  const NS = e.subs.length, LABH = NS > 1 ? 44 : 0, W = 1000, ASKH = 50, WORK = 520, ANSH = 150;
  const imH = im ? Math.min(im.height * (W - 40) / im.width, e.how === "ichigyo" ? 900 : 1600) : 0, AREA = LABH + WORK + ANSH, H = ASKH + imH + 20 + NS * AREA + 20;
  const top0 = ASKH + imH + 20;
  const dpr = Math.min(window.devicePixelRatio || 1, 2), cssW = cv.clientWidth || 800, sc = cssW / W;
  const base = g => {
    g.font = `700 26px ${FONT}`; g.fillStyle = "#c0392b"; g.fillText("聞かれていることに 線を引こう（だれの・なにを）", 20, 34);
    if (im) g.drawImage(im, 20, ASKH, im.width * imH / im.height, imH);
    e.subs.forEach((si, j) => { const top = ANS_TOP ? ASKH + imH + 20 + NS * ANSH + j * (LABH + WORK) : ASKH + imH + 20 + j * AREA, y0 = top + LABH;
      if (LABH) { g.fillStyle = "#1c6b78"; g.fillRect(20, top + 4, W - 40, 3); g.font = `700 28px ${FONT}`; g.fillText(subName(e.p, si) || `(${j + 1})`, 24, top + 38); }
      // 2026-11-03 ユーザー「解答欄は全部上に詰めて。式を書く欄はその下に改めて (1)(2)(3) で並べて」→ 11/4 の分から 問題のすぐ下に答えの欄を全部 → その下に小問ごとの式と考え方（それより前の日は書いた線がずれないよう前のまま）
      const wy = y0, ay = ANS_TOP ? top0 + j * ANSH + 10 : y0 + WORK + 20;
      g.fillStyle = "#555"; g.font = `400 22px ${FONT}`; g.fillText("式と考え方", 24, wy + 28);
      g.strokeStyle = "#e3ebe7"; g.lineWidth = 1; for (let x = 20; x <= W - 20; x += 40) { g.beginPath(); g.moveTo(x, wy + 40); g.lineTo(x, wy + WORK); g.stroke(); }
      for (let y = wy + 40; y <= wy + WORK; y += 40) { g.beginPath(); g.moveTo(20, y); g.lineTo(W - 20, y); g.stroke(); }
      g.strokeStyle = "#222"; g.lineWidth = 3; g.strokeRect(W - 560, ay, 540, ANSH - 20);
      g.fillStyle = "#111"; g.font = `700 28px ${FONT}`; g.fillText(LABH ? (subName(e.p, si) || "") + "の答え" : "答え", LABH ? W - 720 : W - 650, ay + 75); }); };
  const strokes = () => ICS.ink[id] || [];
  const line = (g, s) => { if (!s.p.length) return; g.strokeStyle = s.c; g.lineWidth = 2; g.lineCap = g.lineJoin = "round"; g.beginPath(); g.moveTo(s.p[0][0] * W, s.p[0][1] * W); s.p.forEach(q => g.lineTo(q[0] * W, q[1] * W)); if (s.p.length === 1) g.lineTo(s.p[0][0] * W + .1, s.p[0][1] * W); g.stroke(); };
  // 1枚の紙の a〜b の所を、その canvas に見せる
  const parts = [{c: cv, a: 0, b: top0}].concat(cvA ? [{c: cvA, a: top0, b: H}] : []);
  parts.forEach(P => { P.c.width = Math.round(cssW * dpr); P.c.height = Math.round((P.b - P.a) * sc * dpr); P.c.style.height = ((P.b - P.a) * sc) + "px"; P.g = P.c.getContext("2d"); });
  const drawOne = P => { const g = P.g; g.setTransform(dpr * sc, 0, 0, dpr * sc, 0, -P.a * dpr * sc); g.fillStyle = "#fff"; g.fillRect(0, P.a, W, P.b - P.a); base(g); strokes().forEach(s => line(g, s)); };
  const draw = () => parts.forEach(drawOne);
  ICS.cv = ICS.cv.filter(c => c.cv !== cv); ICS.cv.push({id, draw, cv}); draw();
  // 見えている位置 → 線を残す位置（下の解答欄は 問題の高さ だけ下にずらす）
  const bodyScroll = dy => { body.scrollTop -= dy; };
  const bandScroll = dy => { if (band && band.scrollHeight > band.clientHeight + 1) { const y = band.scrollTop; band.scrollTop -= dy; if (band.scrollTop !== y) return; } body.scrollTop -= dy; };
  icsPen(cv, id, bandScroll, W, strokes, draw);
  if (cvA) icsPen(cvA, id, bodyScroll, W, strokes, draw, (x, y) => [x, y + top0]);
}
async function icsWsCanvas(cv, e, body, j) {
  const id = icsId(e) + ":ws" + j, im = await loadImg(icsWs(e)[j]).catch(() => null), W = 1000;
  const H = im ? Math.round(im.height * W / im.width) : 300;
  const dpr = Math.min(window.devicePixelRatio || 1, 2), cssW = cv.clientWidth || 800, sc = cssW / W;
  cv.width = Math.round(cssW * dpr); cv.height = Math.round(H * sc * dpr); cv.style.height = (H * sc) + "px"; cv.style.border = "1px solid #ccc";
  const g = cv.getContext("2d"), strokes = () => ICS.ink[id] || [];
  const line = s => { if (!s.p.length) return; g.strokeStyle = s.c; g.lineWidth = 2; g.lineCap = g.lineJoin = "round"; g.beginPath(); g.moveTo(s.p[0][0] * W, s.p[0][1] * W); s.p.forEach(q => g.lineTo(q[0] * W, q[1] * W)); if (s.p.length === 1) g.lineTo(s.p[0][0] * W + .1, s.p[0][1] * W); g.stroke(); };
  const draw = () => { g.setTransform(dpr * sc, 0, 0, dpr * sc, 0, 0); g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); if (im) g.drawImage(im, 0, 0, W, H); strokes().forEach(line); };
  ICS.cv.push({id, draw}); draw();
  icsPen(cv, id, dy => { body.scrollTop -= dy; }, W, strokes, draw);
}
function icsPen(cv, id, scroll, W, strokes, draw, toLog) {
  const pt = ev => { const r = cv.getBoundingClientRect(), f = v => Math.round(v * 10000) / 10000; let x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.width;
    if (toLog) { const q = toLog(x * W, y * W); x = q[0] / W; y = q[1] / W; } return [f(x), f(y)]; };
  const eraseAt = q => { const a = strokes(), b = a.filter(s => !s.p.some(v => Math.hypot(v[0] - q[0], v[1] - q[1]) < 0.02)); if (b.length !== a.length) { ICS.ink[id] = b; draw(); } };
  let cur = null, scrollY = null, before = null;
  cv.onpointerdown = ev => {
    if (ev.pointerType === "touch" && !ICS.finger) { scrollY = ev.clientY; return; }   // 指は画面を動かす（手のひらで線が入らないように）
    ev.preventDefault(); const q0 = pt(ev);
    cv.setPointerCapture(ev.pointerId); before = strokes().slice(); try { getSelection().removeAllRanges(); } catch (x) {}
    if (ICS.erase) { cur = {erase: true}; eraseAt(q0); return; }
    cur = {c: ICS.pen, p: [q0]}; ICS.ink[id] = strokes().concat([cur]); draw(); };
  cv.onpointermove = ev => {
    if (scrollY !== null) { scroll(ev.clientY - scrollY); scrollY = ev.clientY; return; }
    if (!cur) return; ev.preventDefault();
    if (cur.erase) return eraseAt(pt(ev));
    (ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev]).forEach(x => cur.p.push(pt(x))); draw(); };
  cv.onpointerup = cv.onpointercancel = () => { if (scrollY !== null) { scrollY = null; return; } if (!cur) return; cur = null;
    if (JSON.stringify(before) !== JSON.stringify(strokes())) { ICS.undo.push({id, before}); if (ICS.undo.length > 80) ICS.undo.shift(); icsSave(id); } };
}
