/* ---------- 図で説明: Claude に図を描き直してもらい、説明の段ごとに色・線・数を書きこむ ---------- */
// Claude が返す形（JSON）:
// {"kind":"geo","points":{"A":[x,y],...},"segments":[["A","B"],...],"steps":[{"text":"…","fill":[{"poly":["A","C","D"],"c":1}],"lines":[{"from":"A","to":"C","c":2}],"labels":[{"seg":["A","D"],"text":"18"}]}]}
//   points は 0〜100 の座標（y は下向き）。c は 1=赤 2=青 3=緑
// {"kind":"table","steps":[{"text":"…","rows":[["", "…"],…],"hl":[1]}]}   … 表で説明する問題
// {"kind":"bars","steps":[{"text":"…","lines":[{"label":"兄","segs":[{"u":3,"t":"③"}]}],"note":"…"}]}  … 線分図
(function () {
  const COL = {1: ["var(--red)", "var(--red-soft)"], 2: ["var(--teal)", "var(--teal-soft)"], 3: ["var(--done)", "var(--done-soft)"]};
  const e = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  function geo(d, k) {
    const P = d.points || {}, W = 420, H = 300, pad = 30;
    const xs = Object.values(P).map(p => p[0]), ys = Object.values(P).map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const sc = Math.min((W - 2 * pad) / Math.max(1, x1 - x0), (H - 2 * pad) / Math.max(1, y1 - y0));
    const X = n => pad + (P[n][0] - x0) * sc, Y = n => pad + (P[n][1] - y0) * sc;
    const has = n => P[n] && P[n].length === 2;
    const cx = Object.keys(P).reduce((a, n) => a + X(n), 0) / Math.max(1, Object.keys(P).length);
    const cy = Object.keys(P).reduce((a, n) => a + Y(n), 0) / Math.max(1, Object.keys(P).length);
    let s = "";
    // それまでの段の書きこみも残す（今の段は濃く）
    (d.steps || []).slice(k, k + 1).forEach(st => {
      const now = true;
      (st.fill || []).forEach(f => { const ps = (f.poly || []).filter(has); if (ps.length < 3) return; const c = COL[f.c] || COL[1];
        s += `<polygon points="${ps.map(n => X(n) + "," + Y(n)).join(" ")}" fill="${c[1]}" fill-opacity="${now ? 0.95 : 0.45}" stroke="${c[0]}" stroke-width="${now ? 2.5 : 1}"/>`; });
    });
    (d.segments || []).forEach(([a, b]) => { if (has(a) && has(b)) s += `<line x1="${X(a)}" y1="${Y(a)}" x2="${X(b)}" y2="${Y(b)}" stroke="var(--ink)" stroke-width="1.5"/>`; });
    (d.steps || []).slice(0, k + 1).forEach((st, j) => {
      const now = j === k;
      if (now) (st.lines || []).forEach(l => { if (!has(l.from) || !has(l.to)) return; const c = COL[l.c] || COL[1];
        s += `<line x1="${X(l.from)}" y1="${Y(l.from)}" x2="${X(l.to)}" y2="${Y(l.to)}" stroke="${c[0]}" stroke-width="${now ? 4 : 2}" stroke-linecap="round" ${l.dash ? 'stroke-dasharray="6 5"' : ""}/>`; });
      (st.labels || []).forEach(lb => {
        const [a, b] = lb.seg || [];
        let x, y;
        if (has(a) && has(b)) { x = (X(a) + X(b)) / 2; y = (Y(a) + Y(b)) / 2; const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy) || 1; x += dx / r * 14; y += dy / r * 14; }
        else if (has(lb.at)) { x = X(lb.at); y = Y(lb.at) - 14; } else return;
        s += `<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="15" font-weight="700" fill="${now ? "var(--red)" : "var(--muted)"}" paint-order="stroke" stroke="var(--sheet)" stroke-width="4">${e(lb.text)}</text>`;
      });
    });
    Object.keys(P).forEach(n => { if (!has(n)) return; const dx = X(n) - cx, dy = Y(n) - cy, r = Math.hypot(dx, dy) || 1;
      s += `<circle cx="${X(n)}" cy="${Y(n)}" r="2.5" fill="var(--ink)"/><text x="${X(n) + dx / r * 14}" y="${Y(n) + dy / r * 14 + 5}" text-anchor="middle" font-size="15" fill="var(--ink)">${e(n)}</text>`; });
    return `<svg viewBox="-10 -10 ${W + 20} ${H + 20}" role="img" style="width:100%;max-width:560px;height:auto">${s}</svg>`;
  }
  window.vizRender = function (d, k) {
    const st = (d.steps || [])[k] || {};
    if (d.kind === "geo") return geo(d, k);
    const L = window.FIGLIB;
    if (d.kind === "table" && Array.isArray(st.rows) && st.rows.length) return L.table(st.rows.map(r => r.map(String)), st.hl || [], st.note || "");
    if (d.kind === "bars" && Array.isArray(st.lines) && st.lines.length) return L.bars(st.lines, 40, st.note || "");
    return "";
  };
  window.vizPrompt = function (p, key, kidLine, hasImg) {
    return `あなたは小学5年生に算数を教える先生です。${hasImg ? `1枚目の画像は予習シリーズ5年下の問題（${p.no}）です。` : `予習シリーズ5年下の問題（${p.no}）の説明をします。問題の画像はありません。${key.q ? "問題文は次の通り:\n" + key.q + "\n" : ""}図は、本の解き方に出てくる点・辺・三角形の関係（平行、相似、長さ、比）とつじつまが合うように組み立ててください。点の名前は解き方に出てくるものを使い、出てこない点は作らない。`}
この問題の解き方を、図を使って3〜6段で説明します。説明は本の解き方にそって、本の答えとちがう答えを言ってはいけません。

【本の答え】
${key.a.map((a, i) => (p.subs[i] || "答え") + ": " + a).join("\n")}

【本の解き方】
${key.how || "（なし。本の答えになる解き方を、この単元の考え方で）"}
${kidLine ? "\n【この子の結果】\n" + kidLine + "\n" : ""}
【図の描き方】
- 図形の問題なら kind:"geo"。問題の図にある点を、同じ名前で points に 0〜100 の座標（xは右、yは下）で置き、図の線を segments に入れる。形は問題の図に似せる（長さの比は大まかでよい）。
- 各段の steps[].fill で注目する三角形などに色をぬり（c: 1=赤, 2=青, 3=緑。比べる2つの図形は別の色）、lines で注目する辺をなぞり、labels で辺の長さや比を書きこむ（seg: ["A","D"] の辺の横に text を出す）。
- 図形でない問題なら kind:"table"（steps[].rows に表、hl に強調する列番号）か kind:"bars"（steps[].lines に線分図: {"label":"兄","segs":[{"u":3,"t":"③"}]}、u は長さ）。
- text は1段につき1〜3文。小学5年生にわかる言葉で、式もふくめる。最後の段で答えを言う。
- 小問が2つ以上あるときは、各段に "sub" でどの小問の説明かを書く（"(1)" "(2)" など、問題の小問の書き方どおり）。(2) から見ても分かるように、(1) で求めた数は (2) の最初の段でもう一度ふれる。

次のJSONだけを返してください（例）:
{"kind":"geo","points":{"A":[20,10],"B":[0,90],"C":[100,90],"D":[60,10]},"segments":[["A","B"],["B","C"],["C","D"],["D","A"],["A","C"],["B","D"]],
 "steps":[{"sub":"(1)","text":"三角形AGDとCGBは形が同じ（相似）。","fill":[{"poly":["A","G","D"],"c":1},{"poly":["C","G","B"],"c":2}],"lines":[],"labels":[{"seg":["A","D"],"text":"18cm"}]}]}`;
  };
})();
/* ---------- 問題の画像に重ねて描く（点の位置 fig が測ってある問題） ---------- */
(function () {
  const COL = {1: ["#d83a2c", "rgba(216,58,44,.28)"], 2: ["#1c6b78", "rgba(28,107,120,.28)"], 3: ["#2f7d4f", "rgba(47,125,79,.28)"]};
  const e = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const pt = (fig, n) => { const v = fig.points[n]; if (!v) return null; return Array.isArray(v) ? v : v.at; };
  window.vizOverlay = function (p, d, k) {
    const fig = p.fig, asp = p.asp || 0.5, W = 1000, H = W * asp;
    const P = n => { const v = pt(fig, n); return v ? [v[0] * W, v[1] * H] : null; };
    const names = Object.keys(fig.points), cs = names.map(P).filter(Boolean);
    const cx = cs.reduce((a, q) => a + q[0], 0) / Math.max(1, cs.length), cy = cs.reduce((a, q) => a + q[1], 0) / Math.max(1, cs.length);
    const st = (d.steps || [])[k] || {};
    // 図の部分だけを切り出して大きく見せる（点のまわりに余白）
    const xs = cs.map(q => q[0]), ys = cs.map(q => q[1]);
    const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys), pad = Math.max(60, 0.18 * Math.max(bw, bh));
    const vx = Math.max(0, Math.min(...xs) - pad), vy = Math.max(0, Math.min(...ys) - pad);
    const vw = Math.min(W, Math.max(...xs) + pad) - vx, vh = Math.min(H, Math.max(...ys) + pad) - vy;
    const u = Math.max(vw, vh) / 600;   // 線・文字の太さを切り出しの大きさにあわせる
    let s = `<image href="${imgSrc(p.img)}" x="0" y="0" width="${W}" height="${H}"/>`;
    (st.fill || []).forEach(f => { const ps = (f.poly || []).map(P).filter(Boolean); if (ps.length < 3) return; const c = COL[f.c] || COL[1];
      s += `<polygon points="${ps.map(q => q.join(",")).join(" ")}" fill="${c[1]}" stroke="${c[0]}" stroke-width="${3 * u}"/>`; });
    (st.lines || []).forEach(l => { const a = P(l.from), b = P(l.to); if (!a || !b) return; const c = COL[l.c] || COL[1];
      s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${c[0]}" stroke-width="${6 * u}" stroke-linecap="round" opacity=".85" ${l.dash ? `stroke-dasharray="${12 * u} ${9 * u}"` : ""}/>`; });
    // 書きこみ（長さ・比）は、それまでの段の分も残す（前の段はうすく）
    (d.steps || []).slice(0, k + 1).forEach((sx, j) => (sx.labels || []).forEach(lb => {
      let x, y; const [a, b] = (lb.seg || []).map(P);
      if (a && b) { x = (a[0] + b[0]) / 2; y = (a[1] + b[1]) / 2; const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy) || 1; x += dx / r * 26 * u; y += dy / r * 26 * u; }
      else { const q = P(lb.at); if (!q) return; x = q[0]; y = q[1] - 24 * u; }
      x = Math.min(Math.max(x, vx + 30 * u), vx + vw - 30 * u); y = Math.min(Math.max(y, vy + 24 * u), vy + vh - 10 * u);
      const box = /^\[(.+)\]$/.exec(String(lb.text || "")), txt = box ? box[1] : lb.text, col = j === k ? "#d83a2c" : "#7a6a66";
      if (box) { const bw = (String(txt).length * 0.62 + 0.9) * 28 * u, bh = 36 * u;
        s += `<rect x="${x - bw / 2}" y="${y - bh / 2 - 2 * u}" width="${bw}" height="${bh}" fill="#fff" stroke="${col}" stroke-width="${3 * u}" rx="${3 * u}"/>`; }
      s += `<text x="${x}" y="${y + 10 * u}" text-anchor="middle" font-size="${28 * u}" font-weight="700" fill="${col}" paint-order="stroke" stroke="#fff" stroke-width="${box ? 0 : 7 * u}">${e(txt)}</text>`;
    }));
    return `<svg viewBox="${vx} ${vy} ${vw} ${vh}" role="img" style="width:100%;max-width:560px;height:auto;background:#fff;border-radius:4px">${s}</svg>`;
  };
  // 図形の問題は「点の名前を選ぶだけ」の頼み方にする
  window.vizPromptFig = function (p, key, kidLine) {
    const list = Object.entries(p.fig.points).map(([n, v]) => n.startsWith("#") ? `${n}（${(v && v.desc) || "名前のない点"}）` : n).join("、");
    return `あなたは小学5年生に算数を教える先生です。予習シリーズ5年下の問題（${p.no}）の解き方を、問題の図に色や線を書きこみながら3〜6段で説明します。
説明は本の解き方にそって、本の答えとちがう答えを言ってはいけません。

【本の答え】
${key.a.map((a, i) => (p.subs[i] || "答え") + ": " + a).join("\n")}

【本の解き方】
${key.how || "（なし）"}
${kidLine ? "\n【この子の結果】\n" + kidLine + "\n" : ""}
【図にある点】（この名前だけを使う。新しい点は作らない）
${list}
【図にある線】${(p.fig.segments || []).map(x => x.join("")).join("、")}
- # で始まる点は図に名前が書いていない点。text の中では（）の中の言い方でよぶ（例「左下の頂点」）。
- 各段の fill で注目する三角形などに色（c: 1=赤, 2=青, 3=緑。比べる2つは別の色）、lines で注目する辺をなぞり、labels で長さや比を辺の横に書く（seg: [点, 点]）。
- text は1段につき1〜3文。小学5年生の言葉で、式もふくめる。最後の段で答えを言う。
- 小問が2つ以上あるときは、各段に "sub" でどの小問の説明かを書く（"(1)" "(2)" など、問題の小問の書き方どおり）。小問ごとに、その小問だけで分かるように説明する（(2) から見ても分かるように、(1) で求めた数は (2) の最初の段でもう一度ふれる）。
次のJSONだけを返してください（points は書かない）:
{"kind":"overlay","steps":[{"sub":"(1)","text":"…","fill":[{"poly":["A","B","C"],"c":1}],"lines":[{"from":"A","to":"C","c":2}],"labels":[{"seg":["A","D"],"text":"18cm"}]}]}`;
  };
})();

