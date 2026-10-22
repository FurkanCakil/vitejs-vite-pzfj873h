export const SERVER_XOX_ENABLED = import.meta.env?.VITE_SERVER_XOX_ENABLED === 'true';

export class GameApiError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function randomRequestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

export function createGameApi(getToken, fetcher = fetch) {
  return async function send(fields, { keepalive = false } = {}) {
    const body = JSON.stringify({ ...fields, actionId: randomRequestId() });
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await getToken(attempt > 0);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      try {
        const response = await fetcher('/api/room-action', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body, signal: controller.signal, keepalive,
        });
        const result = await response.json();
        if (response.status === 401 && attempt === 0) continue;
        if (!response.ok || !result.ok) throw new GameApiError(result.error || 'service_unavailable');
        return result;
      } catch (error) {
        if (error instanceof GameApiError) throw error;
        if (attempt === 1 || keepalive) throw new GameApiError('connection_failed');
        // Retries retain the same action ID, including after a lost response.
      } finally { clearTimeout(timeout); }
    }
    throw new GameApiError('invalid_token');
  };
}

export function gameErrorMessage(error) {
  return ({
    room_not_found: 'Böyle bir oda kodu yok.', room_closed: 'Bu oda kapalı.',
    room_full: 'Bu odadaki oyuncu koltukları dolu.',
    stale_version: 'Oyun güncellendi. Son durumu kontrol edip tekrar dene.',
    player_disconnected: 'Rakibin bağlantısı bekleniyor.',
    player_reconnected: 'Rakibin yeniden bağlandı; oyun devam ediyor.',
    not_your_turn: 'Henüz senin sıran değil.', occupied_cell: 'Bu kare dolu.',
    too_many_actions: 'Çok hızlı işlem yapıldı. Birkaç saniye sonra tekrar dene.',
    too_many_rooms: 'Kısa sürede çok oda açıldı. Bir dakika sonra tekrar dene.',
    server_not_enabled: 'Yeni oyun sistemi henüz açılmadı. Sayfayı yenileyip tekrar dene.',
    invalid_token: 'Oturum doğrulanamadı. Sayfayı yenileyip tekrar dene.',
    connection_failed: 'İşlem doğrulanamadı. İnternet bağlantını kontrol edip tekrar dene.',
    session_expired: 'Bağlantın yenileniyor. Birkaç saniye sonra tekrar dene.',
    'permission-denied': 'Odadaki oturumun sona erdi. Oda koduyla yeniden katılabilirsin.',
  })[error?.code] || 'İşlem tamamlanamadı. Tekrar dene.';
}
