// 回ごとの判定（どの回でも同じ決まり）。index.html（1問の画面）・today.js（今日のプリント）・dash.js（保護者）が使う
//   makeKai(n, getRec, isSkip) … getRec(): その回の記録 {"rei1_0": [{ok,t,by}], …}、isSkip(n, id): 親がスキップにしたか
// 回の呼び名。テストなど回でないもの（KAI_DATA[n].short がある）はその名前
window.kaiName = n => (window.KAI_DATA[n] && window.KAI_DATA[n].short) || "第" + n + "回";
window.makeKai = function (n, getRec, isSkip) {
  const KD = window.KAI_DATA[n];
  const withImg = p => Object.assign({}, p, {kai: n, img: "img/" + n + "/" + p.id + ".png"});
  // 難関校対策（nankan）は出さない（ユーザーの方針 2026-10-03）
  const UNITS = KD.units.filter(u => !u.nankan).map(u => Object.assign({}, u, {
    kai: n, steps: u.steps.filter(s => !s.nankan).map(withImg), extra: (u.extra || []).filter(s => !s.nankan).map(withImg)}));
  const hasUnit = id => UNITS.some(u => u.id === id);
  const RENSHU = KD.renshu.filter(r => !r.nankan).map(r => Object.assign(withImg(r), {needs: r.needs.filter(hasUnit)}));
  // 反復練習: after（練習問題）があればその練習のあと。無ければ needs（系統）がそろったら（第5回のステップ②）
  const HANREN = (KD.hanren || []).filter(r => !r.nankan && (r.after ? RENSHU.some(x => x.id === r.after) : true))
    .map(r => Object.assign(withImg(r), r.after ? {} : {needs: (r.needs || []).filter(hasUnit)}));
  const PRACTICE = [...RENSHU, ...HANREN];
  const ITEMS = {}, UNIT_OF = {};
  UNITS.forEach(u => [...u.steps, ...u.extra].forEach(p => { ITEMS[p.id] = p; UNIT_OF[p.id] = u; }));
  PRACTICE.forEach(p => ITEMS[p.id] = p);

  const kind = p => p.id.startsWith("t") ? "テスト" : p.id.startsWith("rei") ? "例題" : p.id.startsWith("rui") ? "類題" : p.id.startsWith("kihon") ? "基本問題"
    : p.id.startsWith("hanren") ? "反復練習" : p.id.startsWith("han") ? "反復基本" : p.id.startsWith("st1") ? "反復基本" : p.id.startsWith("st2") ? "反復練習" : "練習問題";
  const sk = (p, i) => p.id + "_" + i;
  const last = (p, i) => { const a = getRec()[sk(p, i)]; return a && a.length ? a[a.length - 1] : null; };
  const skipped = p => !!isSkip(n, p.id);
  const subOk = (p, i) => skipped(p) || !!(last(p, i) && last(p, i).ok);
  const itemOk = p => p.subs.every((_, i) => subOk(p, i));
  const itemTried = p => !skipped(p) && p.subs.some((_, i) => last(p, i));
  // 1回目で◎だったか（スキップは「定着している」扱い）
  const firstOk = p => skipped(p) || p.subs.every((_, i) => { const a = getRec()[sk(p, i)]; return !!(a && a.length && a[0].ok); });
  // 例題・類題・基本が全部済んでも、1回で◎にならなかった問題があれば反復問題（基本）を足す
  const needsExtra = u => u.extra.length > 0 && u.steps.every(itemOk) && u.steps.some(p => !firstOk(p));
  const unitItems = u => needsExtra(u) ? [...u.steps, ...u.extra] : u.steps;
  const unitOk = u => u.steps.every(itemOk);
  const unitById = id => UNITS.find(u => u.id === id);
  const needsOf = p => p.needs || (ITEMS[p.after] && ITEMS[p.after].needs) || [];
  const ready = r => r.after ? itemOk(ITEMS[r.after]) : r.needs.every(id => unitOk(unitById(id)));
  // 小問の状態: first=1回で◎ / redo=やり直して◎ / ng=× / todo=まだ / skip=スキップ
  const subState = (p, i) => {
    if (skipped(p)) return "skip";
    const a = getRec()[sk(p, i)];
    if (!a || !a.length) return "todo";
    if (!a[a.length - 1].ok) return "ng";
    return a[0].ok ? "first" : "redo";
  };
  return {n, KD, title: KD.title, UNITS, RENSHU, HANREN, PRACTICE, ITEMS, UNIT_OF, kind, sk, last, skipped, subOk, itemOk, itemTried,
    firstOk, needsExtra, unitItems, unitOk, unitById, needsOf, ready, subState,
    hist: (p, i) => getRec()[sk(p, i)] || []};   // 小問の記録（古い順）。一行問題の解き直しの間かくに使う（2026-10-25）
};
// 画像は data URI で ic/ic_*.js の束にまとめてある（公開ファイル数の上限のため）。どの束かは imgman.js。無ければ元のパス
// ★束は使うときに読む（2026-10-31 開くときに全部 約180MB を読むと iPad が落ちた）。まだのときは白い点を返し、読めたら描き直す
(() => {
  const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", got = {};
  const key = s => String(s).replace(/^img\//, "").replace(/\.png$/, "");
  const man = () => window.IMGMAN || {f: [], m: {}};
  const load = i => { const f = man().f[i]; if (!f) return Promise.resolve();
    return got[f] || (got[f] = new Promise(ok => { const el = document.createElement("script"); el.src = furl(f); el.onload = ok; el.onerror = ok; document.head.appendChild(el); })); };
  let t = null;
  const redraw = () => { if (t) return; t = setTimeout(() => { t = null; if (typeof dayBusy !== "undefined" && dayBusy) return redraw(); try { render(); } catch (e) {} }, 200); };
  window.imgSrc = s => { const k = key(s), v = window.IMGS && window.IMGS[k]; if (v) return v;
    const i = man().m[k]; if (i == null) return s; load(i).then(redraw); return BLANK; };
  window.imgReady = async s => { const k = key(s), i = man().m[k]; if (i != null && !(window.IMGS && window.IMGS[k])) await load(i); return window.imgSrc(s); };
  // 回 k の問題（ids）の絵と答えの絵（k/id・k/a_id_N）の束を先に読む（PDF・画面で解くの前に）
  let byBase = null;
  window.imgPreload = (k, ids) => { if (!byBase) { byBase = {}; for (const [kk, i] of Object.entries(man().m)) { const b = kk.replace(/\/a_(.*)_\d+$/, "/$1"); (byBase[b] = byBase[b] || new Set()).add(i); } }
    const need = new Set(); ids.forEach(id => (byBase[k + "/" + id] || []).forEach(i => need.add(i)));
    return Promise.all([...need].map(load)); };
})();
