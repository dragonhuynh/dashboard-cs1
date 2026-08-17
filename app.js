// Dashboard điều phối phòng khám — đọc window.DASHBOARD_DATA (data.js).
// Khi mở qua http server cũng thử fetch data.json để lấy bản mới nhất.

function levelOf(room) {
  if ((room.da_kham || 0) === 0 && (room.dang_cho || 0) === 0) return "gray"; // chưa hoạt động
  const c = room.dang_cho || 0;
  if (c >= 10) return "red";
  if (c >= 5) return "amber";
  return "green";
}

function fmt(n) { return (n ?? 0).toLocaleString("vi-VN"); }
// Số 0 = mờ đi (nhiễu); số >0 = đậm. bnum: in đậm; znum: thường.
function bnum(n) { return (n || 0) ? `<b>${fmt(n)}</b>` : `<b class="z0">0</b>`; }
function znum(n) { return (n || 0) ? fmt(n) : `<span class="z0">0</span>`; }

// Ngưỡng "dữ liệu cũ" (phút) — PHẢI bám sát CHU KỲ CHẠY THẬT: 5 phút (CLAUDE.md §14).
// Trước đây để 120'/240' (kế thừa thời còn chạy tay vài lần/ngày): luồng chết **24 vòng
// liên tiếp** mà trang vẫn im — đúng kiểu "số cũ nói dối im lặng" của log lỗi L03/L05b.
// Tab Phòng·Giường đã dùng 15'/60' từ 22/07; nay 2 tab kia dùng cùng thang.
const STALE_WARN_MIN = 15;    // > 15 phút (3 vòng hụt) → theo dõi (cam)
const STALE_BAD_MIN  = 60;    // > 1 giờ  (12 vòng hụt) → cảnh báo cũ (đỏ)

// ⚠️ NHƯNG luồng Phòng khám + CĐHA chỉ chạy TRONG GIỜ KHÁM (scraper: WORK_START/WORK_END
// = 6:00–20:00). Ngoài khung đó, số cũ là ĐÚNG BẢN CHẤT chứ không phải hỏng — báo đỏ mỗi
// tối là báo động giả, mà báo động giả lặp lại thì tới lúc hỏng thật không ai còn nhìn nữa.
// (Tab Phòng·Giường KHÔNG áp luật này: người bệnh nội trú nằm 24/24, luồng chạy cả đêm.)
const GIO_KHAM = [6, 20];
function trongGioKham(d) { const h = d.getHours(); return h >= GIO_KHAM[0] && h < GIO_KHAM[1]; }

// Mốc chụp mới nhất mà ta CÓ QUYỀN mong đợi tại thời điểm `now`.
// Trong giờ khám: phải luôn mới. Ngoài giờ: mốc hợp lệ là lần chụp cuối của khung vừa qua
// → số của 19:58 xem lúc 22:00 vẫn là "mới", còn số của hôm qua thì vẫn bị bắt là CŨ.
function mocMongDoi(now) {
  const d = new Date(now);
  if (trongGioKham(d)) return now;
  const k = new Date(d);
  k.setHours(GIO_KHAM[1], 0, 0, 0);                       // 20:00 hôm nay
  if (d.getHours() < GIO_KHAM[0]) k.setDate(k.getDate() - 1);  // trước 6h sáng → 20:00 hôm qua
  return k.getTime();
}

// Badge mốc giờ chụp RIÊNG từng khối: giờ tuyệt đối + tương đối + chỉ báo cũ/mới.
// Không chỉ dựa vào màu (WCAG 1.4.1): kèm icon hình + chữ "DỮ LIỆU CŨ" khi stale.
function freshnessBadge(iso) {
  if (!iso) return `<span class="freshness none">⏱ chưa có giờ chụp</span>`;
  const s = String(iso).replace(" ", "T");
  const then = new Date(s);
  // Đo tuổi so với MỐC MONG ĐỢI, không so với "bây giờ" — xem `mocMongDoi`.
  const ageMin = Math.max(0, Math.round((mocMongDoi(Date.now()) - then.getTime()) / 60000));
  const ngoaiGio = !trongGioKham(new Date());
  const hhmm = s.slice(11, 16);
  const abs = then.toLocaleString("vi-VN");
  // STALE: banner có cấu trúc 3 phần (nhãn · giờ · việc cần làm) → không còn khoảng đỏ trống.
  if (ageMin >= STALE_BAD_MIN) {
    return `<time class="freshness stale" datetime="${s}" title="Chụp lúc ${abs} (GMT+7)">`
      + `<span class="fdot" aria-hidden="true"></span>`
      + `<b class="f-tag">DỮ LIỆU CŨ</b>`
      + `<span class="f-mid">📸 Ảnh chụp ${hhmm} · ${timeAgo(iso)}</span>`
      + `<span class="f-act">→ Kiểm luồng tự cập nhật (chu kỳ 5 phút)</span></time>`;
  }
  const lv = ageMin >= STALE_WARN_MIN ? "warn" : "fresh";
  // Ngoài giờ khám thì NÓI RA, kẻo người xem thấy mốc 19:58 lúc 22:00 lại tưởng trang treo.
  const ghiChu = ngoaiGio ? ` · ngoài giờ khám` : "";
  return `<time class="freshness ${lv}" datetime="${s}" title="Chụp lúc ${abs} (GMT+7)">`
    + `<span class="fdot" aria-hidden="true"></span>📸 Chụp lúc ${hhmm} · ${timeAgo(iso)}${ghiChu}</time>`;
}

// ---- Dải HÀNH ĐỘNG: dịch số → mệnh lệnh điều phối. Người quản lý đọc DÒNG NÀY trước tiên. ----
// items: [{name, n, note}] đã sort giảm dần theo mức khẩn. kind: 'clinic' | 'cls'.
function actionBand(elId, level, headline, items, hint) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (level === "ok") {
    el.className = "action-band ok";
    el.innerHTML = `<span class="ab-ic">✅</span>
      <span class="ab-text"><b>${headline}</b></span>`;
    return;
  }
  const chips = items.map(it =>
    `<span class="ab-chip"><b>${it.name}</b> ${it.n}${it.note ? " " + it.note : ""}</span>`).join("");
  el.className = "action-band " + level;
  // Bố cục 2 hàng rõ thứ bậc: (1) TIÊU ĐỀ + danh sách đối tượng · (2) VIỆC CẦN LÀM nổi bật (pill).
  el.innerHTML = `<div class="ab-top">
      <span class="ab-ic">${level === "red" ? "🔴" : "🟠"}</span>
      <span class="ab-head">${headline}</span>
      <span class="ab-chips">${chips}</span>
    </div>
    ${hint ? `<div class="ab-do"><span class="ab-do-lbl">VIỆC CẦN LÀM</span>
      <span class="ab-do-text">${hint}</span></div>` : ""}`;
}

// Huy hiệu số trên tab: số việc cần can thiệp (đỏ = quá tải/nghẽn nặng, cam = đông/cần theo dõi)
function setTabBadge(id, count, level) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!count) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = count;
  el.className = "tab-badge " + (level || "amber");
}

// render() = dựng TOÀN BỘ 1 lượt (lúc mở trang). softRefresh() gọi các mảnh này
// THEO BƯỚC để vẽ tiến trình thật (mỗi mảnh = 1 đầu việc, ứng 1 nấc %).
function render(data) {
  if (!data || !data.rooms) {
    document.getElementById("rooms").innerHTML =
      `<p class="empty">Chưa có số liệu. Chạy <code>/dashboard</code> hoặc
       <code>python scraper/dashboard_flow.py</code>.</p>`;
    return;
  }
  applyMeta(data);
  renderClinic(data);
  renderCLS(data.cls);
  renderPT(data.pt);
  renderToa(data.toa);
  renderKtd(data.ktd);
  renderFooter(data);
}

// Ngày báo cáo (mức NGÀY — tránh 1 đồng hồ global gây hiểu nhầm khi các khối chụp khác giờ)
function applyMeta(data) {
  const rd = (data.report_date || data.captured_at || "").slice(0, 10);
  const rdEl = document.getElementById("report-date");
  if (rdEl) rdEl.textContent = rd ? rd.split("-").reverse().join("/") : "—";
  // Lọc KHOA chỉ áp cho tab CĐHA (KHOA_HIEN_THI_CLS) → cất riêng, dải phạm vi tự nói khi mở tab đó.
  _khoaFilterCls = (data.cls && data.cls.khoa_filter) || null;
  _phongGiuLaiCls = (data.cls && data.cls.phong_giu_lai) || null;
  _anFilterCls = (data.cls && data.cls.an_filter) || null;
  applyScopeBand(data.khu_filter);
}

// PHẠM VI đang hiển thị. Scraper lọc khu (KHU_HIEN_THI) → mọi số trên 2 tab chỉ tính các khu đó;
// riêng tab CĐHA còn lọc KHOA (KHOA_HIEN_THI_CLS) → chỉ hiện khoa CĐHA.
// KHÔNG nói ra là để người dùng hiểu nhầm 2 kiểu, kiểu nào cũng tai hại: (a) tưởng dashboard mất
// phòng/hỏng; (b) tưởng "248 người chờ" là của CẢ VIỆN rồi ra quyết định trên số thiếu.
// Không lọc gì → ẩn hẳn dải, không chiếm chỗ.
function applyScopeBand(khus) {
  const el = document.getElementById("scope-band");
  if (!el) return;
  _khuFilter = (khus && khus.length) ? khus : null;
  const tab = tabDangXem();
  // Lọc khoa CHỈ có ở tab CĐHA → nói ra khi đang đứng ở đó, để nó không nói SAI phạm vi tab khác.
  const khoas = (tab === "cls" && _khoaFilterCls && _khoaFilterCls.length) ? _khoaFilterCls : null;
  const ans = (tab === "cls" && _anFilterCls && _anFilterCls.length) ? _anFilterCls : null;
  // ⚠️ Lọc khu CHỈ áp cho 2 tab lấy từ luồng phòng khám/CĐHA. Tab Phòng·Giường là luồng khác
  // (`beds_flow.py --nb`, 14 khoa NỘI TRÚ toàn viện) — để dải này nằm đó là nói SAI phạm vi:
  // người xếp giường đọc ra "1.993 giường chỉ của 3 khu". Ẩn hẳn khi đang ở tab giường.
  if (tab === "giuong" || (!_khuFilter && !khoas && !ans)) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  const dong = [];
  if (_khuFilter)
    dong.push(`Chỉ xem <b>${_khuFilter.join(" · ")}</b>` +
      ` <span class="sb-note">— mọi số trên trang chỉ tính ${_khuFilter.length} khu này, không phải toàn viện</span>`);
  // ⚠️ Phải nói luôn vế "gồm cả phòng đặt trong địa bàn khoa khác": bộ lọc chạy theo KHOA HIS KHAI,
  // còn dòng phòng ghi khoa theo ĐỊA BÀN (§5b) → không nói thì dòng "Siêu âm - P3 (HIẾM MUỘN) ·
  // Khoa Hiếm muộn" đọc ra như lọc bị hỏng (luật 14).
  // Nhãn phần GIỮ THEO TÊN PHÒNG do scraper cấp (cls.phong_giu_lai) — đổi luật bên đó là chữ ở đây
  // tự theo, không phải sửa 2 nơi.
  if (khoas) {
    const giu = (_phongGiuLaiCls && _phongGiuLaiCls.length)
      ? khoas.join(" · ") + " và " + _phongGiuLaiCls.join(" · ") : khoas.join(" · ");
    dong.push(`Tab CĐHA chỉ hiện <b>${giu}</b>` +
      ` <span class="sb-note">— các khoa khác tạm ẩn; phòng siêu âm đặt trong địa bàn khoa khác vẫn giữ</span>`);
  }
  // ⚠️ Dòng trên CHƯA ĐỦ: danh sách ẩn có mục thuộc CHÍNH khoa CĐHA (`Chưa phân phòng - Khoa Hiếm
  // Muộn` — HIS khai khoa CĐHA), nên "chỉ hiện khoa CĐHA" đọc ra là mọi phòng khoa đó đều còn, mà
  // thực tế đã bớt. Không nói ra thì người xem tưởng mất phòng/hỏng số (luật 14).
  // Chữ rút gọn hết mức: dòng trên đã nói "Tab CĐHA" nên bỏ, và ghi chú ngắn lại — trên máy 390px
  // mỗi dòng thừa của dải này đẩy KPI + phòng đầu tiên xuống dưới màn hình đầu (§12.4).
  if (ans)
    dong.push(`Đã ẩn <b>${ans.join(" · ")}</b>` +
      ` <span class="sb-note">— ẩn theo yêu cầu, số liệu không thiếu</span>`);
  el.innerHTML = `<span class="sb-ico" aria-hidden="true">🔎</span>
    <span class="sb-text">${dong.map(d => `<span class="sb-line">${d}</span>`).join("")}</span>`;
}

/* Gộp thời gian các chặng của MỘT tab (tải + ghi DB) → "Phòng khám 6,0 giây". */
function tocDoTheoTab(td) {
  const NHAN = { rooms: "Phòng khám", cls: "CĐHA", beds: "Phòng/Giường", web: "Dựng trang" };
  const gom = {};
  (td.buoc || []).forEach(b => { gom[b.flow] = (gom[b.flow] || 0) + (b.giay || 0); });
  return Object.keys(NHAN).filter(k => gom[k] != null)
    .map(k => NHAN[k] + " " + gom[k].toFixed(1).replace(".", ",") + "s").join(" · ");
}

function renderFooter(data) {
  const el = document.getElementById("footer");
  let s = "Cập nhật lúc " + (data.generated_at || "").replace("T", " ") +
          " · Số liệu ghi nhận tại thời điểm trên, thay đổi liên tục trong ngày.";
  // TỐC ĐỘ vòng cập nhật gần nhất — nói ra thay vì để người dùng đoán "sao lâu vậy" (§ đo tốc độ).
  const td = data.toc_do;
  if (td && td.giay != null) {
    s += " Vòng cập nhật gần nhất (cả 3 tab) mất " +
         td.giay.toFixed(1).replace(".", ",") + " giây — " + tocDoTheoTab(td) + ".";
  }
  el.textContent = s;
}

// Khối Phòng khám: mốc giờ chụp · KPI · dải hành động · thẻ phòng · xu hướng.
function renderClinic(data) {
  // Mốc giờ chụp RIÊNG của khối Phòng khám
  const cf = document.getElementById("clinic-fresh");
  if (cf) cf.innerHTML = freshnessBadge(data.captured_at);

  const rooms = data.rooms.slice().sort((a, b) => (b.dang_cho || 0) - (a.dang_cho || 0));
  const t = data.totals || {};
  const quaTai = rooms.filter(r => levelOf(r) === "red").length;
  const dong = rooms.filter(r => levelOf(r) === "amber").length;
  const hoatDong = rooms.filter(r => levelOf(r) !== "gray").length;

  // ---- KPI: tồn đọng = CAM (giữa buổi là bình thường); ĐỎ chỉ cho phòng quá tải thật ----
  // dang_cho = đợi khám + đợi KL (lồng nhau) → gộp 1 thẻ + dòng phụ, không tách thẻ ngang hàng.
  // `hero` = số CHỦ ĐẠO của tab → mobile phóng to + full width, 3 thẻ bối cảnh co nhỏ xếp dưới
  // (cùng khuôn với tab CĐHA). Không đánh dấu hero thì 4 thẻ bằng nhau ngốn ~430px = nửa màn ĐT,
  // đẩy phòng đầu tiên ra khỏi màn hình đầu — đúng lỗi §12.4 đã trị bên tab CĐHA.
  document.getElementById("kpis").innerHTML = `
    <div class="kpi amber hero"><div class="big">${fmt(t.dang_cho)}</div>
      <div class="lbl">Tổng bệnh nhân đang chờ</div>
      <div class="sub-metric">${fmt(t.doi_kham)} đợi khám · ${fmt(t.doi_ket_luan)} đợi kết luận</div></div>
    <div class="kpi ${quaTai ? "red" : dong ? "amber" : "ok"}"><div class="big">${(quaTai + dong) ? (quaTai ? "⛔ " : "⚠️ ") : "✅ "}${quaTai + dong}</div>
      <div class="lbl">Phòng cần can thiệp</div>
      <div class="sub-metric">${(quaTai + dong) ? `${quaTai} quá tải (≥10) · ${dong} đông (5–9)` : "không phòng nào quá tải"}</div></div>
    <div class="kpi ok"><div class="big">${fmt(t.da_kham)}</div>
      <div class="lbl">Tổng đã khám hôm nay</div>
      <div class="sub-metric">${fmt(t.da_ket_luan)} đã kết luận</div></div>
    <div class="kpi info"><div class="big">${hoatDong}/${rooms.length}</div>
      <div class="lbl">Phòng đang hoạt động</div>
      <div class="sub-metric">${rooms.length - hoatDong ? (rooms.length - hoatDong) + " phòng chưa mở" : "tất cả phòng đã mở"}</div></div>`;

  // ---- Dải hành động = 1 CÂU QUYẾT ĐỊNH (không lặp tên phòng — tên đã ở thẻ ngay dưới) ----
  // Giá trị RIÊNG của dải: (a) ưu tiên #1 (1 sự thật quan trọng nhất) + (b) MỆNH LỆNH NHÂN LỰC
  // gộp theo loại tắc (tổng cần thêm bao nhiêu bác sĩ khám / đẩy nhanh kết luận) — thẻ không nói ở mức tổng.
  const hotRooms = rooms.filter(r => levelOf(r) === "red" || levelOf(r) === "amber")
    .sort((a, b) => (b.dang_cho || 0) - (a.dang_cho || 0));
  if (hotRooms.length) {
    let nKham = 0, nKL = 0;
    hotRooms.forEach(r => { (r.doi_kham || 0) >= (r.doi_ket_luan || 0) ? nKham++ : nKL++; });
    const top = hotRooms[0];
    const topDo = (top.doi_kham || 0) >= (top.doi_ket_luan || 0) ? "thêm bác sĩ khám" : "đẩy nhanh kết luận";
    const parts = [];
    if (nKham) parts.push(`${nKham} phòng thêm bác sĩ khám`);
    if (nKL)   parts.push(`${nKL} phòng đẩy nhanh kết luận`);
    // Tiêu đề = BƯỚC ĐẦU CỤ THỂ (phòng nào + làm gì); pill VIỆC CẦN LÀM = tổng nhân lực cần phân bổ.
    actionBand("clinic-action", quaTai ? "red" : "amber",
      `Bắt đầu ở ${top.name}: ${topDo}`, [], parts.join(" · "));
  } else {
    actionBand("clinic-action", "ok", "Mọi phòng trong tầm kiểm soát — không phòng nào quá tải.", [], "");
  }
  // Huy hiệu = ĐÚNG số phòng trong danh sách việc (phòng QUÁ TẢI), không phải quá tải + đông.
  // Trước đây badge ghi 30 trong khi danh sách nói 9 → người dùng không biết tin con nào.
  setTabBadge("badge-clinic", quaTai, "red");

  // ---- Thẻ từng phòng (gom theo KHU M/N → khoa; xếp hạng + thu gọn phòng chưa hoạt động) ----
  _roomsData = rooms;
  // KHU = tòa nhà HIS ("Nhà M", "Nhà N"…) → nhãn chính là tên tòa, không cần bảng dịch.
  _khuLabels = data.khu_labels || {};
  _khuOrder = data.khu_order || [];
  // CHUẨN HÓA chuỗi xu hướng: sắp theo GIỜ tăng dần + BỎ mốc trễ hơn lần chụp mới nhất
  // (không thể chụp "tương lai" → mốc đó là dữ liệu NGÀY KHÁC còn sót → gây zigzag/sai hình).
  _trendData = normalizeTrend(data.trend, data.rooms);
  renderRooms();

  // ---- Sparkline xu hướng đang chờ ----
  renderTrend(_trendData, rooms.filter(r => levelOf(r) !== "gray"));
}

// ====== XU HƯỚNG HÀNG ĐỢI — panel hỗ trợ QUYẾT ĐỊNH (không chỉ trang trí) ======
// Nguyên tắc: (1) THANG ĐO CHUNG → so sánh phòng nào nặng hơn được; (2) lọc phòng im;
// (3) sắp theo MOMENTUM (đang phình lên đầu = chỉ báo sớm quá tải); (4) đường ngưỡng 5/10;
// (5) cấu trúc sẵn cho ĐƯỜNG NỀN so sánh lịch sử (hôm qua / tuần trước) — drawSeries nhiều line.
const T_BUSY = 5, T_OVER = 10;     // ngưỡng đông / quá tải (khớp levelOf)
const WAIT_TARGET_MIN = 30;        // SLA chờ ước tính: ≤30′ đạt · ≤60′ theo dõi · >60′ vượt chuẩn

// Bỏ giá trị null (lần lấy lỗi) ở mọi vị trí, trả mảng {v,i} sạch + GIỮ chỉ số gốc i
// → vừa map nhãn giờ, vừa phát hiện MỐC THIẾU (i nhảy >1 giữa 2 điểm sạch liền kề).
function cleanSeries(arr) {
  const out = [];
  (arr || []).forEach((v, i) => { if (v != null) out.push({ v, i }); });
  return out;
}

function hm(t) { const a = String(t).split(":"); return (+a[0]) * 60 + (+a[1]); }

// #3 — Số MỐC THIẾU nằm GIỮA chuỗi (giữa điểm đầu & cuối có giá trị) → cảnh báo "đừng tin tuyệt đối".
function interiorGaps(sr) {
  let g = 0;
  for (let k = 1; k < sr.length; k++) g += (sr[k].i - sr[k - 1].i - 1);
  return g;
}

// #1+#2 — ĐÀ GẦN ĐÂY chuẩn hóa theo GIỜ THỰC (BN/phút) bằng HỒI QUY tuyến tính trên ≤3 điểm cuối.
// Hồi quy 3 điểm KHÔNG bị lật bởi 1 lần chụp nhiễu (khác Δ 2-điểm cũ). slope BN/phút (có thể âm).
function regSlope(xs, ys) {
  const n = xs.length; if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den ? num / den : 0;
}
// slope BN/phút của hàng đợi trên cửa sổ ≤3 điểm cuối + thay đổi KỲ VỌNG trong cửa sổ (để áp deadband).
function recentMomentum(sr, times) {
  const win = sr.slice(-3);
  if (win.length < 2) return { rate: 0, change: 0 };
  const xs = win.map(p => hm(times[p.i])), ys = win.map(p => p.v);
  const rate = regSlope(xs, ys);
  const span = Math.max(1, xs[xs.length - 1] - xs[0]);
  return { rate, change: rate * span };
}

// #4 — THÔNG LƯỢNG (BN/phút) = Δ "đã khám" (luỹ kế) / Δ phút trên cửa sổ ≤3 điểm gần nhất.
// Phản ánh NĂNG LỰC phòng → dùng cho ước tính THỜI GIAN CHỜ (Little's Law), tự chuẩn hóa theo phòng.
function serviceRate(dkSr, times) {
  const win = dkSr.slice(-3);
  if (win.length < 2) return null;
  const dv = win[win.length - 1].v - win[0].v;
  const dt = hm(times[win[win.length - 1].i]) - hm(times[win[0].i]);
  if (dt <= 0 || dv < 0) return null;
  return dv / dt;   // BN/phút (≥0)
}

// #4/#5 — Chờ ước tính (phút) ≈ số đang chờ / thông lượng (Little's Law). null = chưa đủ dữ liệu;
// Infinity = còn người chờ mà thông lượng 0 (TẮC — không ai được khám trong cửa sổ gần nhất).
function waitEstimate(last, svc) {
  if (last <= 0) return 0;
  if (svc == null) return null;
  if (svc <= 0) return Infinity;
  return Math.round(last / svc);
}

// #5/REC9 — Số phút đến ngưỡng quá tải theo ĐÀ NET gần đây (slope hồi quy; net = đến − đi ĐÃ trừ
// thông lượng vì đo trực tiếp hàng đợi). null nếu đã quá tải / đang giảm / quá xa (chống dự báo ảo).
function projectOverload(it) {
  if (it.last >= T_OVER) return null;
  if (!(it.rate > 0)) return null;
  const mins = Math.round((T_OVER - it.last) / it.rate);
  return mins > 0 && mins <= 180 ? mins : null;
}

// Phân loại QUỸ ĐẠO CẢ CA theo HÌNH DẠNG chuỗi (khớp mắt nhìn sparkline) thay vì 3 điểm cuối.
// Lý do: cửa sổ cuối hay bị "đóng băng" (nghỉ trưa, hoặc lần chụp lặp giá trị) → momentum 3-điểm = 0
// → MỌI phòng ra "giữ mức" SAI dù đường cong rõ ràng lên/xuống. Trả 'up' | 'down' | 'flat'.
function shiftTrajectory(peak, last, first) {
  if (!(peak > 0)) return "flat";
  const drop = peak - last, rose = last - first;
  if (last < peak && drop >= Math.max(2, peak * 0.25)) return "down";   // đã rớt rõ rệt khỏi đỉnh
  if (last >= peak * 0.9 && rose >= 2) return "up";                      // ở/gần đỉnh & cao hơn đầu ca
  return "flat";
}

// Vẽ 1 đường trên thang đo CHUNG gmax. Trục X theo GIỜ THỰC (T_X[i]).
// markGaps: vẽ theo TỪNG ĐOẠN; đoạn BẮC QUA mốc thiếu (i nhảy >1) tô NÉT ĐỨT (#3 — không giấu lỗ hổng).
function trendPath(series, gmax, opts) {
  const n = series.length;
  if (!n) return "";
  const X = k => n === 1 ? 50 : (T_X[series[k].i] != null ? T_X[series[k].i] : (series[k].i / (LAST_IDX || 1)) * 100);
  const Y = v => 38 - (v || 0) / gmax * 34;   // 0 ở đáy(38), gmax ở đỉnh(4)
  const px = k => X(k).toFixed(1), py = k => Y(series[k].v).toFixed(1);
  let s = "";
  if (opts.fill) {
    const pts = series.map((p, k) => `${px(k)},${py(k)}`).join(" ");
    s += `<polygon points="0,38 ${pts} 100,38" fill="${opts.fill}" opacity="${opts.fillOp || .12}"/>`;
  }
  if (opts.markGaps && n > 1) {
    for (let k = 1; k < n; k++) {
      const bridged = series[k].i - series[k - 1].i > 1;   // đoạn nối qua mốc thiếu → nội suy
      s += `<line x1="${px(k - 1)}" y1="${py(k - 1)}" x2="${px(k)}" y2="${py(k)}"`
        + ` stroke="${opts.stroke}" stroke-width="${opts.w || 2}"`
        + (bridged ? ` stroke-dasharray="2 2" opacity=".55"` : "")
        + ` vector-effect="non-scaling-stroke"/>`;
    }
  } else {
    const pts = series.map((p, k) => `${px(k)},${py(k)}`).join(" ");
    s += `<polyline points="${pts}" fill="none" stroke="${opts.stroke}" stroke-width="${opts.w || 2}"`
      + ` ${opts.dash ? `stroke-dasharray="${opts.dash}"` : ""} vector-effect="non-scaling-stroke"/>`;
  }
  if (opts.dot) {
    s += `<circle cx="${px(n - 1)}" cy="${py(n - 1)}" r="${opts.dotR || 2.6}" fill="${opts.stroke}"/>`;
  }
  return s;
}
let LAST_IDX = 1;   // (n_times - 1) — dùng chung cho trục X mọi đường
let T_X = [];       // T_X[i] = vị trí X (%) của mốc giờ thứ i theo GIỜ THỰC

// CHUẨN HÓA chuỗi xu hướng cho ĐÚNG NGÀY + ĐÚNG THỨ TỰ (xem ghi chú nơi gọi).
// ⚠ Gốc rễ nên sửa ở scraper (sắp + lọc theo report_date khi export); đây là lớp phòng vệ phía web.
function normalizeTrend(trend, rooms) {
  if (!trend || !trend.times || !trend.times.length) return trend;
  const times = trend.times;
  const caps = (rooms || []).map(r => r.captured_at).filter(Boolean)
    .map(s => hm(String(s).slice(11, 16)));
  const cutoff = caps.length ? Math.max(...caps) : Math.max(...times.map(t => hm(t)));
  const ord = times.map((t, i) => i)
    .filter(i => hm(times[i]) <= cutoff + 5)          // bỏ mốc "tương lai" (ngày khác còn sót)
    .sort((a, b) => hm(times[a]) - hm(times[b]));      // sắp theo giờ tăng dần
  const reorder = obj => {
    if (!obj) return obj;
    const out = {};
    for (const k in obj) out[k] = ord.map(i => obj[k][i]);
    return out;
  };
  return Object.assign({}, trend, {
    times: ord.map(i => times[i]),
    dang_cho: reorder(trend.dang_cho),
    da_kham: reorder(trend.da_kham),
  });
}

