export function ReadOnlyBanner() {
  return (
    <div className="fixed top-0 inset-x-0 z-50 bg-amber-500 text-white text-center text-sm font-semibold py-2 px-4 shadow-md">
      Tab này chỉ xem — POS đang hoạt động ở tab khác. Đóng tab khác để chiếm leader.
    </div>
  )
}
