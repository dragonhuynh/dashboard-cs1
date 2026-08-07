/* =====================================================================
   TAB PHÒNG · GIƯỜNG NỘI TRÚ — logic riêng của panel #tab-giuong
   ---------------------------------------------------------------------
   Trước 2026-07-22 đây là <script> nội tuyến của trang riêng giuong.html.
   Nay là TAB THẬT trong dashboard tổng (user chốt).

   ⚠️ BA LUẬT PHẢI GIỮ:
   1. TOÀN BỘ nằm trong IIFE — app.js đã có `esc`, `cut`, `hhmm`, `fmt`…
      cùng tên; để lọt ra phạm vi toàn cục là hai tab ghi đè lẫn nhau.
   2. Mọi truy vấn DOM đi qua `$()` (giới hạn trong #tab-giuong), KHÔNG
      document.querySelector — trang này còn 2 tab khác cùng sống.
   3. Dữ liệu `giuong-data.js` (~530 KB) NẠP LƯỜI: chỉ tải khi người dùng
      mở tab lần đầu, để 2 tab kia không gánh thêm nửa MB lúc mở trang.
   ===================================================================== */
(function () {
  const ROOT_SEL = "#tab-giuong";
  const root = () => document.querySelector(ROOT_SEL);
  const $ = s => { const r = root(); return r ? r.querySelector(s) : null; };
  const $$ = s => { const r = root(); return r ? [...r.querySelectorAll(s)] : []; };

  let D = null;                 // dữ liệu đang hiển thị (window.GIUONG_DATA)
  let daNap = false;            // đã nạp xong dữ liệu lần đầu chưa
  let dangNap = false;
  let q = "";
  const ttLoc = new Set();      // trạng thái giường đang lọc (rỗng = hiện hết)

  /* ===== 4 TRẠNG THÁI GIƯỜNG — dùng chung cho MÀU và cho BỘ LỌC =====
     Mỗi giường thuộc ĐÚNG MỘT loại, thứ tự xét y hệt lúc tô màu thẻ: nhiều người bệnh >
     sắp ra viện > đang có người. Lọc và màu phải cùng một hàm, nếu tách ra thì bấm
     "Sắp ra viện" lại ra thẻ đỏ — dashboard nói một đằng bày một nẻo. */
  const TEN_LOAI = { trong: "Giường trống", nguoi: "Đang có người", sap_ra: "Sắp ra viện", nhieu: "Nhiều người bệnh" };
  const LOAI_CLS = { nguoi: "busy", sap_ra: "out", nhieu: "multi" };
  function loaiGiuong(g) {
    const ppl = g.nguoi || [];
    if (!ppl.length) return "trong";
    if (g.ho > 1) return "nhieu";
    return ppl.some(p => p.sap_ra) ? "sap_ra" : "nguoi";
  }
  const dangLoc = () => !!q || ttLoc.size > 0;

  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const n = v => (v ?? 0).toLocaleString("vi-VN");
  const dm = s => s ? s.slice(8, 10) + "/" + s.slice(5, 7) : "";
  const hhmm = s => s ? s.slice(11, 16) : "";

  /* Giải mã TỪ ĐIỂN CHUỖI: chẩn đoán · bác sĩ · chế độ chăm sóc · loại bệnh án · loại giường được
     xuất dưới dạng SỐ THỨ TỰ trỏ vào D.tu (mỗi giá trị chỉ ghi 1 lần trong file thay vì lặp ~1.900
     lần). File cũ chưa có D.tu vẫn chạy được: giá trị không phải số thì trả về nguyên văn. */
  const tu = i => (typeof i === "number" ? (D.tu && D.tu[i]) : i) || "";
  /* Nhãn trạng thái NB tra theo mã. Mã lạ HIS thêm sau này → hiện thẳng "Mã <n>", KHÔNG đoán nghĩa. */
  const ttNhan = m => (m == null ? "" : ((D.tt_nhan && D.tt_nhan[m]) || "Mã " + m));

  /* ===== Mốc cập nhật =====
     TỰ CẢNH BÁO khi số cũ: luồng nền (`dashboard_auto.bat`) chết lặng thì trang vẫn bày số y như
     thường — người dùng KHÔNG có cách nào biết (log lỗi L03). Ngưỡng RIÊNG của luồng giường:
     >15' = cam (chu kỳ chạy 5') · >60' = đỏ. KHÔNG dùng freshnessBadge() của app.js: ngưỡng bên
     đó là 120'/240' cho luồng phòng khám, áp vào đây thì 3 tiếng không cập nhật vẫn báo "bình thường". */
  function veMocCapNhat() {
    const el = $("#g-fresh"); if (!el) return;
    const s = (D && D.cap_nhat) || "";                 // "2026-07-21 16:36:29"
    const d = s ? new Date(s.replace(" ", "T")) : null;
    if (!d || isNaN(d)) { el.innerHTML = `<span class="freshness none">⏱ chưa có mốc cập nhật</span>`; return; }
    const ngay = s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4), gio = s.slice(11, 16);
    const ph = Math.max(0, Math.round((Date.now() - d) / 60000));
    const truoc = ph < 1 ? "vừa xong" : ph < 60 ? ph + " phút trước"
      : ph < 1440 ? Math.round(ph / 60) + " giờ trước" : Math.round(ph / 1440) + " ngày trước";
    const nhac = "Số liệu nội trú đáng lẽ tự cập nhật 5 phút/lần. Quá hạn ⇒ kiểm tra dashboard_auto.bat có đang chạy không (từ 22/07 MỘT luồng lo cả 3 tab).";
    if (ph > 60) {
      el.innerHTML = `<time class="freshness stale" datetime="${s.replace(" ", "T")}" title="${esc(nhac)}">`
        + `<span class="fdot" aria-hidden="true"></span><b class="f-tag">SỐ ĐÃ CŨ</b>`
        + `<span class="f-mid">🛏 Số giường lúc ${gio} · ${truoc}</span>`
        + `<span class="f-act">→ Kiểm tra dashboard_auto.bat</span></time>`;
      return;
    }
    el.innerHTML = `<time class="freshness ${ph > 15 ? "warn" : "fresh"}" datetime="${s.replace(" ", "T")}"`
      + ` title="${ph > 15 ? esc(nhac) : "Cập nhật lúc " + gio + " ngày " + ngay}">`
      + `<span class="fdot" aria-hidden="true"></span>`
      + `${ph > 15 ? "⚠ số cũ — " : ""}🛏 Số giường lúc ${gio} · ${truoc}</time>`;
  }

  /* ⚠️ Khối `tong` của giuong-data.js dùng tên NGẮN (co_nguoi · giuong · trong · khoa), trong khi
     mỗi khoa lại dùng tên DÀI (giuong_co_nguoi · tong_giuong · giuong_trong). Đọc nhầm nhóm tên là
     KPI ra 0/0 mà trang vẫn trông bình thường — đúng kiểu "số 0 nói dối im lặng" (log lỗi L05 §luật 5).
     Đọc cả hai tên để file xuất cũ/mới đều chạy; ?? chứ không || vì 0 là giá trị hợp lệ. */
  const tongSo = (t, ngan, dai) => t[ngan] ?? t[dai];

  function renderKpis() {
    const t = D.tong;
    veMocCapNhat();
    $("#g-kpis").innerHTML = `
      <div class="g-kpi g-hero"><div class="lab">Giường đang có người</div>
        <div class="val">${n(tongSo(t, "co_nguoi", "giuong_co_nguoi"))}<span style="font-size:17px;color:var(--muted)">/${n(tongSo(t, "giuong", "tong_giuong"))}</span></div>
        <div class="note">công suất ${t.cong_suat}% · ${n(tongSo(t, "khoa", "so_khoa"))} khoa</div></div>
      <div class="g-kpi g-free"><div class="lab">Giường trống</div><div class="val">${n(tongSo(t, "trong", "giuong_trong"))}</div>
        <div class="note">còn nhận được người bệnh</div></div>
      <div class="g-kpi g-out"><div class="lab">Sắp ra viện</div><div class="val">${n(t.sap_ra)}</div>
        <div class="note">đã hẹn giờ ra viện → giường sắp trống</div></div>
      <div class="g-kpi g-wait"><div class="lab">Chờ tiếp nhận vào khoa</div><div class="val">${n(t.cho_vao)}</div>
        <div class="note">đang cần bố trí giường</div></div>
      <div class="g-kpi g-none"><div class="lab">Người bệnh nội trú</div><div class="val">${n(t.nguoi_benh)}</div>
        <div class="note">gồm cả trẻ sơ sinh</div></div>`;
  }

  /* Bảng khoa = TOÀN CẢNH, hiện hết 14 khoa cùng lúc (user chốt: "khỏi phải kéo qua kéo lại").
     Bấm 1 khoa → nhảy xuống đúng phần chi tiết của khoa đó ở dưới. */
  function renderKhoas() {
    $("#g-khoas").innerHTML = D.khoas.map((k, i) => {
      const cs = k.cong_suat ?? 0;
      const lv = cs >= 90 ? "hi" : (cs >= 70 ? "mid" : "");
      return `<button class="g-kh" type="button" data-i="${i}">
        <b>${esc(k.ten)}</b>
        <div class="num"><em>${n(k.giuong_co_nguoi)}</em>/${n(k.tong_giuong)} giường
          · <span class="fr">trống ${n(k.giuong_trong)}</span>
          ${k.sap_ra ? ` · sắp ra ${n(k.sap_ra)}` : ""}
          ${k.cho_vao ? ` · <span class="wt">chờ vào ${n(k.cho_vao)}</span>` : ""}</div>
        <div class="bar"><i class="${lv}" style="width:${cs}%"></i></div>
      </button>`;
    }).join("");
    $$(".g-kh").forEach(b => b.onclick = () => {
      const el = $("#gk" + b.dataset.i);
      moKhoa(false);            // GẬP TRƯỚC rồi mới cuộn: cuộn trong lúc trang còn co lại thì
      doThanhDinh();            // trình duyệt tính đích theo chiều cao CŨ → nhảy quá đích
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  /* ===== ĐT: bảng khoa gập vào nút; nhãn nút = khoa ĐANG XEM + còn trống / chờ vào =====
     Người xếp giường hỏi đúng 2 câu: "đang ở khoa nào" và "khoa đó còn trống mấy giường". */
  function moKhoa(mo) {
    const bar = $("#g-stickybar"); if (!bar) return;
    if (mo === undefined) mo = !bar.classList.contains("open");
    bar.classList.toggle("open", mo);
    const p = $("#g-pick"); if (p) p.setAttribute("aria-expanded", mo ? "true" : "false");
  }

  let khoaDangXem = -1;
  function capNhatNhanKhoa() {
    if (!D) return;
    const cs = getComputedStyle(document.documentElement);
    const moc = (parseFloat(cs.getPropertyValue("--topstack-h")) || 0)
              + (parseFloat(cs.getPropertyValue("--sticky-h")) || 0) + 12;
    // duyệt các khoa ĐANG CÓ trên trang (lọc tìm kiếm có thể ẩn bớt khoa), không duyệt theo D.khoas
    let i = -1;
    for (const el of $$(".g-khoa-sec")) {
      if (el.getBoundingClientRect().top <= moc) i = +el.id.slice(2); else break;
    }
    if (i === khoaDangXem) return;
    khoaDangXem = i;
    const k = i >= 0 ? D.khoas[i] : null;
    const lab = $("#g-pickLab"); if (!lab) return;
    lab.innerHTML = k
      ? `${esc(k.ten)} · <span class="fr">trống ${n(k.giuong_trong)}</span>`
        + (k.cho_vao ? ` · <span class="wt">chờ vào ${n(k.cho_vao)}</span>` : "")
      : "Chọn khoa để xem sơ đồ giường";
  }

  function bedHtml(g) {
    const ppl = g.nguoi || [];
    const sapRa = ppl.some(p => p.sap_ra);
    const cls = LOAI_CLS[loaiGiuong(g)];

    // mẹ trước, con sau (tên con bắt đầu bằng "CB")
    const sorted = [...ppl].sort((a, b) => (/^CB\s/i.test(a.ten) ? 1 : 0) - (/^CB\s/i.test(b.ten) ? 1 : 0));
    // Thẻ chỉ mang thứ điều dưỡng cần khi đứng ở cửa phòng: AI · NẰM MẤY NGÀY · BAO GIỜ RA.
    // Chẩn đoán/BS đưa vào tooltip — in ra mặt thẻ thì mỗi giường tốn thêm 1 dòng × hàng nghìn giường.
    const who = sorted.map(p => {
      const con = /^CB\s/i.test(p.ten);
      const bs = tu(p.bs);
      const tip = [ttNhan(p.tt_ma), tu(p.cd), bs && "BS " + bs, tu(p.cham_soc)].filter(Boolean).join(" · ");
      const ra = p.ra ? ` <span class="out-at">→ ra ${hhmm(p.ra)} ${dm(p.ra)}</span>` : "";
      // Chỉ ghi trạng thái KHI KHÁC "Đang điều trị": in nhãn đó lên 1.700 dòng bình thường là nhiễu,
      // còn "đang chuyển khoa"/"chờ ra viện" mới là thứ làm giường sắp đổi chủ.
      const tt = p.tt_ma && p.tt_ma !== 30 ? ` <span class="g-tt g-tt${p.tt_ma}">${esc(ttNhan(p.tt_ma))}</span>` : "";
      return `<div class="who" title="${esc(tip)}">
        <span class="${con ? "kid" : "nm"}">${con ? "↳ " : ""}${esc(p.ten)}</span>${tt}
        <span class="det">${p.tuoi ? " · " + esc(p.tuoi) : ""}${p.ngay ? " · " + p.ngay + " ngày" : ""}${ra}</span>
        ${p.ba ? `<div class="ba" title="Số vào viện (mã bệnh án)">${esc(p.ba)}</div>` : ""}
        </div>`;
    }).join("");
    const tag = g.ho > 1 ? `<span class="tag" style="color:var(--red);border-color:#f3c7c7">${g.ho} người bệnh</span>`
      : (sapRa ? `<span class="tag" style="color:var(--amber);border-color:#f5dda6">sắp ra viện</span>` : "");
    return `<div class="g-bed ${cls}"><div class="top"><span class="no">${esc(g.so_hieu)}</span>${tag}</div>${who}</div>`;
  }

  // Lọc trạng thái và từ khóa CỘNG DỒN (VÀ): gõ "h6" rồi bấm "Giường trống" = giường trống của H6.
  function match(g, room) {
    if (ttLoc.size && !ttLoc.has(loaiGiuong(g))) return false;
    if (!q) return true;
    // Tìm được cả bằng SỐ VÀO VIỆN: cầm giấy tờ trên tay gõ số là ra ngay giường (user chốt).
    const hay = (g.so_hieu + " " + room.ten + " " + (room.ma || "") + " " +
      (g.nguoi || []).map(p => p.ten + " " + (p.ba || "")).join(" ")).toLowerCase();
    return hay.includes(q);
  }

  let dem = { g: 0, p: 0, k: 0 };     // đếm KẾT QUẢ ĐANG VẼ RA (khoaHtml cộng vào)

  function renderBody() {
    dem = { g: 0, p: 0, k: 0 };
    const html = D.khoas.map(khoaHtml).join("");
    // Lọc ra 0 giường mà trang chỉ trống trơn thì trông y hệt "mất dữ liệu" → nói rõ là do bộ lọc.
    const rong = dangLoc()
      ? `<div class="g-empty-msg">Không có giường nào khớp bộ lọc.
           <span class="g-sub">Thử bỏ bớt trạng thái đang chọn hoặc xóa từ khóa tìm.</span></div>`
      : `<div class="g-empty-msg">Không có dữ liệu.</div>`;
    $("#g-body").innerHTML = tomTatLoc() + (html || rong);
  }

  /* Bấm lọc xong phải thấy NGAY còn lại bao nhiêu — và thấy mình đang lọc GÌ, vì thanh chú giải
     có thể đã cuộn khuất trên ĐT. Số ở đây đếm từ chính thứ đang vẽ ra nên không thể lệch. */
  function tomTatLoc() {
    if (!dangLoc()) return "";
    const phan = [];
    if (ttLoc.size) phan.push(Object.keys(TEN_LOAI).filter(t => ttLoc.has(t)).map(t => TEN_LOAI[t]).join(" hoặc "));
    if (q) phan.push(`từ khóa “${esc(q)}”`);
    return `<div class="g-flt-sum">Đang lọc: <b>${phan.join(" · ")}</b>
      <span class="num">${n(dem.g)} giường · ${n(dem.p)} phòng · ${n(dem.k)} khoa</span></div>`;
  }

  function khoaHtml(k, idx) {
    let html = "", lastFloor = "___";
    // `hien` = giường KHỚP bộ lọc (thứ được vẽ) · `giuong` giữ NGUYÊN cả phòng (thứ để ĐẾM).
    // Trước 2026-07-23 chỗ này ghi đè luôn `giuong` → đang tìm kiếm thì "tối đa N giường" và
    // "N có người · N trống" đếm theo phần đã lọc, tức phòng 10 giường hiện ra "tối đa 1 giường".
    const rooms = k.phong
      .map(r => ({ ...r, hien: r.giuong.filter(g => match(g, r)) }))
      .filter(r => r.hien.length);

    dem.p += rooms.length;
    if (rooms.length) { dem.k++; dem.g += rooms.reduce((s, r) => s + r.hien.length, 0); }

    if (!rooms.length) {
      if (dangLoc()) return "";               // đang lọc → khoa không khớp thì ẩn hẳn, khỏi nhiễu
      html = `<div class="g-empty-msg">Khoa này chưa khai giường trên HIS.</div>`;
    } else {
      let open = false;
      for (const r of rooms) {
        const fl = r.tang == null ? "Chưa rõ tầng" : "Tầng " + r.tang;
        if (fl !== lastFloor) {
          if (open) html += "</div>";
          html += `<div class="g-floor">${fl}</div><div class="g-rooms">`;
          lastFloor = fl; open = true;
        }
        // ĐẾM theo cả phòng (sự thật về phòng đó) · VẼ theo phần khớp bộ lọc.
        const coNguoi = r.giuong.filter(g => g.nguoi.length).length;
        const conTrong = r.giuong.length - coNguoi;
        const busy = r.hien.filter(g => g.nguoi.length);
        const free = r.hien.filter(g => !g.nguoi.length);
        const wide = busy.length > 3 ? " wide" : "";   // phòng đông → trải ngang cả hàng
        const day = conTrong === 0;
        html += `<div class="g-room${wide} ${coNguoi === 0 ? "empty" : (day ? "full" : "")}">
          <h3><span>${esc(r.ten)}</span>
            <span class="g-cap${day ? " done" : ""}">tối đa ${r.giuong.length} giường</span></h3>
          <div class="rmeta">${dangLoc()
            ? `<b>${r.hien.length}</b> giường khớp · cả phòng: ${coNguoi} có người · ${conTrong} trống`
            : `<b>${coNguoi}</b> giường có người · <b>${conTrong}</b> trống${day ? " · <b>đã kín</b>" : ""}`}</div>
          ${busy.length ? `<div class="g-beds">${busy.map(bedHtml).join("")}</div>` : ""}
          ${free.length ? `<div class="g-frees"><span class="lb">Trống:</span>
            ${free.map(g => `<span class="g-chip">${esc(g.so_hieu)}</span>`).join("")}</div>` : ""}
          </div>`;
      }
      if (open) html += "</div>";
    }

    // Đang lọc thì ẩn: nhóm này là NGƯỜI CHƯA CÓ GIƯỜNG, không thuộc 4 trạng thái giường đang lọc.
    if (k.chua_xep.length && !dangLoc()) {
      // Nhóm theo TRẠNG THÁI: "chờ tiếp nhận vào khoa" = đang cần bố trí giường (việc phải làm),
      // khác hẳn trẻ sơ sinh nằm cùng mẹ (không cần giường). Gộp chung một đống thì mất mất việc.
      const nhom = {};
      k.chua_xep.forEach(p => (nhom[ttNhan(p.tt_ma) || "Không rõ trạng thái"] ||= []).push(p));
      const uu = ["Chờ tiếp nhận vào khoa", "Đang chuyển khoa", "Chờ hoàn tất thủ tục ra viện"];
      const keys = Object.keys(nhom).sort((a, b) =>
        (uu.indexOf(a) + 1 || 9) - (uu.indexOf(b) + 1 || 9) || nhom[b].length - nhom[a].length);
      html += `<div class="g-unassigned"><h3>${k.chua_xep.length} người bệnh chưa xếp giường</h3>
        <div class="hint">HIS để trống cột Giường–Phòng. Trẻ sơ sinh nằm cùng mẹ thì không cần giường
          riêng; nhóm <b>chờ tiếp nhận vào khoa</b> mới là người đang cần bố trí giường.</div>
        ${keys.map(kk => `<div class="g-ugrp"><b>${esc(kk)}</b> — ${nhom[kk].length} người
          <div class="g-ulist">${nhom[kk].map(p =>
        `<div>${esc(p.ten)}${p.tuoi ? " · " + esc(p.tuoi) : ""}</div>`).join("")}</div></div>`).join("")}
        </div>`;
    }

    return `<section class="g-khoa-sec" id="gk${idx}">
      <div class="g-khoa-head">
        <h2>${esc(k.ten)}</h2>
        <div class="st"><b>${n(k.giuong_co_nguoi)}</b>/${n(k.tong_giuong)} giường có người
          · công suất <b>${k.cong_suat ?? "—"}%</b>
          · <span style="color:var(--green);font-weight:700">trống ${n(k.giuong_trong)}</span>
          ${k.sap_ra ? ` · <span style="color:var(--amber);font-weight:700">sắp ra viện ${n(k.sap_ra)}</span>` : ""}</div>
      </div>${html}</section>`;
  }

  /* Đo chiều cao khối đầu trang DÍNH (header + tabs) và thanh điều phối của tab này.
     Đo THẬT thay vì đặt số cứng: cả hai đổi theo bề ngang màn hình. Thiếu bước này thì
     thanh khoa chui xuống dưới tabs, và bấm khoa xong tiêu đề khoa bị che. */
  function doThanhDinh() {
    const top = document.querySelector(".topstack");
    document.documentElement.style.setProperty("--topstack-h", (top ? top.offsetHeight : 0) + "px");
    const bar = $("#g-stickybar"); if (!bar) return;
    const st = getComputedStyle(bar);
    // Bảng khoa đang bung thì KHÔNG đo cả khối: nó gập lại ngay sau khi chọn khoa.
    // Phần che tầm nhìn lâu dài chỉ là thanh công cụ (nút khoa + ô tìm).
    const tools = $(".g-tools");
    const cao = st.position !== "sticky" ? 0
      : (bar.classList.contains("open") && tools
        ? tools.offsetHeight + (parseFloat(st.paddingTop) || 0)
        : bar.offsetHeight);
    document.documentElement.style.setProperty("--sticky-h", cao + "px");
  }

  const chinhNutTop = () => {
    const b = $("#g-toTop"); if (b) b.classList.toggle("an", window.scrollY < 400);
  };

  // Vẽ lại phần kết quả sau khi đổi bộ lọc/từ khóa: lọc xong thì khoa nào nằm dưới thanh dính đã khác.
  function veLaiKetQua() {
    renderBody();
    khoaDangXem = -2; capNhatNhanKhoa();
  }

  function capNhatNutLoc() {
    $$(".g-lg").forEach(b => b.setAttribute("aria-pressed", ttLoc.has(b.dataset.tt) ? "true" : "false"));
    const c = $("#g-lgClear"); if (c) c.classList.toggle("an", ttLoc.size === 0);
  }

  function veTatCa() {
    renderKpis(); renderKhoas(); renderBody(); capNhatNutLoc();
    doThanhDinh(); khoaDangXem = -2; capNhatNhanKhoa(); chinhNutTop();
    // Huy hiệu tab = số người ĐANG CẦN bố trí giường (chờ tiếp nhận vào khoa) — con số HÀNH ĐỘNG,
    // song song với "phòng cần can thiệp" của 2 tab kia. 0 thì ẩn (khuôn setTabBadge của app.js).
    if (typeof window.setTabBadge === "function") {
      window.setTabBadge("badge-giuong", (D.tong && D.tong.cho_vao) || 0, "amber");
    }
    // Pill mốc giờ trên header đọc window.GIUONG_DATA — lúc app.js vẽ pill thì dữ liệu chưa nạp
    // xong (nạp lười), nên phải gọi lại ở đây, nếu không pill đứng ở "Đang nạp…" mãi.
    if (typeof window.updateAge === "function") window.updateAge();
  }

  // ---- Gắn sự kiện MỘT LẦN (markup tĩnh nằm sẵn trong index.html) ----
  let daGan = false;
  function ganSuKien() {
    if (daGan) return; daGan = true;
    $("#g-q").addEventListener("input", e => {
      q = e.target.value.trim().toLowerCase(); veLaiKetQua();
    });
    // Chú giải màu = nút lọc. Bấm lại = tắt; chọn nhiều trạng thái = HOẶC (xem match()).
    $$(".g-lg").forEach(b => b.onclick = () => {
      const t = b.dataset.tt;
      if (ttLoc.has(t)) ttLoc.delete(t); else ttLoc.add(t);
      moKhoa(false);          // ĐT: bảng khoa đang bung thì che mất kết quả vừa lọc
      capNhatNutLoc(); veLaiKetQua();
    });
    $("#g-lgClear").onclick = () => { ttLoc.clear(); capNhatNutLoc(); veLaiKetQua(); };
    // gõ tìm thì gập bảng khoa lại — kết quả tìm nằm ngay dưới, đừng để bảng che
    $("#g-q").addEventListener("focus", () => moKhoa(false));
    $("#g-pick").onclick = () => moKhoa();
    $("#g-toTop").onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });
    // bấm ra ngoài thanh = đóng (thói quen dùng ĐT), khỏi phải bấm lại đúng nút
    addEventListener("click", e => {
      if (root() && !e.target.closest("#g-stickybar")) moKhoa(false);
    }, { passive: true });

    let choVe = false;   // gộp việc cập nhật nhãn vào 1 khung hình, cuộn không giật
    addEventListener("scroll", () => {
      if (choVe || !dangMo()) return;
      choVe = true;
      requestAnimationFrame(() => { choVe = false; capNhatNhanKhoa(); chinhNutTop(); });
    }, { passive: true });
    addEventListener("resize", () => { if (dangMo()) doThanhDinh(); }, { passive: true });
  }

  const dangMo = () => { const r = root(); return !!r && r.classList.contains("active"); };

  /* ===== NẠP LƯỜI dữ liệu =====
     Trang mở bằng file:// nên KHÔNG fetch được (trình duyệt chặn) → nạp bằng thẻ <script>.
     Chỉ nạp khi người dùng thật sự mở tab: giuong-data.js ~530 KB, gánh sẵn lúc mở dashboard
     là bắt 2 tab kia trả giá cho thứ chưa ai xem. */
  /* Bản công khai: dữ liệu giường KHÔNG nằm trong file tĩnh (nó mang tên · tuổi ·
     số bệnh án · chẩn đoán của ~2.000 người bệnh) mà do cổng API phát ra sau khi
     xác thực — auth.js cấp `window.GIUONG_LOADER`. Dùng chung cho cả nạp lần đầu
     lẫn tự cập nhật 5 phút/lần, để chỉ có MỘT đường lấy dữ liệu. */
  function layTuAPI() {
    return typeof window.GIUONG_LOADER === "function" ? window.GIUONG_LOADER() : null;
  }

  function napDuLieu(xong) {
    if (dangNap) return; dangNap = true;
    const qua = layTuAPI();
    if (qua) {
      qua.then(d => {
        dangNap = false;
        D = d || null;
        if (D) { window.GIUONG_DATA = D; daNap = true; xong && xong(true); }
        else baoLoi("<b>Chưa lấy được sơ đồ giường.</b><br>Máy thu thập trong bệnh viện "
          + "có thể đang tạm dừng. Thử lại sau ít phút.");
      });
      return;
    }
    const s = document.createElement("script");
    s.src = "giuong-data.js?t=" + Date.now();
    s.onload = () => {
      dangNap = false; s.remove();
      D = window.GIUONG_DATA || null;
      if (D) { daNap = true; xong && xong(true); }
      else baoLoi("File giuong-data.js không có dữ liệu.");
    };
    s.onerror = () => {
      dangNap = false; s.remove();
      /* Thiếu file có HAI nguyên nhân khác hẳn nhau — nói cả hai để người xem khỏi đoán:
         (a) trong viện: luồng nền chưa chạy nên chưa sinh file;
         (b) ngoài viện: bản công khai CỐ Ý không kèm `giuong-data.js` vì file này mang tên,
             chẩn đoán, mã bệnh án của ~1.900 người bệnh (KE_HOACH_TRIEN_KHAI.md §phạm vi xuất
             bản). Đừng viết như "lỗi hệ thống" — với người ngoài viện thì đó là thiết kế. */
      baoLoi("<b>Chưa có sơ đồ giường.</b><br>Trong mạng bệnh viện: kiểm tra luồng nền "
        + "<b>dashboard_auto.bat</b> (một luồng lo cả 3 tab) hoặc chạy "
        + "<code>python scraper/beds_flow.py --nb</code>.<br>Ngoài mạng bệnh viện: sơ đồ giường "
        + "không được đưa ra ngoài vì chứa thông tin người bệnh.");
    };
    document.body.appendChild(s);
  }

  function baoLoi(html) {
    const b = $("#g-body");
    if (b) b.innerHTML = `<div class="g-empty-msg">${html}</div>`;
    // Pill header đang ghi "Đang nạp số giường…" — để nguyên là nói dối: nạp đã HỎNG, không còn chạy.
    if (typeof window.setRefreshStatus === "function") {
      window.setRefreshStatus(`<span class="ic">🛏</span> Chưa có số giường`, "warn");
    }
  }

  /* Gọi khi người dùng mở tab (app.js gọi trong switchTab). Lần đầu: nạp dữ liệu rồi vẽ.
     Các lần sau: chỉ đo lại thanh dính (bề ngang có thể đã đổi lúc tab bị ẩn — phần tử ẩn
     đo ra 0px nên phải đo lại đúng lúc hiện). */
  function moTab() {
    ganSuKien();
    if (daNap) { doThanhDinh(); khoaDangXem = -2; capNhatNhanKhoa(); veMocCapNhat(); return; }
    const b = $("#g-body");
    if (b && !b.innerHTML) b.innerHTML = `<div class="g-empty-msg">Đang nạp sơ đồ giường…</div>`;
    napDuLieu(ok => { if (ok) veTatCa(); });
  }

  /* TỰ CẬP NHẬT 5 PHÚT/LẦN (user chốt 2026-07-20).
     Nạp lại chính giuong-data.js kèm tem thời gian để khỏi dính cache. Chỉ VẼ LẠI khi số liệu
     thực sự đổi mốc, để người đang đọc dở không bị giật màn hình mỗi 5 phút.
     ⚠️ Hồi còn là trang riêng thì gọi location.reload(); nay KHÔNG được — reload sẽ ném người
     dùng ra khỏi tab họ đang xem (và tải lại cả 2 tab kia). Vẽ lại đúng panel này là đủ.
     ⚠️ Chỉ chạy khi tab ĐANG MỞ: nạp lại nửa MB cho một tab không ai nhìn là phí băng thông. */
  const LAM_MOI_PHUT = 5;
  setInterval(() => {
    if (!daNap || !dangMo() || dangNap) return;
    const cu = D && D.cap_nhat;
    // Vẽ lại CHỈ khi mốc số liệu đổi → người đang đọc dở không bị giật màn.
    const veNeuMoi = (d) => {
      if (!d || d.cap_nhat === cu) return;
      window.GIUONG_DATA = D = d;
      const y = window.scrollY;            // giữ nguyên chỗ đang đọc
      veTatCa();
      window.scrollTo({ top: y });
    };
    const qua = layTuAPI();                // bản công khai: lấy qua cổng đã xác thực
    if (qua) { qua.then(veNeuMoi); return; }
    const s = document.createElement("script");
    s.src = "giuong-data.js?t=" + Date.now();
    s.onload = () => { s.remove(); veNeuMoi(window.GIUONG_DATA); };
    s.onerror = () => s.remove();
    document.body.appendChild(s);
  }, LAM_MOI_PHUT * 60 * 1000);

  window.GiuongTab = { moTab };

  /* ⚠️ File này nạp SAU app.js, mà app.js chọn tab ngay lúc khởi động (localStorage/hash) —
     lúc đó `window.GiuongTab` chưa tồn tại nên switchTab() không gọi được moTab().
     Hậu quả đã đo thật: mở lại trang (F5) hoặc vào thẳng `index.html#giuong` thì tab mở ra
     nhưng RỖNG — 0 giường, không báo lỗi gì. Tự kiểm lúc nạp xong là hết. */
  if (dangMo()) moTab();
})();