function renderTrend(trend, rooms) {
  const wrap = document.getElementById("trend");
  if (!trend || !trend.times || trend.times.length < 2) {
    wrap.innerHTML = `<p class="empty">Cần ≥2 lần lấy số để vẽ xu hướng (chạy lại sau ít phút).</p>`;
    return;
  }
  _trendRooms = rooms;        // cache để re-render khi đổi kỳ so sánh
  const times = trend.times;
  LAST_IDX = times.length - 1;
  // Trục X theo GIỜ THỰC: khoảng cách phản ánh đúng thời gian giữa các lần chụp (không đều nhau).
  const _t0 = hm(times[0]), _tspan = Math.max(1, hm(times[LAST_IDX]) - _t0);
  T_X = times.map(t => (hm(t) - _t0) / _tspan * 100);

  // 1) Gom các phòng có HOẠT ĐỘNG trong ca (đỉnh ≥1) — bỏ phòng im (nhiễu thị giác).
  const items = rooms.map(r => {
    const sr = cleanSeries(trend.dang_cho && trend.dang_cho[r.key]);
    if (!sr.length) return null;
    const vals = sr.map(p => p.v);
    const peak = Math.max(...vals);
    if (peak < 1) return null;
    // "Đang chờ" hiển thị = giá trị SNAPSHOT (khớp thẻ phòng) thay vì điểm cuối chuỗi → hết mâu thuẫn
    // Nội 21 (thẻ) vs 23 (xu hướng). Chuỗi vẫn dùng để vẽ sparkline + tính đà.
    const seriesLast = vals[vals.length - 1];
    const last = (r.dang_cho != null) ? r.dang_cho : seriesLast;
    const first = vals[0];
    const delta = last - first;             // Δ cả ca → bối cảnh "tăng/giảm từ đầu ca"
    // #1+#2 ĐÀ GẦN ĐÂY = slope HỒI QUY chuẩn hóa BN/phút (mượt, không lật do 1 điểm nhiễu).
    const { rate } = recentMomentum(sr, times);
    // HƯỚNG theo QUỸ ĐẠO CẢ CA (khớp mắt) — KHÔNG dùng 3 điểm cuối (đóng băng giờ trưa → sai).
    const traj = shiftTrajectory(peak, last, first);
    const peakAt = times[sr[vals.indexOf(peak)].i];
    const gaps = interiorGaps(sr);          // #3 — số mốc thiếu giữa ca
    return { r, sr, vals, peak, last, first, delta, rate, traj, peakAt, gaps };
  }).filter(Boolean);

  if (!items.length) { wrap.innerHTML = `<p class="empty">Chưa có phòng nào phát sinh hàng đợi trong ca.</p>`; return; }

  // 2) TÁCH NHIỄU: phòng đã về 0 chờ = "đã hết chờ" (gom 1 dòng); còn lại = đang cần để mắt.
  const cleared = items.filter(it => it.last === 0);
  const live = items.filter(it => it.last > 0);

  // #6 — VIEW TỔNG HỆ THỐNG: tổng đang chờ TOÀN CƠ SỞ theo thời gian + đà (chỉ số nhìn-1-lần).
  // ⚠ Mỗi phòng KHÔNG chụp cùng mốc → cộng thẳng theo index làm THIẾU (phòng chưa có số ở mốc đó).
  // CARRY-FORWARD giá trị mới-nhất-đã-biết của từng phòng → tổng cuối = Σ last mỗi phòng (khớp KPI + các dòng).
  const filled = rooms.map(r => {
    const arr = (trend.dang_cho && trend.dang_cho[r.key]) || [];
    const f = []; let prev = null;
    for (let i = 0; i < times.length; i++) { if (arr[i] != null) prev = arr[i]; f.push(prev); }
    return f;
  });
  const totalRaw = times.map((_, idx) => {
    let sum = 0, any = false;
    filled.forEach(f => { if (f[idx] != null) { sum += f[idx]; any = true; } });
    return any ? sum : null;
  });
  const totSr = cleanSeries(totalRaw);
  // Giá trị HIỂN THỊ = tổng SNAPSHOT (Σ đang chờ các phòng) → KHỚP KPI "Tổng đang chờ" (49),
  // không lấy điểm cuối chuỗi carry-forward (có thể lệch ±1 do mốc chụp khác nhau). Sparkline vẫn dùng chuỗi.
  const totLast = rooms.reduce((a, r) => a + (r.dang_cho || 0), 0);
  const totMax = Math.max(1, ...totSr.map(p => p.v));
  const totPeak = totMax, totFirst = totSr.length ? totSr[0].v : totLast;
  // Hướng tổng theo QUỸ ĐẠO cả ca (giống phòng) — đường tổng vọt đỉnh rồi tụt phải đọc "đang giảm",
  // KHÔNG "ổn định" (momentum 3-điểm cuối đóng băng giờ trưa cho kết quả sai).
  const totTraj = shiftTrajectory(totPeak, totLast, totFirst);
  const totDirTxt = totTraj === "up" ? `<span class="ts-dir up">▲ đang tăng</span>`
    : totTraj === "down" ? `<span class="ts-dir down">▼ đã giảm · đỉnh ${totPeak}</span>`
    : `<span class="ts-dir flat">– giữ mức</span>`;
  const totSpark = totSr.length > 1
    ? `<svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img"
         aria-label="Tổng đang chờ toàn cơ sở: ${totSr[0].v}→${totLast}">
         ${trendPath(totSr, totMax, { stroke: "var(--brand-blue-dark)", w: 2, dot: true, markGaps: true })}</svg>`
    : "";
  const sysBlock = `<div class="trend-system">
      <div class="ts-info"><span class="ts-lbl">Tổng đang chờ toàn cơ sở</span>
        <span class="ts-row"><b class="ts-val">${totLast}</b> ${totDirTxt}
          <span class="ts-sub">· ${live.length} phòng còn hàng đợi</span></span></div>
      <div class="ts-spark">${totSpark}</div>
    </div>`;

  // 4) ⭐ SMALL-MULTIPLES SPARKLINE — giá trị RIÊNG của panel (thẻ snapshot KHÔNG có): HÌNH DẠNG
  //    diễn biến trong ca. SỐ LỚN đã nói độ lớn + VIỀN MÀU nói mức nguy → sparkline TỰ CO GIÃN theo
  //    từng phòng để THẤY RÕ HÌNH: "Nội qua đỉnh đang tụt" ≠ "Tiêm ngừa leo đều" — quyết cứu phòng nào trước.
  const liveSorted = live.slice().sort((a, b) => b.last - a.last);

  const mini = (it) => {
    const lv = it.last >= T_OVER ? "red" : it.last >= T_BUSY ? "amber" : it.traj === "up" ? "climb" : "calm";
    // HƯỚNG = quỹ đạo cả ca. Phòng "đã giảm" kèm BỐI CẢNH ĐỈNH (thông tin thẻ phòng KHÔNG có):
    // "23 giờ · từng đỉnh 66" → quản lý hiểu ngay phòng đang HỒI PHỤC, khỏi điều thêm người.
    const dir = it.traj === "up" ? `<span class="smd up">▲ đang tăng</span>`
      : it.traj === "down" ? `<span class="smd down">▼ đã giảm · đỉnh ${it.peak}</span>`
      : `<span class="smd flat">▬ giữ mức</span>`;
    const stroke = lv === "red" ? "var(--red)" : (lv === "amber" || lv === "climb") ? "var(--amber)" : "var(--green)";
    // THANG ĐO RIÊNG mỗi phòng (headroom 15%) → hình dạng hiện rõ kể cả phòng số nhỏ.
    const scale = Math.max(1, it.peak * 1.15);
    const tip = `${it.r.name}: ${it.last} đang chờ · đỉnh trong ca ${it.peak} (lúc ${it.peakAt})`
      + (it.gaps ? ` · thiếu ${it.gaps} mốc chụp` : "");
    const spark = `<svg viewBox="0 0 100 40" preserveAspectRatio="none" class="sm-svg" role="img"
        aria-label="${it.r.name} từ ${it.first} đến ${it.last}, đỉnh ${it.peak}">
        ${trendPath(it.sr, scale, { stroke, w: 2, dot: true, markGaps: true, fill: stroke, fillOp: .08 })}</svg>`;
    return `<div class="spark-mini ${lv}" title="${tip}">
      <div class="sm-top"><span class="sm-name">${it.r.name}</span><b class="sm-now">${it.last}</b></div>
      ${spark}
      <div class="sm-foot">${dir}</div>
    </div>`;
  };

  // DÒNG GỌN cho nhóm "đang hạ" (không cần hành động) → dày, nhường tiêu điểm cho nhóm cần để mắt.
  // Vẫn giữ sparkline nhỏ (hình dạng) + bối cảnh ĐỈNH (giá trị riêng của panel) nhưng nén chiều cao.
  const miniRow = (it) => {
    const lv = it.last >= T_OVER ? "red" : it.last >= T_BUSY ? "amber" : "calm";
    const stroke = lv === "red" ? "var(--red)" : lv === "amber" ? "var(--amber)" : "var(--green)";
    const scale = Math.max(1, it.peak * 1.15);
    const ctx = it.traj === "down" ? `<span class="sr-ctx down">từ đỉnh ${it.peak}</span>`
      : `<span class="sr-ctx flat">giữ mức</span>`;
    const spark = `<svg viewBox="0 0 100 40" preserveAspectRatio="none" class="sr-spark" role="img"
        aria-label="${it.r.name} từ ${it.first} đến ${it.last}, đỉnh ${it.peak}">
        ${trendPath(it.sr, scale, { stroke, w: 2, dot: true, markGaps: true })}</svg>`;
    return `<div class="spark-row ${lv}" title="${it.r.name}: ${it.last} đang chờ · đỉnh ${it.peak} lúc ${it.peakAt}">
      <span class="sr-name">${it.r.name}</span>${spark}<b class="sr-now">${it.last}</b>${ctx}</div>`;
  };

  // Phòng đã về 0 chờ → chip gọn (không cần sparkline, chỉ xác nhận đã hết).
  const clearedChips = cleared.sort((a, b) => b.peak - a.peak)
    .map(it => `<span class="tc-chip">${it.r.name}</span>`).join("");
  const restLine = cleared.length
    ? `<div class="trend-cleared">
        <span class="tcl-lbl">✓ <b>${cleared.length} phòng không còn người chờ</b>:</span> ${clearedChips}</div>`
    : "";

  // GOM THEO QUỸ ĐẠO → quyết định bật ra ngay: phòng ĐANG TĂNG = nơi cần để mắt/điều người;
  // phòng ĐÃ GIẢM/GIỮ MỨC = đang tự hạ, đừng dồn người vào (dù số hiện tại còn lớn như Nội).
  const rising = liveSorted.filter(it => it.traj === "up");
  const easing = liveSorted.filter(it => it.traj !== "up");
  // Nhóm CẦN HÀNH ĐỘNG = thẻ lớn (mini); nhóm ĐANG HẠ = dòng gọn (miniRow) → phân tầng tiêu điểm.
  const upBlock = rising.length
    ? `<div class="spark-grouphd g-up"><b class="gh-n">${rising.length}</b> <span>▲ Đang tăng · cần để mắt</span></div>
       <div class="spark-grid">${rising.map(mini).join("")}</div>` : "";
  const downBlock = easing.length
    ? `<div class="spark-grouphd g-down"><b class="gh-n">${easing.length}</b> <span>▼ Đang hạ · không cần can thiệp</span></div>
       <div class="spark-rows">${easing.map(miniRow).join("")}</div>` : "";
  const grid = liveSorted.length ? upBlock + downBlock
    : `<p class="empty">Mọi phòng đã hết hàng đợi trong ca.</p>`;

  wrap.innerHTML =
    `${sysBlock}
     ${grid}
     ${restLine}`;
}

// Tồn đọng = ca chưa ra kết quả (đang chờ tiếp nhận + đã tiếp nhận nhưng chưa có KQ)
function backlogOf(s) { return (s.cho_tiep_nhan || 0) + (s.da_tiep_nhan || 0); }
function clsLevel(s) {
  const b = backlogOf(s);
  if (b >= 10) return "red";
  if (b >= 5) return "amber";
  return "";
}

// ====== GOM NHÓM DỊCH VỤ THEO LOẠI KỸ THUẬT (modality) ======
// Vì sao: danh sách phẳng ~40 dòng GIẤU điểm nghẽn — một nhóm (vd Thăm dò chức năng) có thể tồn 9 ca
// nhưng rải rác khắp bảng. Gom theo loại kỹ thuật → quản lý thấy NGAY nhóm nào ùn, điều người tới đó.
// Nguyên tắc (research: DICOM modality · phân loại CĐHA/TDCN của Bộ Y tế · NN/g progressive disclosure):
// gom theo KỸ THUẬT (siêu âm / X-quang / nội soi…), KHÔNG theo bộ phận cơ thể. Nhóm lẻ 1–2 DV gộp lại.
// Khớp theo THỨ TỰ (first-match-wins) trên tên đã bỏ dấu; không khớp → "Thủ thuật khác".
function _normj(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase().replace(/\s+/g, " ").trim();
}
// ⚠️ CHỈNH RIÊNG CHO DANH MỤC CS1 (Từ Dũ — sản phụ khoa), đối chiếu 58 dịch vụ CĐHA thật (2026-07-13).
// Bộ nhóm kế thừa CS2 (Cần Giờ, đa khoa) phân loại SAI ở đây, đã sửa:
//   • MRI "…có TIÊM chất tương phản" bị luật `tiem` của nhóm "Thủ thuật & cấp cứu" cướp mất
//     → tách hẳn nhóm "Cộng hưởng từ", và ĐẶT TRƯỚC mọi luật theo hành động.
//   • "Chụp XQ tuyến vú" không khớp /x.?quang/ (viết tắt XQ, không có chữ "quang") → thêm \bxq\b.
//   • NST (theo dõi tim thai bằng monitor) chiếm ~52% toàn bộ tồn đọng CĐHA → phải là NHÓM RIÊNG,
//     gộp chung vào "Thăm dò chức năng" là chôn mất điểm nghẽn lớn nhất viện.
//   • Oxy / CPAP (hỗ trợ hô hấp) rơi hết vào "khác" → thành nhóm riêng.
// Khớp theo THỨ TỰ (first-match-wins) trên tên đã bỏ dấu; không khớp → "Kỹ thuật khác".
const SVC_GROUPS = [
  { key: "cht",     label: "Cộng hưởng từ (MRI)",   icon: "🧲", re: /cong huong tu/ },
  { key: "sieu_am", label: "Siêu âm",               icon: "🫧", re: /^sieu am/ },
  { key: "xquang",  label: "X-quang",               icon: "🩻", re: /xquang|x-quang|\bxq\b/ },
  { key: "nst",     label: "Theo dõi tim thai (NST)", icon: "💓", re: /nhip tim thai|monitor san khoa|nonstress/ },
  { key: "noi_soi", label: "Nội soi / Soi",         icon: "🔬", re: /^noi soi|^soi |soi co tu cung/ },
  { key: "ho_hap",  label: "Hỗ trợ hô hấp",         icon: "💨", re: /^oxy|cpap|ho hap ap luc|tho may|^tho / },
  { key: "tdcn",    label: "Thăm dò chức năng",     icon: "📈", re: /dien tim|dien tam do|dien nao|ho hap ky|do loang xuong|mat do xuong|nieu dong/ },
  // ---- Từ đây là PT-TT: màn HIS "Thực hiện CDHA-TDCN" trả về CẢ ca phẫu thuật/thủ thuật
  // (user chốt lấy hết để khớp 1:1 với HIS). Đặt SAU các nhóm CĐHA → không cướp mất dòng chẩn đoán.
  { key: "ivf",        label: "Hỗ trợ sinh sản",    icon: "🧬", re: /ivf|icsi|\biui\b|tton|chuyen phoi|tru phoi|phoi\/trung|thoat mang|nuoi cay|ra dong|noan|tinh trung|tru trung/ },
  { key: "phau_thuat", label: "Phẫu thuật",         icon: "🔪", re: /^phau thuat|\[pt\]|mo lay thai|chuyen mo|vet mo cu|triet san/ },
  { key: "sanh",       label: "Sanh & hậu sản",     icon: "👶", re: /^sanh|sinh thuong|ho tro sanh|bong nhau|may tang sinh mon/ },
  { key: "thu_thuat",  label: "Thủ thuật",          icon: "🩹", re: /^hut|^lay dung cu|^dat |^thay|^cat|^khau|^chich|^tiem|^truyen|^bom|^nao|^pha thai|^sinh thiet|^thong tieu|^thao dung cu|^choc|^gap thai|^xoan|que tranh thai|polype|dieu hoa me|dieu tri|thu thuat|chieu den/ },
];
const SVC_GROUP_OTHER = { key: "khac", label: "Kỹ thuật khác", icon: "📋" };

// Gom services → mảng nhóm (đã cộng dồn tồn/chờ/làm/xong/tổng). Giữ thứ tự khai báo; nhóm rỗng bỏ qua.
function groupServices(services) {
  const bucket = {};
  (services || []).forEach((s) => {
    const n = _normj(s.ten);
    const g = SVC_GROUPS.find((G) => G.re.test(n)) || SVC_GROUP_OTHER;
    if (!bucket[g.key]) bucket[g.key] = { meta: g, services: [], cho: 0, lam: 0, kq: 0, tong: 0 };
    const b = bucket[g.key];
    b.services.push(s);
    b.cho += s.cho_tiep_nhan || 0; b.lam += s.da_tiep_nhan || 0;
    b.kq += (s.da_co_kq || 0) + (s.da_xem_kq || 0); b.tong += s.tong || 0;
  });
  const order = SVC_GROUPS.map((g) => g.key).concat(SVC_GROUP_OTHER.key);
  return order.filter((k) => bucket[k]).map((k) => {
    const b = bucket[k]; b.backlog = b.cho + b.lam; return b;
  });
}
// Ngưỡng của NHÓM DỊCH VỤ — cũng phải theo thang đo của CĐHA, không mượn ngưỡng phòng khám:
// nhóm nặng nhất (NST) tồn ~350, tổng cả viện ~1.600. Lấy 10 làm "đỏ" thì 10/11 nhóm đều đỏ.
function groupLevel(g) { return g.backlog >= 100 ? "red" : g.backlog >= 40 ? "amber" : ""; }

// Trạng thái mở/đóng nhóm — lưu localStorage theo tab. null = chưa có lựa chọn (dùng mặc định).
function svcGroupOpen(cfg) {
  try {
    const v = localStorage.getItem(cfg.doneKey + "_g");
    if (v != null) return new Set(v ? v.split(",") : []);
  } catch (e) {}
  return null;
}
function setSvcGroupOpen(cfg, set) {
  try { localStorage.setItem(cfg.doneKey + "_g", [...set].join(",")); } catch (e) {}
}

let _roomsData = null;
let _khuLabels = {};      // khu (tòa nhà) → nhãn; scraper cấp qua data.khu_labels
let _khuOrder = [];       // thứ tự tòa nhà, scraper cấp qua data.khu_order
let _khuFilter = null;    // các khu ĐANG hiện (data.khu_filter); null = hiện hết. Xem applyScopeBand.
let _khoaFilterCls = null; // khoa ĐANG hiện ở RIÊNG tab CĐHA (cls.khoa_filter); null = hiện hết.
let _phongGiuLaiCls = null; // nhãn các phòng GIỮ LẠI theo tên dù khác khoa (cls.phong_giu_lai).
let _anFilterCls = null;   // nhãn các thứ bị ẨN HẲN khỏi tab CĐHA (cls.an_filter). Phải nói ra:
                           // có mục thuộc CHÍNH khoa CĐHA (Chưa phân phòng - Khoa Hiếm Muộn) nên
                           // dòng "chỉ hiện khoa CĐHA" ở trên là CHƯA ĐỦ để giải thích (luật 14).
let _trendData = null;
let _trendRooms = null;     // cache rooms cho panel xu hướng (re-render khi đổi kỳ so sánh)
// Hai tab "dịch vụ" (CLS + PT-TT) dùng CHUNG code render — chỉ khác id/nhãn/lệnh.
// State (data + sort) giữ trong cfg để không lẫn giữa 2 tab.
const SVC_TAB = {
  cls: {
    prefix: "cls", badge: "badge-cls", doneKey: "cls_done_open",
    label: "CĐHA-TDCN", cmd: "--cls", flowName: "luồng CLS",
    totalLabel: "Tổng chỉ định trong ngày", data: null, sort: "backlog",
  },
  pt: {
    prefix: "pt", badge: "badge-pt", doneKey: "pt_done_open",
    label: "PT-TT", cmd: "--pt", flowName: "luồng PT-TT",
    totalLabel: "Tổng ca PTTT trong ngày", data: null, sort: "backlog",
  },
};
// Kỳ so sánh lịch sử đang chọn (null = tắt). Chỉ hiện nút nếu data.trend.compare có kỳ đó.
let _cmpKey = null;
try { _cmpKey = localStorage.getItem("trend_compare") || null; } catch (e) {}
// Thứ tự + nhãn ngắn các kỳ so sánh (scraper export vào trend.compare[key].dang_cho[room])
const CMP_PERIODS = [
  { key: "hom_qua", label: "Hôm qua", short: "HQ" },
  { key: "tuan_truoc", label: "Tuần trước", short: "Tuần" },
  { key: "thang_truoc", label: "Tháng trước", short: "Tháng" },
];

// Hướng hàng đợi của 1 phòng theo 2 lần lấy gần nhất: tăng (xấu) / giảm (đỡ) / phẳng.
function queueTrend(key) {
  const series = _trendData && _trendData.dang_cho && _trendData.dang_cho[key];
  if (!series || series.length < 2) return null;
  const last = series[series.length - 1] ?? 0, prev = series[series.length - 2] ?? last;
  const d = last - prev;
  if (d > 0) return { cls: "up", txt: `▲ +${d}`, title: `Đang tăng (+${d} so với lần lấy trước)` };
  if (d < 0) return { cls: "down", txt: `▼ ${d}`, title: `Đang giảm (${d} so với lần lấy trước)` };
  return { cls: "flat", txt: "▬", title: "Không đổi so với lần lấy trước" };
}

