/* app.html（オフライン版の算数ステップ帳）の上に出す小さな帯。メニュー（index.html）へもどる・いま何日目か */
(function () {
  var i = +(localStorage.getItem("sansu-off-day") || 0), d = null;
  try { d = JSON.parse(localStorage.getItem("sansu-step-dayAll") || "null"); } catch (e) {}
  var bar = document.createElement("div");
  bar.style.cssText = "position:sticky;top:0;z-index:50;background:#1c6b78;color:#fff;font:700 14px/1.4 sans-serif;padding:6px 12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap";
  bar.innerHTML = '<a href="index.html" style="color:#fff">◀ オフラインのメニュー</a><span>オフライン版・' + (i + 1) + "日目" + (d && d.date ? "（" + d.date.slice(5).replace("-", "/") + "）" : "") + "</span>";
  document.body.prepend(bar);
})();
