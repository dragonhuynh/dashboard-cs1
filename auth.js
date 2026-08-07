/* =====================================================================
   LỚP ĐĂNG NHẬP + PHÂN QUYỀN TAB — Dashboard HIS · BVTD Cơ Sở 1
   Chạy TRƯỚC app.js và giuong.js; chính nó quyết định khi nào nạp 2 file kia.

   HAI CHẾ ĐỘ — CÙNG MỘT BỘ FILE (đừng tách làm 2 bản index.html):
     • TRONG VIỆN (mở bằng file:// hoặc máy chủ nội bộ): `api-config.js` khai
       API_BASE = null → KHÔNG có đăng nhập, nạp thẳng data.js → app.js →
       giuong.js, y hệt cách chạy từ trước tới nay. Không đổi thói quen ai cả.
     • CÔNG KHAI (GitHub Pages): `api-config.js` khai API_BASE trỏ tới Cloudflare
       Worker → bắt đăng nhập, số liệu lấy qua API sau khi xác thực, tab nào
       không có quyền thì ẩn hẳn.

   ⚠️ VÌ SAO SỐ LIỆU KHÔNG NẰM TRONG FILE TĨNH Ở BẢN CÔNG KHAI:
      dự án CS2 đã kết luận bằng máu (../Dashboar_HIS/TRIEN_KHAI/
      buoc6_dua_len_web_GitHub.md): *"File data.json có URL công khai riêng; ai
      gõ thẳng URL đó là tải được, không qua trang login"* — và mật khẩu của họ
      đã lộ thật, phải gỡ cả site. Ở đây `data.json`/`giuong-data.js` KHÔNG được
      đưa lên repo công khai; chúng chỉ được Worker phát ra sau khi xác thực.
   ===================================================================== */