function clinicInactiveOpen() { try { return localStorage.getItem("clinic_inactive_open") === "1"; } catch (e) { return false; } }
// Trạng thái mở/đóng nhóm "phòng còn lại" của TỪNG KHOA — nhớ theo localStorage.
// Thẻ LỚN cho 1 phòng cần điều phối (dùng chung cho mọi khu). maxWait = mốc chuẩn hóa thanh trong khu.
// rank = thứ hạng TOÀN VIỆN (không phải trong khoa) → #1 luôn là phòng nặng nhất bệnh viện.
// MỌI phòng đều dùng thẻ này — kể cả phòng đang ổn (user chốt 2026-08-17: "nếu phòng khám không
// đông thì màu xanh, nếu đông thì hiện màu đỏ, KHÔNG thu nhỏ thông tin lại, không đủ thông tin
// điều phối"). Trước đó chỉ 10 phòng đỏ nặng nhất viện lên thẻ, phần còn lại rút thành dòng gọn
// `pkRestRow` — dòng đó bỏ mất: nút thắt (đợi khám / đợi kết luận), khối lượng đã khám, xu hướng
// hàng đợi, ước tính phút tới lượt, số lượt của bác sĩ chính. Đúng những thứ để RA QUYẾT ĐỊNH.
//  • rank: chỉ có ở phòng quá tải (hạng TOÀN VIỆN trong nhóm đỏ) → phòng cam/xanh không in "#".
//  • locOverride: thẻ nằm trong cụm TẦNG rồi thì chỉ ghi KHOA (tiêu đề cụm đã nói tầng).
function roomCard(r, rank, maxWait, locOverride) {
  const tag = { red: "⛔ Quá tải", amber: "⚠️ Đông", green: "✓ Ổn định", gray: "Chưa hoạt động" };
  {
    const lv = levelOf(r);
    const w = Math.round((r.dang_cho || 0) / Math.max(1, maxWait) * 100);
    const dk = r.doi_kham || 0, dkl = r.doi_ket_luan || 0;
    const bnK = dk >= dkl;                                   // nút thắt = đợi khám? (tô nổi ô tương ứng)
    // AI ĐANG TRỰC PHÒNG (thay dòng lệnh cũ) — user chốt 2026-07-16. bac_si_chinh = BS khám nhiều
    // lượt nhất hôm nay; so_bac_si = số BS đã khám hôm nay = ĐÚNG số tên trong doctorSessionDetail().
    const docLine = doctorLine(r);
    // Gập HƯỚNG + CẢNH BÁO HÀNH ĐỘNG vào thẻ (đơn vị quyết định) → khỏi mở panel xu hướng riêng.
    // DÙNG CHUNG logic momentum/ETA/tắc với panel xu hướng → card & panel KHỚP nhau.
    let tr = "", alert = "", waitChip = "";
    const sr = cleanSeries((_trendData && _trendData.dang_cho && _trendData.dang_cho[r.key]) || []);
    if (sr.length >= 2 && _trendData && _trendData.times) {
      const vals = sr.map(p => p.v), peak = Math.max(...vals);
      const last = r.dang_cho != null ? r.dang_cho : vals[vals.length - 1];
      const traj = shiftTrajectory(peak, last, vals[0]);   // quỹ đạo cả ca (khớp panel xu hướng)
      if (traj === "up") tr = `<span class="qtrend up" title="Hàng đợi tăng dần trong ca">▲ đang tăng</span>`;
      else if (traj === "down") tr = `<span class="qtrend down" title="Đã giảm rõ rệt khỏi đỉnh ${peak} trong ca">▼ đã giảm</span>`;
      else tr = `<span class="qtrend flat" title="Giữ mức ổn định trong ca">▬ giữ mức</span>`;
      // CẢNH BÁO TẮC chỉ khi THẬT quá tải (≥${T_OVER}) mà thông lượng = 0 → tránh báo giả lúc nghỉ trưa
      // (cửa sổ cuối đóng băng làm mọi phòng nhỏ ra "tắc" sai). ETA chỉ cho phòng đang tăng tiến gần ngưỡng.
      const { rate } = recentMomentum(sr, _trendData.times);
      const svc = serviceRate(cleanSeries(_trendData.da_kham && _trendData.da_kham[r.key]), _trendData.times);
      const we = waitEstimate(last, svc);                  // ước tính phút tới lượt (Little's Law)
      // SỐ QUYẾT-ĐỊNH-ĐẮT NHẤT cho điều phối viên: "còn ~bao lâu tới lượt". Chỉ hiện khi ĐÁNG TIN
      // (hữu hạn & ≤90′); thông lượng ~0 → Infinity → KHÔNG hiện số ảo, để badge "Tắc" lo việc đó.
      if (we != null && we !== Infinity && we > 0 && we <= 90)
        waitChip = `<span class="wait-eta" title="Ước tính theo thông lượng khám gần đây (Little's Law)">≈ ${we}′ tới lượt</span>`;
      const stall = last >= T_OVER && we === Infinity;
      const eta = projectOverload({ last, rate });
      const badges = [];
      if (stall) badges.push(`<span class="ra-badge stall">⚠ Tắc — chưa ai được khám</span>`);
      if (eta) badges.push(`<span class="ra-badge eta">⏱ ~${eta}′ tới quá tải</span>`);
      if (badges.length) alert = `<div class="room-alert">${badges.join("")}</div>`;
    }
    // Nút thắt được TÔ NỔI (số to + viền màu phòng) → mắt nối thẳng "16 đợi khám → thêm bác sĩ".
    const cellK  = `<span class="d-cell${bnK && dk > 0 ? " bottleneck" : ""}"><span class="d-lbl">Đợi khám</span>${bnum(r.doi_kham)}</span>`;
    const cellKL = `<span class="d-cell${!bnK && dkl > 0 ? " bottleneck" : ""}"><span class="d-lbl">Đợi kết luận</span>${bnum(r.doi_ket_luan)}</span>`;
    // Đã khám = khối lượng phòng đã giải quyết hôm nay → đọc số chờ mới đúng bối cảnh
    // (30 chờ khi đã khám 200 khác hẳn 30 chờ khi mới khám 5).
    const cellDK = `<span class="d-cell done"><span class="d-lbl">Đã khám</span>${bnum(r.da_kham)}</span>`;
    // khoa · tầng → biết đi đâu. Thẻ nằm trong cụm tầng thì caller truyền sẵn chuỗi chỉ có KHOA.
    const loc = locOverride !== undefined ? locOverride : (r.nhom || r.khoa || "");
    return `<div class="room ${lv}">
      <div class="name">${r.name}
        <span class="rank"><span class="rstat ${lv}">${tag[lv]}</span>${rank ? ` #${rank}` : ""}</span></div>
      ${loc ? `<div class="room-loc">${loc}</div>` : ""}
      <div class="wait"><span class="wlead"><span class="wnum">${fmt(r.dang_cho)}</span> <small>đang chờ</small></span>${tr}</div>
      ${waitChip ? `<div class="wait-sub">${waitChip}</div>` : ""}
      <div class="bar"><i style="width:${w}%"></i></div>
      ${alert}
      <div class="detail">${cellK}${cellKL}${cellDK}</div>
      ${docLine}
    </div>`;
  }
}

// ====== BẤM ĐỂ SỔ CHI TIẾT BÁC SĨ (tab Phòng khám — user chốt 2026-08-17) ======
// User: "khi ấn vào (hoặc rê chuột vào, tùy bạn quyết định) thì sổ xuống chi tiết bác sĩ đã khám".
// CHỐT: **BẤM**, không phải rê chuột — 3 lý do đo được, đừng đổi lại:
//  1. Trang này xem nhiều trên ĐIỆN THOẠI (đo 10,8 màn ở 390px) và MÀN HÌNH TƯỜNG cảm ứng —
//     hai nơi KHÔNG CÓ hover. Tính năng chỉ mở bằng hover là tính năng không tồn tại với họ.
//  2. Danh sách có 82 dòng: rê chuột từ đầu xuống cuối sẽ bung/cụp liên tiếp, trang nhảy loạn
//     (WCAG 1.4.13 Content on Hover — nội dung hiện khi rê phải ổn định và bỏ được).
//  3. <details> NATIVE: đi được bằng bàn phím (Tab + Enter), có sẵn ngữ nghĩa cho trình đọc màn
//     hình, chạy trên file:// mà không cần wiring JS. Hover chỉ dùng làm TÍN HIỆU (đổi nền nhẹ).
//
// Nhớ phòng nào đang mở: trang TỰ NẠP LẠI mỗi 5′ (AUTO_MS) và vẽ lại toàn bộ #rooms → khối đang
// đọc dở sẽ tự cụp. Giữ trong bộ nhớ phiên (KHÔNG localStorage: đây là trạng thái đang-xem, không
// phải cài đặt; sang ngày hôm sau mở lại 40 phòng là nhiễu).
const _bsMo = new Set();
document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (!d || !d.matches || !d.matches("details[data-bs]")) return;
  const k = d.getAttribute("data-bs");
  if (d.open) _bsMo.add(k); else _bsMo.delete(k);
}, true);   // ⚠️ `toggle` KHÔNG nổi bọt (bubble) → BẮT BUỘC bắt ở pha capture, nếu không listener
            // ủy quyền này không bao giờ chạy và mọi khối sẽ cụp lại sau mỗi lần tự nạp lại.

// Bọc "dòng tóm tắt + khối chi tiết" thành một khối bấm-mở.
// KHÔNG có chi tiết ⇒ trả về dòng tĩnh, KHÔNG dựng nút bấm: cho bấm ra khối rỗng là hứa suông
// (Baymard) — và ở đây "rỗng" còn dễ bị đọc thành "dashboard mất dữ liệu" (luật 5).
// `bodyThem` (tuỳ chọn): phần thân xếp SAU danh sách người làm — tab CĐHA nhét chi tiết loại dịch
// vụ vào đây thay vì dựng <details> thứ hai. Bắt buộc phải gộp: dòng phòng nay CHÍNH LÀ <summary>,
// mà <details> lồng trong <summary> là HTML không hợp lệ (trình duyệt tự gỡ, khối rơi mất).
function bsBox(r, bb, L, sumCls, sumInner, tip, bodyThem) {
  const body = sessionBody(bb, L) + (bodyThem || "");
  if (!body) return `<div class="${sumCls}">${sumInner}</div>`;
  const n = sessionCount(bb);
  const t = tip || `Bấm để xem ${n} ${L.who} đã làm tại ${r.name} hôm nay (từng người · số ${L.unit} · giờ)`;
  return `<details class="bs-det" data-bs="${esc(r.key)}"${_bsMo.has(r.key) ? " open" : ""}>
    <summary class="${sumCls}" title="${esc(t)}">${sumInner}</summary>
    <div class="bs-body">${body}</div></details>`;
}

// Dòng BÁC SĨ trên thẻ phòng — "số BS + BS chính" (user chốt 2026-07-16), nay CHÍNH NÓ là nút mở
// chi tiết (user chốt 2026-08-17). Trước đây thẻ có HAI khối: dòng này + một hàng "👥 Bác sĩ theo
// buổi (7)" ngay dưới → nói lại y con số 7, tốn ~40px/thẻ, và người dùng phải bấm ở chỗ KHÁC với
// chỗ đang thắc mắc. Nay bấm thẳng vào dòng đang đọc.
//  • ≥2 BS: nêu số BS luân phiên (cường độ nhân lực) + ai khám chính.
//  • 1 BS : chỉ 1 tên (khỏi ghi "1 BS · chính" thừa).
//  • chưa có: dòng mờ, giữ chỗ cho thẻ không nhảy layout.
function doctorLine(r) {
  const inner = docInner(r);
  const cls = (r.bac_si_chinh || "").trim() ? "room-doc" : "room-doc none";
  return bsBox(r, r.bac_si_buoi, L_BS, cls, inner);
}

// Nội dung BÊN TRONG dòng bác sĩ (dùng cho cả dòng tĩnh lẫn <summary>).
// ⚠️ Phần chữ phải nằm TRONG MỘT thẻ `.rd-who` duy nhất: `.room-doc` là flex container, mà mọi con
// inline (kể cả `<b>`) đều bị biến thành flex item riêng → "7 BS luân phiên" tách khỏi "· chính:
// Châu Uy Bằng" thành 2 cột hẹp và vỡ 3 dòng trên điện thoại (user gửi ảnh 2026-08-17).
function docInner(r) {
  const ten = (r.bac_si_chinh || "").trim();
  if (!ten) return `<span class="rd-ico">👨‍⚕️</span><span class="rd-who">chưa rõ bác sĩ trực</span>`;
  const n = soNguoiBuoi(r.bac_si_buoi) || r.so_bac_si || 0;
  const lt = docLuot(r, ten);
  const luot = lt ? `<span class="doc-luot">${fmt(lt)} lượt</span>` : "";
  const who = n >= 2 ? `<b>${n} BS luân phiên</b> · chính: ${ten}` : ten;
  return `<span class="rd-ico">👨‍⚕️</span><span class="rd-who">${who}</span>${luot}`;
}
const L_BS = { title: "Bác sĩ theo buổi", who: "BS", unit: "lượt" };

// Số BN 1 bác sĩ đã khám TẠI PHÒNG NÀY tính tới hiện tại (user chốt 2026-07-16) = cộng cả 2 buổi
// của `clinic_doctor_session` (nguồn duy nhất có lượt tách theo bác sĩ). Không có dữ liệu → 0 (ẩn số).
function docLuot(r, ten) {
  const bb = r.bac_si_buoi;
  if (!bb || !ten) return 0;
  const key = String(ten).trim().toLowerCase();
  return [...(bb.sang || []), ...(bb.chieu || [])]
    .filter(d => String(d.ten || "").trim().toLowerCase() === key)
    .reduce((s, d) => s + (d.so_luot || 0), 0);
}

// CHI TIẾT: MỌI bác sĩ đã khám phòng HÔM NAY, tách buổi sáng/chiều (user chốt 2026-07-16).
// Dòng `doctorLine` chỉ nói TỔNG "N BS · chính: ai" → khối này trả lời "N người đó LÀ AI, luân phiên
// ra sao": mỗi BS bao nhiêu lượt, từ mấy giờ tới mấy giờ, buổi nào (user chốt 2026-07-16).
// ⚠️ Số trong `doctorLine` suy từ CHÍNH `bac_si_buoi` này (export lo) → 2 chỗ không bao giờ lệch.
// Dùng <details> NATIVE: gập mặc định (không phình thẻ) + chạy được trên file:// khỏi wiring JS.
// Nguồn: bảng clinic_doctor_session → export gắn r.bac_si_buoi = {sang:[...], chieu:[...]}.
function doctorSessionDetail(r) {
  return sessionDetail(r.bac_si_buoi, { title: "Bác sĩ theo buổi", who: "BS", unit: "lượt" });
}

// Khối chi tiết cho tab CĐHA — CÙNG khuôn với tab Phòng khám (user chốt 2026-07-16: "bên phòng Siêu âm
// cũng làm giống phòng khám"). Chỉ khác cách gọi: "người thực hiện" (có cả KTV) và đơn vị "ca".
function performerSessionDetail(r) {
  return sessionDetail(r.nguoi_buoi, { title: "Người thực hiện theo buổi", who: "người", unit: "ca" });
}

// Số NGƯỜI đã làm ở phòng hôm nay = số tên duy nhất của 2 buổi (KHÔNG tính nhóm trả kết quả).
// Suy thẳng từ `bac_si_buoi`/`nguoi_buoi` — tức từ CHÍNH dữ liệu mà khối chi tiết bày ra → con số
// trên dòng tóm tắt không bao giờ lệch với số tên bấm ra được (user chốt 2026-07-16: "nếu 7 BS thì
// phải biết 7 BS đó ai"). Không có dữ liệu → 0, để caller rơi về cột `so_bac_si` của export.
function soNguoiBuoi(bb) {
  if (!bb) return 0;
  return new Set([...(bb.sang || []), ...(bb.chieu || [])].map(d => d.ten)).size;
}
function sessionCount(bb) { return soNguoiBuoi(bb); }

// AI đã làm ở phòng HÔM NAY, tách buổi sáng/chiều — dùng CHUNG cho cả 2 tab.
// `bb` = {sang:[…], chieu:[…], ket_qua:[…]} (ket_qua chỉ có ở tab Phòng khám).
// THÂN của khối chi tiết (không kèm <details>) → dùng lại được ở CẢ thẻ lẫn dòng gọn.
function sessionBody(bb, L) {
  if (!bb) return "";
  const sang = bb.sang || [], chieu = bb.chieu || [], kq = bb.ket_qua || [];
  if (!sang.length && !chieu.length && !kq.length) return "";
  const rows = arr => arr.map(d =>
    `<div class="bs-row"><span class="bs-ten">${d.ten}</span>
       <span class="bs-luot">${fmt(d.so_luot)} ${L.unit}</span>
       <span class="bs-gio">${d.gio_dau}–${d.gio_cuoi}</span></div>`).join("");
  const seg = (label, arr, cls = "", note = "") => arr.length
    ? `<div class="bs-buoi ${cls}"><div class="bs-buoi-h">${label}
         <span class="bs-buoi-n">${fmt(arr.reduce((s, d) => s + (d.so_luot || 0), 0))} ${L.unit} · ${arr.length} ${L.who}</span>
       </div>${note}${rows(arr)}</div>` : "";
  // Người CHỈ trả/xem kết quả: hiện để thấy đủ việc của phòng, nhưng TÁCH mục + ghi rõ không tính là
  // khám → con số "N BS" trên thẻ (chỉ đếm người khám) không mâu thuẫn với danh sách. Xem §6a.
  const kqSeg = seg("Trả kết quả", kq, "bs-kq",
    `<div class="bs-note">Không tính là khám — chỉ thao tác trả/xem kết quả xét nghiệm</div>`);
  return `${seg("Buổi sáng", sang)}${seg("Buổi chiều", chieu)}${kqSeg}`;
}

// Khối gập ĐỘC LẬP (tiêu đề riêng "👥 … (N)") — tab CĐHA còn dùng. Tab Phòng khám nay bấm thẳng
// vào dòng bác sĩ/dòng phòng nên không gọi hàm này nữa (xem bsBox).
function sessionDetail(bb, L) {
  const body = sessionBody(bb, L);
  if (!body) return "";
  return `<details class="bs-detail"><summary>👥 ${L.title} (${sessionCount(bb)})</summary>${body}</details>`;
}

// ================= HÀNG ĐỢI GỒM LOẠI GÌ (tab CĐHA — user chốt 2026-08-17) =================
// "20 ca chưa xong" KHÔNG đủ để điều phối: 20 ca siêu âm phụ khoa giải quyết nhanh hơn hẳn 20 ca
// siêu âm 3D/4D, mà hai phòng đó hiện con số y hệt nhau (user: "chờ Siêu âm phụ khoa 5 ca thì
// nhanh hơn siêu âm 3D 2 ca"). Nguồn: bảng cls_room_service → export gắn r.dv = [{ten,cho,lam,…}].

// Bỏ dấu để so chuỗi (không đụng tới chữ hiển thị — chỉ dùng cho phép so).
function khongDau(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
}

// NHÃN NGẮN cho chip — rút gọn CÓ LUẬT, tuyệt đối không bịa chữ viết tắt y khoa (đọc sai một chữ
// trong tên kỹ thuật là điều phối sai phòng). Chỉ làm 2 việc, cả 2 đều suy từ chính dữ liệu:
//   • Tách phần trong [ ] — đó là mô tả phụ HIS thêm vào → xuống dòng phụ mờ, KHÔNG xoá.
//   • Lược cụm mở đầu đã có sẵn trong TÊN PHÒNG ("Siêu âm …" ở phòng Siêu âm = nói lại điều đã
//     biết, mà tên dịch vụ dài trung vị 53 ký tự / max 97 nên từng chữ đều phải đáng giá).
// Tên ĐẦY ĐỦ nguyên văn HIS vẫn còn ở tooltip + khối "Loại dịch vụ hôm nay" → không cắt thông tin.
function dvNhan(ten, tenPhong) {
  let s = String(ten || "").trim(), phu = "";
  const m = s.match(/^([^[]+)\[(.+)\]\s*$/);
  if (m) { s = m[1].trim(); phu = m[2].trim(); }
  const kp = khongDau(tenPhong), tu = s.split(/\s+/);
  for (let n = Math.min(3, tu.length - 1); n >= 1; n--) {
    if (kp.includes(khongDau(tu.slice(0, n).join(" ")))) { s = tu.slice(n).join(" "); break; }
  }
  s = s.replace(/^[-–,\s]+/, "");
  if (s) s = s[0].toUpperCase() + s.slice(1);
  return { chinh: s || String(ten || "").trim(), phu };
}

// CHIP: MỌI loại còn đang chờ của phòng — KHÔNG chặn top-N, không "+N loại nữa" (user chốt: đủ
// thông tin, không cắt bớt). Đo thật từ BC01: 1 phòng siêu âm chạy trung vị 5 loại/ngày, nên hàng
// đợi tại một mốc chỉ vài loại → hiện hết vẫn gọn. Xếp theo số ca giảm dần (export đã xếp sẵn).
//
// GẬP ĐƯỢC, giống khối người thực hiện (user chốt 2026-08-17: "phân loại kỹ thuật trong phòng Siêu
// âm cũng có nút thu gọn giống bác sĩ"). Vì sao đúng: chip chiếm TRỌN bề ngang cột thẻ (tên kỹ
// thuật dài trung vị 53 ký tự) nên 3 loại đã ngốn ~150px và ĐẨY dòng người thực hiện xuống dưới —
// mỗi thẻ hoá thành một bài đọc, trong khi đây là thông tin TRA CỨU, không phải thứ quét bằng mắt.
//  • dòng tóm tắt phải nói SỐ LIỆU MỚI, không chỉ là nhãn: số LOẠI đang chờ (thông tin cơ cấu —
//    1 loại 12 ca khác hẳn 6 loại mỗi loại 2 ca) · 1 loại thì nói luôn tên, khỏi bắt bấm.
//  • tooltip liệt kê ĐỦ mọi loại kèm số ca ⇒ gập lại KHÔNG mất thông tin, chỉ thôi chiếm chỗ.
// ⚠️ KHOÁ NHỚ-ĐANG-MỞ phải khác khoá của khối bác sĩ (`dv:` + key): hai <details> cùng thẻ mà chung
// một khoá thì mở cái này, lần tự nạp lại sau (5′) sẽ mở nhầm cả cái kia.
function svcWaitChips(r) {
  const ds = (r.dv || []).filter(d => (d.ton || 0) > 0);
  if (!ds.length) return "";
  const chips = ds.map(d => {
    const nh = dvNhan(d.ten, r.name);
    const tip = `${d.ten} — ${fmt(d.cho || 0)} chờ tiếp nhận · ${fmt(d.lam || 0)} đang làm`
      + ` · ${fmt((d.kq || 0) + (d.xem || 0))} đã xong · tổng ${fmt(d.tong || 0)} ca hôm nay`;
    return `<span class="dv-chip" title="${esc(tip)}"><b>${fmt(d.ton)}</b> ca · ${esc(nh.chinh)}`
      + (nh.phu ? `<i>${esc(nh.phu)}</i>` : "") + `</span>`;
  }).join("");
  const inner = ds.length === 1
    ? `<b>${fmt(ds[0].ton)} ca</b> · ${esc(dvNhan(ds[0].ten, r.name).chinh)}`
    : `<b>${ds.length} loại kỹ thuật</b> đang chờ`;
  const tip = `Đang chờ tại ${r.name}:\n`
    + ds.map(d => `• ${fmt(d.ton)} ca — ${d.ten}`).join("\n")
    + "\n(bấm để xem đủ, có cả phụ chú của HIS)";
  const k = "dv:" + r.key;
  return `<details class="bs-det dv-det" data-bs="${esc(k)}"${_bsMo.has(k) ? " open" : ""}>
    <summary class="dv-sum" title="${esc(tip)}"><span class="dv-sum-t">${inner}</span></summary>
    <div class="bs-body"><div class="dv-chips">${chips}</div></div></details>`;
}

// Bản DÒNG CHỮ của khối trên — dùng cho dòng gọn (38 phòng), nơi chip quá tốn chỗ.
// ⚠️ ĐO RỒI MỚI ĐỔI, đừng quay lại chip: chip ở cả 38 phòng làm tab dài 4,7 → 14,8 màn điện thoại
// (mỗi chip chiếm trọn bề ngang 390px vì tên kỹ thuật dài trung vị 53 ký tự). Dòng chữ nói ĐÚNG
// CHỪNG ẤY loại, không cắt bớt cái nào, mà chỉ tốn ~1/3 chỗ — cùng khuôn `.rc-tt` đã dùng cho
// dòng tình trạng. Phụ chú [ ] lược khỏi dòng này (vẫn còn nguyên ở tooltip + khối bung).
function svcWaitLine(r) {
  const ds = (r.dv || []).filter(d => (d.ton || 0) > 0);
  if (!ds.length) return "";
  // Lược CỤM MỞ ĐẦU CHUNG của chính danh sách này rồi ghi nó MỘT LẦN ở nhãn ("Đang chờ siêu âm:").
  // Vì sao cần, dù dvNhan đã lược theo tên phòng: quá nửa phòng CĐHA mang mã phòng (KM2.05, N219…)
  // nên tên phòng không chứa chữ "Siêu âm" ⇒ luật kia không chạy và cả 6 mẩu đều lặp "siêu âm" —
  // đo bằng ảnh chụp: ô phòng phình 6–8 dòng chữ, cao thấp so le, đọc rất nặng.
  const ten = ds.map(d => dvNhan(d.ten, r.name).chinh);
  let nchung = 0;
  if (ten.length >= 2) {
    const w0 = ten[0].split(/\s+/);
    while (nchung < 3 && w0[nchung] && ten.every(t => {
      const w = t.split(/\s+/);
      return w.length > nchung + 1 && khongDau(w[nchung]) === khongDau(w0[nchung]);
    })) nchung++;
  }
  const chung = nchung ? w0Cum(ten[0], nchung) : "";
  // CHẶN 3 MẨU: đo từ BC01 — 3 loại nặng nhất chiếm trung vị 90% khối lượng của phòng, nên dòng
  // vẫn nói gần trọn câu chuyện. Phần dư KHÔNG bị giấu im lặng: ghi rõ "+N loại nữa" và bấm vào
  // dòng là ra ĐỦ, kèm tên đầy đủ (luật 14 — cái gì ẩn thì phải nói ra là đang ẩn).
  const HIEN = 3;
  // ⚠️ KHÔNG bọc `.nb` (nowrap) như dòng tình trạng: mẩu ở đây là cả tên kỹ thuật (~45 ký tự) —
  // cấm ngắt dòng là ô lưới 220px không co được và TRÀN NGANG cả trang (đã đo, 320→1920px đều tràn).
  const mau = ds.slice(0, HIEN).map((d, i) => {
    const t = esc((nchung ? boTu(ten[i], nchung) : ten[i]).toLowerCase()).split(" ");
    return `<span class="dv-m"><b>${fmt(d.ton)}</b>&nbsp;${t.shift()} ${t.join(" ")}</span>`;
  }).join(" · ");
  const du = ds.length - HIEN;
  const tip = "Đang chờ tại " + r.name + ":\n" + ds.map(d => `• ${fmt(d.ton)} ca — ${d.ten}`).join("\n")
    + (du > 0 ? "\n(bấm vào dòng để xem đủ)" : "");
  return `<span class="rc-dv" title="${esc(tip)}"><span class="rc-dv-h">Đang chờ${
    chung ? " " + esc(chung.toLowerCase()) : ""}:</span> ${mau}`
    + (du > 0 ? ` · <span class="dv-du">+${du} loại nữa</span>` : "") + `</span>`;
}
// Lấy `n` từ đầu của chuỗi · bỏ `n` từ đầu của chuỗi (tách hàm cho dễ đọc, dùng ở svcWaitLine).
function w0Cum(s, n) { return s.split(/\s+/).slice(0, n).join(" "); }
function boTu(s, n) { return s.split(/\s+/).slice(n).join(" ") || s; }

// CHI TIẾT: đủ MỌI loại của phòng hôm nay (kể cả đã làm xong) với tên ĐẦY ĐỦ nguyên văn HIS +
// đủ 5 trạng thái — chip phía trên chỉ nói loại còn chờ và nhãn đã rút gọn, khối này là nơi giữ
// trọn thông tin (user chốt: "đủ thông tin, không cắt bớt").
// ⚠️ Trả về THÂN, KHÔNG bọc <details> của riêng nó: dòng phòng nay là <summary> của khối bác sĩ,
// mà <details> lồng trong <summary> là HTML không hợp lệ → trình duyệt gỡ ra, khối rơi mất. Phần
// này đi vào tham số `bodyThem` của bsBox ⇒ một cú bấm ra CẢ ai đang làm LẪN đang chờ loại gì.
function svcBody(r) {
  const ds = r.dv || [];
  if (!ds.length) return "";
  const cho = ds.filter(d => (d.ton || 0) > 0), xong = ds.filter(d => !(d.ton || 0));
  const rows = arr => arr.map(d => {
    const mau = [];
    if (d.cho) mau.push(`${fmt(d.cho)} chờ tiếp nhận`);
    if (d.lam) mau.push(`${fmt(d.lam)} đang làm`);
    if ((d.kq || 0) + (d.xem || 0)) mau.push(`${fmt((d.kq || 0) + (d.xem || 0))} đã xong`);
    if (d.bo) mau.push(`${fmt(d.bo)} bỏ qua`);
    return `<div class="dv-row"><span class="dv-ten">${esc(d.ten)}</span>
      <span class="dv-num">${d.ton ? `<b>${fmt(d.ton)}</b> chờ` : "✓ xong"}</span>
      <span class="dv-sub">${mau.join(" · ")} · tổng ${fmt(d.tong || 0)} ca</span></div>`;
  }).join("");
  const seg = (label, arr) => arr.length
    ? `<div class="bs-buoi dv-seg"><div class="bs-buoi-h">${label}
         <span class="bs-buoi-n">${fmt(arr.reduce((s, d) => s + (d.ton || 0), 0))} ca · ${arr.length} loại</span>
       </div>${rows(arr)}</div>` : "";
  return seg("Đang chờ — theo loại kỹ thuật", cho) + seg("Đã làm xong hôm nay", xong);
}

// HÀNG ĐỢI CỦA PHÒNG NÀY ĐẾN TỪ ĐÂU (user chốt 2026-08-17) — chỉ tab CĐHA.
// Vì sao cần: "20 ca chưa xong" không nói được phải đi đâu để giải quyết. 18 ca dồn từ MỘT phòng
// khám là một cuộc gọi; 18 ca rải 12 phòng là chuyện khác hẳn — cùng con số, khác việc phải làm.
// Nguồn: `tenPhongChiDinh` của chính dòng chỉ định (miễn phí, không gọi thêm API) — xem cls_room_order.
//
// ⚠️ CỐ Ý KHÔNG làm nút gập như khối loại kỹ thuật — đã dựng bản gập rồi ĐO mới đổi:
// nút gập tốn +440px desktop / +2,1 màn điện thoại mà vẫn PHẢI BẤM mới biết ca đến từ đâu. Ở đây
// tên nơi ngắn (đo: trung vị 8 ký tự, max 30 — tên kỹ thuật thì 53) nên 3 nơi nặng nhất nằm gọn
// MỘT dòng chữ: rẻ hơn nút gập mà trả lời ngay, không bắt bấm. (Lý do khối loại kỹ thuật phải gập
// là vì chip của nó chiếm trọn bề ngang thẻ — hai thứ khác nhau, đừng áp cùng một khuôn.)
//  • CHẶN 3 mẩu, phần dư ghi rõ "+N nơi nữa" (luật 14 — ẩn thì phải nói là đang ẩn). Có căn cứ:
//    đo mốc thật, 3 nơi nặng nhất chiếm trung vị 100% hàng đợi của phòng (thấp nhất 52%).
//  • Đủ MỌI nơi + tên đầy đủ nằm ở tooltip và ở khối bung của dòng người thực hiện (xem ncBody).
function noiWaitLine(r) {
  const ns = (r.nc || []).filter(n => (n.ton || 0) > 0);
  if (!ns.length) return "";
  const HIEN = 3;
  // ⛔ `kh:1` = HIS KHÔNG ghi phòng chỉ định, chỉ có khoa của NGƯỜI BỆNH (đo: 30/68 phòng chỉ định
  // ứng với nhiều khoa ⇒ từ khoa KHÔNG suy ra được phòng). Nói đúng chừng ấy, đừng gọi là "khoa
  // chỉ định"; đánh dấu bằng dấu ° + tooltip, đúng quy ước "HIS ghi vậy, chưa chắc đủ" của dự án.
  // SỐ ĐI SAU TÊN, trong ngoặc — khác dòng loại kỹ thuật (số đứng trước) và cố ý: ở đó nhãn là
  // "Đang chờ siêu âm:" nên "17 tử cung buồng trứng" đọc trôi, còn ở đây nhãn là "Chờ từ" ⇒
  // "Chờ từ 4 KM1.11" đọc vấp thành "chờ từ 4 phòng KM1.11". Ngoặc buộc số vào đúng tên nó,
  // và dấu · chỉ còn một nghĩa: ngăn cách các nơi.
  const mau = ns.slice(0, HIEN).map(n =>
    `<span class="nc-m${n.kh ? " nc-kh" : ""}">${esc(n.ten)}${n.kh ? "°" : ""}`
    + `&nbsp;(<b>${fmt(n.ton)}</b>)</span>`).join(" · ");
  const du = ns.length - HIEN;
  const tip = `Ca đang chờ tại ${r.name} do các nơi này chỉ định:\n`
    + ns.map(n => `• ${fmt(n.ton)} ca — ${n.ten}${n.kh ? " (° HIS không ghi phòng chỉ định, đây là khoa của người bệnh)" : ""}`).join("\n")
    + "\n(bấm vào dòng người thực hiện để xem đủ)";
  return `<div class="nc-line" title="${esc(tip)}"><span class="nc-h">Chờ từ</span> ${mau}`
    + (du > 0 ? ` · <span class="dv-du">+${du} nơi nữa</span>` : "") + `</div>`;
}

// CHI TIẾT đủ MỌI nơi chỉ định — xếp vào THÂN của khối người thực hiện (cùng chỗ với chi tiết loại
// kỹ thuật) ⇒ một cú bấm ra cả ba câu: ai đang làm · đang chờ loại gì · ca đến từ đâu.
// ⚠️ Trả về THÂN, KHÔNG bọc <details> riêng: dòng phòng chính là <summary>, mà <details> lồng trong
// <summary> là HTML không hợp lệ (trình duyệt gỡ ra, khối rơi mất) — đúng bẫy đã ghi ở svcBody.
function ncBody(r) {
  const ns = (r.nc || []).filter(n => (n.ton || 0) > 0);
  if (!ns.length) return "";
  const rows = ns.map(n => `<div class="dv-row"><span class="dv-ten">${esc(n.ten)}${
      n.kh ? `<span class="nc-note">HIS không ghi phòng chỉ định — đây là khoa của người bệnh</span>` : ""}</span>
    <span class="dv-num"><b>${fmt(n.ton)}</b> chờ</span>
    <span class="dv-sub">${fmt(n.cho || 0)} chờ tiếp nhận · ${fmt(n.lam || 0)} đang làm · đã gửi tới ${fmt(n.tong || 0)} ca hôm nay</span></div>`).join("");
  return `<div class="bs-buoi dv-seg nc-seg"><div class="bs-buoi-h">Đang chờ — theo nơi chỉ định
      <span class="bs-buoi-n">${fmt(ns.reduce((s, n) => s + (n.ton || 0), 0))} ca · ${ns.length} nơi</span>
    </div>${rows}</div>`;
}

// Nhãn cho khối người thực hiện tab CĐHA — "người thực hiện", KHÔNG gọi "bác sĩ" (CĐHA có cả KTV).
const L_NG = { title: "Người thực hiện theo buổi", who: "người", unit: "ca" };

// Nội dung dòng NGƯỜI THỰC HIỆN (song song `docInner` của tab Phòng khám). Cùng lý do bọc `.rd-who`:
// `.room-doc` là flex container nên `<b>` trần sẽ thành flex item riêng và vỡ dòng trên điện thoại.
function performerInner(r) {
  const ten = (r.nguoi_chinh || "").trim();
  if (!ten) return `<span class="rd-ico">👨‍⚕️</span><span class="rd-who">chưa ai thực hiện</span>`;
  const n = soNguoiBuoi(r.nguoi_buoi) || r.so_nguoi || 0;
  return `<span class="rd-ico">👨‍⚕️</span><span class="rd-who">${
    n >= 2 ? `<b>${n} người luân phiên</b> · chính: ${ten}` : ten}</span>`;
}

// Tooltip cho khối bung của tab CĐHA: nói ra CẢ HAI thứ sẽ hiện ra, vì khối này gộp người thực
// hiện + cơ cấu loại kỹ thuật (hứa đúng thứ mở ra — Baymard).
function clsBoxTip(r) {
  const nl = (r.dv || []).filter(d => (d.ton || 0) > 0).length;
  const n = soNguoiBuoi(r.nguoi_buoi) || r.so_nguoi || 0;
  const ve = [n ? `${n} người đã làm hôm nay` : "", nl ? `${nl} loại kỹ thuật đang chờ` : ""]
    .filter(Boolean).join(" · ");
  return `Bấm để xem chi tiết tại ${r.name}${ve ? " — " + ve : ""}`;
}

// Dòng GỌN cho phòng đang ổn (xanh) / chưa hoạt động: chỉ "còn mấy ca chờ".
function calmRow(r) {
  return `<div class="room-calm"><span class="rc-dot"></span>
    <span class="rc-name">${r.name}</span>
    <span class="rc-wait">${(r.dang_cho || 0) ? fmt(r.dang_cho) + " chờ" : "không chờ"}</span></div>`;
}

// Thứ tự cụm TRONG 1 khu = thứ tự TẦNG THẬT: trệt (0) → tầng 1..n. Cụm chưa rõ tầng → xếp cuối.
// ---- TẦNG (dùng cho gom cụm trong khu) --------------------------------------------------------
// `nhom` do scraper dựng sẵn = "Khoa · Tầng x" (_nhom_of/_tang_of trong dashboard_flow.py — tầng suy
// từ MÃ PHÒNG HIS, không chắc thì bỏ trống). Ở đây chỉ ĐỌC LẠI phần tầng, KHÔNG tự suy lại.
function tangText(r) { return String(r.nhom || "").split(" · ")[1] || ""; }
// Số tầng để gom + xếp. "Tầng 4 (VIP)" và "Tầng 4" là CÙNG MỘT TẦNG VẬT LÝ → cùng số 4, cùng một
// cụm. Đúng chủ trương đã ghi ở TANG_VIP_CUA_KHOA (dashboard_flow.py): "nếu không có luật này,
// tầng 4 bị tách làm 2 cụm rời" — tách 1 tầng thành nhiều cụm là sai bản chất đường đi thực địa.
// Không đọc được tầng → null = "chưa rõ tầng", frontend xếp CUỐI khu (§5b: thà không nói còn hơn nói sai).
// Tầng lửng = 0,5 → nằm ĐÚNG giữa trệt (0) và tầng 1, khớp đường đi thực địa (user chốt 2026-07-17).
function tangNum(t) {
  if (!t) return null;
  if (/trệt/i.test(t)) return 0;
  if (/lửng/i.test(t)) return 0.5;
  const m = t.match(/Tầng\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}
function tangLabel(n) {
  if (n === 0) return "Tầng trệt";
  if (n === 0.5) return "Tầng lửng";
  return `Tầng ${n}`;
}

function cumOrder(nhom) {
  const sub = String(nhom).split(" · ")[1] || "";
  if (!sub) return -1;                                  // khoa chưa rõ tầng
  if (/trệt/i.test(sub)) return 0;
  if (/lửng/i.test(sub)) return 0.5;                    // lửng nằm giữa trệt và tầng 1
  const m = sub.match(/Tầng\s*(\d+)/i);
  if (m) return Number(m[1]);                           // "Tầng 4 (VIP)" → 4 (VIP thật sự ở tầng 4)
  return 800;
}

// KHU = tên tòa nhà HIS ("Nhà M", "Nhà BC", "Bệnh viện Từ Dũ"…). Cần 2 thứ dẫn xuất:
//  • khuSlug  → class CSS hợp lệ (tên tòa có dấu + khoảng trắng, không dùng thẳng làm class được)
//  • khuTag   → 1–2 ký tự cho ô vuông 26px cạnh tiêu đề khu
const KHU_KHAC = "Chưa rõ tòa";   // khớp KHU_KHAC trong dashboard_flow.py
function khuSlug(khu) {
  return "khu-" + String(khu).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function khuTag(khu) {
  const m = String(khu).match(/^Nhà\s+(\S+)/i);
  if (m) return m[1].toUpperCase();                     // "Nhà M1" → M1 · "Nhà BC" → BC
  if (/Từ Dũ/i.test(khu)) return "TD";                  // "Bệnh viện Từ Dũ" (phòng dùng chung)
  return "◆";                                           // "Chưa rõ tòa"
}

// Tiêu đề 1 cụm (dùng chung 2 tab): "Khoa · Tầng 2" → tên khoa + chip TẦNG + chip NGOẠI TRÚ.
// Chip "Ngoại trú" giữ lại thông tin mà cấp KHU không còn mang (khu nay là tòa nhà, không phải
// ngoại trú/nội trú) → không mất thông tin khi đổi cách phân khu.
function khoaHead(nhom, list) {
  const [kMain, kSub] = String(nhom).split(" · ");
  const vip = /VIP/i.test(kSub || "");
  const nt = list && list[0] && list[0].ngoai_tru;
  return `${kMain}`
    + (kSub ? `<span class="khoa-chip${vip ? " vip" : ""}">${kSub}</span>` : "")
    + (nt ? `<span class="khoa-chip nt">Ngoại trú</span>` : "");
}

// Tổng hợp 1 nhóm phòng (khu hoặc khoa) → số liệu điều phối dùng chung cho dòng tổng.
function groupStats(list) {
  const hot  = list.filter(r => levelOf(r) === "red" || levelOf(r) === "amber")
                   .sort((a, b) => (b.dang_cho || 0) - (a.dang_cho || 0));
  const rest = list.filter(r => levelOf(r) !== "red" && levelOf(r) !== "amber")
                   .sort((a, b) => (b.dang_cho || 0) - (a.dang_cho || 0));
  return {
    hot, rest,
    quaTai: list.filter(r => levelOf(r) === "red").length,
    dong:   list.filter(r => levelOf(r) === "amber").length,
    totCho: list.reduce((s, r) => s + (r.dang_cho || 0), 0),
  };
}
// Dòng tổng: "N phòng · X đang chờ · N quá tải · N đông" (chỉ hiện phần khác 0).
function groupSumBits(list, st) {
  const bits = [`${list.length} phòng`, `<b>${fmt(st.totCho)}</b> đang chờ`];
  if (st.quaTai) bits.push(`<b class="k-red">${st.quaTai} quá tải</b>`);
  if (st.dong)   bits.push(`<b class="k-amber">${st.dong} đông</b>`);
  return bits.join(" · ");
}

// TAB PHÒNG KHÁM — cùng thiết kế v3 với tab CĐHA (2026-07-14): MÀN HÌNH MẶC ĐỊNH CHỈ CHỨA
// DANH SÁCH VIỆC. Bản cũ bày cả 108 phòng cùng lúc: 29 khối khoa · 30 thẻ · 78 dòng = 15 màn hình
// trên điện thoại — user phản ánh đúng "quá nhiều khoa, quá nhiều phòng một lúc".
// Số liệu biện hộ: trung vị chỉ 2 người chờ, mà 10 phòng nặng nhất gánh 47% hàng đợi cả viện
// → đọc 10 dòng là đủ điều phối; 98 phòng kia là TRA CỨU, nằm sau 1 nút.
function pkHotRow(r, rank, maxCho) {
  const dk = r.doi_kham || 0, dkl = r.doi_ket_luan || 0;
  const tang = String(r.nhom || "").split(" · ")[1];
  const noi = [(_khuLabels && _khuLabels[r.khu]) || r.khu, tang].filter(Boolean).join(" · ");
  // Nút thắt quyết định điều người làm gì: thiếu bác sĩ KHÁM hay bác sĩ chưa KẾT LUẬN.
  const nut = dk >= dkl ? `${fmt(dk)} đợi khám` : `${fmt(dkl)} đợi kết luận`;
  const w = Math.round((r.dang_cho || 0) / Math.max(1, maxCho) * 100);
  return `<div class="hot-row ${levelOf(r)}">
    <span class="hr-fill" style="width:${w}%"></span>
    <span class="hr-rank">${rank}</span>
    <span class="hr-main">
      <span class="hr-name">${r.name}</span>
      <span class="hr-sub">${noi} · ${nut}</span>
    </span>
    <span class="hr-num">${fmt(r.dang_cho)}${rank === 1 ? "<small>người chờ</small>" : ""}</span>
  </div>`;
}
// Bác sĩ dạng GỌN cho dòng tra cứu: "👨‍⚕️ Tên" (+N nếu có nhiều BS luân phiên). Rỗng khi chưa có.
function doctorInline(r) {
  const ten = (r.bac_si_chinh || "").trim();
  if (!ten) return "";
  const n = soNguoiBuoi(r.bac_si_buoi) || r.so_bac_si || 0;
  // "+2" một mình là số trần (xem .claude/rules/ngon-ngu-ui.md) → nói đủ nghĩa trong tooltip,
  // còn "họ là ai" thì bấm vào dòng là ra — khỏi phải nhét thêm chữ vào dòng vốn đã chật.
  const tip = n >= 2 ? `${n} BS luân phiên hôm nay · khám nhiều nhất: ${ten}` : ten;
  return `<span class="rc-bs" title="${esc(tip)}">👨‍⚕️ ${ten}${n >= 2 ? ` +${n - 1}` : ""}</span>`;
}
// `noi` = chuỗi vị trí ghi trên dòng; bỏ trống thì tự lấy "Khoa · Tầng". Dòng nằm TRONG cụm tầng
// chỉ cần ghi KHOA (tiêu đề cụm đã nói tầng rồi) — lặp lại tầng ở 35 dòng của Khu N là nhiễu, đúng
// lỗi "lệnh lặp 46 lần" đã trị ở §12.3. Ngược lại KHOA thì phải giữ: một tầng có nhiều khoa.
// BẤM VÀO DÒNG → sổ chi tiết bác sĩ (user chốt 2026-08-17). Trước đó dòng chỉ ghi "👨‍⚕️ Tên +2"
// mà KHÔNG có cách nào biết 2 người kia là ai: chi tiết chỉ có trên THẺ, mà thẻ chỉ dành cho 10
// phòng nặng nhất viện ⇒ 58/82 phòng có bác sĩ nhưng không tra được (đo 2026-08-17).
// Dòng nào KHÔNG có dữ liệu bác sĩ thì giữ nguyên là dòng tĩnh (không caret, không bấm được) —
// đừng mời bấm để rồi mở ra khối rỗng.
function pkRestRow(r, noi) {
  const c = r.dang_cho || 0;
  if (noi === undefined) noi = r.nhom || r.khoa || "";
  const bs = doctorInline(r);
  const inner = `<span class="rc-dot"></span>
    <span class="rc-name">${r.name}<span class="rc-noi">${noi}${noi && bs ? " · " : ""}${bs}</span></span>
    <span class="rc-wait">${c ? fmt(c) + " người" : "✓ không chờ"}</span>`;
  return bsBox(r, r.bac_si_buoi, L_BS, `room-calm ${levelOf(r)}`, inner);
}
function pkOpen(k) { try { return localStorage.getItem("pk_open_" + k) === "1"; } catch (e) { return false; } }
function pkToggle(k) { try { localStorage.setItem("pk_open_" + k, pkOpen(k) ? "0" : "1"); } catch (e) {} }

// TAB PHÒNG KHÁM — GOM TẤT CẢ THEO KHU → TẦNG, mỗi phòng MỘT THẺ ĐẦY ĐỦ (user chốt 2026-08-17).
// Cấu trúc KHU → TẦNG giữ nguyên (§5b/§12.8): đi tòa nào thấy hết tòa đó, trong tòa đi theo tầng.
// Đổi ở chỗ MỖI PHÒNG BÀY GÌ: trước đây chỉ phòng đỏ được thẻ, phòng cam/xanh rút thành dòng gọn
// `pkRestRow` (tên · khoa · "3 người" / "✓ không chờ" · tên BS chính). User: "không thu nhỏ thông
// tin lại, không đủ thông tin điều phối" — dòng gọn giấu mất nút thắt (đợi khám hay đợi kết luận),
// khối lượng đã khám, xu hướng, ước tính phút tới lượt. Nay mọi phòng cùng một khuôn thẻ, chỉ khác
// MÀU: xanh = ổn định · cam = đông · đỏ = quá tải.
// Giá phải trả (nói ra chứ không giấu): trang dài hơn hẳn — đo ở cuối phiên, ghi vào CLAUDE.md.
function renderRooms() {
  const rooms = _roomsData || [];
  const wrap = document.getElementById("rooms");
  if (!rooms.length) { wrap.innerHTML = `<p class="empty">Chưa có số liệu phòng.</p>`; return; }

  // Hạng TOÀN VIỆN cho phòng quá tải → #N trên thẻ vẫn so được cả bệnh viện dù đã gom theo khu.
  const redAll = rooms.filter(r => levelOf(r) === "red")
                      .sort((a, b) => (b.dang_cho || 0) - (a.dang_cho || 0));
  const rankOf = new Map(redAll.map((r, i) => [r.key, i + 1]));

  const byKhu = {};
  rooms.forEach(r => { const k = r.khu || KHU_KHAC; (byKhu[k] = byKhu[k] || []).push(r); });
  const order = ((_khuOrder && _khuOrder.length) ? _khuOrder : Object.keys(byKhu)).slice();
  Object.keys(byKhu).forEach(k => { if (!order.includes(k)) order.push(k); });

  // KHÔNG dựng dòng bối cảnh "Cả viện: N chờ · N quá tải · N đã khám": cả 3 số ĐÃ nằm nguyên trong
  // 4 thẻ KPI ngay phía trên → lặp số trên cùng một màn (lỗi đã trị ở tab Khám toàn diện, xem
  // .claude/rules/ngon-ngu-ui.md). Dòng này là tàn dư bản v3 hồi KPI còn bị ẩn (§12.5); §12.7 đưa KPI
  // trở lại nhưng quên gỡ. Bỏ luôn hết chuyện nhãn "Cả viện" nói dối khi đang lọc khu — phạm vi nay
  // do dải .scope-band ở đầu trang nói MỘT lần cho cả 2 tab.
  let html = "";

  order.forEach(khu => {
    const list = byKhu[khu];
    if (!list || !list.length) return;
    const redKhu = list.filter(r => levelOf(r) === "red");            // đếm ở dòng tổng khu
    const label = (_khuLabels && _khuLabels[khu]) || khu;
    const tot = list.reduce((s, r) => s + (r.dang_cho || 0), 0);
    // Thanh trong thẻ chuẩn hóa theo phòng nặng nhất CỦA KHU → so được giữa các khoa trong cùng tòa.
    // ⚠️ Sàn = T_OVER (ngưỡng quá tải): nay MỌI phòng đều có thẻ, nên khu nhẹ nhất (max 3 người) mà
    // chuẩn theo chính nó thì phòng 3 người vẽ thanh ĐẦY 100% — mắt đọc ra "phòng này kín", trong
    // khi nó đang xanh. Có sàn thì thanh đầy chỉ xuất hiện khi thật sự chạm mức quá tải.
    const maxW = Math.max(T_OVER, list.reduce((m, r) => Math.max(m, r.dang_cho || 0), 0));
    html += `<section class="khu-block ${khuSlug(khu)}">
      <div class="khu-head"><span class="khu-tag ${khuSlug(khu)}-tag">${khuTag(khu)}</span>
        <h2 class="khu-title">${label}</h2>
        <span class="khu-sum">${list.length} phòng · <b>${fmt(tot)}</b> người chờ`
      + (redKhu.length ? ` · <b class="k-red">${redKhu.length} quá tải</b>` : "")
      + `</span></div>`;
    // Gom theo TẦNG, mỗi tầng một cụm riêng → phòng CÙNG TẦNG đứng cạnh nhau, xuống dòng là tầng
    // khác (user chốt 2026-07-16). Trước đây khu xếp thẳng theo số người chờ nên Tầng 1/2/3/4 TRỘN
    // LẪN (Khu N: 35 phòng lẫn lộn) → đi thực địa phải chạy lên chạy xuống.
    // Gom theo TẦNG chứ KHÔNG theo khoa·tầng: một tầng có nhiều khoa (tầng 4 Nhà N có cả Phụ sản N
    // (VIP) lẫn Tạo Hình Thẩm Mỹ) — gom theo khoa·tầng thì cùng một tầng bị xé làm 2 cụm rời, đúng
    // cái TANG_VIP_CUA_KHOA đã cảnh báo. Người đi điều phối lên tầng 4 là xử hết phòng tầng 4.
    // Thứ tự = ĐƯỜNG ĐI THỰC ĐỊA trệt→1→2→3→4, "chưa rõ tầng" xuống CUỐI (§5b).
    // ⚠️ MỌI phòng của khu đều vào đây (không còn tách 10 thẻ đỏ lên đầu khu): tách ra thì phòng
    // nặng nhất bị RÚT KHỎI TẦNG của nó — đúng cái user đã phản đối ("Khu N 50 phòng mà chỉ thấy
    // 22"). Trong tầng xếp nặng → nhẹ, nên phòng cần can thiệp vẫn đứng đầu cụm.
    {
      const byTang = new Map();
      list.forEach(r => {
        const k = tangNum(tangText(r));
        const kk = (k === null ? "?" : k);
        if (!byTang.has(kk)) byTang.set(kk, []);
        byTang.get(kk).push(r);
      });
      [...byTang.keys()]
        .sort((a, b) => (a === "?" ? 9999 : a) - (b === "?" ? 9999 : b))
        .forEach(k => {
          const g = byTang.get(k).sort((a, b) => (b.dang_cho || 0) - (a.dang_cho || 0));
          const gt = g.reduce((s, r) => s + (r.dang_cho || 0), 0);
          const gRed = g.filter(r => levelOf(r) === "red").length;
          // Cả tầng đều là khu VIP → nói rõ trên tiêu đề tầng (thông tin này nằm ở _tang_of, đừng bỏ).
          const allVip = g.length > 0 && g.every(r => /VIP/i.test(tangText(r)));
          const lbl = k === "?" ? "Chưa rõ tầng" : tangLabel(k);
          html += `<div class="khoa-block">
            <div class="khoa-head"><h3 class="khoa-name">${lbl}`
            + (allVip ? `<span class="khoa-chip vip">VIP</span>` : "")
            + `</h3>
              <span class="khoa-sum">${g.length} phòng · <b>${fmt(gt)}</b> người chờ`
            + (gRed ? ` · <b class="k-red">${gRed} quá tải</b>` : "")
            + `</span></div>
            <div class="rooms-grid">${g.map(r => roomCard(r, rankOf.get(r.key), maxW, r.khoa || "")).join("")}</div>
          </div>`;
        });
    }
    html += `</section>`;
  });

  wrap.innerHTML = html;
}

// ====== TAB CĐHA — KHỐI 1: PHÒNG THỰC HIỆN (điều phối nhân lực, như tab Phòng khám) ======
// Trục PHÒNG trả lời "dồn người về đâu"; bảng dịch vụ bên dưới trả lời "kỹ thuật nào ùn".
// TỒN ĐỌNG = chờ tiếp nhận + đang làm (chưa có kết quả) — song song với `dang_cho` của phòng khám,
// dùng CÙNG ngưỡng RAG (≥10 quá tải · 5–9 đông) để quản lý chỉ phải nhớ MỘT bộ ngưỡng.
// ⚠️ NGƯỠNG RIÊNG CỦA CĐHA — KHÔNG mượn ngưỡng của tab Phòng khám (≥10/≥5). Hai tab khác thang đo:
// phòng khám xếp hàng vài chục người; CĐHA cả viện tồn ~1.600 ca, phòng nặng nhất 230, TRUNG VỊ chỉ 6.
// Lấy ngưỡng 10 ở đây thì 53% số phòng thành "đỏ" → hơn nửa màn hình báo động = màu đỏ mất nghĩa
// (alarm fatigue), đúng cái làm tab rối. Ngưỡng dưới đặt theo phân bố thật: đỏ ≈ P90, cam ≈ P75.
const CLS_RED = 40;     // ≈ P90 → ~9 phòng thật sự phải can thiệp ngay
const CLS_AMBER = 15;   // ≈ P75 → cần theo dõi, KHÔNG lên thẻ lớn
function clsLevelOf(r) {
  const c = r.ton_dong || 0;
  if (c >= CLS_RED) return "red";
  if (c >= CLS_AMBER) return "amber";
  return "green";
}

function clsGroupStats(list) {
  const hot  = list.filter(r => clsLevelOf(r) !== "green")
                   .sort((a, b) => (b.ton_dong || 0) - (a.ton_dong || 0));
  const rest = list.filter(r => clsLevelOf(r) === "green")
                   .sort((a, b) => (b.ton_dong || 0) - (a.ton_dong || 0));
  return {
    hot, rest,
    quaTai: list.filter(r => clsLevelOf(r) === "red").length,
    dong:   list.filter(r => clsLevelOf(r) === "amber").length,
    totCho: list.reduce((s, r) => s + (r.ton_dong || 0), 0),
  };
}
function clsSumBits(list, st) {
  const bits = [`${list.length} phòng`, `<b>${fmt(st.totCho)}</b> ca chưa xong`];
  if (st.quaTai) bits.push(`<b class="k-red">${st.quaTai} phòng ùn</b>`);
  if (st.dong)   bits.push(`<b class="k-amber">${st.dong} cần theo dõi</b>`);
  return bits.join(" · ");
}

// Thẻ 1 phòng CĐHA — dùng cho MỌI phòng, kể cả phòng đã xong hết (user chốt 2026-08-17: áp cùng
// một khuôn cho "phòng khám và phòng siêu âm, phòng của khoa Chẩn đoán hình ảnh"). Trước đây chỉ
// phòng ùn nặng (≥ CLS_RED = 40 ca) mới lên thẻ, phần còn lại rút thành dòng gọn `clsRestRow` —
// mà ngưỡng đỏ tab này cao nên giờ thường KHÔNG phòng siêu âm nào chạm ngưỡng (đo 14/08: phòng
// nặng nhất 23 ca), tức đúng những phòng user đang hỏi lại là những phòng bày ít thông tin nhất.
// Nay mọi phòng cùng khuôn thẻ, chỉ khác MÀU: xanh = ổn định · cam = cần theo dõi · đỏ = ùn nặng.
//  • rank: chỉ phòng ùn nặng mới có (hạng TOÀN VIỆN trong nhóm đỏ) → phòng cam/xanh không in "#".
//  • locOverride: thẻ nằm trong cụm TẦNG rồi thì chỉ ghi KHOA (tiêu đề cụm đã nói tầng).
// KHÔNG có dòng lệnh "→ …" trên thẻ: lệnh gần như giống nhau ở mọi phòng, lặp hàng chục lần thì
// nó thành nhiễu chứ không còn là lệnh. Lệnh nằm DUY NHẤT ở dải hành động phía trên.
function clsRoomCard(r, rank, maxTon, khuLabels, locOverride) {
  const lv = clsLevelOf(r);
  const tag = { red: "⛔ Ùn nặng", amber: "⚠️ Cần theo dõi", green: "✓ Ổn định" };
  const cho = r.cho_tiep_nhan || 0, lam = r.da_tiep_nhan || 0;
  const xong = (r.da_co_kq || 0) + (r.da_xem_kq || 0), bo = r.bo_qua || 0;
  const w = Math.round((r.ton_dong || 0) / Math.max(1, maxTon) * 100);
  const bnCho = cho >= lam;                 // nút thắt = khâu đọng nhiều hơn → tô nổi
  const cellC = `<span class="d-cell${bnCho && cho > 0 ? " bottleneck" : ""}"><span class="d-lbl">Chờ tiếp nhận</span>${bnum(cho)}</span>`;
  const cellL = `<span class="d-cell${!bnCho && lam > 0 ? " bottleneck" : ""}"><span class="d-lbl">Đang làm</span>${bnum(lam)}</span>`;
  // Ô thứ 3 = KHỐI LƯỢNG ĐÃ LÀM. Bỏ nó thì phòng làm 140 ca và phòng làm 1 ca hiện Y HỆT NHAU khi
  // cùng đã xong — đúng lỗi user báo 14/08 ở dòng gọn; dòng gọn nay không còn nên thông tin đó phải
  // lên thẻ. Song song với ô "Đã khám" của thẻ tab Phòng khám.
  const cellX = `<span class="d-cell done"><span class="d-lbl">Đã xong</span>${bnum(xong)}</span>`;
  // Vị trí: trong cụm tầng thì caller truyền sẵn chuỗi chỉ có KHOA; ngoài cụm thì tự ghi "Khu · Tầng".
  // Nhãn khu phải lấy từ bảng của CHÍNH tab CĐHA: tab Phòng khám không có phòng ở Khu A nên
  // bảng nhãn của nó thiếu 'Nhà A' → tra nhầm bảng sẽ rớt về chuỗi thô "Nhà A".
  const tang = String(r.nhom || "").split(" · ")[1];
  const noi = locOverride !== undefined ? locOverride
            : [(khuLabels && khuLabels[r.khu]) || r.khu, tang].filter(Boolean).join(" · ");
  // Tooltip ghi ĐỦ 5 trạng thái HIS kể cả mẩu bằng 0 — thẻ chỉ bày mẩu có nghĩa, ai cần tra thì rê chuột.
  const tip = `${r.name} — ${fmt(cho)} chờ tiếp nhận · ${fmt(lam)} đã tiếp nhận`
    + ` · ${fmt(r.da_co_kq || 0)} đã có kết quả · ${fmt(r.da_xem_kq || 0)} đã xem kết quả`
    + ` · ${fmt(bo)} bỏ qua · tổng ${fmt(r.tong || 0)} ca`;
  return `<div class="room ${lv}" title="${esc(tip)}">
    <div class="name">${r.name}
      <span class="rank"><span class="rstat ${lv}">${tag[lv]}</span>${rank ? ` #${rank}` : ""}</span></div>
    ${noi ? `<div class="room-noi">${noi}</div>` : ""}
    <div class="wait"><span class="wlead"><span class="wnum">${fmt(r.ton_dong)}</span> <small>ca chưa xong</small></span></div>
    <div class="bar"><i style="width:${w}%"></i></div>
    <div class="detail">${cellC}${cellL}${cellX}</div>
    ${bo ? `<div class="detail-sub"><span>${fmt(bo)} ca bỏ qua</span></div>` : ""}
    ${svcWaitChips(r)}
    ${noiWaitLine(r)}
    ${performerLine(r)}
  </div>`;
}

// AI ĐANG LÀM ở phòng CĐHA — từ `tenNguoiThucHien`. Gọi "người thực hiện", KHÔNG gọi "bác sĩ":
// CĐHA do cả KTV (X-quang) lẫn bác sĩ (siêu âm) làm → gọi hết là BS là SAI sự thật.
// Phòng chưa ai làm (toàn ca chờ tiếp nhận) → dòng mờ, giữ chỗ cho thẻ khỏi nhảy layout.
// "N người" trơ bị đọc thành "N người cùng lúc" (đúng lỗi đã trị ở dòng bác sĩ tab Phòng khám,
// xem .claude/rules/ngon-ngu-ui.md) → ghi "luân phiên": họ thay ca nhau trong ngày.
// Dòng này CHÍNH NÓ là nút mở chi tiết — cùng khuôn bsBox với tab Phòng khám (user chốt 2026-08-17):
// bấm ngay chỗ đang thắc mắc, và khối bung nói cả AI LÀM lẫn ĐANG CHỜ LOẠI GÌ.
function performerLine(r) {
  const cls = (r.nguoi_chinh || "").trim() ? "room-doc" : "room-doc none";
  return bsBox(r, r.nguoi_buoi, L_NG, cls, performerInner(r), clsBoxTip(r), svcBody(r) + ncBody(r));
}
// Người thực hiện dạng GỌN cho dòng tra cứu (song song `doctorInline` của tab Phòng khám).
function performerInline(r) {
  const ten = (r.nguoi_chinh || "").trim();
  if (!ten) return "";
  const n = r.so_nguoi || 0;
  return `<span class="rc-bs">👨‍⚕️ ${ten}${n >= 2 ? ` +${n - 1}` : ""}</span>`;
}

// Dòng GỌN — dùng cho MỌI phòng còn lại (kể cả phòng cam). Tô màu theo mức, nhưng không phình
// thành thẻ: 78/86 phòng thuộc nhóm này, cho mỗi phòng 1 thẻ thì tab dài 20 màn hình.
// TAB CĐHA — KHỐI PHÒNG. Thiết kế v3 (2026-07-14, sau phản biện "vẫn còn quá phức tạp").
//
// Nguyên tắc: MÀN HÌNH MẶC ĐỊNH CHỈ CHỨA MỘT THỨ — DANH SÁCH VIỆC.
// Người quản lý mở điện thoại ra hỏi đúng một câu: "phải dồn người về đâu?" → câu trả lời là một
// danh sách ~10 phòng. Mọi thứ khác (75 phòng còn lại · 209 dịch vụ) là TRA CỨU, nằm sau 1 nút bấm.
// Bản trước vẫn bày cả 3 thứ cùng lúc nên đọc mãi không ra quyết định.
//
// Bỏ THẺ, dùng DÒNG: thẻ (thanh bar, 2 ô chờ/làm, khung viền) ngốn ~120px cho 1 phòng mà thông tin
// thêm không đổi được quyết định — dồn người về phòng nào chỉ cần: TÊN · SỐ TỒN · Ở ĐÂU.
function clsHotRow(r, rank, khuLabels, maxTon) {
  const cho = r.cho_tiep_nhan || 0, lam = r.da_tiep_nhan || 0;
  const tang = String(r.nhom || "").split(" · ")[1];
  const noi = [(khuLabels && khuLabels[r.khu]) || r.khu, tang].filter(Boolean).join(" · ");
  // Nút thắt: đọng ở khâu TIẾP NHẬN hay khâu TRẢ KẾT QUẢ — quyết định điều người làm việc gì.
  const nut = cho >= lam ? `${fmt(cho)} chờ tiếp nhận` : `${fmt(lam)} đang làm dở`;
  // THANH TỈ LỆ nền: nếu chỉ tô đỏ thì 230 và 40 nhìn NẶNG NHƯ NHAU — mắt không so được lượng
  // bằng màu. Độ DÀI là kênh mã hoá lượng chính xác nhất (Cleveland & McGill) → nhìn phát biết
  // phòng đầu gấp mấy lần phòng cuối, khỏi phải đọc số.
  const w = Math.round((r.ton_dong || 0) / Math.max(1, maxTon) * 100);
  return `<div class="hot-row ${clsLevelOf(r)}">
    <span class="hr-fill" style="width:${w}%"></span>
    <span class="hr-rank">${rank}</span>
    <span class="hr-main">
      <span class="hr-name">${r.name}</span>
      <span class="hr-sub">${noi} · ${nut}</span>
    </span>
    <span class="hr-num">${fmt(r.ton_dong)}${rank === 1 ? "<small>ca chưa xong</small>" : ""}</span>
  </div>`;
}

// Dòng phòng ở phần TRA CỨU (gập mặc định): tên + khoa·tầng + số ca chưa xong.
// `noi` = chuỗi vị trí ghi trên dòng; bỏ trống thì tự lấy "Khoa · Tầng". Dòng nằm TRONG cụm tầng
// chỉ cần ghi KHOA (tiêu đề cụm đã nói tầng) — y hệt pkRestRow của tab Phòng khám (§12.8).
//
// DÒNG TÌNH TRẠNG (user báo 2026-08-14, ảnh Khu KM tầng 2): dòng cũ chỉ có MỘT mẩu — "18 ca" hoặc
// "✓ xong" — nên KM2.05 (làm 140 ca) và KM3.17 (làm 1 ca) hiện Y HỆT NHAU. Mất cả KHỐI LƯỢNG lẫn
// KHÂU ĐANG ĐỌNG, đúng lúc điều phối viên cần biết "phòng này đang kẹt ở tiếp nhận hay ở trả kết quả".
// Chỉ in khâu CÓ SỐ (bỏ mẩu 0): in "0 chờ · 0 đang làm" ở 15/17 phòng đã xong là nhiễu thuần tuý.
//
// ⚠️ ĐẶT Ở CỘT TRÁI, KHÔNG đặt cạnh con số bên phải (đã đo, đừng làm lại): `.rc-wait` mang
// `white-space:nowrap; flex:none` nên nó KHÔNG CO ĐƯỢC — nhét chuỗi ~130px vào đó thì tên phòng dài
// bị bóp còn ~100px và vỡ thành 5 dòng: "Siêu âm - P3 (HIẾM MUỘN)(Tăng cường)" phình 83px → 152px,
// 20/42 dòng cao thêm. Cột trái vốn đã tự xuống dòng (rc-noi) nên đặt ở đây không bóp gì cả.
// Mỗi mẩu bọc `.nb` để không bị ngắt giữa chừng ("5 đang / làm" đọc vấp — cùng lý do ghi ở style.css).
function clsTinhTrang(r) {
  const cho = r.cho_tiep_nhan || 0, lam = r.da_tiep_nhan || 0;
  const xong = (r.da_co_kq || 0) + (r.da_xem_kq || 0), bo = r.bo_qua || 0;
  const b = [];
  if (r.ton_dong) {                       // còn việc → nói rõ đọng ở khâu nào
    if (cho) b.push(`${fmt(cho)} chờ`);
    if (lam) b.push(`${fmt(lam)} đang làm`);
    if (xong) b.push(`${fmt(xong)} xong`);
  } else if (xong) {                      // xong hết → chỉ còn khối lượng đã làm ("✓ xong" đã ở trên)
    b.push(`${fmt(xong)} ca`);
  }
  if (bo) b.push(`${fmt(bo)} bỏ qua`);
  return b.map(x => `<span class="nb">${x}</span>`).join(" · ");
}
function clsRestRow(r, noi) {
  const ton = r.ton_dong || 0;
  if (noi === undefined) noi = r.nhom || r.khoa || "";
  const ng = performerInline(r);
  const tt = clsTinhTrang(r);
  // Tooltip ghi ĐỦ 5 trạng thái HIS (kể cả mẩu bằng 0) — dòng chỉ in mẩu có số, ai cần tra thì rê chuột.
  const tip = `${r.name} — ${fmt(r.cho_tiep_nhan || 0)} chờ tiếp nhận · ${fmt(r.da_tiep_nhan || 0)}`
    + ` đã tiếp nhận · ${fmt(r.da_co_kq || 0)} đã có kết quả · ${fmt(r.da_xem_kq || 0)} đã xem kết quả`
    + ` · ${fmt(r.bo_qua || 0)} bỏ qua · tổng ${fmt(r.tong || 0)} ca`;
  // CHIP LOẠI KỸ THUẬT ĐANG CHỜ — hiện NGAY trên dòng, không giấu sau nút bấm (user chốt
  // 2026-08-17: đây là thứ quyết định điều phối, "5 ca siêu âm phụ khoa nhanh hơn 2 ca 3D").
  // ⚠️ Phải có ở DÒNG GỌN, không chỉ ở thẻ: ngưỡng đỏ tab này là 40 ca (CLS_RED) nên phòng siêu âm
  // hầu như không bao giờ lên thẻ — đo mốc 08:50 hôm nay, phòng nặng nhất mới 23 ca ⇒ làm mỗi ở thẻ
  // thì đúng những phòng user hỏi lại là những phòng không có gì.
  // ⚠️ Đặt trong `.rc-name` (cột trái tự xuống dòng), KHÔNG đặt cạnh `.rc-wait`: ô đó là
  // `nowrap; flex:none` nên không co được, nhét chip vào là bóp tên phòng vỡ nhiều dòng (đã đo,
  // xem ghi chú clsTinhTrang ở trên).
  const inner = `<span class="rc-dot"></span>
    <span class="rc-name">${r.name}<span class="rc-noi">${noi}${noi && ng ? " · " : ""}${ng}</span>${
      tt ? `<span class="rc-tt">${tt}</span>` : ""}${svcWaitLine(r)}</span>
    <span class="rc-wait">${ton ? fmt(ton) + " ca" : "✓ xong"}</span>`;
  // Cả dòng là nút mở chi tiết (cùng khuôn pkRestRow): bung ra AI đã làm buổi nào + ĐỦ mọi loại
  // dịch vụ với tên đầy đủ. Phòng không có gì để bung → bsBox tự trả dòng tĩnh, không dựng nút rỗng.
  return bsBox(r, r.nguoi_buoi, L_NG, `room-calm ${clsLevelOf(r)}`, inner,
               clsBoxTip(r) + " · " + tip, svcBody(r));
}

function clsOpen(key) {
  try { return localStorage.getItem("cls_open_" + key) === "1"; } catch (e) { return false; }
}
function clsToggle(key) {
  try { localStorage.setItem("cls_open_" + key, clsOpen(key) ? "0" : "1"); } catch (e) {}
}

function renderClsRooms(cls) {
  const wrap = document.getElementById("cls-rooms");
  if (!wrap) return;
  const rooms = (cls && cls.rooms) || [];
  // Trống thì KHÔNG được im lặng (luật 5): nói rõ là do bộ lọc khoa hay do chưa có số. Trang trắng
  // trơn trông y hệt "mất dữ liệu" — mà đây là ca dễ xảy ra nhất khi HIS đổi tên khoa.
  if (!rooms.length) {
    const kf = (cls && cls.khoa_filter) || null;
    const gl = (cls && cls.phong_giu_lai) || [];
    wrap.innerHTML = kf
      ? `<p class="empty">Không có phòng nào thuộc <b>${kf.concat(gl).join(" · ")}</b> trong phạm vi
           đang xem. Nếu HIS vừa đổi tên khoa thì sửa <code>KHOA_HIEN_THI_CLS</code> /
           <code>PHONG_GIU_LAI_CLS</code> trong <code>scraper/dashboard_flow.py</code>.</p>`
      : "";
    return;
  }

  const nong = rooms.filter(r => clsLevelOf(r) === "red")
                    .sort((a, b) => (b.ton_dong || 0) - (a.ton_dong || 0));
  const conLai = rooms.filter(r => clsLevelOf(r) !== "red");
  const t = cls.totals || {};
  const xong = (t.da_co_kq || 0) + (t.da_xem_kq || 0);
  const pctXong = t.tong ? Math.round(xong / t.tong * 100) : 0;
  const canTD = rooms.filter(r => clsLevelOf(r) === "amber").length;

  // ===== KPI LỚN đầu tab (phong cách CS2). "Ca chưa có kết quả" = chỉ số chính (đỏ). =====
  const kpiEl = document.getElementById("cls-kpis");
  if (kpiEl) kpiEl.innerHTML = `
    <div class="kpi red hero"><div class="big">${fmt(t.ton_dong)}</div>
      <div class="lbl">Ca chưa có kết quả</div>
      <div class="sub-metric">${fmt(t.cho_tiep_nhan)} chờ tiếp nhận · ${fmt(t.da_tiep_nhan)} đang làm</div></div>
    <div class="kpi ${nong.length ? "red" : canTD ? "amber" : "ok"}"><div class="big">${(nong.length || canTD) ? (nong.length ? "⛔ " : "⚠️ ") : "✅ "}${nong.length + canTD}</div>
      <div class="lbl">Phòng cần can thiệp</div>
      <div class="sub-metric">${nong.length} ùn nặng · ${canTD} cần theo dõi</div></div>
    <div class="kpi ok"><div class="big">${pctXong}%</div>
      <div class="lbl">Đã có kết quả</div>
      <div class="sub-metric">${fmt(xong)}/${fmt(t.tong)} ca chỉ định hôm nay</div></div>`;

  // ===== GOM TẤT CẢ THEO KHU → TẦNG, mỗi phòng MỘT THẺ ĐẦY ĐỦ — CÙNG khuôn với tab Phòng khám
  // (user chốt 2026-08-17: "dùng cho cả phòng khám và phòng siêu âm, phòng của khoa Chẩn đoán hình
  // ảnh"). Trước đây trong khu: phòng ùn nặng = THẺ · còn lại = DÒNG gọn `clsRestRow`. Dòng gọn bỏ
  // mất nút thắt tách bạch (chờ tiếp nhận / đang làm), ô khối lượng đã xong, và thanh so sánh.
  // #N vẫn là hạng TOÀN VIỆN trong nhóm ùn nặng.
  const rankOf = new Map(nong.map((r, i) => [r.key, i + 1]));
  const byKhu = {};
  rooms.forEach(r => { const k = r.khu || KHU_KHAC; (byKhu[k] = byKhu[k] || []).push(r); });
  const order = ((cls.khu_order && cls.khu_order.length) ? cls.khu_order : Object.keys(byKhu)).slice();
  Object.keys(byKhu).forEach(k => { if (!order.includes(k)) order.push(k); });

  // Bỏ dòng bối cảnh — 3 thẻ KPI ngay trên đã nói đủ (xem ghi chú cùng việc ở renderRooms).
  let html = "";

  order.forEach(khu => {
    const list = byKhu[khu];
    if (!list || !list.length) return;
    const red = list.filter(r => clsLevelOf(r) === "red");   // đếm ở dòng tổng khu
    const label = (cls.khu_labels && cls.khu_labels[khu]) || khu;
    const tot = list.reduce((s, r) => s + (r.ton_dong || 0), 0);
    // Thanh chuẩn hóa theo phòng nặng nhất CỦA KHU, SÀN = CLS_RED (ngưỡng ùn nặng): nay mọi phòng
    // đều có thẻ, nên khu nhẹ nhất (max 6 ca) mà chuẩn theo chính nó thì phòng 6 ca vẽ thanh ĐẦY
    // 100% — mắt đọc ra "phòng này ùn" trong khi nó đang xanh. Cùng luật với maxW của tab Phòng khám.
    const maxT = Math.max(CLS_RED, list.reduce((m, r) => Math.max(m, r.ton_dong || 0), 0));
    html += `<section class="khu-block ${khuSlug(khu)}">
      <div class="khu-head"><span class="khu-tag ${khuSlug(khu)}-tag">${khuTag(khu)}</span>
        <h2 class="khu-title">${label}</h2>
        <span class="khu-sum">${list.length} phòng · <b>${fmt(tot)}</b> ca chưa xong`
      + (red.length ? ` · <b class="k-red">${red.length} ùn nặng</b>` : "")
      + `</span></div>`;
    // Gom theo TẦNG — CÙNG luật với tab Phòng khám (§5b/§12.8): mỗi tầng một cụm riêng, thứ tự =
    // đường đi thực địa trệt→1→2→3→4, "chưa rõ tầng" xuống CUỐI. Gom theo TẦNG chứ KHÔNG theo
    // khoa·tầng: một tầng có nhiều khoa → gom theo khoa·tầng thì cùng một tầng bị xé làm 2 cụm.
    // ⚠️ MỌI phòng của khu đều vào đây (không tách thẻ ùn nặng lên đầu khu): tách ra thì phòng nặng
    // nhất bị RÚT KHỎI TẦNG của nó. Trong tầng xếp nặng → nhẹ nên phòng cần can thiệp vẫn đứng đầu.
    {
      const byTang = new Map();
      list.forEach(r => {
        const k = tangNum(tangText(r));
        const kk = (k === null ? "?" : k);
        if (!byTang.has(kk)) byTang.set(kk, []);
        byTang.get(kk).push(r);
      });
      [...byTang.keys()]
        .sort((a, b) => (a === "?" ? 9999 : a) - (b === "?" ? 9999 : b))
        .forEach(k => {
          const g = byTang.get(k).sort((a, b) => (b.ton_dong || 0) - (a.ton_dong || 0));
          const gt = g.reduce((s, r) => s + (r.ton_dong || 0), 0);
          const gRed = g.filter(r => clsLevelOf(r) === "red").length;
          const allVip = g.length > 0 && g.every(r => /VIP/i.test(tangText(r)));
          const lbl = k === "?" ? "Chưa rõ tầng" : tangLabel(k);
          html += `<div class="khoa-block">
            <div class="khoa-head"><h3 class="khoa-name">${lbl}`
            + (allVip ? `<span class="khoa-chip vip">VIP</span>` : "")
            + `</h3>
              <span class="khoa-sum">${g.length} phòng · <b>${fmt(gt)}</b> ca chưa xong`
            + (gRed ? ` · <b class="k-red">${gRed} ùn nặng</b>` : "")
            + `</span></div>
            <div class="rooms-grid">${g.map(r => clsRoomCard(r, rankOf.get(r.key), maxT, cls.khu_labels, r.khoa || "")).join("")}</div>
          </div>`;
        });
    }
    html += `</section>`;
  });

  wrap.innerHTML = html;

  // Dải hành động + huy hiệu tab nói theo trục PHÒNG (ghi đè bản theo-nhóm-kỹ-thuật của renderSvcTab).
  if (nong.length) {
    const top = nong[0];
    const hint = (top.cho_tiep_nhan && top.da_tiep_nhan) ? "tiếp nhận ngay + đẩy nhanh ca đang làm"
               : top.cho_tiep_nhan ? "phân công người tiếp nhận" : "đẩy nhanh trả kết quả";
    actionBand("cls-action", "red", `Ưu tiên ${top.name}: ${fmt(top.ton_dong)} ca chưa có kết quả`,
      nong.slice(1, 4).map(r => ({ name: r.name, n: r.ton_dong, note: "ca" })), hint);
  } else {
    actionBand("cls-action", "ok", "Không phòng nào ùn — CĐHA thông suốt.", [], "");
  }
  setTabBadge("badge-cls", nong.length, "red");
}

// ====== BỐ TRÍ PHÒNG THEO KHUNG GIỜ — cung ⇄ cầu (user chốt 2026-08-17) ======
// Trả lời: "mở phòng khám và phòng siêu âm có tương thích nhau không, có gây ùn ứ không".
//
// ⚠️ TUYỆT ĐỐI KHÔNG DÙNG TRỤC KÉP (2 thang y trong 1 khung). Đây là lỗi biểu đồ bị phản đối
//    nhiều nhất trong ngành: Stephen Few (Perceptual Edge) kết luận không có tình huống nào biện
//    minh được; FT Visual Vocabulary ghi thẳng "be careful… beware spurious correlations";
//    Datawrapper/Flourish/PolicyViz đều khuyên thay bằng SMALL MULTIPLES. Ở đây: mỗi panel là một
//    khung riêng, và trong một panel CHỈ đặt các chuỗi CÙNG ĐƠN VỊ (phòng với phòng, người với
//    người) → hai đường trong cùng panel so sánh được thật, không phải trùng hợp do co giãn thang.
// ⚠️ Cột (không phải đường): số liệu là ẢNH CHỤP GOM THEO KHUNG GIỜ (rời rạc). Đường nối ngụ ý đo
//    liên tục — sai bản chất. Cột cũng vẽ được "giờ không có số liệu" thành khoảng trống thật.
// ⚠️ Màu: chỉ dùng token thương hiệu `--brand-blue-dark` (phòng khám) và `--brand-pink` (siêu âm).
//    Cặp này đã ĐO bằng trình kiểm mù màu: ΔE 16,6 (protan) — gấp đôi ngưỡng sàn 8. KHÔNG mượn màu
//    RAG (đỏ/cam/xanh lá) làm màu chuỗi: chúng dành riêng cho mức cảnh báo (brand-kit §5).
const BTR_DV = { phong: "phòng", nguoi: "người", ca: "ca" };

// KHU DÙNG CHUNG PHÒNG SIÊU ÂM → BẢNG SỐ gộp làm một (user chốt 2026-08-17: *"khu KM và khu M gom
// chung 1 bảng… tôi đang quan tâm số tổng. Vì số phòng khám khu M và khu KM dùng chung số lượng
// phòng siêu âm ở khu KM"*). Với người điều phối, KM và M là MỘT vùng phục vụ: người bệnh khám ở
// cả hai tòa đều sang phòng siêu âm bên KM ⇒ đọc số tách rời thì Khu M trông như không có năng lực
// siêu âm, còn Khu KM trông như phải gánh gấp đôi phần của nó.
// ⚠️ CHỈ gộp Ở BẢNG SỐ. Biểu đồ cột và lưới khu·tầng vẫn TÁCH từng khu, vì chúng trả lời câu "đi
//    tòa nào, lầu nào" — đúng cái lý do dự án đã tách Nhà KM khỏi Nhà M ngày 17/07 (§5b: gộp 2 tòa
//    vào một hàng là đi nhầm tòa). Gộp số ≠ gộp đường đi.
// ⚠️ Tên khu phải viết Y HỆT `toaNha` mà scraper xuất ra ("Nhà KM"), không phải nhãn hiển thị
//    ("Khu KM") — khớp sai thì nhóm lặng lẽ không thành, bảng vẫn ra 2 cái như cũ.
const BTR_KHU_GOP = [["Nhà KM", "Nhà M"]];

// ====== CHỌN THỜI GIAN: hôm nay · khoảng ngày · tháng (user chốt 2026-08-17) ======
// "dò lại ngày phải có THỨ để coi quy luật" → mọi chỗ hiện ngày đều kèm thứ trong tuần.
const BTR_THU = { 1: "T2", 2: "T3", 3: "T4", 4: "T5", 5: "T6", 6: "T7", 7: "CN" };
const BTR_THU_DAI = { 1: "Thứ 2", 2: "Thứ 3", 3: "Thứ 4", 4: "Thứ 5", 5: "Thứ 6",
                      6: "Thứ 7", 7: "Chủ nhật" };
let _btrChon = null;      // {loai:'hom_nay'|'7ngay'|'thang'|'tu_chon', tu, den}

function btrDocChon() {
  if (_btrChon) return _btrChon;
  try { _btrChon = JSON.parse(localStorage.getItem("btr_chon") || "null"); } catch (e) {}
  return (_btrChon = _btrChon || { loai: "hom_nay" });
}
function btrLuuChon(x) {
  _btrChon = x;
  try { localStorage.setItem("btr_chon", JSON.stringify(x)); } catch (e) {}
}

// Chuỗi nén "24,65,,," → [24,65,null,null] (xem _nen() bên scraper). Rỗng = KHÔNG ĐO ĐƯỢC,
// tuyệt đối không quy về 0.
function btrTach(s) {
  if (Array.isArray(s)) return s;
  return String(s == null ? "" : s).split(",").map(x => x === "" ? null : Number(x));
}

// TRUNG VỊ (không phải trung bình): một ngày lỗi mốc hoặc một ngày lễ vắng bất thường sẽ kéo
// trung bình đi, còn trung vị thì không. Bỏ qua giờ không đo được của từng ngày.
function btrTrungVi(vals) {
  const v = vals.filter(x => x != null && !isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 10) / 10;
}

function btrNgayChon(bt) {
  const ls = bt.lich_su || [];
  if (!ls.length) return [];
  const ch = btrDocChon();
  const het = ls.map(x => x.ngay);
  const cuoi = het[het.length - 1];
  if (ch.loai === "hom_nay") return [cuoi];
  if (ch.loai === "7ngay") return het.slice(-7);
  if (ch.loai === "thang") return het.filter(d => d.slice(0, 7) === cuoi.slice(0, 7));
  const tu = ch.tu || het[0], den = ch.den || cuoi;
  return het.filter(d => d >= tu && d <= den);
}

// Gộp nhiều ngày → MỘT hồ sơ ngày điển hình. Tỷ số tính TỪ TRUNG VỊ (chứ không lấy trung vị của
// các tỷ số): giữ đúng quan hệ "người chờ ÷ phòng mở" của con số đang hiển thị ngay bên trên.
function btrGop(bt, ngays) {
  const ls = (bt.lich_su || []).filter(x => ngays.includes(x.ngay));
  const N = bt.gio.length;
  const gop = (lay) => {
    const out = [];
    for (let i = 0; i < N; i++) out.push(btrTrungVi(ls.map(x => btrTach(lay(x))[i])));
    return out;
  };
  const ty = (a, b) => a.map((v, i) => (v == null || !b[i]) ? null
    : Math.round((v / b[i]) * 10) / 10);
  // ⚠️ GIỜ ĐUÔI NGÀY LÀM PHÉP CHIA NỔ TUNG — đã dính thật: 19h còn 129 người chờ mà chỉ giải quyết
  // được 1 ca ⇒ "129 giờ mới giải toả"; 18h còn 3,5 phòng mở ⇒ "37,6 người/phòng". Cả hai đúng về
  // số học nhưng SAI về nghĩa: lúc đó phòng khám đang đóng cửa, hàng còn lại chuyển sang hôm sau
  // chứ không phải đang được giải quyết với nhịp đó. Chỉ tính tỷ số ở GIỜ HOẠT ĐỘNG CHÍNH —
  // giờ mà số phòng mở đạt ≥25% mức cao nhất của chính bên đó trong ngày.
  const chinh = (mo) => {
    const mx = Math.max(...mo.filter(v => v != null), 0);
    return mo.map(v => v != null && mx > 0 && v >= mx * 0.25);
  };
  const loc = (arr, ok) => arr.map((v, i) => ok[i] ? v : null);
  // `lays` = một hoặc NHIỀU hàm, mỗi hàm trả {mo,cho,xong} của một ngày (null nếu ngày đó không có
  // nhóm này). Nhiều hàm = GỘP nhiều khu (xem BTR_KHU_GOP): CỘNG số gốc theo từng giờ trước, rồi
  // mới lấy trung vị nhiều ngày, rồi mới chia tỷ số — KHÔNG cộng/bình quân các TỶ SỐ (cùng lý do
  // đã ghi ở đầu hàm: giữ đúng quan hệ "người chờ ÷ phòng mở" của chính con số đang hiển thị).
  // ⚠️ Cộng `null + số` phải ra SỐ, không ra null: khu này chưa có mốc thu mà khu kia có thì tổng
  //    vẫn là sự thật quan sát được. Chỉ khi CẢ HAI rỗng mới để null (missing ≠ 0 — luật 5).
  const benTu = (...lays) => {
    const g = (f) => {
      // Tách chuỗi MỘT LẦN cho mỗi (ngày × khu), đừng tách lại trong vòng lặp giờ.
      const cot = ls.map(x => lays.map(lay => { const o = lay(x); return o ? btrTach(o[f]) : null; }));
      const out = [];
      for (let i = 0; i < N; i++) {
        out.push(btrTrungVi(cot.map(ds => {
          let t = null;
          ds.forEach(a => { if (a && a[i] != null) t = (t == null ? 0 : t) + a[i]; });
          return t;
        })));
      }
      return out;
    };
    const mo = g("mo"), cho = g("cho"), xong = g("xong");
    const ok = chinh(mo);
    // ⚠️ ĐẢO LẠI quyết định cũ (bản trước KHÔNG lọc `moi_phong`, lý lẽ: "nó là sự thật quan sát
    // được, không phải suy ra tốc độ"). Lý lẽ đúng nhưng HẬU QUẢ TRÊN MÀN HÌNH thì sai — đo thật
    // 17/08: 17h còn 3/71 phòng khám mở với 206 người ⇒ 68,7 người/phòng, gấp 3,4 lần đỉnh thật
    // (20,4). Ba hỏng cùng lúc:
    //   1. Thang đo panel nổ tung ⇒ MỌI giờ hoạt động chính bị nén còn 30% chiều cao (đo px: 7h–15h
    //      cột chỉ 8–26px, cột 17h 89px) — đúng lý do người dùng báo "khó phân biệt".
    //   2. Nhãn đỉnh vẽ ra "68,7 ⇄ 20,4" trong khi dòng chữ NGAY TRÊN nói "phòng khám 17 · siêu âm
    //      20,4" ⇒ một màn hình hai con số cho cùng một việc.
    //   3. Biểu đồ kể NGƯỢC câu chuyện: ở giờ hoạt động chính SIÊU ÂM mới là bên nặng hơn.
    // Bảng số cũng đã in "—" cho 2 cột tỷ số kia ở 16h–17h ⇒ để riêng cột này có số là tự mâu thuẫn
    // trong cùng một bảng, và trái luật §12.11 ("tỷ số CHỈ tính ở giờ hoạt động chính").
    // Giờ bị loại KHÔNG bị giấu: panel vẽ ô CHẤM MỜ riêng + nói lý do (luật 14) — xem `btrPanel`.
    return { mo, cho, xong, gio_chinh: ok,
             moi_phong: loc(ty(cho, mo), ok),
             nang_suat: loc(ty(xong, mo), ok),
             giai_toa: loc(ty(cho, xong), ok) };
  };
  const ben = (k) => benTu(x => x[k]);
  // TỪNG KHU MỘT BẢNG (user chốt). Đừng sắp theo mức nặng — khối sẽ đảo chỗ mỗi vòng lấy số.
  // ⚠️ Thứ tự KHOÁ của `x.khu` KHÔNG phải thứ tự đi thực địa: nó là thứ tự scraper GẶP PHÒNG khi
  //    quét (đo thật 2026-08-17: ra "Nhà N · Nhà M · Nhà KM" trong khi đường đi là KM → M → N).
  //    Phải sắp lại theo `bt.khu` — mảng ĐÓ mới do scraper xuất theo TOA_NHA_ORDER. Khu lạ không có
  //    trong `bt.khu` xuống chót (đừng để `indexOf` trả −1 rồi nhảy lên đầu).
  const thuTu = (bt.khu || []).map(z => z.khu);
  const viTri = (k) => (thuTu.indexOf(k) < 0 ? 99 : thuTu.indexOf(k));
  const tenKhu = Object.keys((ls[0] && ls[0].khu) || {}).sort((a, b) => viTri(a) - viTri(b));
  const timKhu = (k) => (bt.khu || []).find(z => z.khu === k) || {};
  const motKhu = (ks) => ({
    ten: ks.join(" + "),
    nhan: ks.map(k => timKhu(k).khu_nhan || k).join(" + "),
    n_khu: ks.length,
    pk: benTu(...ks.map(k => (x => ((x.khu || {})[k] || {}).pk))),
    sa: ls.some(x => ks.some(k => ((x.khu || {})[k] || {}).sa))
      ? benTu(...ks.map(k => (x => ((x.khu || {})[k] || {}).sa))) : null,
    n_sa: ks.reduce((s, k) => s + (timKhu(k).sa || 0), 0),
  });
  // GỘP các khu dùng chung phòng siêu âm (BTR_KHU_GOP). Sắp mỗi nhóm theo thứ tự `tenKhu` rồi dựng
  // bảng ở THÀNH VIÊN ĐẦU TIÊN → bảng gộp nằm đúng chỗ khu đầu tiên của nó, thứ tự đi thực địa
  // không bị đảo; các thành viên sau bị bỏ qua vì số của chúng đã nằm trong bảng gộp.
  const nhom = (typeof BTR_KHU_GOP === "undefined" ? [] : BTR_KHU_GOP)
    .map(g => g.filter(k => tenKhu.includes(k))
                .sort((a, b) => tenKhu.indexOf(a) - tenKhu.indexOf(b)))
    .filter(g => g.length > 1);
  const trongNhom = new Set(nhom.flat());
  const khu = [];
  tenKhu.forEach(k => {
    const g = nhom.find(x => x[0] === k);
    if (g) khu.push(motKhu(g));
    else if (!trongNhom.has(k)) khu.push(motKhu([k]));
  });
  const cum = (bt.pk.cum || []).map((cm, j) => ({ ...cm, mo: gop(x => (x.cum || [])[j]) }));
  // `gio` đi kèm để V tự đủ dùng — btrGioHien()/btrBang() nhận V, không được buộc phải cầm thêm
  // `bt` mới biết dải giờ (hai nguồn cho một sự thật là chỗ sinh ra lệch).
  return { gio: bt.gio, pk: { ...ben("pk"), cum }, sa: ben("sa"), khu, n_ngay: ls.length,
           ngays: ls.map(x => ({ ngay: x.ngay, thu: x.thu })) };
}

function btrMax(arrs) {
  let m = 0;
  arrs.forEach(a => (a || []).forEach(v => { if (v != null && v > m) m = v; }));
  return m || 1;
}

function btrSo(v, le) {
  if (v == null) return "—";
  return le ? String(v).replace(".", ",") : fmt(v);
}

// CẮT khoảng giờ CHƯA TỚI ở hai đầu. Vẽ trọn 6h–20h lúc mới 14h thì gần nửa bề ngang là ô trống,
// cột bị ép mỏng dính — đo thật trên 1440px: bỏ đuôi rỗng làm mỗi cột rộng gần GẤP ĐÔI.
// Vẫn giữ khoảng trống Ở GIỮA (mốc thu lỗi) vì đó là thông tin thật, khác hẳn "chưa tới giờ".
function btrGioHien(bt) {
  const ds = [bt.pk.mo, bt.sa.mo, bt.pk.cho, bt.sa.cho, bt.pk.xong, bt.sa.xong];
  const co = (i) => ds.some(a => a && a[i] != null);
  let lo = 0, hi = bt.gio.length - 1;
  while (lo <= hi && !co(lo)) lo++;
  while (hi >= lo && !co(hi)) hi--;
  if (lo > hi) return { lo: 0, hi: bt.gio.length - 1, gio: bt.gio };
  return { lo, hi, gio: bt.gio.slice(lo, hi + 1) };
}

// Một panel = một khung, tối đa 2 chuỗi. `series[i].arr` cùng độ dài với `gio`.
// ⚠️ BA TRẠNG THÁI Ô RỖNG, mỗi trạng thái một HOA VĂN riêng (user chốt 17/08: "một là một màu, hai
// là sọc sọc, ba là chấm chấm" — nguyên tắc đúng, nhưng phải áp vào chỗ nó GIẢI QUYẾT được việc):
//   · có số      → cột ĐẶC, màu theo chuỗi
//   · chưa đo được → GẠCH CHÉO (`.btr-na`)   — HIS chưa có mốc thu ở giờ đó
//   · có số mà tỷ số vô nghĩa → CHẤM (`.btr-ngoai`) — ngoài giờ hoạt động chính
// Hai cái sau KHÔNG được dùng chung hoa văn: gộp lại thì "chưa đo được" và "đo được nhưng không
// chia được" đọc y hệt nhau, mà chúng là hai kết luận vận hành khác hẳn.
// Ngược lại, KHÔNG đổ hoa văn cho hai CHUỖI (phòng khám ⇄ siêu âm): chúng đã tách bằng MÀU (đo mù
// màu ΔE 16,6 protan) + VỊ TRÍ cố định (khám luôn cột trái). Đổ thêm hoa văn ở đó thì cột sọc va
// nghĩa với ô "chưa đo được" ngay bên cạnh, và cột chỉ rộng 26px desktop / 16px ĐT nên sinh moiré.
function btrPanel(cfg) {
  const { tieu_de, don_vi, gio, series, le, nhan, ngoai, goi_y, dv_truc } = cfg;
  const max = btrMax(series.map(s => s.arr));
  // Đỉnh của chuỗi ĐẦU TIÊN → nhãn trực tiếp (không bắt người đọc rê chuột mới biết số cao nhất).
  const dinhIdx = series.map(s => {
    let bi = -1, bv = -Infinity;
    (s.arr || []).forEach((v, i) => { if (v != null && v > bv) { bv = v; bi = i; } });
    return bi;
  });
  let cols = "", coNa = false, coNgoai = false;
  gio.forEach((h, i) => {
    const co = series.some(s => s.arr && s.arr[i] != null);
    if (!co) {
      // GIỜ CHƯA TỚI / KHÔNG ĐO ĐƯỢC — vẽ TRỐNG có gạch chéo, KHÔNG vẽ cột 0. Vẽ 0 là khẳng định
      // "giờ đó không có phòng nào mở / không ai chờ", trong khi sự thật là chưa có số (luật 5).
      const ng = ngoai && ngoai[i];
      if (ng) { coNgoai = true; cols += `<div class="btr-col btr-ngoai" title="${esc(ng)}"></div>`; }
      else { coNa = true; cols += `<div class="btr-col btr-na" title="${h}h — chưa có số liệu"></div>`; }
      return;
    }
    // Đơn vị ghi THEO TỪNG CHUỖI: hai chuỗi trong panel cùng THANG ĐO nhưng khác danh từ
    // ("người chờ" ⇄ "ca chưa xong"). Ghép chung thành "người · ca" thì mỗi con số đọc ra hai
    // nghĩa — đúng lỗi nhãn mơ hồ mà ngon-ngu-ui.md cấm.
    const tip = `${h}h · ` + series.map(s =>
      `${s.ten}: ${btrSo(s.arr ? s.arr[i] : null, le)} ${s.dv || don_vi || ""}`.trim()).join(" · ");
    let bars = "";
    series.forEach((s, si) => {
      const v = s.arr ? s.arr[i] : null;
      if (v == null) { bars += `<i class="btr-b btr-trong"></i>`; return; }
      // Sàn 2% để giá trị >0 không biến mất hẳn; giá trị 0 thật thì để vạch mảnh sát đáy.
      const pc = v > 0 ? Math.max(2, (v / max) * 100) : 0;
      const nhan = (si === 0 && i === dinhIdx[0]) || (si === 1 && i === dinhIdx[1])
        ? `<u class="btr-dinh">${btrSo(v, le)}</u>` : "";
      bars += `<i class="btr-b ${s.cls}" style="height:${pc.toFixed(1)}%">${nhan}</i>`;
    });
    cols += `<div class="btr-col" title="${esc(tip)}">${bars}</div>`;
  });
  // ĐƠN VỊ ĂN MÀU CỦA CHÍNH CHUỖI, không để `--muted` như bản trước: cùng một màu xanh mang BA nghĩa
  // qua ba panel (người/phòng · phòng · người) mà đơn vị lại in màu xám trung tính ⇒ mắt không nối
  // được "màu này ⇄ đơn vị nào". Tô màu là buộc đơn vị ⇄ màu ⇄ chuỗi thành một khối, khỏi phải dò.
  // ⚠️ Dùng token CHỮ riêng (`--brand-pink-text`), KHÔNG dùng `--brand-pink-dark`: đo được 3,87:1
  // trên nền trắng, hụt ngưỡng 4,5:1 của WCAG 1.4.3 cho chữ 11,5px.
  const chu = series.map(s =>
    `<span class="btr-key"><i class="btr-sw ${s.cls}"></i>${esc(s.ten)}`
    + (s.dv ? ` <em class="${s.cls === "btr-pk" ? "btr-tpk" : "btr-tsa"}">(${esc(s.dv)})</em>` : "")
    + `</span>`).join("")
    // Chú giải ô rỗng chỉ hiện khi trạng thái đó THẬT SỰ có mặt trong panel — in sẵn cả hai ở mọi
    // panel là dạy người đọc một thứ họ không nhìn thấy, và làm hàng chú giải dài gấp đôi.
    + (coNa ? `<span class="btr-key"><i class="btr-sw btr-na"></i>chưa có số liệu</span>` : "")
    + (coNgoai ? `<span class="btr-key"><i class="btr-sw btr-ngoai"></i>ngoài giờ hoạt động chính`
                 + `</span>` : "");
  // TRỤC DỌC + LƯỚI NGANG: bản đầu không có, nên ngoài cột đỉnh ra thì KHÔNG cột nào đọc được giá
  // trị — người xem phải rê chuột từng cột (và trên điện thoại thì chịu). 3 mốc là đủ: 0 · giữa ·
  // cao nhất; nhiều hơn thành lưới rối mà không thêm thông tin.
  // ĐƠN VỊ LÊN MỐC TRÊN CÙNG CỦA TRỤC — bản trước trục chỉ có SỐ TRẦN ở cả 3 panel (đo: panel "Số
  // người đang chờ" không có đơn vị ở BẤT KỲ đâu ngoài ngoặc 11,5px trong chú giải). Chỉ ghi ở mốc
  // trên cùng: lặp ở cả 3 mốc là nhiễu, mà đọc một mốc là đủ suy ra cả trục.
  const nhanY = [max, max / 2, 0].map((v, k) =>
    `<span>${btrSo(le ? Math.round(v * 10) / 10 : Math.round(v), le)}`
    + (k === 0 && dv_truc ? `<i>${esc(dv_truc)}</i>` : "") + `</span>`).join("");
  // Panel có HAI ĐƠN VỊ khác nhau trên CHUNG một thang đo thì phải NÓI RA (luật 14): đặt cạnh nhau
  // là tự mời người đọc so chiều cao, mà "người chờ khám" ⇄ "ca siêu âm chưa xong" không quy đổi
  // được cho nhau. Thứ so được là NHỊP theo giờ (đỉnh rơi vào lúc nào) — chính là câu hỏi của khối.
  const dvKhac = series.filter(s => s.dv).length > 1 && series[0].dv !== series[1].dv;
  const uHtml = [goi_y ? `<i>${esc(goi_y)}</i>` : "",
                 dvKhac ? "hai đơn vị khác nhau — so nhịp theo giờ, đừng so chiều cao"
                        : (don_vi ? `đơn vị: ${esc(don_vi)}` : "")].filter(Boolean).join(" · ");
  return `<div class="btr-panel${nhan ? " btr-nhanmanh" : ""}">
      <div class="btr-h"><span class="btr-t">${esc(tieu_de)}</span>
        <span class="btr-legend">${chu}</span>
        <span class="btr-u">${uHtml}</span></div>
      <div class="btr-body"><div class="btr-y">${nhanY}</div>
        <div class="btr-plot">${cols}</div></div>
    </div>`;
}

// Lưới small-multiples: mỗi cụm KHU · TẦNG một ô, DÙNG CHUNG một thang đo → so được cụm với cụm.
function btrLuoi(bt, H) {
  const cum = (bt.pk.cum || []).map(c => ({
    ...c,
    mo: (c.mo || []).slice(H.lo, H.hi + 1),
    mo_sa: (c.mo_sa || []).slice(H.lo, H.hi + 1),
  }));
  if (!cum.length) return "";
  const gioH = H.gio;
  // MỘT THANG ĐO CHUNG cho cả phòng khám lẫn siêu âm, cả 12 ô: đó là điều kiện để so ô này với ô
  // kia. Thang riêng từng ô thì cột cao bằng nhau trong khi số thực chênh 10 lần.
  const max = btrMax(cum.map(c => c.mo).concat(cum.map(c => c.mo_sa)));
  let html = "", khuTruoc = null;
  cum.forEach(c => {
    if (c.khu !== khuTruoc) {
      // ⚠️ ĐÓNG CẢ HAI thẻ (.btr-cells VÀ .btr-khu). Bản trước chỉ đóng một → mỗi khu mới LỒNG vào
      //    khu trước, và `.btr-grid` không bao giờ được đóng ⇒ trình duyệt tự đóng ở cuối chuỗi, kéo
      //    theo cả BẢNG SỐ (`btrBangKhu` dựng ngay sau) vào NẰM TRONG lưới khu·tầng. Đo thật cây
      //    DOM: TABLE → .btr-scroll → .btr-bang → .btr-khu → .btr-khu → .btr-grid. Đọc mã không
      //    thấy — chỉ lộ ra khi đi ngược cây cha để tìm màu nền.
      if (khuTruoc !== null) html += `</div></div>`;
      html += `<div class="btr-khu"><h4>${esc(c.khu_nhan)}</h4><div class="btr-cells">`;
      khuTruoc = c.khu;
    }
    // Có phòng siêu âm ở cụm này không — cụm không có thì scraper xuất chuỗi RỖNG (không phải
    // dãy số 0), nhờ vậy phân biệt được "không có phòng" với "có phòng mà đang đóng".
    const coSa = c.n_phong_sa > 0;
    // ⚠️ Cụm CHỈ CÓ PHÒNG SIÊU ÂM là có thật: Nhà KM tầng 2 (11 phòng) và tầng 3 (5 phòng) không có
    //    phòng khám nào. Scraper vẫn xuất `mo` = dãy số 0 cho chúng (giao với tập rỗng), nên phải
    //    chặn ở đây: vẽ cột 0 và in "0/0" xanh đọc ra thành "phòng khám đóng cửa hết", trong khi sự
    //    thật là TẦNG ĐÓ KHÔNG CÓ PHÒNG KHÁM (luật 5 — số 0 nói dối im lặng). Đối xứng với `coSa`.
    const coPk = c.n_phong > 0;
    let cols = "";
    gioH.forEach((h, i) => {
      const v = coPk ? c.mo[i] : null, w = coSa ? c.mo_sa[i] : null;
      // `return` chứ KHÔNG `continue`: đây là callback của forEach, không phải thân vòng lặp —
      // `continue` ở đây là LỖI CÚ PHÁP, và nó làm VỠ TOÀN BỘ app.js (cả 3 tab trắng, không chỉ
      // biểu đồ này). Cùng cách viết với btrBang() ngay dưới.
      // ⚠️ Ô "chưa tới giờ" KHÔNG được mang lớp .btr-mc: .btr-mc khai nền xanh SAU .btr-na nên
      // đè mất gạch chéo → ô rỗng vẽ thành CỘT XANH CAO NHẤT, đọc thành "8 giờ tối phòng nào
      // cũng mở" (chỉ lộ ra khi CHỤP ẢNH — bài kiểm đếm số không thấy).
      if (v == null && w == null) {
        cols += `<i class="btr-mna" title="${h}h — chưa có số liệu"></i>`;
        return;
      }
      const cot = (x, cls) => {
        if (x == null) return "";
        const pc = x > 0 ? Math.max(4, (x / max) * 100) : 0;
        return `<i class="${cls}" style="height:${pc.toFixed(1)}%"></i>`;
      };
      // TOOLTIP TỪNG GIỜ: ô nhỏ 30px không có nhãn trục dọc, nên nếu chỉ có tooltip ở CẢ Ô thì
      // người đọc biết đỉnh là bao nhiêu mà không biết giờ nào cao giờ nào thấp. Ghi rõ "chưa có
      // số" thay vì bỏ trống — trống đọc thành 0 (luật 5).
      const soGio = (x) => (x == null ? "chưa có số" : x);
      const tipGio = `${h}h` + (coPk ? ` · phòng khám ${soGio(v)}` : "")
                             + (coSa ? ` · siêu âm ${soGio(w)}` : "");
      cols += `<span class="btr-mgio" title="${esc(tipGio)}">`
            + `${cot(v, "btr-mc")}${cot(w, "btr-mc-sa")}</span>`;
    });
    const dinh = Math.max(0, ...c.mo.filter(v => v != null));
    const dinhSa = coSa ? Math.max(0, ...c.mo_sa.filter(v => v != null)) : 0;
    const tip = `${c.khu_nhan} · ${c.tang || "chưa rõ tầng"} — `
      + (coPk ? `phòng khám ${c.n_phong} (cao nhất ${dinh} cùng hoạt động)`
              : "không có phòng khám")
      + (coSa ? ` · phòng siêu âm ${c.n_phong_sa} (cao nhất ${dinhSa} cùng hoạt động)`
              : " · không có phòng siêu âm");
    // ⚠️ SỐ PHẢI CÓ CHỮ ĐI KÈM, đừng để mỗi màu phân biệt (WCAG 1.4.1): trước đây ô ghi "6/7  2/4"
    //    và người đọc phải nhớ "xanh = phòng khám, hồng = siêu âm" từ dòng chú giải phía trên —
    //    trên điện thoại không rê chuột được nên tooltip không cứu được. Nay mỗi số tự nói nó là gì.
    // Nhãn hai đầu trục giờ: 10 cột trong ô 30px cao mà không có mốc thời gian nào thì thấy hình
    // dạng mà không biết cao ở giờ nào. Chỉ in giờ ĐẦU và CUỐI — in đủ 10 mốc là chữ đè lên nhau.
    html += `<div class="btr-cell" title="${esc(tip)}">
        <div class="btr-cn">${esc(c.tang || "Chưa rõ tầng")}</div>
        <div class="btr-cso">
          ${coPk ? `<span class="btr-cs">${dinh}/${c.n_phong}<i>khám</i></span>` : ""}
          ${coSa ? `<span class="btr-cs sa">${dinhSa}/${c.n_phong_sa}<i>siêu âm</i></span>` : ""}
        </div>
        <div class="btr-mplot">${cols}</div>
        <div class="btr-mtruc"><span>${gioH[0]}h</span><span>${gioH[gioH.length - 1]}h</span></div>
      </div>`;
  });
  // NÓI RA THANG ĐO. Chú giải cũ chỉ ghi "dùng chung một thang đo" mà không cho biết thang đó là
  // bao nhiêu ⇒ so được ô này với ô kia nhưng KHÔNG đọc được giá trị của bất kỳ cột nào. Một con số
  // là đủ: cột chạm nóc = bao nhiêu phòng.
  // Đóng nốt .btr-cells + .btr-khu của khu CUỐI, rồi mới đóng .btr-grid — đủ 3 thẻ, cân bằng.
  return `<p class="btr-thang">Cột chạm nóc ô = <b>${max} phòng</b> — mọi ô dùng chung thang đo này,
      nên so được tầng này với tầng kia.</p>
    <div class="btr-grid">${html}${khuTruoc !== null ? "</div></div>" : ""}</div>`;
}

// Bảng số — BẮT BUỘC có: trên điện thoại không rê chuột được nên tooltip vô dụng, và người đọc
// cần con số chính xác chứ không chỉ chiều cao cột (chuẩn tiếp cận: mọi biểu đồ phải có bản bảng).
// MỘT BẢNG CHO MỖI KHU (user chốt 2026-08-17) + một bảng tổng khớp với biểu đồ ở trên.
// Khu không có phòng siêu âm thì KHÔNG vẽ 6 cột rỗng — nói thẳng bằng chữ, đừng để người đọc
// nhìn một hàng dấu "—" rồi tưởng mất số liệu (luật 5 · 14).
// ⚠️ LUÔN MỞ, KHÔNG có nút thu gọn (user chốt 2026-08-17, cùng lượt với nút gập của cả khối):
//    trước đây là `<details><summary>Xem bảng số theo từng khu</summary>`. Bảng số là BẢN CHỮ của
//    biểu đồ ngay trên (chuẩn tiếp cận) — gập nó lại thì người không rê chuột được phải bấm mới
//    đọc được con số, tức đúng thứ nó sinh ra để phục vụ. `.btr-bang` nay là <div>, không phải
//    <details> ⇒ ĐỪNG thêm <summary> trở lại (style của summary đã xoá khỏi style.css).
function btrBangKhu(bt, V, mot) {
  // ⚠️ Số khu lấy TỪ DỮ LIỆU, đừng gõ cứng "Cả 3 khu": khi gộp KM+M thì `V.khu` chỉ còn 2 phần tử
  //    trong khi vẫn là 3 tòa nhà, và gỡ `KHU_HIEN_THI` là thành 8 tòa — chữ gõ cứng sẽ nói sai.
  const nKhu = (bt.khu || []).length || (V.khu || []).length;
  const cai = [{ nhan: `Cả ${nKhu} khu`, pk: V.pk, sa: V.sa, tong: true }]
    .concat((V.khu || []).map(k => ({ nhan: k.nhan, pk: k.pk, sa: k.sa, n_sa: k.n_sa,
                                      n_khu: k.n_khu })));
  return `<div class="btr-bang">
    <h3 class="btr-h3">Bảng số theo từng khu</h3>
    ${cai.map(x => btrMotBang(bt, x, mot)).join("")}
    <p class="btr-note">“Giải toả” = số người đang chờ ÷ tốc độ giải quyết của chính giờ đó —
      tức <b>với nhịp làm việc lúc đó thì bao lâu mới hết hàng</b>. Ô “—” là giờ chưa đo được
      (chưa có mốc thu, chưa làm xong ca nào, hoặc ngoài giờ hoạt động chính nên tỷ số không có
      nghĩa).</p></div>`;
}

function btrMotBang(bt, x, mot) {
  const V = { pk: x.pk, sa: x.sa };
  const coSa = !!x.sa;
  // Bảng GỘP phải NÓI RA là gộp và vì sao (luật 14): người đọc thấy "Khu KM + Khu M" mà không có
  // lời giải thích thì không biết số đã cộng lại hay chỉ là hai khu xếp cạnh nhau.
  const gop = x.n_khu > 1;
  // ⚠️ Ghép bằng MẢNG rồi join(" "), đừng nối chuỗi thẳng: bản trước dính liền thành
  // "Khu KM + Khu M— 17 phòng siêu âm— số đã cộng lại…" (thiếu dấu cách trước mỗi gạch ngang).
  const phu = [];
  if (x.tong) {
    phu.push(`<span>— khớp với biểu đồ ở trên</span>`);
  } else {
    phu.push(coSa ? `<span>— ${x.n_sa} phòng siêu âm</span>`
      : `<span class="btr-nosa">— ${gop ? "các khu này" : "khu này"} không có phòng siêu âm nào</span>`);
    if (gop) phu.push(`<span>— số đã cộng lại vì ${x.n_khu} khu dùng chung phòng siêu âm</span>`);
  }
  const tieu = `<h4 class="btr-bh">${esc(x.nhan)} ${phu.join(" ")}</h4>`;
  return tieu + btrBang(bt, V, mot, coSa);
}

function btrBang(bt, V, mot, coSa) {
  let tr = "";
  // NỀN 2 MÀU tách hai bên (user chốt 2026-08-17): 12 cột số liền nhau thì mắt không biết cột nào
  // thuộc phòng khám, cột nào thuộc siêu âm. Nền dùng ĐÚNG token nhạt của 2 màu chuỗi trên biểu đồ
  // (--brand-blue-50 ⇄ --brand-pink-50) → bảng và biểu đồ nói cùng một ngôn ngữ màu.
  const o = (s, i) => {
    const c = s === "pk" ? "cpk" : "csa";
    return `<td class="${c}">${btrSo(V[s].mo[i], !mot)}</td>`
      + `<td class="${c}">${btrSo(V[s].cho[i], !mot)}</td>`
      + `<td class="${c}">${btrSo(V[s].xong[i], !mot)}</td>`
      + `<td class="${c} btr-r">${btrSo(V[s].moi_phong[i], true)}</td>`
      + `<td class="${c} btr-r">${btrSo(V[s].nang_suat[i], true)}</td>`
      // lớp `btr-gt` để phép nghiệm thu bám vào Ý NGHĨA ô, không bám vào VỊ TRÍ cột (bảng của khu
      // không có siêu âm chỉ 6 cột, bảng khu có siêu âm 12 cột — đếm theo chỉ số là vỡ).
      + `<td class="${c} btr-r btr-gt">${btrSo(V[s].giai_toa[i], true)}</td>`;
  };
  bt.gio.forEach((h, i) => {
    if (V.pk.mo[i] == null && V.pk.cho[i] == null) return;
    tr += `<tr><th>${h}h</th>${o("pk", i)}${coSa ? o("sa", i) : ""}</tr>`;
  });
  // ⚠️ ĐƠN VỊ PHẢI Ở TỪNG CỘT (user báo 17/08: "màu nền giống nhau thì rất khó phân biệt"). Nền
  // `--brand-blue-50` phủ đều SÁU cột mang SÁU đơn vị khác nhau (phòng · người · ca · người/phòng ·
  // ca/phòng/giờ · giờ), mà bản trước chỉ 2/6 tiêu đề có đơn vị ⇒ nền chỉ nói được "cột này thuộc
  // phòng khám", không nói được "cột này đếm cái gì". Đơn vị xuống DÒNG RIÊNG (`.btr-dv`) để tên
  // cột vẫn đọc lướt được thành một hàng.
  // `Ca/phòng/giờ` → `Năng suất`: tên cũ vốn là ĐƠN VỊ đứng nhầm chỗ tiêu đề, nên đọc cả hàng ra
  // năm khái niệm + một đơn vị. Nay mọi cột cùng khuôn "khái niệm ở trên · đơn vị ở dưới".
  const cot = (c, sa) => {
    const u = (t, d) => `<th class="${c}">${t}<i class="btr-dv">${d}</i></th>`;
    return u("Phòng mở", BTR_DV.phong) + u("Đang chờ", sa ? BTR_DV.ca : BTR_DV.nguoi)
      + u("Xong trong giờ", BTR_DV.ca) + u("Chờ/phòng", sa ? "ca/phòng" : "người/phòng")
      + u("Năng suất", "ca/phòng/giờ") + u("Giải toả", "giờ");
  };
  // ĐT: bảng 13 cột rộng ~1.060px trong khung 370px ⇒ phải kéo ngang 693px. Không nói ra thì nửa
  // "Phòng siêu âm" coi như không tồn tại — người dùng chỉ thấy 4 cột và tưởng bảng chỉ có thế
  // (luật 14). Dòng này CSS ẩn trên desktop (ở đó bảng vừa khít, không có gì phải kéo).
  return `<p class="btr-keo">↔ Kéo ngang để xem${coSa ? " nửa <b>Phòng siêu âm</b>" : " hết cột"}</p>
    <div class="btr-scroll"><table>
      <thead><tr><th rowspan="2">Giờ</th><th colspan="6" class="cpk">Phòng khám</th>
        ${coSa ? `<th colspan="6" class="csa">Phòng siêu âm</th>` : ""}</tr>
      <tr>${cot("cpk", false)}${coSa ? cot("csa", true) : ""}</tr></thead>
      <tbody>${tr}</tbody></table></div>`;
}

// Nhận định — CHỈ nói điều đọc thẳng ra từ số, không suy diễn nguyên nhân (R09).
// ⚠️ Tính đỉnh TỪ CHÍNH MẢNG ĐANG VẼ (`V`), không đọc `bt.dinh` do scraper tính sẵn: khi người
// dùng chọn khoảng ngày thì mảng đang vẽ là TRUNG VỊ nhiều ngày, còn `bt.dinh` vẫn là của hôm nay
// ⇒ chữ và biểu đồ nói hai chuyện khác nhau trên cùng một màn hình.
function btrNhanDinh(bt, V) {
  const b = [];
  const dinhCua = (arr) => {
    let bi = -1, bv = -Infinity;
    (arr || []).forEach((v, i) => { if (v != null && v > bv) { bv = v; bi = i; } });
    return bi;
  };
  const ip = dinhCua(V.pk.cho), is = dinhCua(V.sa.cho);
  const dp = ip < 0 ? null : bt.gio[ip], ds = is < 0 ? null : bt.gio[is];
  if (dp != null && ds != null) {
    const lech = ds - dp;
    b.push(lech === 0
      ? `Hai bên cùng đạt đỉnh lúc <b>${dp}h</b>.`
      : `Đỉnh phòng khám <b>${dp}h</b>, đỉnh siêu âm <b>${ds}h</b> — <b>lệch ${Math.abs(lech)} giờ</b>.`);
  }
  // Giờ nặng nhất theo TỶ SỐ (người trên mỗi phòng đang mở) — đó mới là mức chịu tải thật.
  // ⚠️ CHỈ xét GIỜ HOẠT ĐỘNG CHÍNH: cuối buổi còn 3,5 phòng mở với 129 người chờ ra "37,6
  // người/phòng" và cướp mất đỉnh thật lúc 8h — xem ghi chú ở btrGop().
  const nang = (o) => {
    const i = dinhCua(o.moi_phong.map((v, j) => o.gio_chinh[j] ? v : null));
    return i < 0 ? null : { gio: bt.gio[i], v: o.moi_phong[i], mo: o.mo[i] };
  };
  // THỜI GIAN GIẢI TOẢ — trả lời chữ "ùn ứ" bằng đơn vị hành động được (bao lâu mới hết hàng),
  // thay vì bằng số người. Nêu bên TẮC LÂU HƠN trước: đó là nút thắt thật.
  const tac = (o) => {
    const i = dinhCua(o.giai_toa);
    return i < 0 ? null : { gio: bt.gio[i], v: o.giai_toa[i] };
  };
  const tp = tac(V.pk), ts = tac(V.sa);
  if (tp && ts) {
    const pkTac = tp.v >= ts.v;
    const A = pkTac ? { t: "Phòng khám", x: tp } : { t: "Siêu âm", x: ts };
    const B = pkTac ? { t: "siêu âm", x: ts } : { t: "phòng khám", x: tp };
    b.push(`Nút thắt lâu hơn nằm ở <b>${A.t.toLowerCase()}</b> — ${btrSo(A.x.v, true)} giờ mới `
      + `giải toả hết hàng (lúc ${A.x.gio}h), so với ${B.t} ${btrSo(B.x.v, true)} giờ `
      + `(lúc ${B.x.gio}h).`);
  }
  // BỐ TRÍ KHÔNG GIAN — khu có phòng khám mà KHÔNG có phòng siêu âm. Chuỗi theo giờ không nói được
  // điều này, mà nó lại là vế "bố trí có hợp lý không": người bệnh phải đi sang tòa khác.
  const thieu = (bt.khu || []).filter(k => k.pk > 0 && !k.sa);
  if (thieu.length) {
    const co = (bt.khu || []).filter(k => k.sa > 0);
    const nPk = thieu.reduce((s, k) => s + k.pk, 0);
    const tong = (bt.khu || []).reduce((s, k) => s + k.pk, 0);
    b.push(`<b>Bố trí:</b> ${thieu.map(k => `${esc(k.khu_nhan)} (${k.pk} phòng khám)`).join(" và ")}
      không có phòng siêu âm nào — cả ${co.reduce((s, k) => s + k.sa, 0)} phòng siêu âm đều ở
      ${co.map(k => esc(k.khu_nhan)).join(" · ")}. Tức <b>${nPk}/${tong} phòng khám</b>
      phải gửi người bệnh sang tòa khác để siêu âm.`);
  }
  const np = nang(V.pk), ns = nang(V.sa);
  if (np) b.push(`Phòng khám nặng nhất lúc <b>${np.gio}h</b>: ${btrSo(np.v, true)} người/phòng `
    + `(${btrSo(np.mo, true)} phòng mở).`);
  if (ns) b.push(`Siêu âm nặng nhất lúc <b>${ns.gio}h</b>: ${btrSo(ns.v, true)} ca/phòng `
    + `(chỉ ${btrSo(ns.mo, true)} phòng mở).`);
  return b.length ? `<ul class="btr-nd">${b.map(x => `<li>${x}</li>`).join("")}</ul>` : "";
}

// Thanh chọn thời gian + danh sách ngày CÓ KÈM THỨ (user chốt: có thứ mới thấy quy luật).
function btrThanhChon(bt, ngays) {
  const ls = bt.lich_su || [];
  if (ls.length < 2) return "";      // 1 ngày thì không có gì để chọn
  const ch = btrDocChon();
  const het = ls.map(x => x.ngay);
  const nut = (loai, nhan, tip) => `<button type="button" class="btr-mode`
    + `${ch.loai === loai ? " on" : ""}" data-btr-mode="${loai}" title="${esc(tip)}">${nhan}</button>`;
  const cuoi = het[het.length - 1];
  const nThang = het.filter(d => d.slice(0, 7) === cuoi.slice(0, 7)).length;
  const dsNgay = ls.filter(x => ngays.includes(x.ngay)).map(x =>
    `<span class="btr-ng" title="${esc(BTR_THU_DAI[x.thu] + " " + x.ngay)}">`
    + `${BTR_THU[x.thu]} ${x.ngay.slice(8, 10)}/${x.ngay.slice(5, 7)}</span>`).join("");
  return `<div class="btr-chon">
      <span class="btr-clab">Xem:</span>
      ${nut("hom_nay", "Hôm nay", "Chỉ ngày mới nhất có số liệu")}
      ${nut("7ngay", "7 ngày gần nhất", "Trung vị 7 ngày có số liệu gần nhất")}
      ${nut("thang", `Tháng này (${nThang} ngày)`, "Trung vị các ngày trong tháng hiện tại")}
      ${nut("tu_chon", "Từ ngày → đến ngày", "Tự chọn khoảng ngày")}
      <span class="btr-range${ch.loai === "tu_chon" ? "" : " an"}">
        <input type="date" id="btr-tu" min="${het[0]}" max="${cuoi}"
               value="${ch.tu || het[Math.max(0, het.length - 7)]}">
        <span>→</span>
        <input type="date" id="btr-den" min="${het[0]}" max="${cuoi}" value="${ch.den || cuoi}">
      </span>
    </div>
    <div class="btr-ngays"><span class="btr-clab">${ngays.length} ngày:</span>${dsNgay}</div>`;
}

function renderBoTri(bt) {
  const sec = document.getElementById("cls-botri");
  const sub = document.getElementById("cls-botri-sub");
  if (!sec) return;
  if (!bt || !bt.gio || !bt.gio.length) {
    // Không có dữ liệu thì NÓI RA lý do, đừng để khối trắng (trắng trông y hệt "hỏng" — L06).
    sec.innerHTML = `<p class="btr-empty">Chưa dựng được biểu đồ bố trí phòng — cần ít nhất một
      giờ đã chạy trọn trong ngày. Số sẽ hiện sau vòng cập nhật kế tiếp.</p>`;
    if (sub) sub.textContent = "chưa đủ số liệu trong ngày";
    return;
  }
  // CHỌN THỜI GIAN: gộp các ngày được chọn thành MỘT hồ sơ ngày điển hình (trung vị theo giờ).
  // `bt.pk/bt.sa` của scraper chỉ là hôm nay — mọi thứ vẽ ra từ nay đọc `V`, đừng đọc `bt` nữa,
  // kẻo chọn khoảng ngày mà biểu đồ vẫn vẽ hôm nay (mâu thuẫn ngay trên một màn hình).
  const ngays = btrNgayChon(bt);
  const V = btrGop(bt, ngays.length ? ngays : [bt.ngay]);
  const mot = V.n_ngay <= 1;
  const ip = V.pk.cho.reduce((b, v, i) => (v != null && (b < 0 || v > V.pk.cho[b])) ? i : b, -1);
  const is = V.sa.cho.reduce((b, v, i) => (v != null && (b < 0 || v > V.sa.cho[b])) ? i : b, -1);
  const dp = ip < 0 ? null : bt.gio[ip], ds = is < 0 ? null : bt.gio[is];
  if (sub) {
    sub.textContent = (dp != null && ds != null && dp !== ds)
      ? `đỉnh ${dp}h ⇄ ${ds}h — lệch ${Math.abs(ds - dp)} giờ`
      : `${bt.pk.n_phong} phòng khám ⇄ ${bt.sa.n_phong} phòng siêu âm`;
  }
  const nDau = ngays[0] || bt.ngay, nCuoi = ngays[ngays.length - 1] || bt.ngay;
  const dmy = (s) => String(s || "").split("-").reverse().join("/");
  const dodo = (mot && bt.gio_dang_chay != null && nCuoi === bt.ngay)
    ? ` · <span class="btr-canh">giờ ${bt.gio_dang_chay}h đang chạy dở nên chưa tính</span>` : "";
  const pham_vi = mot
    ? `Ngày <b>${esc(dmy(nCuoi))}</b>${nCuoi === bt.ngay && bt.gio_chot != null
        ? `, số liệu tới <b>${bt.gio_chot}h</b>` : ""}${dodo}.`
    : `<b>Trung vị ${V.n_ngay} ngày</b> ${esc(dmy(nDau))} – ${esc(dmy(nCuoi))} — mỗi khung giờ lấy
       giá trị giữa của các ngày, nên một ngày bất thường không kéo lệch cả biểu đồ.`;
  // Cắt khoảng giờ chưa tới ở hai đầu — xem btrGioHien(). Mọi panel + trục giờ phải dùng CHUNG
  // một dải giờ, nếu không các cột lệch nhau và small multiples mất tác dụng.
  const H = btrGioHien(V), G = H.gio;
  const c = (a) => (a || []).slice(H.lo, H.hi + 1);
  // GIỜ CÓ SỐ NHƯNG TỶ SỐ KHÔNG CÓ NGHĨA — trạng thái thứ ba của panel tỷ số (xem `btrPanel`).
  // Chỉ dựng cho panel 1; hai panel kia vẽ số đếm nên mọi giờ có số đều vẽ được.
  const pkC = c(V.pk.gio_chinh), saC = c(V.sa.gio_chinh);
  const pkM = c(V.pk.mo), saM = c(V.sa.mo);
  const ngoaiGio = G.map((h, i) => {
    if (pkC[i] || saC[i]) return null;                        // ít nhất một bên còn tính được
    if (pkM[i] == null && saM[i] == null) return null;         // chưa đo được thật → để gạch chéo
    return `${h}h — ngoài giờ hoạt động chính: chỉ còn ${btrSo(pkM[i], !mot)} phòng khám · `
      + `${btrSo(saM[i], !mot)} phòng siêu âm mở. Chia ra vẫn được nhưng không còn nói lên mức `
      + `chịu tải (hàng còn lại là phần để sang hôm sau, không phải đang được giải quyết với nhịp đó).`;
  });
  sec.innerHTML = `
    ${btrThanhChon(bt, ngays)}
    <div class="btr-lead">
      <p class="btr-dn"><b>Phòng đang hoạt động</b> = phòng <b>có bác sĩ làm việc trong phòng</b>,
        tính theo khoảng từ ca đầu đến ca cuối của từng người trong buổi. ${pham_vi}</p>
      ${btrNhanDinh(bt, V)}
    </div>
    ${btrPanel({
      tieu_de: "Mỗi phòng đang mở gánh bao nhiêu", gio: G, le: true, nhan: true,
      goi_y: "càng cao càng quá tải", dv_truc: "/phòng", ngoai: ngoaiGio,
      series: [{ ten: "Phòng khám", dv: "người/phòng", cls: "btr-pk", arr: c(V.pk.moi_phong) },
               { ten: "Phòng siêu âm", dv: "ca/phòng", cls: "btr-sa", arr: c(V.sa.moi_phong) }] })}
    ${btrPanel({
      tieu_de: "Số phòng đang hoạt động", don_vi: BTR_DV.phong, dv_truc: BTR_DV.phong,
      gio: G, le: !mot,
      series: [{ ten: "Phòng khám", cls: "btr-pk", arr: c(V.pk.mo) },
               { ten: "Phòng siêu âm", cls: "btr-sa", arr: c(V.sa.mo) }] })}
    ${btrPanel({
      tieu_de: "Số đang chờ", gio: G, le: !mot,
      series: [{ ten: "Chờ khám", dv: BTR_DV.nguoi, cls: "btr-pk", arr: c(V.pk.cho) },
               { ten: "Siêu âm chưa xong", dv: BTR_DV.ca, cls: "btr-sa", arr: c(V.sa.cho) }] })}
    <div class="btr-body"><div class="btr-y"></div>
      <div class="btr-axis">${G.map(h => `<span>${h}h</span>`).join("")}</div></div>
    <p class="btr-axis-t">Khung giờ trong ngày${H.lo > 0 || H.hi < bt.gio.length - 1
      ? ` — chỉ hiện ${G[0]}h–${G[G.length - 1]}h vì ngoài khoảng này chưa có số liệu` : ""}</p>
    <h3 class="btr-h3">Phòng khám vs Phòng siêu âm — theo từng khu · từng tầng
      <span class="btr-legend">
        <span class="btr-key"><i class="btr-sw btr-pk"></i>Phòng khám</span>
        <span class="btr-key"><i class="btr-sw btr-sa"></i>Phòng siêu âm</span></span></h3>
    <p class="btr-note">Mỗi ô là một tầng. Số trên ô = <b>số phòng cùng hoạt động lúc cao nhất /
      tổng số phòng</b> của tầng đó; thiếu dòng nào là tầng đó không có loại phòng đó
      (Khu KM tầng 2·3 chỉ có phòng siêu âm).</p>
    ${btrLuoi(V, H)}
    ${btrBangKhu(bt, V, mot)}`;
}

// Bấm chọn chế độ / đổi ngày → vẽ lại. Uỷ quyền sự kiện vì khối được dựng lại mỗi vòng 5 phút.
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-btr-mode]");
  if (!b) return;
  const ch = btrDocChon();
  btrLuuChon({ ...ch, loai: b.dataset.btrMode });
  const d = window.DASHBOARD_DATA;
  if (d && d.cls) renderBoTri(d.cls.bo_tri);
});
document.addEventListener("change", (e) => {
  if (e.target.id !== "btr-tu" && e.target.id !== "btr-den") return;
  const tu = (document.getElementById("btr-tu") || {}).value;
  const den = (document.getElementById("btr-den") || {}).value;
  // Chọn ngược (từ > đến) thì tự đảo, đừng trả về danh sách rỗng rồi để trang trắng (luật 5).
  btrLuuChon({ loai: "tu_chon", tu: tu > den ? den : tu, den: tu > den ? tu : den });
  const d = window.DASHBOARD_DATA;
  if (d && d.cls) renderBoTri(d.cls.bo_tri);
});