// 保存してある図の説明がその問題に使えるか（点が測ってある問題は、重ね描きのものだけ）
// 授業（予習ナビ）での説明の仕方。lecture_0N.js にある問題だけ
window.lectOf = t => { const L = (window.LECT || {})[t.kai]; return L && L[t.id] ? {common: L.common || "", own: L[t.id]} : null; };
const lectBlock = t => { const L = lectOf(t); return L ? `
【授業での説明の仕方（予習ナビの先生。この順番・言い回し・書きこみ方にそろえる。数字はこの問題に合わせる）】
${L.own}
- 図の書きこみ（どの三角形を何色でぬる・なぞるか、どの辺に丸数字・四角の数字を書くか、どの順で書くか）は、上の授業の板書と同じにする。授業で書いた比や長さは、そのまま labels に書く。
【この回の授業の決まり】
${L.common}
- 面積の比など四角で囲む数字は labels の text を "[3]" のように書く（四角で囲んで表示される）。辺の比は ①② を使う。
` : ""; };
window.lectBlock = lectBlock;
window.vizUsable = (t, v) => !!(v && Array.isArray(v.steps) && v.steps.length && (!t.fig || v.kind === "overlay") && (!t.fig || !t.fig.vizVer || v.vizVer === t.fig.vizVer) && (!lectOf(t) || v.lect)
  && ((t.subs || []).length < 2 || v.steps.some(st => st && st.sub)));
window.vizPromptFor = (t, key, kid, hasImg) => { const base = t.fig ? vizPromptFig(t, key, kid) : vizPrompt(t, key, kid, hasImg);
  const i = base.indexOf("次のJSONだけを返してください"); return i < 0 ? base + lectBlock(t) : base.slice(0, i) + lectBlock(t) + String.fromCharCode(10) + base.slice(i); };
window.vizDraw = (t, v, k) => v.kind === "overlay" && t.fig ? vizOverlay(t, v, k) : vizRender(v, k);
