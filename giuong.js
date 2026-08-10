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

  /* ===== BỘ LỌC HAI TRỤC (chỉnh 2026-08-10 — xem chú thích markup trong index.html) =====
     TRỤC 1 `ttTruc` — tình trạng chiếm dụng: "" (tất cả) | "trong" | "nguoi".
       Ba giá trị LOẠI TRỪ NHAU và phủ 100% giường ⇒ chọn MỘT (segmented control). Bản cũ để
       "trống"/"có người" thành 2 chip HOẶC nên bấm cả hai = 1.993 giường = y hệt không lọc.
     TRỤC 2 `sigLoc` — dấu hiệu cần soát (tập con của "có người"): chọn NHIỀU, HOẶC trong trục,
       VÀ với trục 1. Nhờ vậy "Có người + Sắp ra viện" nay ra 206 giường thay vì 1.472 như trước.
     PRESET `preset` — "chỗ sắp có" = trống HOẶC sắp ra viện. Đây là HOẶC *chéo trục*, không diễn
       đạt được bằng 2 hàng nút nên phải là một nút riêng. */
  let ttTruc = "";
  const sigLoc = new Set();
  let preset = false;

  const TEN_TT = { trong: "giường trống", nguoi: "giường có người" };
  const TEN_SIG = { sap_ra: "sắp ra viện", qua_hen: "quá giờ hẹn ra viện",
    giu: "giữ chỗ từ xa", ghep: "nằm ghép", trung: "trùng giường" };

  /* MÀU thẻ giường: một giường chỉ được MỘT màu → xét theo thứ tự ưu tiên (nặng nhất thắng).
     ⚠️ CỐ Ý GIỮ NGUYÊN luật màu `ho > 1` ⇒ đỏ, dù đo được 128/242 giường "nhiều người" là do
     TRÙNG GIƯỜNG chứ không phải nằm ghép: khi một người bị HIS gán ở 2 giường, ta KHÔNG biết
     giường nào là thật ⇒ hạ màu là tự đoán, mà đoán sai thì giấu mất một ca nằm ghép thật
     (R09 · log lỗi L10). Thay vì đổi màu, mỗi người trùng được gắn chip "cũng ở <giường>" để
     người đọc tự thấy vì sao thẻ đỏ — nói ra sự thật, không kết luận thay họ. */
  function loaiGiuong(g) {
    const ppl = g.nguoi || [];
    if (!ppl.length) return "trong";
    if (g.ho > 1) return "nhieu";
    return ppl.some(p => p.sap_ra) ? "sap_ra" : "nguoi";
  }
  const LOAI_CLS = { nguoi: "busy", sap_ra: "out", nhieu: "multi" };

  /* ===== CHỈ SỐ NGƯỜI Ở NHIỀU GIƯỜNG =====
     HIS cho một người GIỮ NHIỀU GIƯỜNG cùng lúc (đổi giường trong ngày thì giường cũ còn hiệu lực
     tới giờ trả — CLAUDE.md §13.2). Đo 10/08: 247 người chiếm 2–3 ô giường, 277 ô giường mà MỌI
     người trên đó cũng đang được vẽ ở giường khác. Không nói ra thì người xếp giường thấy thẻ đỏ
     "2 người bệnh" ở hai giường cạnh nhau với y hệt hai cái tên (đo thật: B511.01 · B511.02).
     Dựng lại mỗi lần vẽ (dữ liệu đổi 5'/lần), khoá theo tên + số vào viện. */
  let dsGiuongCuaNguoi = new Map();
  const khoaNguoi = p => p.ten + "|" + (p.ba ?? "");
  function chiSoTrungGiuong() {
    const m = new Map();
    for (const k of D.khoas) for (const r of k.phong) for (const g of r.giuong)
      for (const p of (g.nguoi || [])) {
        const key = khoaNguoi(p);
        if (!m.has(key)) m.set(key, []);
        m.get(key).push(g.so_hieu);
      }
    dsGiuongCuaNguoi = m;
  }
  const giuongKhacCua = p => (dsGiuongCuaNguoi.get(khoaNguoi(p)) || []);
  const nguoiTrungGiuong = p => giuongKhacCua(p).length > 1;

  // Quá giờ hẹn ra viện: so với ĐỒNG HỒ THẬT, không so với mốc dữ liệu — người xếp giường hỏi
  // "tới giờ này còn ai đáng lẽ đã ra", mà mốc dữ liệu có thể đã cũ 5–10 phút.
  function quaGioHen(p) {
    if (!p.sap_ra || !p.ra) return false;
    const t = new Date(String(p.ra).replace(" ", "T"));
    return !isNaN(t) && t < new Date();
  }
  /* "Nằm ghép" = từ 2 hộ trở lên trên một giường. Với giường 2 hộ thì loại các trường hợp giải
     thích được bằng TRÙNG GIƯỜNG / GIỮ CHỖ (chúng đã có nút riêng) → nút này chỉ còn ca nằm ghép
     thật: đo 11:00 ra 109 giường (78 giường 2 hộ + 31 giường ≥3 người) thay vì 242 như nhãn cũ.
     ≥3 người thì luôn tính, dù có ai trùng giường hay không — ba người một giường là bất thường
     kể cả khi một bản ghi là rác (vd B703 Khoa Phụ 8–11 người: HIS dùng làm "giường đợi"). */
  function ghepThat(g) {
    const ppl = g.nguoi || [];
    if ((g.ho || 0) < 2) return false;
    if ((g.ho || 0) >= 3) return true;
    return !ppl.some(p => p.giu) && !ppl.some(nguoiTrungGiuong);
  }
  /* Dấu hiệu của một giường — TẬP HỢP, không phải ưu tiên (một giường mang được nhiều dấu hiệu).
     Đây là chỗ luật "lọc xét tập hợp · màu xét ưu tiên" (user chốt 2026-08-10) tiếp tục sống. */
  function sigOf(g) {
    const ppl = g.nguoi || [];
    const s = new Set();
    if (!ppl.length) return s;
    if (ppl.some(p => p.sap_ra)) s.add("sap_ra");
    if (ppl.some(quaGioHen)) s.add("qua_hen");
    if (ppl.some(p => p.giu)) s.add("giu");
    if (ghepThat(g)) s.add("ghep");
    if (ppl.some(nguoiTrungGiuong)) s.add("trung");
    return s;
  }
  const dangLoc = () => !!q || !!ttTruc || sigLoc.size > 0 || preset;

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
          · <span class="fr">trống <span class="fn">${n(k.giuong_trong)}</span></span>
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
      ? `${esc(k.ten)} · <span class="fr">trống <span class="fn">${n(k.giuong_trong)}</span></span>`
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
      // GIỮ CHỖ: người đã đăng ký giường này nhưng đang ở nơi khác (mổ · hồi sức · chuyển khoa).
      // Giường KHÔNG còn trống, nhưng đứng ở cửa phòng sẽ không thấy ai → phải nói ra, kẻo điều
      // dưỡng tưởng dữ liệu sai rồi xếp thêm người vào. Xem CLAUDE.md §13.2 · log lỗi L10.
      const giu = p.giu ? ` <span class="g-giu" title="Giường đã có người đăng ký giữ chỗ">${esc(p.giu)}</span>` : "";
      /* TRÙNG GIƯỜNG: HIS đang gán người này ở giường khác nữa. Phải nói ra tên giường kia, kẻo
         hai thẻ đỏ "2 người bệnh" cạnh nhau với y hệt hai cái tên (B511.01 · B511.02) đọc ra là
         "phòng này 4 người". Chỉ nêu SỰ VIỆC, không kết luận giường nào mới là thật (R09). */
      const khac = giuongKhacCua(p).filter(s => s !== g.so_hieu);
      const dup = khac.length
        ? ` <span class="g-dup" title="HIS đang gán người bệnh này ở ${khac.length + 1} giường cùng lúc — cần soát lại, giường còn lại có thể đã trống">cũng ở ${esc(khac.slice(0, 2).join(" · "))}${khac.length > 2 ? " +" + (khac.length - 2) : ""}</span>`
        : "";
      return `<div class="who" title="${esc(tip)}">
        <span class="${con ? "kid" : "nm"}">${con ? "↳ " : ""}${esc(p.ten)}</span>${tt}${giu}${dup}
        <span class="det">${p.tuoi ? " · " + esc(p.tuoi) : ""}${p.ngay ? " · " + p.ngay + " ngày" : ""}${ra}</span>
        ${p.ba ? `<div class="ba" title="Số vào viện (mã bệnh án)">${esc(p.ba)}</div>` : ""}
        </div>`;
    }).join("");
    const tag = g.ho > 1 ? `<span class="tag" style="color:var(--red);border-color:#f3c7c7">${g.ho} người bệnh</span>`
      : (sapRa ? `<span class="tag" style="color:var(--amber);border-color:#f5dda6">sắp ra viện</span>` : "");
    return `<div class="g-bed ${cls}"><div class="top"><span class="no">${esc(g.so_hieu)}</span>${tag}</div>${who}</div>`;
  }

  /* ===== GIƯỜNG MANG SỐ HIỆU CỦA PHÒNG KHÁC =====
     HIS khai một số giường có số hiệu thuộc phòng khác: `B517.02` nằm trong **Phòng B518**,
     `B303B.xx` trong B303… Đã HỎI LẠI HIS ngày 10/08 để chắc chắn không phải lỗi của mình: sơ đồ
     phòng giường của HIS cũng xếp `B517.02` vào phòng B518 và tự tính `slGiuong=5 · slGiuongTrong=1`
     — đúng y con số dashboard đang vẽ.
     ⇒ KHÔNG được tự dời giường về phòng trùng tên cho "gọn" (luật 13: khớp HIS, đừng sửa số).
     Nhưng PHẢI NÓI RA: điều dưỡng đứng ở cửa B518 thấy chip xanh "Trống: B517.02" trong khi cả 4
     giường B518.xx đều kín thì tưởng dashboard sai — đúng lớp lỗi "số nói dối im lặng" (luật 5).
     ⚠️ LUẬT ĐÁNH DẤU = "GIƯỜNG LẺ LOI TRONG PHÒNG": chỉ gắn khi phòng CÓ giường mang đúng mã phòng,
     mà giường này thì không. Vì cái gây nhầm là sự LẺ LOI (B518 có B518.01–.04 rồi chen thêm
     B517.02), không phải bản thân việc tên khác mã.
     → Tự loại được các phòng HIS đặt tên đồng loạt, vốn KHÔNG có gì lẻ loi để mà nhầm: `HS01…HS25`
       ở phòng `HKV1` · `GHE.003` ở `PD003` · `BTS101…` ở `BTS1` · `N1129.01–.02` ở `P1129`.
     → Cũng KHÔNG cần biết phòng "chủ" của số hiệu có tồn tại hay không. Luật cũ (đòi tiền tố phải là
       mã một phòng khác) bỏ sót `E309.03` trong phòng A309 vì HIS không khai phòng nào tên E309.
     Đo 10/08 bằng dữ liệu thật: **13 giường ở 5 phòng** — B303 (6) · B307 (4) · B412 · A309 · B518. */
  const maGoc = g => String(g.so_hieu || "").split(".")[0];
  function phongKhac(g, r, coGiuongDungMa) {
    const p = maGoc(g);
    return coGiuongDungMa && p && r.ma && p !== r.ma ? p : "";
  }
  // Phòng có ít nhất 1 giường mang đúng mã phòng → mới có chuyện "lẻ loi" để nói.
  const coGiuongDungMa = r => !!r.ma && r.giuong.some(g => maGoc(g) === r.ma);

  /* Dòng giải thích đặt NGAY trong thẻ phòng — chỉ hiện ở 5 phòng toàn viện nên không thành nhiễu.
     Nói ĐÚNG điều HIS ghi, KHÔNG phán "HIS khai sai": mình không có cách nào biết giường đó thật ra
     nằm ở phòng nào (R09 — chưa biết thì đừng đoán). Chỉ xét giường ĐANG VẼ, để dòng chữ luôn khớp
     với thứ mắt đang thấy khi đang lọc. */
  function maNote(beds, r, dungMa) {
    const ds = beds.filter(g => phongKhac(g, r, dungMa));
    if (!ds.length) return "";
    /* ⚠️ Chỉ nói "số hiệu KHÔNG THEO mã phòng", ĐỪNG nói "mang mã phòng X": tiền tố nhiều khi không
       phải mã phòng nào cả — `PMH.20…PMH.23` trong "Phòng mổ khu H" (mã HPM) là HIS gõ ngược chữ,
       không có phòng nào tên PMH. Khẳng định nó là phòng khác là SUY ĐOÁN (R09). */
    return `<div class="g-manote">HIS khai ${ds.length > 1 ? "các giường" : "giường"} `
      + `<b>${ds.map(g => esc(g.so_hieu)).join(" · ")}</b> thuộc phòng này, `
      + `dù số hiệu không theo mã phòng ${esc(r.ma)}.</div>`;
  }

  /* Ba lớp CỘNG DỒN (VÀ): trục tình trạng · trục dấu hiệu · từ khóa.
     Trong trục dấu hiệu thì HOẶC. Preset thay cho cả 2 trục (nó là HOẶC chéo trục). */
  function match(g, room) {
    const co = (g.nguoi || []).length > 0;
    if (preset) {
      if (co && !sigOf(g).has("sap_ra")) return false;      // giữ: trống · hoặc có hẹn giờ ra
    } else {
      if (ttTruc === "trong" && co) return false;
      if (ttTruc === "nguoi" && !co) return false;
      if (sigLoc.size) {
        if (!co) return false;                              // dấu hiệu chỉ có ở giường có người
        const s = sigOf(g);
        let ok = false;
        for (const t of sigLoc) if (s.has(t)) { ok = true; break; }
        if (!ok) return false;
      }
    }
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
    if (preset) phan.push("chỗ sắp có (trống hoặc sắp ra viện)");
    else {
      if (ttTruc) phan.push(TEN_TT[ttTruc]);
      if (sigLoc.size) phan.push(Object.keys(TEN_SIG).filter(t => sigLoc.has(t))
        .map(t => TEN_SIG[t]).join(" hoặc "));
    }
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
        const dungMa = coGiuongDungMa(r);
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
            ${free.map(g => { const pk = phongKhac(g, r, dungMa);
              return `<span class="g-chip${pk ? " manote" : ""}"${pk
                ? ` title="HIS khai giường này thuộc ${esc(r.ten)}, dù số hiệu không theo mã phòng ${esc(r.ma)}"` : ""
                }>${esc(g.so_hieu)}</span>`; }).join("")}</div>` : ""}
          ${maNote(r.hien, r, dungMa)}
          </div>`;
      }
      if (open) html += "</div>";
    }

    /* CUNG và CẦU phải ở cùng một màn (chỉnh 2026-08-10): khi người dùng lọc "Trống" / "Chỗ sắp
       có" thì việc thật của họ là GHÉP người đang chờ vào chỗ vừa tìm ra — bản cũ lại ẩn hẳn nhóm
       này đúng lúc đó (156 người chờ tiếp nhận vào khoa biến mất). Nay: không lọc → hiện đủ như
       trước · đang lọc CHỖ → chỉ còn nhóm "Chờ tiếp nhận vào khoa" (người ĐANG CẦN bố trí giường)
       · đang lọc dấu hiệu/từ khóa → vẫn ẩn, vì nhóm này không nằm trên giường nào để mà có dấu hiệu. */
    const CHO_VAO = "Chờ tiếp nhận vào khoa";
    const locCho = !q && (preset || ttTruc === "trong");
    if (k.chua_xep.length && (!dangLoc() || locCho)) {
      // Nhóm theo TRẠNG THÁI: "chờ tiếp nhận vào khoa" = đang cần bố trí giường (việc phải làm),
      // khác hẳn trẻ sơ sinh nằm cùng mẹ (không cần giường). Gộp chung một đống thì mất mất việc.
      const chiChoVao = dangLoc();
      const nhom = {};
      k.chua_xep.forEach(p => {
        const t = ttNhan(p.tt_ma) || "Không rõ trạng thái";
        if (chiChoVao && t !== CHO_VAO) return;
        (nhom[t] ||= []).push(p);
      });
      const uu = [CHO_VAO, "Đang chuyển khoa", "Chờ hoàn tất thủ tục ra viện"];
      const keys = Object.keys(nhom).sort((a, b) =>
        (uu.indexOf(a) + 1 || 9) - (uu.indexOf(b) + 1 || 9) || nhom[b].length - nhom[a].length);
      const tong = keys.reduce((s, kk) => s + nhom[kk].length, 0);
      if (tong) html += `<div class="g-unassigned${chiChoVao ? " nho" : ""}">
        <h3>${n(tong)} người bệnh ${chiChoVao ? "đang cần bố trí giường" : "chưa xếp giường"}</h3>
        <div class="hint">${chiChoVao
          ? `Đây là phía <b>cầu</b> của khoa này — ghép vào những chỗ đang hiện ở trên.`
          : `HIS để trống cột Giường–Phòng. Trẻ sơ sinh nằm cùng mẹ thì không cần giường
             riêng; nhóm <b>chờ tiếp nhận vào khoa</b> mới là người đang cần bố trí giường.`}</div>
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
    /* ⚠️ ĐO LẠI thanh dính: bật/tắt bộ lọc làm nút "Bỏ lọc" hiện/ẩn, có bề ngang màn hình (đo thật:
       1366px) hàng lọc vì thế xuống 2 dòng ⇒ thanh dính cao thêm 35px. `--sticky-h` cũ thì
       `scroll-margin-top` của khoa bị thiếu đúng 35px → bấm chọn khoa xong tiêu đề khoa nằm KHUẤT
       dưới thanh. Đây là biến thể của bẫy số 2 đã ghi ở CLAUDE.md §13.1. */
    doThanhDinh();
    khoaDangXem = -2; capNhatNhanKhoa();
  }

  /* Đếm SỐ GIƯỜNG của từng nhóm trên TOÀN BỘ 14 khoa rồi in lên nút (Baymard: hiện số cạnh mỗi
     lựa chọn để người dùng khỏi bấm mù và khỏi rơi vào tổ hợp 0 kết quả).
     Cố ý KHÔNG cho số chạy theo bộ lọc đang bật: đang gõ tìm kiếm mà 8 con số nhảy theo từng ký
     tự thì không ai đọc kịp — số của phần ĐANG XEM đã nằm ở dòng `.g-flt-sum`.
     ⚠️ Đếm theo GIƯỜNG. Thẻ KPI "Sắp ra viện" đếm theo NGƯỜI nên hai số khác nhau là ĐÚNG
     (206 giường / 218 người). Đơn vị ghi rõ trong tooltip từng nút — chữa bằng cách NÓI RA đơn vị,
     không phải bằng cách bỏ số đi (bản cũ bỏ số nên người dùng không biết bấm ra bao nhiêu). */
  function demNhom() {
    const d = { all: 0, trong: 0, nguoi: 0, preset: 0, sap_ra: 0, qua_hen: 0, giu: 0, ghep: 0, trung: 0 };
    for (const k of D.khoas) for (const r of k.phong) for (const g of r.giuong) {
      d.all++;
      if (!(g.nguoi || []).length) { d.trong++; d.preset++; continue; }
      d.nguoi++;
      const s = sigOf(g);
      for (const t of s) d[t]++;
      if (s.has("sap_ra")) d.preset++;
    }
    return d;
  }

  function capNhatNutLoc() {
    const d = D ? demNhom() : null;
    const put = (el, v) => { if (el && v != null) el.textContent = n(v); };
    $$(".g-sg").forEach(b => {
      b.setAttribute("aria-checked", (!preset && ttTruc === b.dataset.tt) ? "true" : "false");
      if (d) put(b.querySelector(".c"), d[b.dataset.tt || "all"]);
    });
    $$(".g-lg").forEach(b => {
      b.setAttribute("aria-pressed", (!preset && sigLoc.has(b.dataset.sg)) ? "true" : "false");
      if (d) put(b.querySelector(".c"), d[b.dataset.sg]);
    });
    const p = $("#g-preset");
    if (p) {
      p.setAttribute("aria-pressed", preset ? "true" : "false");
      if (d) put(p.querySelector(".c"), d.preset);
    }
    const c = $("#g-lgClear"); if (c) c.classList.toggle("an", !dangLoc());
  }

  function veTatCa() {
    // Dựng lại chỉ số "người ở nhiều giường" TRƯỚC mọi lần vẽ: sigOf()/ghepThat() đọc nó, và dữ
    // liệu đổi 5'/lần → dùng chỉ số của vòng trước là gắn cờ trùng giường cho người đã trả giường.
    chiSoTrungGiuong();
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
      q = e.target.value.trim().toLowerCase(); capNhatNutLoc(); veLaiKetQua();
    });
    // TRỤC 1 — chọn MỘT (loại trừ nhau): bấm là thay giá trị, không cộng thêm.
    $$(".g-sg").forEach(b => b.onclick = () => {
      preset = false; ttTruc = b.dataset.tt;
      moKhoa(false);          // ĐT: bảng khoa đang bung thì che mất kết quả vừa lọc
      capNhatNutLoc(); veLaiKetQua();
    });
    // TRỤC 2 — chọn NHIỀU (HOẶC trong trục, VÀ với trục 1). Bấm lại = tắt.
    $$(".g-lg").forEach(b => b.onclick = () => {
      const t = b.dataset.sg;
      if (preset) { preset = false; ttTruc = ""; }     // preset là chế độ riêng → bấm chip là rời nó
      if (sigLoc.has(t)) sigLoc.delete(t); else sigLoc.add(t);
      /* Dấu hiệu chỉ tồn tại ở giường CÓ NGƯỜI ⇒ để trục 1 ở "Trống" thì chắc chắn ra 0 giường.
         Baymard: đừng để người dùng rơi vào tổ hợp không thể có kết quả → tự chuyển sang "Có
         người". Segmented control dịch sang thấy được nên đây không phải thay đổi ngầm. */
      if (sigLoc.size && ttTruc === "trong") ttTruc = "nguoi";
      moKhoa(false);
      capNhatNutLoc(); veLaiKetQua();
    });
    // PRESET: "chỗ sắp có" = trống HOẶC sắp ra viện — HOẶC chéo trục nên phải là chế độ riêng.
    $("#g-preset").onclick = () => {
      preset = !preset;
      if (preset) { ttTruc = ""; sigLoc.clear(); }
      moKhoa(false); capNhatNutLoc(); veLaiKetQua();
    };
    $("#g-lgClear").onclick = () => {
      preset = false; ttTruc = ""; sigLoc.clear();
      const inp = $("#g-q"); if (inp) { inp.value = ""; q = ""; }   // "Bỏ lọc" phải bỏ CẢ từ khóa
      capNhatNutLoc(); veLaiKetQua();
    };
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