// Wrapper 2 tab dịch vụ — cùng code, khác cfg.
// CĐHA có THÊM khối phòng (renderClsRooms chạy SAU → nắm dải hành động + huy hiệu tab, xem ghi chú trong hàm).
function renderCLS(cls) { renderSvcTab("cls", cls); renderClsRooms(cls); renderBoTri(cls && cls.bo_tri); }
function renderPT(pt)   { renderSvcTab("pt", pt); }

// ====== TAB TOA THUỐC — thời gian chờ lấy thuốc tại nhà thuốc ======
// Cách tính (khớp backend, xem CLAUDE.md): đã lấy = thanh_toán−thực_hiện; đang chờ = update−thực_hiện.
// Đơn vị phút; >60' → "X giờ Y phút". KPI chính = P90 + % đúng giờ (≤30') vì phân phối lệch phải
// (median 6' nhưng đuôi dài). BN chờ >120' = NGHI ĐÃ VỀ → tách khỏi hàng đợi thực.
const TOA_SLA_MIN = 30;        // ngưỡng "đúng giờ" (Permenkes 129/2008 — chuẩn khu vực tạm áp)
let _toaShowWalked = false;

function fmtWaitJS(min) {
  if (min == null) return "—";
  let m = Math.round(min); if (m < 0) m = 0;
  if (m < 60) return m + " phút";
  const h = Math.floor(m / 60), mm = m % 60;
  return mm ? `${h} giờ ${mm} phút` : `${h} giờ`;
}
// mức khẩn 1 dòng chờ: >50' đỏ · 31–50' cam · ≤30' thường
function waitRowLevel(min) {
  const m = min || 0;
  if (m > 50) return "red";
  if (m > TOA_SLA_MIN) return "amber";
  return "ok";
}