(function () {
  "use strict";

  var API = String(window.API_BASE || "").replace(/\/+$/, "");
  var K_TOKEN = "bvtd_token", K_USER = "bvtd_user";
  var NHIP_TIM_GIAY = 60;      // xem worker/src/index.js — 60s là mức vừa với hạn mức đọc KV
  var phien = null;            // {user, ten, tabs[]}
  var timerTim = null;
  var daNapApp = false;

  /* ---------- tiện ích ---------- */
  function napScript(src) {
    return new Promise(function (ok, loi) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = ok;
      s.onerror = function () { loi(new Error("Không nạp được " + src)); };
      document.body.appendChild(s);
    });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var luu = {
    get: function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
    xoa: function (k) { try { sessionStorage.removeItem(k); } catch (e) {} },
  };

  /* =====================================================================
     CHẾ ĐỘ TRONG VIỆN — không cổng API thì không đăng nhập, chạy như cũ.
     ===================================================================== */
  if (!API) {
    napScript("data.js").catch(function () { /* chưa chạy scraper lần nào — app.js tự báo */ })
      .then(function () { return napScript("app.js"); })
      .then(function () { return napScript("giuong.js"); })
      .catch(function (e) { console.error(e); });
    return;
  }

  /* =====================================================================
     CHẾ ĐỘ CÔNG KHAI
     ===================================================================== */

  /* Gọi API kèm danh tính. Trả {ok, ma, data}. KHÔNG ném lỗi ra ngoài —
     mọi nơi gọi đều phải xử được trường hợp mạng hỏng. */
  function goiAPI(duong, tuyChon) {
    var o = tuyChon || {};
    var h = { "content-type": "application/json" };
    var tk = luu.get(K_TOKEN), u = luu.get(K_USER);
    if (tk) { h["authorization"] = "Bearer " + tk; h["x-user"] = u || ""; }
    return fetch(API + duong, {
      method: o.method || "GET",
      headers: h,
      body: o.body ? JSON.stringify(o.body) : undefined,
      cache: "no-store",
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        return { ok: r.ok, ma: r.status, data: d };
      });
    }).catch(function () {
      return { ok: false, ma: 0, data: { loi: "Không kết nối được máy chủ. Kiểm tra đường truyền mạng." } };
    });
  }

  /* Mọi lời gọi dữ liệu đều đi qua đây → chỉ MỘT chỗ xử lý "bị đá khỏi phiên". */
  function xuLyMaLoi(kq) {
    if (kq.ma === 409) { hienBiDay(kq.data && kq.data.loi); return true; }
    if (kq.ma === 401) { ketThucPhien(); hienDangNhap(kq.data && kq.data.loi); return true; }
    return false;
  }

  function layDuLieu(loai) {
    return goiAPI("/api/data/" + loai).then(function (kq) {
      if (kq.ok) return kq.data;
      if (xuLyMaLoi(kq)) return null;
      // 503 = máy thu thập trong viện đang dừng. Nói đúng nguyên nhân, đừng
      // để người dùng đoán là lỗi mạng của họ (log lỗi L06 · luật 5).
      console.warn("Không lấy được dữ liệu " + loai + ":", kq.data && kq.data.loi);
      return null;
    });
  }

  /* ---------- KHUNG MÀN HÌNH ---------- */
  function overlay() {
    var el = document.getElementById("auth-overlay");
    if (!el) {
      el = document.createElement("div");
      el.id = "auth-overlay";
      document.body.appendChild(el);
    }
    document.body.classList.add("auth-locked");
    el.hidden = false;
    return el;
  }
  function dongOverlay() {
    var el = document.getElementById("auth-overlay");
    if (el) el.hidden = true;
    document.body.classList.remove("auth-locked");
  }

  function hienDangNhap(loi) {
    if (timerTim) { clearInterval(timerTim); timerTim = null; }
    var el = overlay();
    el.innerHTML =
      '<form class="auth-card" id="auth-form" autocomplete="on">'
      + '<div class="auth-brand">'
      + '  <div class="auth-ring"><img src="assets/logo-tudu.png" alt="Bệnh viện Từ Dũ"'
      + '       onerror="this.parentNode.style.display=\'none\'"></div>'
      + '  <h1>Bệnh viện Từ Dũ</h1>'
      + '  <p class="auth-site">Bảng điều phối · Cơ sở 1</p>'
      + '  <p class="auth-purpose">Phòng khám · Chẩn đoán hình ảnh · Phòng và giường nội trú</p>'
      + '</div>'
      + '<div class="auth-msg" id="auth-msg"' + (loi ? "" : " hidden") + ">" + esc(loi || "") + "</div>"
      + '<div class="auth-fld"><label for="auth-u">Tên đăng nhập</label>'
      + '  <input id="auth-u" type="text" autocomplete="username" required autofocus></div>'
      + '<div class="auth-fld"><label for="auth-p">Mật khẩu</label>'
      + '  <div class="auth-pwrap"><input id="auth-p" type="password" autocomplete="current-password" required>'
      + '    <button type="button" class="auth-eye" id="auth-eye" aria-label="Hiện mật khẩu"'
      + '            title="Hiện / ẩn mật khẩu">👁</button></div></div>'
      + '<button type="submit" class="auth-btn" id="auth-go">Đăng nhập →</button>'
      + '<div class="auth-secure"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"'
      + '   stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">'
      + '   <rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'
      + "Kết nối được mã hóa</div>"
      + '<div class="auth-hint">Trang nội bộ — vui lòng không chia sẻ mật khẩu.<br>'
      + "Mỗi tài khoản chỉ dùng được trên một máy tại một thời điểm.</div>"
      + "</form>";

    document.getElementById("auth-eye").addEventListener("click", function () {
      var p = document.getElementById("auth-p");
      var an = p.type === "password";
      p.type = an ? "text" : "password";
      this.textContent = an ? "🙈" : "👁";
      this.setAttribute("aria-label", an ? "Ẩn mật khẩu" : "Hiện mật khẩu");
    });
    document.getElementById("auth-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      dangNhap(document.getElementById("auth-u").value.trim(),
               document.getElementById("auth-p").value);
    });
  }

  function baoLoi(text, kieu) {
    var m = document.getElementById("auth-msg");
    if (!m) return;
    m.className = "auth-msg" + (kieu ? " " + kieu : "");
    m.innerHTML = esc(text);
    m.hidden = !text;
  }

  function dangNhap(u, p) {
    if (!u || !p) { baoLoi("Nhập đủ tên đăng nhập và mật khẩu."); return; }
    var nut = document.getElementById("auth-go");
    nut.disabled = true; nut.textContent = "Đang kiểm tra…";
    baoLoi("");
    goiAPI("/api/login", { method: "POST", body: { u: u, p: p } }).then(function (kq) {
      nut.disabled = false; nut.textContent = "Đăng nhập →";
      if (!kq.ok) { baoLoi((kq.data && kq.data.loi) || "Đăng nhập không thành công."); return; }
      luu.set(K_TOKEN, kq.data.token);
      luu.set(K_USER, kq.data.user);
      phien = { user: kq.data.user, ten: kq.data.ten, tabs: kq.data.tabs || [] };
      // Minh bạch: vừa đăng nhập là đá máy khác ra thì phải nói, để phát hiện
      // tài khoản đang bị dùng chung.
      if (kq.data.day_phien) {
        console.info("Phiên trước của tài khoản này (mở lúc " + kq.data.day_phien + ") đã được kết thúc.");
      }
      vaoUngDung();
    });
  }

  /* DỌN SẠCH dữ liệu người bệnh khỏi trang.
     ⚠️ Che bằng lớp phủ là CHƯA ĐỦ: mất quyền rồi mà tên · chẩn đoán · số bệnh
     án vẫn nằm nguyên trong DOM và trong window.GIUONG_DATA — mở công cụ nhà
     phát triển là đọc được hết. Đo thật 2026-08-07: máy bị đá vẫn còn 1.993 ô
     giường trong DOM. Mất quyền phải là mất dữ liệu, không chỉ mất giao diện. */
  function xoaDuLieuTrenTrang() {
    try {
      window.GIUONG_DATA = null;
      window.DASHBOARD_DATA = null;
      ["tab-clinic", "tab-cls", "tab-giuong"].forEach(function (id) {
        var p = document.getElementById(id);
        if (p) p.innerHTML = "";
      });
      var chip = document.getElementById("auth-chip");
      if (chip) chip.remove();
    } catch (e) { /* dọn dẹp không được phép làm hỏng luồng đăng xuất */ }
  }

  function hienBiDay(loi) {
    if (timerTim) { clearInterval(timerTim); timerTim = null; }
    luu.xoa(K_TOKEN);
    xoaDuLieuTrenTrang();
    var el = overlay();
    el.innerHTML =
      '<div class="auth-card auth-kick">'
      + '<div class="auth-kick-ico">🔒</div>'
      + "<h2>Phiên làm việc đã kết thúc</h2>"
      + "<p>" + esc(loi || "Tài khoản này vừa được đăng nhập trên một máy khác.") + "</p>"
      + '<p style="color:#7c91a6;font-size:12.5px">Nếu không phải Anh/Chị vừa đăng nhập, '
      + "hãy đổi mật khẩu và báo bộ phận Công nghệ thông tin.</p>"
      + '<button type="button" class="auth-btn" id="auth-again">Đăng nhập lại</button>'
      + "</div>";
    // Nạp lại trang chứ không mở thẳng ô đăng nhập: các panel vừa bị xoá trắng,
    // đăng nhập lại tại chỗ thì không còn khung để vẽ vào.
    document.getElementById("auth-again").addEventListener("click", function () { location.reload(); });
  }

  function ketThucPhien() {
    luu.xoa(K_TOKEN); luu.xoa(K_USER); phien = null;
    if (timerTim) { clearInterval(timerTim); timerTim = null; }
    xoaDuLieuTrenTrang();
  }

  /* ---------- PHÂN QUYỀN TAB ----------
     Ẩn CẢ nút tab LẪN panel. Ẩn mỗi nút thì `index.html#cls` vẫn mở được panel
     — phân quyền mà lách được bằng thanh địa chỉ thì coi như không có.
     ⚠️ Phải chạy SAU khi app.js nạp xong: cuối app.js có đoạn khôi phục tab từ
     localStorage + từ hash, có thể nhảy vào đúng tab không được phép. */
  function apDungQuyen(tabs) {
    var duoc = {};
    (tabs || []).forEach(function (t) { duoc[t] = true; });
    var conLai = [];
    [].forEach.call(document.querySelectorAll(".tab[data-tab]"), function (b) {
      var t = b.dataset.tab;
      var panel = document.getElementById("tab-" + t);
      if (duoc[t]) { conLai.push(t); return; }
      /* Dùng CLASS chứ KHÔNG dùng thuộc tính `hidden` — xem giải thích ở auth.css:
         style.css khai display cho `.tabs .tab` và `.tab-panel.active`, đè mất
         display:none của [hidden] ⇒ tab vẫn hiện và vẫn bấm được. */
      b.classList.add("auth-cam");
      b.setAttribute("aria-hidden", "true");
      b.tabIndex = -1;                       // không lọt vào thứ tự nhấn phím Tab
      b.disabled = true;
      if (panel) { panel.classList.remove("active"); panel.classList.add("auth-cam"); }
    });

    /* Bọc switchTab: chặn ở LỚP HÀNH VI, không chỉ lớp hiển thị.
       Ẩn bằng CSS mà để switchTab chạy tự do thì bàn phím, hash, hoặc bất kỳ mã
       nào gọi switchTab('cls') vẫn mở được panel cấm. Giữ hàm gốc, chỉ lọc tên tab. */
    var goc = window.switchTab;
    if (typeof goc === "function" && !goc.__auth) {
      var boc = function (name) {
        if (!duoc[name]) name = conLai[0];
        if (!name) return;
        return goc(name);
      };
      boc.__auth = true;
      window.switchTab = boc;
    }

    /* Thanh đếm ngược "Tự cập nhật" nói về số liệu PHÒNG KHÁM. Tài khoản không có
       quyền đó thì nó đứng mãi ở "Đang chờ số liệu…" — một dòng chữ sai sự thật
       về thứ người dùng còn không được xem. Ẩn đi. */
    if (!duoc.clinic && !duoc.cls) {
      var ub = document.getElementById("update-bar");
      if (ub) ub.style.display = "none";
    }
    // Chỉ còn 1 tab thì thanh tab không mang thông tin gì nữa → ẩn luôn cho gọn
    // (đúng tinh thần "màn hình mặc định chỉ chứa một thứ", CLAUDE.md §12.5).
    var nav = document.querySelector(".tabs");
    if (nav && conLai.length <= 1) nav.hidden = true;

    var dangMo = document.querySelector(".tab-panel.active");
    var moDung = dangMo && duoc[String(dangMo.id).replace(/^tab-/, "")];
    if (!moDung && conLai.length && typeof window.switchTab === "function") {
      window.switchTab(conLai[0]);
    }
    // Chặn cả đường vào bằng hash sau khi đã tải trang (#cls, #clinic…).
    window.addEventListener("hashchange", function () {
      var h = (location.hash || "").slice(1);
      if (h && !duoc[h] && conLai.length && typeof window.switchTab === "function") {
        window.switchTab(conLai[0]);
      }
    });
  }

  /* ---------- CHIP TÀI KHOẢN + ĐĂNG XUẤT trên header ---------- */
  function ganChip() {
    var host = document.querySelector("header .head-right");
    if (!host || document.getElementById("auth-chip")) return;
    var d = document.createElement("div");
    d.className = "auth-chip";
    d.id = "auth-chip";
    d.innerHTML = '<span class="auth-who">👤 ' + esc(phien.ten || phien.user) + "</span>"
                + '<button type="button" class="auth-out" id="auth-out">Đăng xuất</button>';
    host.insertBefore(d, host.firstChild);
    document.getElementById("auth-out").addEventListener("click", function () {
      goiAPI("/api/logout", { method: "POST" }).then(function () {
        ketThucPhien();
        // Nạp lại trang: sạch mọi dữ liệu đang nằm trong bộ nhớ trình duyệt
        // (window.DASHBOARD_DATA / GIUONG_DATA vẫn còn tên người bệnh).
        location.reload();
      });
    });
  }

  /* ---------- NHỊP TIM: phát hiện bị đá khỏi phiên ----------
     Không có nhịp tim thì máy bị đá vẫn hiện nguyên màn hình cũ đầy dữ liệu
     người bệnh cho tới lần bấm kế tiếp — đúng kiểu "màn hình nói dối im lặng". */
  function batNhipTim() {
    if (timerTim) clearInterval(timerTim);
    timerTim = setInterval(function () {
      goiAPI("/api/session").then(function (kq) {
        if (!kq.ok) xuLyMaLoi(kq);
      });
    }, NHIP_TIM_GIAY * 1000);
  }

  /* ---------- VÀO ỨNG DỤNG ---------- */
  function vaoUngDung() {
    var tabs = phien.tabs || [];
    var xemDuocPK = tabs.indexOf("clinic") >= 0 || tabs.indexOf("cls") >= 0;

    // Cấp NGUỒN DỮ LIỆU cho app.js và giuong.js. Hai file kia không biết gì về
    // đăng nhập — chúng chỉ hỏi "cho tôi dữ liệu", ai đưa thì tuỳ chế độ.
    window.API_FETCH_CLINIC = function () { return layDuLieu("clinic"); };
    window.GIUONG_LOADER = function () {
      return layDuLieu("beds").then(function (d) {
        /* Chip ngày trên header vốn lấy từ dữ liệu PHÒNG KHÁM. Tài khoản không có
           quyền đó thì nó đứng mãi ở "Ngày —", trông như hỏng. Lấy tạm ngày của
           chính số liệu giường — đúng thứ người dùng này đang xem. */
        if (d && d.cap_nhat && !xemDuocPK) {
          var el = document.getElementById("report-date");
          var p = String(d.cap_nhat).slice(0, 10).split("-");
          if (el && p.length === 3) el.textContent = p[2] + "/" + p[1] + "/" + p[0];
        }
        return d;
      });
    };

    var chuanBi = xemDuocPK
      ? layDuLieu("clinic").then(function (d) { window.DASHBOARD_DATA = d || null; })
      : Promise.resolve();

    // Đăng nhập LẠI trên trang đã từng dọn sạch dữ liệu: khung giao diện đã bị
    // xoá trắng nên không vẽ lại tại chỗ được → nạp lại trang. Token đã nằm
    // trong sessionStorage nên sau khi nạp lại là vào thẳng, không hỏi lần nữa.
    if (daNapApp) { location.reload(); return; }

    chuanBi.then(function () {
      dongOverlay();
      return napScript("app.js")
        .then(function () { return napScript("giuong.js"); })
        .then(function () {
          daNapApp = true;
          apDungQuyen(tabs);
          ganChip();
          batNhipTim();
        });
    }).catch(function (e) {
      console.error(e);
      overlay();
      baoLoi("Không tải được giao diện. Vui lòng tải lại trang.");
    });
  }

  /* ---------- KHỞI ĐỘNG ----------
     Có token cũ trong sessionStorage (F5 giữa ca) thì thử dùng lại, khỏi bắt
     gõ mật khẩu. Máy chủ mới là nơi phán quyết token còn hiệu lực hay không. */
  /* Trang đã lên GitHub Pages nhưng cổng xác thực CHƯA triển khai xong.
     Hiện ô đăng nhập lúc này là bẫy người dùng: gõ mật khẩu đúng vẫn không vào
     được, và họ sẽ tưởng mình nhớ nhầm mật khẩu. Nói thẳng đang cài đặt. */
  function hienChuaCaiDat() {
    overlay().innerHTML =
      '<div class="auth-card auth-kick">'
      + '<div class="auth-kick-ico">🛠</div>'
      + '<h2 style="color:#005A92">Đang trong quá trình cài đặt</h2>'
      + "<p>Trang đã sẵn sàng nhưng cổng xác thực chưa được kích hoạt, "
      + "nên chưa thể đăng nhập.</p>"
      + '<p style="color:#7c91a6;font-size:12.5px">Bộ phận kỹ thuật: triển khai Worker rồi chạy '
      + "<b>python scraper/publish_public.py day</b> để cập nhật trang này.</p>"
      + "</div>";
  }

  function khoiDong() {
    if (/CHUA-CAU-HINH|TEN-TAI-KHOAN|\.invalid$/.test(API)) { hienChuaCaiDat(); return; }
    if (!luu.get(K_TOKEN) || !luu.get(K_USER)) { hienDangNhap(""); return; }
    overlay().innerHTML = '<div class="auth-card auth-kick">'
      + '<div class="auth-kick-ico">⏳</div><h2 style="color:#005A92">Đang kiểm tra phiên đăng nhập…</h2></div>';
    goiAPI("/api/session").then(function (kq) {
      if (kq.ok) {
        phien = { user: kq.data.user, ten: kq.data.ten, tabs: kq.data.tabs || [] };
        vaoUngDung();
      } else if (kq.ma === 409) {
        hienBiDay(kq.data && kq.data.loi);
      } else {
        ketThucPhien();
        hienDangNhap(kq.ma === 0 ? (kq.data && kq.data.loi) : "");
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", khoiDong);
  } else {
    khoiDong();
  }
})();
