// Hata kurtarma yalnız sekmenin oda kaydını unutur. Firebase'in anonim
// kimliği IndexedDB'dedir; onu silmek oyuncuyu mevcut koltuğundan koparabilir.
export function resetSavedRoom(browserWindow = window) {
  try { browserWindow.sessionStorage.removeItem('activeRoom'); } catch { /* depolama engelli olabilir */ }
  try { browserWindow.localStorage.removeItem('activeRoom'); } catch { /* eski sürüm kaydı */ }
  browserWindow.location.reload();
}