function renderToa(toa) {
  const fr = document.getElementById("toa-fresh");
  const cap = document.getElementById("toa-captured");
  const kpiEl = document.getElementById("toa-kpis");
  const listEl = document.getElementById("toa-waitlist");
  const distEl = document.getElementById("toa-dist");
  if (!kpiEl) return;
  if (!toa) {
    if (fr) fr.innerHTML = freshnessBadge(null);
    kpiEl.innerHTML = "";
    if (listEl) listEl.innerHTML = `<p class="empty">Chưa có số liệu toa thuốc. Chạy
      <code>python scraper/dashboard_flow.py --toa</code>.</p>`;
    if (distEl) distEl.innerHTML = "";
    setTabBadge("badge-toa", 0);
    return;
  }
  if (fr) fr.innerHTML = freshnessBadge(toa.captured_at);
  if (cap) cap.textContent = toa.captured_at ? "· chụp " + String(toa.captured_at).slice(11, 16) : "";

  const ds = toa.dispensed_stats || {}, ws = toa.waiting_stats || {};
  const backlog = toa.n_cho_active || 0;
  const longest = ws.max || 0;

  // Danh sách chờ (tính TRƯỚC KPI để đếm "quá hạn") — sort chờ lâu → ngắn.
  const waiting = (toa.waiting || []);
  const active = waiting.filter(w => !w.walked);
  const walked = waiting.filter(w => w.walked);
  const overdue = active.filter(w => (w.wait_minutes || 0) > TOA_SLA_MIN).length;

  // RAG: backlog (≤10/11–25/>25) · P90 (≤25/25–40/>40) · %đúng giờ (≥90/75–90/<75) · lâu nhất (≤30/31–50/>50)
  const blLv = backlog > 25 ? "red" : backlog > 10 ? "amber" : (overdue ? "amber" : "ok");
  const p90 = ds.p90, p90Lv = p90 == null ? "info" : p90 > 40 ? "red" : p90 > 25 ? "amber" : "ok";
  const sl = toa.sl_pct, slLv = sl == null ? "info" : sl < 75 ? "red" : sl < 90 ? "amber" : "ok";
  // "Lấy trễ" = toa chờ >defMin (60′) — lấy toa rồi quay lại sau, KHÔNG đứng chờ thật → tách riêng.
  const nDef = toa.n_deferred != null ? toa.n_deferred : ((toa.buckets || {}).gt60 || 0);
  const defMin = toa.defer_min || 60;
  const lgLv = longest > 50 ? "red" : longest > TOA_SLA_MIN ? "amber" : "ok";

  // 4 KPI: 1 HERO realtime (đang chờ) + 3 hiệu suất hôm nay. Bỏ thẻ "Chờ lâu nhất"
  // (đã = dòng #1 danh sách bên dưới) → hết lặp 3 lần.
  kpiEl.innerHTML = `
    <div class="kpi hero ${blLv}"><div class="big">${blLv === "red" ? "🔴 " : blLv === "amber" ? "⚠️ " : ""}${fmt(backlog)}</div>
      <div class="lbl">Đang chờ lấy thuốc</div>
      <div class="sub-metric">${overdue ? `${overdue} ca quá hạn >${TOA_SLA_MIN}′` : "chưa ca nào quá hạn"}${toa.n_walked ? ` · ${toa.n_walked} nghi đã về` : ""}</div></div>
    <div class="kpi ok"><div class="big">${fmt(toa.n_da_lay)}</div>
      <div class="lbl">Đã phát hôm nay</div>
      <div class="sub-metric">${toa.throughput_per_h != null ? "~" + toa.throughput_per_h + " toa/giờ" : ""}</div></div>
    <div class="kpi ${p90Lv}"><div class="big">${fmtWaitJS(p90)}</div>
      <div class="lbl">90% bệnh nhân lấy thuốc trong mức này</div>
      <div class="sub-metric">½ số toa chỉ ≤ ${fmtWaitJS(ds.median)}${nDef ? ` · ${nDef} lấy trễ (>${defMin}′)` : ""}</div></div>
    <div class="kpi ${slLv}"><div class="big">${sl == null ? "—" : sl + "%"}</div>
      <div class="lbl">Đúng giờ (≤${TOA_SLA_MIN}′)</div>
      <div class="sub-metric">${toa.on_time || 0}/${(ds.n || 0)} toa đạt mục tiêu</div></div>`;

  // ---- Dải hành động (không lặp tên — tên hiện ở dòng #1 danh sách) ----
  if (backlog > 0) {
    const lvl = (blLv === "red" || lgLv === "red") ? "red" : "amber";
    const hint = backlog > 10 ? "Mở thêm quầy phát thuốc, ưu tiên ca quá hạn"
      : overdue ? "Gọi tên / xác minh các ca đã quá hạn"
      : "Theo dõi, phát theo thứ tự chờ lâu nhất";
    actionBand("toa-action", lvl,
      `${fmt(backlog)} đang chờ · lâu nhất ${fmtWaitJS(longest)}`, [], hint);
  } else {
    actionBand("toa-action", "ok", "Không có bệnh nhân nào đang chờ lấy thuốc.", [], "");
  }
  setTabBadge("badge-toa", backlog, blLv === "ok" ? "amber" : blLv);

  // ---- Diễn biến hàng đợi → quyết định mở/đóng quầy ----
  // So với mốc CÁCH ~30′ TRƯỚC (chọn điểm gần 30′ nhất, tối thiểu cách 10′ — KHÔNG so 2 mốc 5′ liền
  // kề vì Δ quá nhỏ = nhiễu, "0 toa/giờ" vô nghĩa). Nhịp phát chỉ hiện khi cửa sổ ≥15′ (đủ ý nghĩa).
  const PACE_TARGET = 30, PACE_MIN_AGE = 10, PACE_RATE_SPAN = 15;
  const paceEl = document.getElementById("toa-pace");
  if (paceEl) {
    const mins = s => { const x = String(s).split(":"); return (+x[0]) * 60 + (+x[1]); };
    const tr = (toa.trend || []).filter(p => p && p.cho != null);
    const last = tr[tr.length - 1];
    let base = null, span = 0;
    if (last) {
      const lm = mins(last.t);
      let bestDiff = Infinity;
      for (let k = 0; k < tr.length - 1; k++) {
        const age = lm - mins(tr[k].t);
        if (age < PACE_MIN_AGE) continue;                 // quá gần → bỏ (nhiễu)
        const diff = Math.abs(age - PACE_TARGET);
        if (diff < bestDiff) { bestDiff = diff; base = tr[k]; span = age; }
      }
    }
    if (last && base) {
      const dCho = (last.cho || 0) - (base.cho || 0), dDa = (last.da || 0) - (base.da || 0);
      const dir = dCho > 0 ? `<b class="pc-up">▲ tăng ${dCho}</b>`
        : dCho < 0 ? `<b class="pc-dn">▼ giảm ${-dCho}</b>` : `<b class="pc-flat">→ giữ mức</b>`;
      const ratePart = span >= PACE_RATE_SPAN
        ? ` <span class="pc-sep">·</span> đã phát <b>${dDa}</b> toa (~${Math.round(dDa / span * 60)}/giờ)` : "";
      paceEl.hidden = false;
      paceEl.innerHTML = `<span class="pc-ic">📈</span>
        <span>Hàng chờ ${dir} trong ~${span}′ qua${ratePart}</span>`;
    } else {
      paceEl.hidden = true;   // chưa đủ dữ liệu để nói gì có nghĩa → ẩn (tránh số nhiễu)
    }
  }

  // ---- Danh sách đang chờ — CARD responsive (mobile-safe) ----
  // muted = nhóm "nghi đã về" (BN nhiều khả năng đã rời đi) → KHÔNG tô đỏ/cờ QUÁ HẠN
  // (chống loãng tín hiệu: chỉ hàng đợi THỰC mới cần can thiệp).
  const rowHtml = (w, i, muted) => {
    const lv = muted ? "" : waitRowLevel(w.wait_minutes);
    const flag = muted ? "" : lv === "red" ? `<span class="wl-flag red">QUÁ HẠN</span>`
      : lv === "amber" ? `<span class="wl-flag amber">CHÚ Ý</span>` : "";
    const start = w.thuc_hien_at ? String(w.thuc_hien_at).slice(11, 16) : "—";
    // Đối tượng gần như luôn BHYT → chỉ hiện tag khi NGOẠI LỆ (viện phí/dịch vụ).
    const nonBhyt = w.doi_tuong && !/b[ảa]o hi[ểe]m/i.test(w.doi_tuong);
    return `<div class="wl-row ${lv}">
      <div class="wl-rank">${i + 1}</div>
      <div class="wl-main">
        <div class="wl-name">${esc(w.ho_ten || "—")}${w.n_lines > 1 ? ` <span class="wl-lines">${w.n_lines} thuốc</span>` : ""}${nonBhyt ? ` <span class="wl-dt">${esc(w.doi_tuong)}</span>` : ""}</div>
        <div class="wl-meta">${w.ma_nb ? `<span class="wl-manb">Mã NB ${esc(w.ma_nb)}</span> · ` : ""}Ra toa ${start}</div>
      </div>
      <div class="wl-right">${muted
        ? `<span class="wl-gone">chưa lấy · ${Math.round((w.wait_minutes || 0) / 60)}h trước</span>`
        : `<div class="wl-wait">${fmtWaitJS(w.wait_minutes)}</div>${flag}`}</div>
    </div>`;
  };
  let html;
  if (!active.length && !walked.length) {
    html = `<p class="empty ok-empty">✅ Không có bệnh nhân nào đang chờ lấy thuốc.</p>`;
  } else {
    html = `<div class="wlist">`
      + (active.length ? active.map((w, i) => rowHtml(w, i, false)).join("")
         : `<div class="empty">Không ai đang chờ (trong ngưỡng).</div>`)
      + `</div>`;
    if (walked.length) {
      html += `<button type="button" class="wl-toggle" id="toa-walked-toggle">
        ${_toaShowWalked ? "▾" : "▸"} ${walked.length} toa ra toa từ sáng chưa lấy (nghi đã về / đang điều trị trong ngày)</button>
        <div class="wl-walked" ${_toaShowWalked ? "" : "hidden"}>
        <div class="wlist">${walked.map((w, i) => rowHtml(w, i, true)).join("")}</div></div>`;
    }
  }
  if (listEl) listEl.innerHTML = html;
  const wt = document.getElementById("toa-walked-toggle");
  if (wt) wt.addEventListener("click", () => { _toaShowWalked = !_toaShowWalked; renderToa(toa); });

  // ---- Thời gian chờ toa ĐÃ phát — CHỈ nhóm CHỜ THẬT (≤60′); nhóm "lấy trễ" tách riêng ----
  // BN lấy trễ (>60′) = lấy toa sáng rồi quay lại sau, KHÔNG đứng chờ thật → không vẽ vào phân bố
  // chờ (khỏi kéo lệch), chỉ ghi chú đếm riêng. Khung theo mục tiêu SLA 30′ (đạt ≤30 vs trễ 30–60).
  const b = toa.buckets || {};
  const nReal = (b.le15 || 0) + (b.m15_30 || 0) + (b.m30_60 || 0);   // chờ thật ≤60′ (nDef/defMin: ở trên)
  if (distEl) {
    if (!nReal && !nDef) { distEl.innerHTML = ""; }
    else {
      const pc = n => nReal ? Math.round(100 * (n || 0) / nReal) : 0;
      const onTime = (b.le15 || 0) + (b.m15_30 || 0);     // đạt ≤30′
      const lateReal = (b.m30_60 || 0);                   // trễ thật 30–60′
      const seg = (n, cls, lbl) => n ? `<div class="tb-seg ${cls}" style="width:${pc(n)}%"
        title="${lbl}: ${n} toa (${pc(n)}%)"><span class="tb-n">${n}</span></div>` : "";
      const take = lateReal
        ? `<span class="tb-take warn">⚠ <b>${lateReal} toa</b> (${pc(lateReal)}%) chờ 30–60′, vượt mục tiêu</span>`
        : `<span class="tb-take good">✓ Cả ${nReal} toa chờ thật đều đạt mục tiêu ≤30′</span>`;
      const deferNote = nDef
        ? `<span class="tb-defer">+ <b>${nDef} toa lấy trễ</b> (&gt;${defMin}′ — lấy toa rồi quay lại sau; không tính vào thống kê chờ)</span>`
        : "";
      distEl.innerHTML = `<div class="tb-title">Thời gian chờ của <b>${nReal}</b> toa chờ thật hôm nay
          <span class="tb-sla">┊ vạch = mục tiêu 30′</span></div>
        <div class="tb-bar">${seg(b.le15, "tb-g", "≤15′")}${seg(b.m15_30, "tb-b", "15–30′")}${seg(b.m30_60, "tb-a", "30–60′")}<span class="tb-mark" style="left:${pc(onTime)}%"></span></div>
        <div class="tb-leg"><span class="tb-grp">Đạt (≤30′):</span>
          <span><i class="sw tb-g"></i>≤15′ <b>${b.le15 || 0}</b></span>
          <span><i class="sw tb-b"></i>15–30′ <b>${b.m15_30 || 0}</b></span>
          <span class="tb-div">┊</span><span class="tb-grp">Trễ:</span>
          <span><i class="sw tb-a"></i>30–60′ <b>${b.m30_60 || 0}</b></span></div>
        ${take}${deferNote}`;
    }
  }
}

