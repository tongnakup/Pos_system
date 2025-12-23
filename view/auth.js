const userSession = sessionStorage.getItem("pos_user");

if (!userSession) {
  window.location.href = "/login.html";
} else {
  const user = JSON.parse(userSession);

  if (window.location.pathname.includes("/admin") && user.role !== "admin") {
    alert("⛔️ คุณไม่มีสิทธิ์เข้าถึงหน้านี้ (เฉพาะผู้จัดการ)");
    window.location.href = "/";
  }
}

//(Logout)
<div
  class="menu-item"
  onclick="openLogoutModal()"
  style="background: #c0392b; margin-top: 10px"
>
  <span>🚪</span> ออกจากระบบ
</div>;
