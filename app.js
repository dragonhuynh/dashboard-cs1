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
function roomCard(r, rank, maxWait) {
  const tag = { red: "⛔ Quá tải", amber: "⚠️ Đông" };
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
    const loc = r.nhom || r.khoa || "";                     // khoa · tầng → biết đi đâu (thẻ nay nằm trong khu)
    return `<div class="room ${lv}">
      <div class="name">${r.name}
        <span class="rank"><span class="rstat ${lv}">${tag[lv]}</span> #${rank}</span></div>
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
function bsBox(r, bb, L, sumCls, sumInner, tip) {
  const body = sessionBody(bb, L);
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
  return `<div class="dv-wrap"><div class="dv-h">Đang chờ theo loại kỹ thuật</div>
    <div class="dv-chips">${chips}</div></div>`;
}

// CHI TIẾT: đủ MỌI loại của phòng hôm nay (kể cả đã làm xong) với tên ĐẦY ĐỦ nguyên văn HIS +
// đủ 5 trạng thái. Gập mặc định để dòng/thẻ không phình — cùng khuôn <details> với khối bác sĩ.
function svcDetail(r) {
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
    ? `<div class="bs-buoi"><div class="bs-buoi-h">${label}
         <span class="bs-buoi-n">${fmt(arr.reduce((s, d) => s + (d.ton || 0), 0))} ca · ${arr.length} loại</span>
       </div>${rows(arr)}</div>` : "";
  return `<details class="bs-detail dv-detail"><summary>📋 Loại dịch vụ hôm nay (${ds.length})</summary>
    ${seg("Còn đang chờ", cho)}${seg("Đã làm xong", xong)}</details>`;
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

// TAB PHÒNG KHÁM — GOM TẤT CẢ THEO KHU, mỗi khu hiện ĐỦ phòng (user chốt 2026-07-16). Bỏ mục
// "cần thêm bác sĩ" toàn viện ở đầu: nó rút phòng nặng ra khỏi khu → khu trông thiếu phòng
// ("Khu N 50 phòng mà chỉ thấy 22"). Nay điều phối viên đi tòa nào là thấy HẾT phòng tòa đó:
//  • phòng quá tải (đỏ) = THẺ lớn, xếp đầu khu theo mức nặng · #N vẫn là hạng TOÀN VIỆN.
//  • phòng còn lại (cam/xanh) = DÒNG gọn, đều kèm tên bác sĩ trực.
function renderRooms() {
  const rooms = _roomsData || [];
  const wrap = document.getElementById("rooms");
  if (!rooms.length) { wrap.innerHTML = `<p class="empty">Chưa có số liệu phòng.</p>`; return; }

  // Hạng TOÀN VIỆN cho phòng quá tải → #N trên thẻ vẫn so được cả bệnh viện dù đã gom theo khu.
  const redAll = rooms.filter(r => levelOf(r) === "red")
                      .sort((a, b) => (b.dang_cho || 0) - (a.dang_cho || 0));
  const rankOf = new Map(redAll.map((r, i) => [r.key, i + 1]));

  // CHẶN TRÊN 10 THẺ — tính TOÀN VIỆN, không phải mỗi khu (§12.7; tab CĐHA đã có, tab này còn sót
  // → đo 2026-07-16: 38 thẻ · 15,5 màn mobile, đúng bệnh alarm-fatigue mà §12.4/§12.5 đã trị).
  // Không ai dồn người về 38 phòng cùng lúc; 10 việc là tối đa một điều phối viên xử lý được.
  // Phòng đỏ ngoài top-10 KHÔNG bị giấu: tụt xuống dòng gọn trong khu của nó, vẫn tô đỏ, vẫn đếm
  // ở dòng tổng khu → không mất thông tin, chỉ thôi chiếm chỗ (luật "thẻ = hành động · dòng = tra cứu").
  const HOT_MAX = 10;
  const hotKeys = new Set(redAll.slice(0, HOT_MAX).map(r => r.key));

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
    const redKhu = list.filter(r => levelOf(r) === "red");            // MỌI phòng đỏ của khu (để đếm + chuẩn hóa thanh)
    const cards = redKhu.filter(r => hotKeys.has(r.key)).sort((a, b) => (b.dang_cho || 0) - (a.dang_cho || 0));
    const rest = list.filter(r => !hotKeys.has(r.key));
    const label = (_khuLabels && _khuLabels[khu]) || khu;
    const tot = list.reduce((s, r) => s + (r.dang_cho || 0), 0);
    // Thanh trong thẻ chuẩn hóa theo phòng nặng nhất CỦA KHU — lấy trên redKhu (không phải `cards`),
    // nếu không thì khu bị cap sẽ tự chuẩn theo thẻ #1 của nó → thanh dài như khu nặng nhất, sai lệch.
    const maxW = redKhu.reduce((m, r) => Math.max(m, r.dang_cho || 0), 0) || 1;
    html += `<section class="khu-block ${khuSlug(khu)}">
      <div class="khu-head"><span class="khu-tag ${khuSlug(khu)}-tag">${khuTag(khu)}</span>
        <h2 class="khu-title">${label}</h2>
        <span class="khu-sum">${list.length} phòng · <b>${fmt(tot)}</b> người chờ`
      + (redKhu.length ? ` · <b class="k-red">${redKhu.length} quá tải</b>` : "")
      + `</span></div>`;
    if (cards.length)
      html += `<div class="rooms-grid">${cards.map(r => roomCard(r, rankOf.get(r.key), maxW)).join("")}</div>`;
    // TRA CỨU gom theo TẦNG, mỗi tầng một hàng riêng → phòng CÙNG TẦNG đứng cạnh nhau, xuống dòng
    // là tầng khác (user chốt 2026-07-16). Trước đây khu xếp thẳng theo số người chờ nên Tầng
    // 1/2/3/4 TRỘN LẪN (Khu N: 35 phòng lẫn lộn) → đi thực địa phải chạy lên chạy xuống.
    // Gom theo TẦNG chứ KHÔNG theo khoa·tầng: một tầng có nhiều khoa (tầng 4 Nhà N có cả Phụ sản N
    // (VIP) lẫn Tạo Hình Thẩm Mỹ) — gom theo khoa·tầng thì cùng một tầng bị xé làm 2 cụm rời, đúng
    // cái TANG_VIP_CUA_KHOA đã cảnh báo. Người đi điều phối lên tầng 4 là xử hết phòng tầng 4.
    // Thứ tự = ĐƯỜNG ĐI THỰC ĐỊA trệt→1→2→3→4, "chưa rõ tầng" xuống CUỐI (§5b).
    if (rest.length) {
      const byTang = new Map();
      rest.forEach(r => {
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
            <div class="calm-list">${g.map(r => pkRestRow(r, r.khoa || "")).join("")}</div>
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

// Thẻ lớn 1 phòng CĐHA — CHỈ dùng cho phòng phải can thiệp ngay (đỏ). rank = hạng TOÀN VIỆN.
// maxTon = mốc chuẩn hóa thanh (phòng nặng nhất viện) → so trực tiếp được giữa các thẻ.
// KHÔNG có dòng lệnh "→ …" trên thẻ: lệnh gần như giống nhau ở mọi phòng, lặp hàng chục lần thì
// nó thành nhiễu chứ không còn là lệnh. Lệnh nằm DUY NHẤT ở dải hành động phía trên.
function clsRoomCard(r, rank, maxTon, khuLabels) {
  const cho = r.cho_tiep_nhan || 0, lam = r.da_tiep_nhan || 0;
  const w = Math.round((r.ton_dong || 0) / Math.max(1, maxTon) * 100);
  const bnCho = cho >= lam;                 // nút thắt = khâu đọng nhiều hơn → tô nổi
  const cellC = `<span class="d-cell${bnCho && cho > 0 ? " bottleneck" : ""}"><span class="d-lbl">Chờ tiếp nhận</span>${bnum(cho)}</span>`;
  const cellL = `<span class="d-cell${!bnCho && lam > 0 ? " bottleneck" : ""}"><span class="d-lbl">Đang làm</span>${bnum(lam)}</span>`;
  // Thẻ nằm ngoài phân cấp khu → phải TỰ nói vị trí, nếu không biết nặng mà không biết đi đâu.
  // Nhãn khu phải lấy từ bảng của CHÍNH tab CĐHA: tab Phòng khám không có phòng ở Khu A nên
  // bảng nhãn của nó thiếu 'Nhà A' → tra nhầm bảng sẽ rớt về chuỗi thô "Nhà A".
  const tang = String(r.nhom || "").split(" · ")[1];
  const noi = [(khuLabels && khuLabels[r.khu]) || r.khu, tang].filter(Boolean).join(" · ");
  return `<div class="room ${clsLevelOf(r)}">
    <div class="name">${r.name} <span class="rank">#${rank}</span></div>
    <div class="room-noi">${noi}</div>
    <div class="wait"><span class="wlead"><span class="wnum">${fmt(r.ton_dong)}</span> <small>ca chưa xong</small></span></div>
    <div class="bar"><i style="width:${w}%"></i></div>
    <div class="detail">${cellC}${cellL}</div>
    ${svcWaitChips(r)}
    ${performerLine(r)}
    ${performerSessionDetail(r)}
    ${svcDetail(r)}
  </div>`;
}

// AI ĐANG LÀM ở phòng CĐHA — từ `tenNguoiThucHien`. Gọi "người thực hiện", KHÔNG gọi "bác sĩ":
// CĐHA do cả KTV (X-quang) lẫn bác sĩ (siêu âm) làm → gọi hết là BS là SAI sự thật.
// Phòng chưa ai làm (toàn ca chờ tiếp nhận) → dòng mờ, giữ chỗ cho thẻ khỏi nhảy layout.
// "N người" trơ bị đọc thành "N người cùng lúc" (đúng lỗi đã trị ở dòng bác sĩ tab Phòng khám,
// xem .claude/rules/ngon-ngu-ui.md) → ghi "luân phiên": họ thay ca nhau trong ngày.
function performerLine(r) {
  const ten = (r.nguoi_chinh || "").trim();
  const n = r.so_nguoi || 0;
  if (!ten) return `<div class="room-doc none">👨‍⚕️ <span>chưa ai thực hiện</span></div>`;
  return `<div class="room-doc">👨‍⚕️ ${n >= 2 ? `<b>${n} người luân phiên</b> · chính: ${ten}` : ten}</div>`;
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
  // KHỐI MỞ RỘNG (user chốt 2026-08-17): loại kỹ thuật đang chờ + ai đang làm + chi tiết đủ loại.
  // ⚠️ Phải có ở DÒNG GỌN, không chỉ ở thẻ: ngưỡng đỏ tab này là 40 ca (CLS_RED) nên giờ thường
  // KHÔNG phòng siêu âm nào lên thẻ — đo mốc 08:50: phòng nặng nhất 23 ca ⇒ nếu chỉ làm ở thẻ thì
  // đúng những phòng user hỏi lại là những phòng không có gì. Chi tiết bác sĩ cũng vậy: dòng gọn
  // trước đây chỉ có "👨‍⚕️ Tên +1", bấm không ra được ai làm buổi nào (thẻ tab Phòng khám thì có).
  const more = svcWaitChips(r) + performerSessionDetail(r) + svcDetail(r);
  return `<div class="room-calm ${clsLevelOf(r)}" title="${esc(tip)}"><span class="rc-dot"></span>
    <span class="rc-name">${r.name}<span class="rc-noi">${noi}${noi && ng ? " · " : ""}${ng}</span>${
      tt ? `<span class="rc-tt">${tt}</span>` : ""}</span>
    <span class="rc-wait">${ton ? fmt(ton) + " ca" : "✓ xong"}</span>${
      more ? `<div class="rc-more">${more}</div>` : ""}</div>`;
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

  // ===== GOM TẤT CẢ THEO KHU, mỗi khu ĐỦ phòng — CÙNG khuôn với tab Phòng khám (user chốt 2026-07-16).
  // Bỏ mục "phòng cần dồn người" toàn viện: nó rút phòng ùn ra khỏi khu → khu trông thiếu phòng.
  // Trong khu: phòng ùn nặng (đỏ) = THẺ · còn lại = DÒNG gọn. #N vẫn là hạng TOÀN VIỆN.
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
    const red = list.filter(r => clsLevelOf(r) === "red").sort((a, b) => (b.ton_dong || 0) - (a.ton_dong || 0));
    const rest = list.filter(r => clsLevelOf(r) !== "red").sort((a, b) => (b.ton_dong || 0) - (a.ton_dong || 0));
    const label = (cls.khu_labels && cls.khu_labels[khu]) || khu;
    const tot = list.reduce((s, r) => s + (r.ton_dong || 0), 0);
    const maxT = red.length ? (red[0].ton_dong || 1) : 1;   // thanh chuẩn hóa theo phòng nặng nhất CỦA KHU
    html += `<section class="khu-block ${khuSlug(khu)}">
      <div class="khu-head"><span class="khu-tag ${khuSlug(khu)}-tag">${khuTag(khu)}</span>
        <h2 class="khu-title">${label}</h2>
        <span class="khu-sum">${list.length} phòng · <b>${fmt(tot)}</b> ca chưa xong`
      + (red.length ? ` · <b class="k-red">${red.length} ùn nặng</b>` : "")
      + `</span></div>`;
    if (red.length)
      html += `<div class="rooms-grid">${red.map(r => clsRoomCard(r, rankOf.get(r.key), maxT, cls.khu_labels)).join("")}</div>`;
    // TRA CỨU gom theo TẦNG — CÙNG luật với tab Phòng khám (§5b/§12.8): mỗi tầng một hàng riêng,
    // thứ tự = đường đi thực địa trệt→1→2→3→4, "chưa rõ tầng" xuống CUỐI. Gom theo TẦNG chứ KHÔNG
    // theo khoa·tầng: một tầng có nhiều khoa → gom theo khoa·tầng thì cùng một tầng bị xé làm 2 cụm.
    if (rest.length) {
      const byTang = new Map();
      rest.forEach(r => {
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
            <div class="calm-list">${g.map(r => clsRestRow(r, r.khoa || "")).join("")}</div>
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

// Wrapper 2 tab dịch vụ — cùng code, khác cfg.
// CĐHA có THÊM khối phòng (renderClsRooms chạy SAU → nắm dải hành động + huy hiệu tab, xem ghi chú trong hàm).
function renderCLS(cls) { renderSvcTab("cls", cls); renderClsRooms(cls); }
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

// Nút gập/mở khối "theo loại kỹ thuật" (câu hỏi phân tích → không hiện mặc định).
(function () {
  const btn = document.getElementById("cls-svc-toggle");
  const sec = document.getElementById("cls-svc");
  if (!btn || !sec) return;
  const KEY = "cls_svc_open";
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
})();