// thoát HTML cho tên BN (chống vỡ layout / injection từ dữ liệu HIS)
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ====== TAB 5: KHÁM TOÀN DIỆN ======
// BN khám ≥2 LOẠI = "toàn diện"; lượt toàn diện credit cho PHÒNG GIỚI THIỆU (xem scraper
// _khamtd_credit). % phòng = toàn diện ÷ tổng BN phòng đó khám. KHÔNG dùng màu RAG (đây là chỉ
// số MÔ TẢ, không phải cảnh báo tải) → bar màu brand + thẻ "info"; giữ RAG cho các tab tải.
let _ktdData = null;
const _ktdSort = { by: "pct" };

function shortPhong(s) {
  return String(s || "").replace(/^Phòng khám\s*/i, "").replace(/^Phòng\s*/i, "") || s;
}

function renderKtd(ktd) {
  const fr = document.getElementById("ktd-fresh");
  const cap = document.getElementById("ktd-captured");
  const kpiEl = document.getElementById("ktd-kpis");
  const tblEl = document.getElementById("ktd-table");
  if (!kpiEl) return;
  if (!ktd || !(ktd.clinics || []).length) {
    if (fr) fr.innerHTML = freshnessBadge(ktd && ktd.captured_at);
    kpiEl.innerHTML = "";
    if (tblEl) tblEl.innerHTML = `<p class="empty">Chưa có số liệu khám toàn diện. Chạy
      <code>python scraper/dashboard_flow.py --toa</code> (dùng chung báo cáo BC01).</p>`;
    actionBand("ktd-action", "ok", "Chưa có dữ liệu khám toàn diện.", [], "");
    setTabBadge("badge-ktd", 0);
    _ktdData = null;
    const pe = document.getElementById("ktd-patients"); if (pe) pe.innerHTML = "";
    return;
  }
  _ktdData = ktd;
  if (fr) fr.innerHTML = freshnessBadge(ktd.captured_at);
  if (cap) cap.textContent = "";   // giờ chụp đã có ở badge freshness phía trên → không lặp

  const pct = ktd.pct_overall;
  const ageE = ktd.age_elderly || 65;
  const eldMiss = ktd.n_elderly_khong_td || 0;
  // % người cao tuổi chưa khám toàn diện — mẫu CẢ VIỆN (đủ lớn) nên TỈ LỆ có ý nghĩa cảnh báo.
  const eldPct = ktd.n_elderly ? Math.round(100 * eldMiss / ktd.n_elderly) : null;
  const eldUrgent = eldPct != null && eldPct >= 50;     // ≥50% người cao tuổi sót = cần can thiệp gấp

  // HERO dẫn bằng SỐ CA HÀNH ĐỘNG (số người cao tuổi cần mời khám thêm) — KHÔNG dẫn bằng % vì
  // % to đỏ (85%) dễ báo động giả + không phải số để ra quyết định (số CA mới là khối lượng việc).
  // % người cao tuổi + % toàn viện hạ xuống DÒNG BỐI CẢNH (mỗi số xuất hiện ĐÚNG 1 lần trên màn).
  // Tỉ lệ khám toàn diện toàn viện (chất lượng) — TÁCH thành thẻ riêng (đừng nhồi vào hero người cao tuổi).
  const ovPct = pct == null ? null : Math.round(pct);
  // Thẻ BỐI CẢNH (chất lượng) — KHÔNG có mục tiêu chuẩn + đa số BN chỉ cần 1 chuyên khoa → tô RAG
  // theo trị tuyệt đối là BÁO ĐỘNG GIẢ. Giữ TRUNG TÍNH (brand) để alarm DUY NHẤT dồn vào thẻ người cao tuổi.
  const ovRag = "info";
  kpiEl.innerHTML = `
    <div class="kpi hero ktd-hero ${eldMiss === 0 ? "ok" : eldUrgent ? "red kpi-alarm" : eldPct != null && eldPct >= 25 ? "amber" : "info"}">
      <div class="ktd-hero-main">
        <div class="big">${fmt(eldMiss)}</div>
        <div class="ktd-hero-txt">
          <div class="lbl">Người cao tuổi (≥${ageE}) chưa khám toàn diện</div>
          <div class="sub-metric">${eldPct == null ? "" : `trong ${fmt(ktd.n_elderly)} người ≥${ageE} khám hôm nay`}</div>
        </div>
      </div>
    </div>
    <div class="kpi ktd-rate-kpi ${ovRag}">
      <div class="big">${ovPct == null ? "—" : ovPct}<span class="big-sub">%</span></div>
      <div class="lbl">Tỉ lệ khám toàn diện toàn viện</div>
      <div class="sub-metric">${fmt(ktd.n_bn_toan_dien)}/${fmt(ktd.n_bn_kham)} bệnh nhân khám ≥2 chuyên khoa</div>
    </div>`;

  // Dải HÀNH ĐỘNG = MỆNH LỆNH (verb) + TÊN phòng ưu tiên #1 (nhãn định hướng, giống tab Phòng khám).
  // KHÔNG ghi SỐ CA của phòng đó ở đây — số đã nằm ở danh sách rank #1 ngay dưới (chống lặp số liệu).
  const eldSorted = (ktd.elderly_clinics || []).slice()
    .sort((a, b) => (b.n_no_td - a.n_no_td) || (b.rate - a.rate));
  if (eldSorted.length) {
    const top = eldSorted[0];
    actionBand("ktd-action", eldUrgent ? "red" : "amber",
      `Ưu tiên mời người cao tuổi ở ${shortPhong(top.phong)} khám thêm chuyên khoa`,
      [], "");
  } else {
    actionBand("ktd-action", "ok", "Mọi bệnh nhân cao tuổi đã được khám toàn diện.", [], "");
  }
  // Huy hiệu báo động tab = số BN ≥65 CHƯA khám toàn diện (việc cần can thiệp). Đỏ nếu tỉ lệ ≥50%.
  setTabBadge("badge-ktd", ktd.n_elderly_khong_td || 0, (eldPct != null && eldPct >= 50) ? "red" : "amber");

  renderKtdTable();
  renderKtdElderly();
  renderKtdDoctors();
  renderKtdPatients();
}

// Chip tóm tắt trên TIÊU ĐỀ mục (con số + cảnh báo) → khi ĐÓNG vẫn nắm thông tin chính.
function setKtdSum(id, text, level) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = "ktd-sec-sum" + (level ? " " + level : "");
  el.textContent = text || "";
}

// BN ≥65 tuổi CHƯA khám toàn diện — XẾP HẠNG PHÒNG (tỉ lệ cao nhất = bỏ lỡ nhiều) + ICD.
function renderKtdElderly() {
  const el = document.getElementById("ktd-elderly");
  if (!el || !_ktdData) return;
  // Sắp theo SỐ CA cần rà soát (số quyết định, KHÔNG phải tỉ lệ) — tránh bẫy mẫu nhỏ:
  // 1/1 = 100% trông "đỏ" hơn 21/27 = 78% dù chỉ 1 ca. Số ca = khối lượng cần mời khám thêm.
  const rows = (_ktdData.elderly_clinics || []).slice()
    .sort((a, b) => (b.n_no_td - a.n_no_td) || (b.rate - a.rate));
  const ageE = (_ktdData.age_elderly || 65);
  if (!rows.length) {
    el.innerHTML = `<p class="empty">Không có người cao tuổi (≥${ageE}) nào chưa khám toàn diện. 👍</p>`;
    setKtdSum("ktd-elderly-sum", "✓ không có", "green");
    return;
  }
  const MAJOR = 3;                                   // ≥3 ca = cụm đáng rà soát; 1–2 ca gom vào đuôi mờ
  const major = rows.filter(r => (r.n_no_td || 0) >= MAJOR);
  const minor = rows.filter(r => (r.n_no_td || 0) < MAJOR);
  // Tóm tắt header (chỉ hiện khi ĐÓNG): tổng BN sót · số phòng; màu theo SỐ CA phòng nặng nhất (volume).
  const totNoTd = rows.reduce((s, r) => s + (r.n_no_td || 0), 0);
  const maxN = rows[0].n_no_td || 0;
  const lv = maxN >= 10 ? "red" : maxN >= MAJOR ? "amber" : "green";
  setKtdSum("ktd-elderly-sum",
    `${lv === "green" ? "" : "⚠ "}${fmt(totNoTd)} người · ${rows.length} phòng`, lv);   // ⚠ chỉ khi cần hành động

  const ptList = r => (r.patients || []).map((p, i) => `<div class="ktd-eld-pt">
      <span class="ep-i">${i + 1}</span>
      <span class="ep-name">${p.ho_ten || "(không tên)"}<span class="ep-age">${p.tuoi} tuổi</span><span class="ep-id">${p.ma_nb || ""}</span></span>
      <span class="ep-dx">${p.icd ? `<b>${p.icd}</b>${p.chan_doan ? " · " + p.chan_doan : ""}` : '<span class="ep-noicd">chưa có chẩn đoán</span>'}</span>
    </div>`).join("");
  // SỐ CA là số lớn (việc cần làm); tỉ lệ là bối cảnh phụ. RAG theo SỐ CA: ≥10 đỏ · 3–9 vàng · <3 xanh-mờ.
  const rowHtml = (r, rank) => {
    const lv = r.n_no_td >= 10 ? "red" : r.n_no_td >= MAJOR ? "amber" : "green";
    return `<div class="ktd-eld ktd-${lv}">
      <button type="button" class="ktd-eld-top" aria-expanded="false">
        <span class="ktd-eld-rank">${rank}</span>
        <span class="ktd-eld-name">${shortPhong(r.phong)}
          <span class="ktd-eld-ctx">trong ${fmt(r.n_elderly)} người ≥${ageE} đã khám</span></span>
        <span class="ktd-eld-barwrap" title="${fmt(r.n_no_td)}/${fmt(r.n_elderly)} người cao tuổi của phòng (${r.rate}%) mới khám 1 chuyên khoa">
          <span class="ktd-eld-bar" style="width:${maxN ? Math.max(6, Math.round(100 * r.n_no_td / maxN)) : 0}%"></span></span>
        <span class="ktd-eld-big"><span class="eb-num">${fmt(r.n_no_td)}</span><span class="eb-lbl">người</span></span>
        <span class="ktd-eld-caret">▸</span>
      </button>
      <div class="ktd-eld-list" hidden>${ptList(r)}</div>
    </div>`;
  };

  let html = (major.length ? major : rows).map((r, i) => rowHtml(r, i + 1)).join("");
  // Đuôi MỜ gom phòng lẻ (1–2 ca) → bỏ loạt "100%" đỏ giả do mẫu nhỏ, vẫn tra được khi cần.
  if (major.length && minor.length) {
    const tot = minor.reduce((s, r) => s + (r.n_no_td || 0), 0);
    const names = minor.map(r => shortPhong(r.phong)).join(", ");
    const inner = minor.map((r, i) => rowHtml(r, major.length + i + 1)).join("");
    html += `<div class="ktd-eld-minor">
      <button type="button" class="ktd-eld-minortog" aria-expanded="false">
        <span class="ktd-eld-caret">▸</span>
        <span class="mn-txt">${minor.length} phòng còn lại — mỗi phòng 1–2 người (tổng ${fmt(tot)} người): <b>${names}</b></span>
      </button>
      <div class="ktd-eld-minorbody" hidden>${inner}</div>
    </div>`;
  }
  el.innerHTML = html;
}

function renderKtdTable() {
  const tblEl = document.getElementById("ktd-table");
  if (!tblEl || !_ktdData) return;
  const by = _ktdSort.by;
  const all = (_ktdData.clinics || []).slice().sort(
    (a, b) => (b[by] || 0) - (a[by] || 0) || (b.n_kham || 0) - (a.n_kham || 0));
  // Phòng 0% (chưa có lượt cho đi khám toàn diện) GOM 1 DÒNG → bỏ các thanh đỏ nhiễu báo động giả.
  const active = all.filter(r => (r.pct || 0) > 0);
  const zero = all.filter(r => !((r.pct || 0) > 0));
  let html = active.map(r => {
    const pct = r.pct || 0;
    const w = Math.min(100, pct);   // bar TUYỆT ĐỐI = đúng % (thang 0–100)
    const lv = pct > 20 ? "green" : pct >= 10 ? "amber" : "red";   // >20 xanh · 10–20 vàng · <10 đỏ
    return `<div class="ktd-row ktd-${lv}">
      <div class="ktd-name">${shortPhong(r.phong)}<span class="ktd-sub">${fmt(r.n_kham)} BN khám</span></div>
      <div class="ktd-bar"><span style="width:${w}%"></span></div>
      <div class="ktd-pct"><b>${Math.round(pct)}%</b><span class="ktd-td">${fmt(r.n_toan_dien)} lượt chỉ định</span></div>
    </div>`;
  }).join("");
  if (zero.length) {
    html += `<div class="ktd-zero"><span class="ktd-zero-ico">⚠</span><div class="ktd-zero-body">
      <b>${fmt(zero.length)} phòng</b> chưa chỉ định bệnh nhân khám thêm chuyên khoa <i>(0%)</i>
      <div class="ktd-zero-chips">${zero.map(r => `<span class="ktd-zchip">${shortPhong(r.phong)}</span>`).join("")}</div>
    </div></div>`;
  }
  tblEl.innerHTML = html;
  // Chip tóm tắt header (hiện khi ĐÓNG): bao nhiêu phòng đã chỉ định khám thêm / chưa.
  setKtdSum("ktd-rate-sum", `${fmt(active.length)} phòng đã chỉ định · ${fmt(zero.length)} chưa`, "");
}

// Bảng theo BÁC SĨ chỉ định: ai cho bao nhiêu BN đi khám toàn diện, đi phòng nào, ICD gì.
function renderKtdDoctors() {
  const el = document.getElementById("ktd-doctors");
  if (!el || !_ktdData) return;
  const docs = _ktdData.doctors || [];
  if (!docs.length) {
    el.innerHTML = `<p class="empty">Chưa có bác sĩ nào chỉ định khám toàn diện.</p>`;
    setKtdSum("ktd-doctors-sum", "0 bác sĩ", "muted");
    return;
  }
  const totBn = docs.reduce((s, d) => s + (d.so_bn || 0), 0);
  setKtdSum("ktd-doctors-sum", `${fmt(docs.length)} bác sĩ · ${fmt(totBn)} BN chỉ định`, "");
  // 1 dòng chú thích: tỉ lệ nghĩa là gì + chip → nơi chỉ định đến (đã BỎ ICD để gọn cho mobile).
  const legend = `<div class="ktd-doc-leg">% = <b>BN được chỉ định khám thêm ÷ tổng BN bác sĩ khám</b>
    · <span class="ktd-doc-arrow">→</span> nơi chỉ định đến</div>`;
  // RAG theo % (cao = TỐT, thống nhất với bảng phòng): ≥20 xanh · 10–20 vàng · <10 đỏ-cam.
  const ragOf = p => p == null ? "muted" : p >= 20 ? "green" : p >= 10 ? "amber" : "red";
  el.innerHTML = legend + docs.map(d => {
    const denom = d.so_bn_kham || 0;
    const hasPct = d.pct != null && denom > 0;       // dữ liệu cũ thiếu mẫu số → degrade gọn, không vỡ
    const rag = hasPct ? ragOf(d.pct) : "muted";
    const w = Math.max(3, Math.min(100, d.pct || 0));            // thanh: bề rộng = %
    // Nơi chỉ định đến — TOP 3 + gộp "+N" (điều phối phòng; không nhồi hết chip).
    const ds = d.dests || [];
    const shown = ds.slice(0, 3).map(x =>
      `<span class="ktd-chip">${shortPhong(x.phong)}<b>${x.n}</b></span>`).join("");
    const more = ds.length > 3 ? `<span class="ktd-chip more">+${ds.length - 3}</span>` : "";
    // CÓ %: % hero (RAG) + thanh so sánh + tỉ lệ thô. THIẾU mẫu số: chỉ số BN chỉ định (mờ), bỏ thanh.
    const head = `<div class="ktd-doc-head">
        <div class="ktd-doc-bs">${d.bs}<span class="ktd-doc-ph">${shortPhong(d.phong) || ""}</span></div>
        ${hasPct ? `<div class="ktd-doc-pct ${rag}">${Math.round(d.pct)}%</div>` : ""}
      </div>`;
    const metric = hasPct
      ? `<div class="ktd-doc-barwrap">
           <div class="ktd-doc-bar"><span class="ktd-doc-bar-fill ${rag}" style="width:${w}%"></span></div>
           <div class="ktd-doc-ratio"><b>${fmt(d.so_bn)}</b>/${fmt(denom)} BN</div>
         </div>`
      : `<div class="ktd-doc-ratio solo"><b>${fmt(d.so_bn)}</b> BN chỉ định</div>`;
    return `<div class="ktd-doc">${head}${metric}
      <div class="ktd-doc-dests"><span class="ktd-doc-arrow">→</span>${shown}${more}</div>
    </div>`;
  }).join("");
}

// 1 thẻ bệnh nhân: đường đi qua các phòng theo GIỜ + chẩn đoán (ICD nếu có).
// Tên phòng (vd "Nội") ĐÃ nói chuyên khoa → BỎ nhãn dịch vụ "Khám nội" (trùng), chỉ giữ GIỜ.
function ktdPatientCard(p) {
  const exams = p.exams || [];
  const steps = exams.map((e, i) => {
    const t = e.thuc_hien_at ? String(e.thuc_hien_at).slice(11, 16) : "";
    const ph = shortPhong(e.phong) || e.ten_dv || "?";
    // Chẩn đoán TRÙNG chặng liền trước → chỉ hiện MÃ (mờ), bỏ tên dài lặp (tên đầy đủ vẫn ở title).
    const prev = exams[i - 1];
    const same = e.icd && prev && prev.icd === e.icd && (prev.chan_doan || "") === (e.chan_doan || "");
    const dx = !e.icd ? ""
      : same
        ? `<span class="ktd-step-icd dup" title="${e.icd} · ${e.chan_doan || ""}"><b>${e.icd}</b></span>`
        : `<span class="ktd-step-icd" title="${e.icd} · ${e.chan_doan || ""}"><b>${e.icd}</b>${e.chan_doan ? " " + e.chan_doan : ""}</span>`;
    return `<div class="ktd-step">
      <span class="ktd-step-ph">${ph}${t ? `<span class="ktd-step-t">${t}</span>` : ""}</span>${dx}</div>`;
  }).join("");
  // Số lượt = SỐ CHẤM nhìn thấy → chỉ ghi khi ≥3 (lúc không hiển nhiên); 2 lượt khỏi lặp.
  const cnt = exams.length >= 3 ? `<span class="ktd-pt-n">${exams.length} lượt</span>` : "";
  return `<div class="ktd-pt">
    <div class="ktd-pt-name">${p.ho_ten || "(không tên)"}<span class="ktd-pt-id">${shortManb(p.ma_nb)}</span>${cnt}</div>
    <div class="ktd-pt-flow">${steps}</div>
  </div>`;
}

// Mã NB bỏ tiền tố "TUDU" cố định (lặp ở mọi dòng) → chỉ giữ phần số để tra cứu.
function shortManb(s) { return String(s || "").replace(/^TUDU/i, ""); }

// FLOW từng bệnh nhân — GROUP THEO PHÒNG KHÁM (phòng giới thiệu/tính toàn diện) để theo dõi tiện.
// 1 BN được giới thiệu bởi >1 phòng sẽ hiện ở cả các phòng đó (đúng cách credit).
function renderKtdPatients() {
  const el = document.getElementById("ktd-patients");
  if (!el || !_ktdData) return;
  const pats = _ktdData.patients || [];
  if (!pats.length) {
    el.innerHTML = `<p class="empty">Không có bệnh nhân khám toàn diện.</p>`;
    setKtdSum("ktd-patients-sum", "0 bệnh nhân", "muted");
    return;
  }
  const groups = {};
  pats.forEach(p => {
    const keys = (p.credited && p.credited.length) ? p.credited : ["(vào thẳng)"];
    keys.forEach(k => { (groups[k] = groups[k] || []).push(p); });
  });
  const order = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length || a.localeCompare(b));
  setKtdSum("ktd-patients-sum", `${fmt(pats.length)} bệnh nhân · ${fmt(order.length)} phòng`, "");
  el.innerHTML = order.map(phong => {
    const list = groups[phong].slice().sort((a, b) => (b.exams || []).length - (a.exams || []).length);
    return `<div class="ktd-grp">
      <div class="ktd-grp-head">${shortPhong(phong)}<span class="ktd-grp-n">${list.length} bệnh nhân</span></div>
      <div class="ktd-grp-body">${list.map(ktdPatientCard).join("")}</div>
    </div>`;
  }).join("");
}

function renderSvcTab(key, svc) {
  const cfg = SVC_TAB[key];
  cfg.data = svc;
  const p = cfg.prefix;
  const kpiEl = document.getElementById(p + "-kpis");
  const tblEl = document.getElementById(p + "-table");
  const capEl = document.getElementById(p + "-captured");
  const frEl  = document.getElementById(p + "-fresh");
  const legEl = document.getElementById(p + "-legend");
  if (!tblEl) return;   // panel chưa tồn tại trong DOM
  if (!svc || !svc.services || !svc.services.length) {
    if (kpiEl) kpiEl.innerHTML = "";
    if (frEl) frEl.innerHTML = "";
    if (legEl) legEl.style.display = "none";
    tblEl.innerHTML = `<p class="empty">Chưa có số liệu ${cfg.label}. Chạy
      <code>python scraper/dashboard_flow.py ${cfg.cmd}</code>.</p>`;
    if (capEl) capEl.textContent = "";
    setTabBadge(cfg.badge, 0);
    return;
  }
  const cls = svc;   // giữ tên biến cũ phía dưới cho gọn
  // ⚠️ Bảng dịch vụ là pivot theo DỊCH VỤ, KHÔNG có chiều khu → khi đang lọc khu, nó vẫn là số TOÀN
  // VIỆN. Phải dùng `svc_totals` (tổng của chính bảng này) chứ không dùng `totals` (đã lọc khu) —
  // lấy nhầm thì tổng ở đầu bảng không khớp với các dòng ngay dưới nó.
  const t = cls.svc_totals || cls.totals;
  if (frEl) frEl.innerHTML = freshnessBadge(cls.captured_at);
  if (capEl) capEl.textContent = "· " + cls.n_services + " dịch vụ";
  const scEl = document.getElementById(p + "-svc-scope");
  if (scEl) {
    scEl.hidden = !cls.svc_toan_vien;
    scEl.innerHTML = cls.svc_toan_vien
      ? `⚠️ Bảng này tính <b>toàn viện — mọi khu, mọi khoa</b> — khác phạm vi với phần phòng ở trên.
         HIS chỉ trả số theo dịch vụ, không tách được theo khu/khoa.` : "";
  }

  const tonDong = (t.cho_tiep_nhan || 0) + (t.da_tiep_nhan || 0);
  const done = (t.da_co_kq || 0) + (t.da_xem_kq || 0);
  const pct = t.tong ? Math.round(done / t.tong * 100) : 0;
  // NHÓM đang ùn (gom theo loại kỹ thuật) — dùng cho dải hành động + badge tab.
  const grpKpi = groupServices(cls.services);
  const nghen = grpKpi.filter(g => g.backlog >= 5);
  const nghenNang = grpKpi.filter(g => g.backlog >= 10).length;
  const allClear = tonDong === 0;
  if (legEl) legEl.style.display = allClear ? "none" : "";

  // ---- KPI: 3 SỐ, mỗi số 1 TẦNG (research Shneiderman + Tufte data-ink: 1 số 1 chỗ) ----
  // Tổng (bối cảnh) · TỒN ĐỌNG = số chủ đạo cần quyết · % Hoàn thành.
  // BỎ thẻ "Nhóm cần can thiệp" — bảng TỔNG QUAN bên dưới đã phơi điểm ùn (chống lặp số).
  const blCardLv = nghenNang ? "red" : (tonDong ? "amber" : "ok");
  kpiEl.innerHTML = `
    <div class="kpi info"><div class="big">${fmt(t.tong)}</div>
      <div class="lbl">${cfg.totalLabel}</div></div>
    <div class="kpi ${blCardLv} hero"><div class="big">${fmt(tonDong)}</div>
      <div class="lbl">Tồn đọng — chưa có kết quả</div>
      <div class="sub-metric">${fmt(t.cho_tiep_nhan)} chờ tiếp nhận · ${fmt(t.da_tiep_nhan)} đang làm</div></div>
    <div class="kpi ok"><div class="big">${pct}%</div>
      <div class="lbl">Hoàn thành (${fmt(done)}/${fmt(t.tong)})</div>
      <div class="kpibar"><i style="width:${pct}%"></i></div></div>`;

  // ---- Dải hành động CLS: trỏ thẳng NHÓM ùn nhất + loại tắc (chờ tiếp nhận vs đang làm dở) ----
  // Gom theo NHÓM (modality) để mệnh lệnh là "dồn người vào nhóm X", khớp bảng nhóm ngay dưới.
  const grpAll = groupServices(cls.services).sort((a, b) => b.backlog - a.backlog);
  const hotG = grpAll.filter(g => g.backlog >= 5);
  if (hotG.length) {
    const top = hotG[0];
    const chips = hotG.map(g => ({ name: g.meta.label, n: g.backlog, note: "ca" }));
    const hint = top.cho && top.lam ? "tiếp nhận ngay + đẩy nhanh ca đang làm"
      : top.cho ? "phân công tiếp nhận các ca đang chờ"
      : "đẩy nhanh trả kết quả các ca đang làm";
    actionBand(p + "-action", nghenNang ? "red" : "amber",
      `Ưu tiên ${top.meta.label}: ${fmt(top.backlog)} ca chưa xong`, chips.slice(1), hint);
  } else {
    actionBand(p + "-action", "ok", `Không nhóm nào ùn — ${cfg.flowName} thông suốt.`, [], "");
  }
  setTabBadge(cfg.badge, hotG.length, nghenNang ? "red" : "amber");

  renderSvcTable(key);
}

function svcDoneOpen(cfg) { try { return localStorage.getItem(cfg.doneKey) === "1"; } catch (e) { return false; } }

// ====== BẢNG TỔNG QUAN THEO NHÓM (shared-scale — research Knaflic/Datawrapper/Few/Shneiderman) ======
// LỖI CŨ đã sửa: mỗi nhóm tự chuẩn hóa 100% → Siêu âm(60) trông y Nội soi(13). NAY mọi thanh CHUNG
// MỘT THANG ĐO tuyệt đối (độ DÀI = số ca thật) → liếc 1 cái thấy việc dồn ở đâu.
// Tồn đọng (cam/xanh) neo MÉP TRÁI (baseline chung → so được giữa các nhóm); đã xong = XÁM (mờ đi để
// nhóm ùn NỔI — chống loãng tín hiệu/alarm-fatigue). Sắp theo TỒN ĐỌNG giảm dần = thứ tự ưu tiên.
function renderSvcTable(key) {
  const cfg = SVC_TAB[key];
  const p = cfg.prefix;
  const cls = cfg.data;
  const tblEl = document.getElementById(p + "-table");
  const t = cls.totals;
  const byTongSort = cfg.sort === "tong";
  const cmpSvc = byTongSort
    ? (a, b) => (b.tong || 0) - (a.tong || 0)
    : (a, b) => backlogOf(b) - backlogOf(a) || (b.tong || 0) - (a.tong || 0);

  // Ô tồn đọng 1 dòng: số tồn + loại tắc (chờ tiếp nhận vs đang làm). KHÔNG lặp số nơi khác.
  const blCell = (cho, lam) => {
    const bl = cho + lam;
    if (!bl) return `<span class="num0">✓</span>`;
    const q = (cho && lam) ? `${fmt(cho)} chờ · ${fmt(lam)} làm`
            : cho ? "chờ tiếp nhận" : "đang làm";
    return `<b>${fmt(bl)}</b><small>${q}</small>`;
  };
  // THANH KHỐI LƯỢNG (shared scale): độ dài fill = tong/scaleMax (so được giữa hàng); bên trong chia
  // tỉ lệ chờ→làm→xong. scaleMax = mốc chung cho cả nhóm header (max tổng nhóm) hoặc DV trong 1 nhóm.
  const vbar = (cho, lam, kq, tong, scaleMax) => {
    const fill = scaleMax > 0 ? Math.max(2.5, tong / scaleMax * 100) : 100;
    const seg = (n) => tong ? (n / tong * 100) : 0;
    return `<div class="vtrack" title="${fmt(cho)} chờ · ${fmt(lam)} làm · ${fmt(kq)} xong / ${fmt(tong)} ca">
        <div class="vfill" style="width:${fill}%">
          <i class="v-cho"  style="width:${seg(cho)}%"></i>
          <i class="v-lam"  style="width:${seg(lam)}%"></i>
          <i class="v-done" style="width:${seg(kq)}%"></i>
        </div></div>`;
  };
  // 1 dòng dịch vụ trong nhóm — thanh shared-scale theo MAX của DV cùng nhóm (so được trong nhóm).
  const svcRow = (s, scaleMax) => {
    const lv = clsLevel(s);
    const cho = s.cho_tiep_nhan || 0, lam = s.da_tiep_nhan || 0, kq = (s.da_co_kq || 0) + (s.da_xem_kq || 0);
    const mk = lv === "red" ? `<span class="rmk mk-red" title="Ùn nặng">⬤</span> `
             : lv === "amber" ? `<span class="rmk mk-amber" title="Cần theo dõi">⬤</span> ` : "";
    return `<div class="svc-row ${lv}" title="${s.ma || ""}">
      <span class="sr-name">${mk}${s.ten}</span>
      <span class="sr-bl">${blCell(cho, lam)}</span>
      <span class="sr-prog">${vbar(cho, lam, kq, s.tong || 0, scaleMax)}</span>
      <span class="sr-tot">${fmt(s.tong)}</span>
    </div>`;
  };

  const groups = groupServices(cls.services);
  groups.sort((a, b) => byTongSort ? (b.tong - a.tong) : (b.backlog - a.backlog || b.tong - a.tong));
  const maxTot = Math.max(1, ...groups.map(g => g.tong));   // MỐC CHUNG cho thanh nhóm → so khối lượng

  // Trạng thái mở: mặc định GẬP HẾT — dòng nhóm đã mang đủ số (tồn · tổng · thanh khối lượng),
  // đó chính là câu trả lời "loại kỹ thuật nào đang ùn". Bản cũ bung mọi nhóm có tồn ≥5, mà CĐHA
  // thì 10/11 nhóm đều vượt → đổ ra 198 dòng dịch vụ = hơn 10 màn hình cuộn, không ai đọc.
  // Chi tiết từng dịch vụ là việc PHÂN TÍCH, nằm sau 1 cú bấm (progressive disclosure).
  let openSet = svcGroupOpen(cfg);
  if (openSet == null) openSet = new Set();
  cfg._open = openSet;   // cho handler đọc lại khi toggle

  const tonDong = (t.cho_tiep_nhan || 0) + (t.da_tiep_nhan || 0);
  const allClear = tonDong === 0;

  const groupBlock = (g) => {
    const lv = groupLevel(g);
    const open = openSet.has(g.meta.key);
    const blBig = g.backlog
      ? `<b>${fmt(g.backlog)}</b><small>ca chưa xong</small>`
      : `<span class="sg-ok">✓ xong</span>`;
    const gMaxSvc = Math.max(1, ...g.services.map(s => s.tong || 0));
    const rows = g.services.slice().sort(cmpSvc).map(s => svcRow(s, gMaxSvc)).join("");
    return `<div class="svc-group ${lv}${open ? " open" : ""}">
      <button type="button" class="sg-head" data-g="${g.meta.key}" aria-expanded="${open}">
        <span class="caret">${open ? "▾" : "▸"}</span>
        <span class="sg-ic" aria-hidden="true">${g.meta.icon}</span>
        <span class="sg-name">${g.meta.label}</span>
        <span class="sg-n">${g.services.length} DV</span>
        <span class="sg-prog">${vbar(g.cho, g.lam, g.kq, g.tong, maxTot)}</span>
        <span class="sg-bl">${blBig}</span>
        <span class="sg-tot">${fmt(g.tong)}<small>ca</small></span>
      </button>
      <div class="sg-body"${open ? "" : " hidden"}>${rows}</div>
    </div>`;
  };

  const banner = allClear
    ? `<div class="svc-allclear">✅ Tất cả dịch vụ đã có kết quả — ${cfg.flowName} thông suốt.</div>`
    : "";
  const tools = `<div class="sg-tools">
      <span class="sg-tot-lbl">${groups.length} nhóm kỹ thuật</span>
      <button type="button" data-sgact="all">Mở tất cả</button>
      <span class="sg-dot">·</span>
      <button type="button" data-sgact="none">Thu gọn</button>
    </div>`;

  tblEl.innerHTML = banner + tools +
    `<div class="svc-groups">${groups.map(groupBlock).join("")}</div>`;

  // Bung/gập từng nhóm
  tblEl.querySelectorAll(".sg-head").forEach(btn => btn.addEventListener("click", () => {
    const gk = btn.dataset.g;
    const cur = new Set(cfg._open || []);
    cur.has(gk) ? cur.delete(gk) : cur.add(gk);
    setSvcGroupOpen(cfg, cur);
    renderSvcTable(key);
  }));
  // Mở tất cả / Thu gọn
  tblEl.querySelectorAll("[data-sgact]").forEach(b => b.addEventListener("click", () => {
    const all = b.dataset.sgact === "all";
    setSvcGroupOpen(cfg, new Set(all ? groups.map(g => g.meta.key) : []));
    renderSvcTable(key);
  }));
}

// ---- Soft refresh: nạp lại số liệu NGẦM rồi render tại chỗ (không chớp trang, giữ cuộn/tab) ----
let _refreshing = false;

function setRefreshStatus(html, cls) {
  const el = document.getElementById("refresh-status");
  if (el) { el.className = "refresh-status" + (cls ? " " + cls : ""); el.innerHTML = html; }
}

function timeAgo(iso) {
  if (!iso) return "";
  const then = new Date(String(iso).replace(" ", "T"));
  const s = Math.max(0, Math.round((Date.now() - then.getTime()) / 1000));
  if (s < 45) return "vừa xong";
  const m = Math.round(s / 60);
  if (m < 60) return m + " phút trước";
  const h = Math.floor(m / 60);
  return h + "h" + (m % 60 ? (m % 60) + "'" : "") + " trước";
}

// Chữ ký độ tươi của 1 bản data (giờ chụp 2 khối) → so 2 lần nạp để biết CÓ bản mới không.
function capSig(d) {
  if (!d) return "";
  return (d.captured_at || "") + "|" + ((d.cls && d.cls.captured_at) || "")
    + "|" + ((d.pt && d.pt.captured_at) || "") + "|" + ((d.toa && d.toa.captured_at) || "")
    + "|" + ((d.ktd && d.ktd.captured_at) || "");
}
// Tuổi ẢNH CHỤP HIS (cũ nhất giữa các khối) — đây mới là độ tươi số liệu, KHÔNG phải lúc nạp file.
function captureAgeIso(d) {
  const isos = [d && d.captured_at, d && d.cls && d.cls.captured_at,
                d && d.pt && d.pt.captured_at].filter(Boolean);
  if (!isos.length) return null;
  return isos.reduce((old, s) =>
    new Date(String(s).replace(" ", "T")) < new Date(String(old).replace(" ", "T")) ? s : old);
}
// Giờ chụp của TAB ĐANG XEM → pill header luôn khớp banner của khối đang hiển thị (hết mâu thuẫn 2 số).
// Tab đang xem (theo DOM, không theo localStorage) — dùng chung cho pill mốc giờ + dải phạm vi.
function tabDangXem() {
  const t = document.querySelector(".tab.active");
  return (t && t.dataset && t.dataset.tab) || "clinic";
}
function activeTabIso(d) {
  const tab = tabDangXem();
  if (tab === "cls") return (d && d.cls && d.cls.captured_at) || (d && d.captured_at);
  if (tab === "pt") return (d && d.pt && d.pt.captured_at) || (d && d.captured_at);
  if (tab === "toa") return (d && d.toa && d.toa.captured_at) || (d && d.captured_at);
  if (tab === "ktd") return (d && d.ktd && d.ktd.captured_at) || (d && d.captured_at);
  return (d && d.captured_at) || captureAgeIso(d);
}
// Pill header nói CÙNG câu chuyện với banner của tab đang xem: tuổi ảnh chụp + màu theo độ cũ, không trấn an giả.
function updateAge() {
  const d = window.DASHBOARD_DATA;
  if (_refreshing) return;
  // Tab Phòng·Giường có luồng số liệu RIÊNG (giuong-data.js) và chu kỳ riêng (5' thay vì 30')
  // → pill phải nói mốc CỦA NÓ với ngưỡng CỦA NÓ. Lấy mốc phòng khám gán cho tab giường là
  // trấn an giả: luồng giường chết 3 tiếng mà pill vẫn xanh "chụp 10 phút trước".
  if (tabDangXem() === "giuong") {
    const g = window.GIUONG_DATA;
    // Chưa có dữ liệu = ĐANG NẠP (nạp lười, ~1–2 giây) chứ không phải hỏng → đừng báo động sớm.
    // giuong.js gọi lại updateAge() ngay khi nạp xong, nên trạng thái này chỉ thoáng qua.
    if (!g || !g.cap_nhat) { setRefreshStatus(`<span class="ic">🛏</span> Đang nạp số giường…`, "ok"); return; }
    const p = Math.max(0, Math.round((Date.now() - new Date(String(g.cap_nhat).replace(" ", "T")).getTime()) / 60000));
    setRefreshStatus(`<span class="ic">🛏</span> Số giường ${timeAgo(g.cap_nhat)}`,
                     p > 60 ? "err" : p > 15 ? "warn" : "ok");
    return;
  }
  if (!d) return;
  const iso = activeTabIso(d) || captureAgeIso(d);
  if (!iso) { setRefreshStatus(`<span class="ic">↻</span> Tự làm mới đang bật`, "ok"); return; }
  const m = Math.max(0, Math.round((Date.now() - new Date(String(iso).replace(" ", "T")).getTime()) / 60000));
  const lvl = m >= STALE_BAD_MIN ? "err" : m >= STALE_WARN_MIN ? "warn" : "ok";
  setRefreshStatus(`<span class="ic">📸</span> Số liệu chụp ${timeAgo(iso)}`, lvl);
}

// Lấy data mới: qua http dùng fetch (data.json); mở file:// thì nạp lại data.js (fetch bị chặn)
async function fetchLatest() {
  // BẢN CÔNG KHAI: số liệu KHÔNG nằm trong file tĩnh mà do cổng API phát ra sau
  // khi xác thực (auth.js cấp hàm này). Phải xét TRƯỚC mọi cách đọc file, vì
  // trên bản công khai `data.json`/`data.js` cố ý KHÔNG tồn tại.
  if (typeof window.API_FETCH_CLINIC === "function") {
    const d = await window.API_FETCH_CLINIC();
    if (d) window.DASHBOARD_DATA = d;
    return d || null;
  }
  if (location.protocol !== "file:") {       // tránh lỗi console "fetch file:// not supported"
    try {
      const res = await fetch("data.json?t=" + Date.now(), { cache: "no-store" });
      if (res.ok) { const d = await res.json(); window.DASHBOARD_DATA = d; return d; }
    } catch (e) { /* rơi xuống nạp data.js */ }
  }
  return await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(window.DASHBOARD_DATA || null); } };
    const s = document.createElement("script");
    // file:// hiểu "data.js?t=123" là TÊN FILE literal (không tồn tại) → onerror → giữ data cũ
    // (đây là lý do bấm "Làm mới" không cập nhật). file:// đọc thẳng từ đĩa nên không cần cache-bust.
    s.src = location.protocol === "file:" ? "data.js" : ("data.js?t=" + Date.now());
    s.setAttribute("data-dyn", "1");
    s.onload = () => {
      document.querySelectorAll('script[data-dyn]').forEach(x => { if (x !== s) x.remove(); });
      finish();
    };
    s.onerror = finish;
    document.body.appendChild(s);
    setTimeout(finish, 4000);   // CHỐNG TREO: Edge/file:// đôi khi không fire onload/onerror
  });
}

// ====== TIẾN TRÌNH LÀM MỚI THEO ĐẦU VIỆC THẬT ======
// Việc "làm mới" = chuỗi bước có thật, mỗi bước ứng 1 mốc %: nút biết khi nào XONG
// (thanh chạy hết + số đếm tới 100%), không phải trickle giả. Trọng số = thời lượng tương đối.
// Nhãn nói THẬT: nút chỉ ĐỌC LẠI bản chụp gần nhất script đã thu (không kéo số mới từ HIS)
// → tránh quản lý hiểu nhầm là real-time. Ngôn ngữ kết quả, không thuật ngữ kỹ thuật.
// NÓI THẬT bản chất: nút TẢI LẠI bản đã đăng trên máy chủ — KHÔNG kéo số mới từ HIS.
// Vì vậy nhãn là "tải lại bản đã đăng", không phải "đang cập nhật" (tránh hiểu nhầm real-time).
const REFRESH_STEPS = [
  { pct: 18, msg: "Đang tải lại bản đã đăng trên máy chủ" },
  { pct: 70, msg: "Đã tải xong" },               // fetch xong → nhảy tới đây
  { pct: 90, msg: "Đang hiển thị lại phòng khám" },
  { pct: 96, msg: "Đang hiển thị lại CĐHA-TDCN" },
  { pct: 100, msg: "Xong" },
];
const STEP_MIN_MS = 220;   // mỗi bước hiện tối thiểu chừng này → người dùng KỊP thấy nấc tiến

// Đặt thanh đỉnh trang về đúng % (không trickle giả) + bật hiển thị.
function topSet(pct) {
  const bar = document.getElementById("topbar");
  if (!bar) return;
  bar.classList.remove("done"); bar.classList.add("on");
  bar.style.width = Math.max(0, Math.min(100, pct)) + "%";
}
function topDone() {
  const bar = document.getElementById("topbar");
  if (!bar) return;
  bar.style.width = "100%";
  setTimeout(() => bar.classList.add("done"), 240);
  setTimeout(() => { bar.classList.remove("on", "done"); bar.style.width = "0%"; }, 760);
}

// Vẽ 1 bước: cập nhật thanh + pill (việc đang làm · số %), chờ tối thiểu để thấy được.
async function refreshStep(i) {
  const s = REFRESH_STEPS[i];
  topSet(s.pct);
  setRefreshStatus(
    `<span class="ic">⟳</span> <span class="rs-msg">${s.msg}…</span>`
    + `<b class="rs-pct">${s.pct}%</b>`, "updating");
  await new Promise(r => setTimeout(r, STEP_MIN_MS));
}

async function softRefresh(auto) {
  if (_refreshing) return false;
  _refreshing = true;
  const el = document.getElementById("refresh-status");
  const btn = document.getElementById("btn-reload");
  // AUTO (3 phút/lần): IM LẶNG — chỉ chạy thanh đỉnh mảnh, KHÔNG cướp pill (chống nhiễu/alarm-fatigue).
  // MANUAL (bấm nút): màn % đầy đủ — vì người dùng CHỦ ĐỘNG yêu cầu, muốn thấy phản hồi.
  if (!auto) {
    if (el) el.setAttribute("aria-busy", "true");
    if (btn) { btn.disabled = true; btn.classList.add("busy"); }
    _ubChecking = true; ubRender();          // thanh đếm ngược → "Đang kiểm tra…"
  }
  const step = auto ? (i => { topSet(REFRESH_STEPS[i].pct); }) : refreshStep;
  // Chữ ký bản hiện tại → so sau khi nạp để biết có BẢN MỚI hay không (báo thật, không reo nhầm).
  const prevSig = capSig(window.DASHBOARD_DATA);

  await step(0);
  const data = await fetchLatest();           // việc nặng nhất (mạng / nạp data.js)
  await step(1);

  let ok = false;
  if (data) {
    applyMeta(data);
    renderClinic(data);                        // KPI + thẻ phòng + xu hướng
    await step(2);
    renderCLS(data.cls);                        // tab CĐHA-TDCN
    renderPT(data.pt);                          // tab PT-TT
    renderToa(data.toa);                         // tab Toa thuốc
    renderKtd(data.ktd);                          // tab Khám toàn diện
    renderFooter(data);
    await step(3);
    await step(4);                              // 100% — hoàn tất
    ok = true;
  }

  _refreshing = false;
  if (btn) { btn.disabled = false; btn.classList.remove("busy"); }
  if (el) el.setAttribute("aria-busy", "false");
  topDone();
  if (ok) {
    // Có BẢN MỚI thật? (so chữ ký độ tươi 2 lần nạp) — quyết định cho cả pill lẫn thanh đếm ngược.
    const fresh = capSig(data) !== prevSig;
    // AUTO: chỉ lặng lẽ cập nhật nhãn độ tươi. MANUAL: báo XONG rõ ràng (✓ + 100% nhấp sáng).
    if (auto) { updateAge(); }
    else {
      // NÓI THẬT: nút chỉ TẢI LẠI bản đã đăng (không kéo số mới từ HIS). Có bản mới → khoe tuổi
      // bản mới; CÙNG bản cũ → KHÔNG loé "Hoàn tất" gây hiểu nhầm vừa cập nhật, mà giải thích vì
      // sao số vẫn là N phút trước + nhịp đăng của máy thu thập → người ở xa hiểu đúng, hết bức xúc.
      const ageIso = activeTabIso(data) || captureAgeIso(data);
      if (fresh) {
        setRefreshStatus(
          `<span class="ic flash">✓</span> Đã có số mới <b class="rs-pct ok">${timeAgo(ageIso)}</b>`, "ok");
        setTimeout(updateAge, 2200);
      } else {
        const am = ageIso ? Math.max(0, Math.round((Date.now() - new Date(String(ageIso).replace(" ", "T")).getTime()) / 60000)) : 0;
        const lvl = am >= STALE_BAD_MIN ? "err" : am >= STALE_WARN_MIN ? "warn" : "ok";
        setRefreshStatus(
          `<span class="ic">↻</span> <span class="rs-msg">Máy chủ chưa có bản mới — số liệu vẫn là `
          + `bản chụp ${timeAgo(ageIso)}. Máy thu thập đăng số mới mỗi ~15′.</span>`, lvl);
        setTimeout(updateAge, 4500);   // để câu giải thích nán lại lâu hơn
      }
    }
    // Thanh đếm ngược: bản mới → vọt 100% + loé "xong" rồi reset chu kỳ; không mới → về đếm tiếp.
    if (fresh) ubOnNewData();
    else { _ubChecking = false; ubRender(); }
    return true;
  }
  _ubChecking = false; ubRender();
  if (!auto) setRefreshStatus(`<span class="ic">⚠</span> Chưa tải được — sẽ thử lại`, "err");
  return false;
}

// LÚC MỞ: render NGAY từ data.js tĩnh đã nạp (KHÔNG chờ nạp động — tránh treo màn chờ trên file://)
function load() {
  render(window.DASHBOARD_DATA || null);
  updateAge();
}

// Chuyển tab (Phòng khám ↔ CĐHA-TDCN); nhớ tab đang xem qua localStorage
function switchTab(name) {
  document.querySelectorAll(".tab[data-tab]").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach(p =>
    p.classList.toggle("active", p.id === "tab-" + name));
  try { localStorage.setItem("dash_tab", name); } catch (e) { /* file:// */ }
  updateAge();   // pill header đổi theo giờ chụp của tab vừa chuyển sang
  // Dải "Chỉ xem Khu …" chỉ đúng với 2 tab dùng luồng phòng khám/CĐHA → dựng lại theo tab.
  if (typeof applyScopeBand === "function") applyScopeBand(_khuFilter);
  // Tab Phòng · Giường có luồng dữ liệu riêng (giuong-data.js ~530 KB) → nạp LƯỜI lúc mở lần đầu.
  // Gọi mỗi lần mở (không chỉ lần đầu): phần tử đang ẩn đo ra 0px nên thanh dính phải đo lại khi hiện.
  if (name === "giuong" && window.GiuongTab) window.GiuongTab.moTab();
}
// `[data-tab]` — chỉ những thẻ CÓ panel. Giữ bộ lọc này để thêm một thẻ dẫn ra ngoài (nếu sau
// này có) không làm switchTab(undefined) tắt sạch panel đang mở.
document.querySelectorAll(".tab[data-tab]").forEach(b =>
  b.addEventListener("click", () => switchTab(b.dataset.tab)));
try {
  const saved = localStorage.getItem("dash_tab");
  if (saved) switchTab(saved);
} catch (e) { /* file:// */ }
// Từ trang giuong.html quay lại: `index.html#cls` phải mở ĐÚNG tab đó, không phải tab nhớ trong
// localStorage — người dùng vừa bấm thẳng vào tên tab thì đó mới là ý định. Hash thắng bộ nhớ.
{
  const h = (location.hash || "").slice(1);
  if (h && document.getElementById("tab-" + h)) switchTab(h);
}

// Sắp xếp bảng dịch vụ (Tồn đọng ↔ Tổng ca) — scope theo tab (cls / pt) để 2 bảng độc lập.
document.querySelectorAll(".sortbtn").forEach(b =>
  b.addEventListener("click", () => {
    const panel = b.closest(".tab-panel");
    if (panel && panel.id === "tab-ktd") {        // tab Khám toàn diện có handler riêng
      _ktdSort.by = b.dataset.sort;
      panel.querySelectorAll(".ktd-sort").forEach(x => x.classList.toggle("active", x === b));
      renderKtdTable();
      return;
    }
    const key = panel && panel.id === "tab-pt" ? "pt" : "cls";
    SVC_TAB[key].sort = b.dataset.sort;
    // chỉ đổi active trong CÙNG nhóm sort của tab này
    (panel || document).querySelectorAll(".sortbtn").forEach(x =>
      x.classList.toggle("active", x === b));
    if (SVC_TAB[key].data) renderSvcTable(key);
  }));

// Thu gọn/mở section trong tab Khám toàn diện — nhớ trạng thái. (BS: mặc định MỞ; Flow: mặc định ĐÓNG)
function ktdToggle(btnId, boxId, key, defOpen) {
  const btn = document.getElementById(btnId);
  const box = document.getElementById(boxId);
  if (!btn || !box) return;
  let open = defOpen;
  try { const v = localStorage.getItem(key); if (v !== null) open = v === "1"; } catch (e) {}
  const apply = () => {
    box.hidden = !open;
    btn.setAttribute("aria-expanded", open);
    btn.querySelector(".caret").textContent = open ? "▾" : "▸";
  };
  btn.addEventListener("click", () => {
    open = !open;
    try { localStorage.setItem(key, open ? "1" : "0"); } catch (e) {}
    apply();
  });
  apply();
}
ktdToggle("ktd-rate-toggle", "ktd-rate-body", "ktd_rate_open", false);
ktdToggle("ktd-doctors-toggle", "ktd-doctors", "ktd_doctors_open", false);

// Bấm 1 phòng trong mục ≥65 → bung/thu danh sách BN của phòng đó (mặc định thu gọn cho dễ nhìn).
(function () {
  const box = document.getElementById("ktd-elderly");
  if (!box) return;
  box.addEventListener("click", (e) => {
    // 1 phòng riêng HOẶC nút đuôi "phòng còn lại" — cùng cơ chế bung/thu khối kế bên.
    const top = e.target.closest(".ktd-eld-top, .ktd-eld-minortog");
    if (!top || !box.contains(top)) return;
    const list = top.nextElementSibling;
    if (!list) return;
    const open = list.hidden;
    list.hidden = !open;
    top.setAttribute("aria-expanded", open);
    const c = top.querySelector(".ktd-eld-caret");
    if (c) c.textContent = open ? "▾" : "▸";
  });
})();

// Thu gọn/mở danh sách BN khám toàn diện (thứ yếu) — nhớ trạng thái
(function () {
  const btn = document.getElementById("ktd-detail-toggle");
  const box = document.getElementById("ktd-patients");
  if (!btn || !box) return;
  let open = false;
  try { open = localStorage.getItem("ktd_detail_open") === "1"; } catch (e) {}
  const apply = () => {
    box.hidden = !open;
    btn.setAttribute("aria-expanded", open);
    btn.querySelector(".caret").textContent = open ? "▾" : "▸";
  };
  btn.addEventListener("click", () => {
    open = !open;
    try { localStorage.setItem("ktd_detail_open", open ? "1" : "0"); } catch (e) {}
    apply();
  });
  apply();
})();

// Bấm thanh đếm ngược = KIỂM TRA NGAY (nạp lại data mới nhất máy đã đẩy)
document.getElementById("update-bar").addEventListener("click", () => softRefresh(false));

// Thu gọn/mở khối xu hướng (thứ yếu) — nhớ trạng thái
(function () {
  const btn = document.getElementById("trend-toggle");
  const box = document.getElementById("trend");
  if (!btn || !box) return;
  let open = false;
  try { open = localStorage.getItem("trend_open") === "1"; } catch (e) {}
  const apply = () => {
    box.hidden = !open;
    btn.setAttribute("aria-expanded", open);
    btn.querySelector(".caret").textContent = open ? "▾" : "▸";
  };
  apply();
  btn.addEventListener("click", () => {
    open = !open;
    try { localStorage.setItem("trend_open", open ? "1" : "0"); } catch (e) {}
    apply();
  });
})();

// ===== THANH ĐẾM NGƯỢC TỰ-CẬP-NHẬT (thay nút "Làm mới") =====
// Đầy dần từ mốc "vừa cập nhật xong" (captured_at MỚI NHẤT) qua 1 chu kỳ auto (data.auto.interval_min).
// Web KHÔNG thấy máy local chạy trực tiếp → DỰ ĐOÁN theo lịch. Khi phát hiện captured_at đổi
// (bản mới thật) → vọt 100% + loé xanh-lá → reset chạy lại chu kỳ mới. Ngoài giờ làm → tạm dừng.
// Fallback khi data.json thiếu khối `auto` — phải khớp GIỜ KHÁM CS1 (6:00–20:00, cả 7 ngày),
// không phải giờ CS2 (7:00–16:30, T2–T6): sai thì thanh đếm ngược tự "tạm dừng" giữa ca chiều/cuối tuần.
const UB_DEFAULT = { interval_min: 5, work_start: [6, 0], work_end: [20, 0],
                     work_days: [0, 1, 2, 3, 4, 5, 6], pipeline_lag_sec: 180 };
let _ubChecking = false, _ubTimer = null;

function ubAuto() { const d = window.DASHBOARD_DATA; return (d && d.auto) || UB_DEFAULT; }
function ubFreshestIso(d) {   // mốc MỚI NHẤT giữa 2 tab = "vừa cập nhật xong"
  const isos = [d && d.captured_at, d && d.cls && d.cls.captured_at].filter(Boolean);
  return isos.length ? isos.slice().sort().slice(-1)[0] : null;
}
function ubInWork(a, now) {
  const wd = (now.getDay() + 6) % 7;                 // JS 0=CN → quy ước py 0=T2
  if (!(a.work_days || []).includes(wd)) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  return cur >= a.work_start[0] * 60 + a.work_start[1]
      && cur <= a.work_end[0] * 60 + a.work_end[1];
}
function ubSet(cls, pct, label) {
  const bar = document.getElementById("update-bar"); if (!bar) return;
  bar.className = "update-bar" + (cls ? " " + cls : "");
  bar.querySelector(".ub-fill").style.width = Math.max(0, Math.min(100, pct)) + "%";
  bar.querySelector(".ub-label").textContent = label;
}
function ubRender() {
  if (_ubChecking) { ubSet("checking", 100, "⟳ Đang kiểm tra…"); return; }
  const bar = document.getElementById("update-bar");
  if (!bar || bar.classList.contains("done")) return;   // đang loé "xong" → để yên
  const d = window.DASHBOARD_DATA, a = ubAuto(), now = new Date();
  if (!ubInWork(a, now)) {
    const hh = String(a.work_start[0]).padStart(2, "0") + ":" + String(a.work_start[1]).padStart(2, "0");
    ubSet("offhours", 0, "🌙 Ngoài giờ · mở lại " + hh); return;
  }
  const iso = ubFreshestIso(d);
  if (!iso) { ubSet("checking", 100, "↻ Đang chờ số liệu…"); return; }
  const startMs = new Date(String(iso).replace(" ", "T")).getTime();
  const lenMs = (a.interval_min || 30) * 60000;
  const lagMs = (a.pipeline_lag_sec || 180) * 1000;
  const elapsed = now.getTime() - startMs;
  if (elapsed < lenMs) {                                 // còn trong chu kỳ → đếm ngược
    const remain = Math.max(1, Math.ceil((lenMs - elapsed) / 60000));
    ubSet("", elapsed / lenMs * 100, "↻ Cập nhật sau ~" + remain + "′");
  } else if (elapsed - lenMs <= Math.max(lagMs * 2, 300000)) {  // quá mốc → pipeline đang chạy
    ubSet("overdue", 100, "⏳ Đang cập nhật & đẩy web…");
  } else {                                              // quá lâu không có bản mới → máy có thể tắt
    ubSet("overdue", 100, "⚠ Chưa có bản mới · " + timeAgo(iso));
  }
}
function ubOnNewData() {   // phát hiện bản mới thật → vọt 100% + loé xanh-lá → reset
  const bar = document.getElementById("update-bar"); if (!bar) return;
  _ubChecking = false;
  ubSet("done", 100, "✓ Đã cập nhật");
  setTimeout(() => { bar.classList.remove("done"); ubRender(); }, 1400);
}
function ubStart() { ubRender(); clearInterval(_ubTimer); _ubTimer = setInterval(ubRender, 1000); }

load();
ubStart();

// ---- Tự nạp lại NGẦM, nhẹ & lịch sự (theo best-practice dashboard real-time) ----
// 5 phút — BẰNG chu kỳ `--auto --interval 5`. Trước đây để 10' (di sản nhịp build web của CS2)
// → số mới nằm sẵn trên máy/Worker mà trang vẫn hiện số của vòng trước, người xem tưởng luồng
// thu thập đã chết. Tab Phòng·Giường (`giuong.js LAM_MOI_PHUT`) vốn đã 5' — nay cả 3 tab cùng nhịp.
const AUTO_MS = 300000;
const RETRY_MS = 30000;     // lỗi/hoãn → thử lại sớm
let _autoTimer = null;

function userBusy() {
  // Đang bôi đen/chọn text → HOÃN (không cướp nội dung người dùng đang đọc/sao chép)
  const sel = window.getSelection && window.getSelection();
  return !!(sel && String(sel).trim());
}
function scheduleAuto(delay) {
  clearTimeout(_autoTimer);
  _autoTimer = setTimeout(autoTick, delay == null ? AUTO_MS : delay);
}
async function autoTick() {
  // Tab ẩn (Page Visibility) hoặc user đang thao tác → hoãn, KHÔNG bỏ
  if (document.hidden || userBusy()) { scheduleAuto(RETRY_MS); return; }
  const ok = await softRefresh(true);
  scheduleAuto(ok ? AUTO_MS : RETRY_MS);   // lỗi → back-off ngắn
}
// Ẩn tab thì NGỪNG nạp (đỡ tốn tài nguyên); quay lại thì nạp ngay 1 lần
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { clearTimeout(_autoTimer); }
  else { softRefresh(true); scheduleAuto(); }
});
scheduleAuto();

// Cập nhật nhãn "x phút trước" mỗi 30s cho người dùng thấy độ tươi mà không cần thao tác.
setInterval(updateAge, 30000);

// ============================================================
// CHẾ ĐỘ MÀN HÌNH TƯỜNG (TV) — chữ to, ẩn nút, TỰ XOAY 2 tab.
// Bật: nút 📺 hoặc mở URL kèm ?tv=1 (cắm thẳng vào TV/kiosk). Thoát: Esc / nút.
// ============================================================
const TV_ROTATE_S = 15;          // số giây mỗi tab trước khi xoay
let _tvOn = false, _tvTimer = null, _tvLeft = TV_ROTATE_S;

function tvTick() {
  _tvLeft -= 1;
  const c = document.getElementById("tv-count");
  if (c) c.textContent = _tvLeft;
  if (_tvLeft <= 0) {
    // Xoay theo CÁC TAB THỰC SỰ có trong DOM (CS1 GĐ1 chỉ có "clinic"; tự mở rộng khi thêm tab).
    // ⚠️ BỎ tab Phòng·Giường khỏi vòng xoay: màn hình tường là để BGĐ theo dõi ĐIỀU PHỐI
    // (hàng đợi phòng khám / CĐHA), còn sơ đồ giường dài ~70 màn — xoay tới nó thì màn hình
    // chỉ hiện được đúng 1/70 nội dung, lại kéo thêm nửa MB dữ liệu mỗi vòng.
    const order = [...document.querySelectorAll(".tab[data-tab]")]
      .map(t => t.dataset.tab).filter(t => t !== "giuong");
    const cur = document.querySelector(".tab.active");
    const i = cur ? order.indexOf(cur.dataset.tab) : 0;
    switchTab(order[(i + 1) % order.length]);
    _tvLeft = TV_ROTATE_S;
  }
}
function setTV(on) {
  _tvOn = on;
  document.body.classList.toggle("tv", on);
  const btn = document.getElementById("btn-tv");
  if (btn) btn.setAttribute("aria-pressed", on);
  clearInterval(_tvTimer);
  if (on) {
    _tvLeft = TV_ROTATE_S;
    const c = document.getElementById("tv-count"); if (c) c.textContent = _tvLeft;
    _tvTimer = setInterval(tvTick, 1000);
    try { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); } catch (e) {}
  } else {
    try { document.fullscreenElement && document.exitFullscreen(); } catch (e) {}
  }
}
const _btnTv = document.getElementById("btn-tv");
if (_btnTv) _btnTv.addEventListener("click", () => setTV(!_tvOn));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && _tvOn) setTV(false); });
try { if (new URLSearchParams(location.search).get("tv") === "1") setTV(true); } catch (e) {}

// ============================================================
// IN / XUẤT PDF — in TAB ĐANG XEM (CSS @media print lo phần trình bày).
// ============================================================
const _btnPrint = document.getElementById("btn-print");
if (_btnPrint) _btnPrint.addEventListener("click", () => window.print());

// Nút ⏻ Đăng xuất chỉ có nghĩa trên bản WEB (có phiên đăng nhập). Mở LOCAL (file://) thì
// /__logout không tồn tại → ẩn đi để khỏi bấm hụt (thân thiện hơn khi xem local).
(function () {
  const lo = document.getElementById("btn-logout");
  if (lo && location.protocol === "file:") lo.style.display = "none";
})();

// Nút gập/mở khối phân tích của tab CĐHA (câu hỏi phân tích → không hiện mặc định, §12.5).
// ⚠️ Mỗi khối một KHOÁ NHỚ RIÊNG: dùng chung khoá thì mở khối này, lần tự nạp lại sau (5') bung
//    nhầm cả khối kia (đúng bẫy đã ghi ở §12.10 với 2 <details> trong cùng một thẻ).
// ⚠️ "Bố trí phòng theo khung giờ" đã RA KHỎI danh sách này (user chốt 2026-08-17: luôn mở, không
//    có nút đóng). Giữ vòng lặp dạng danh sách để thêm khối gập mới không phải viết lại; đừng thêm
//    `cls-botri-toggle` trở lại — phần tử đó không còn tồn tại trong index.html.
[["cls-svc-toggle", "cls-svc", "cls_svc_open"]].forEach(([bId, sId, KEY]) => {
  const btn = document.getElementById(bId);
  const sec = document.getElementById(sId);
  if (!btn || !sec) return;
  const set = (open) => {
    sec.hidden = !open;
    btn.setAttribute("aria-expanded", open);
    btn.querySelector(".caret").textContent = open ? "▾" : "▸";
    try { localStorage.setItem(KEY, open ? "1" : "0"); } catch (e) {}
  };
  let init = false;
  try { init = localStorage.getItem(KEY) === "1"; } catch (e) {}
  set(init);
  btn.addEventListener("click", () => set(sec.hidden));
});
