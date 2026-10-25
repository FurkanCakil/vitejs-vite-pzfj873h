export const SERVER_XOX_ENABLED = import.meta.env?.VITE_SERVER_XOX_ENABLED === 'true';
export const SERVER_BATTLESHIP_ENABLED = import.meta.env?.VITE_SERVER_BATTLESHIP_ENABLED === 'true';
export const SERVER_OKEY_ENABLED = import.meta.env?.VITE_SERVER_OKEY_ENABLED === 'true';
export const SERVER_CONNECT4_ENABLED = import.meta.env?.VITE_SERVER_CONNECT4_ENABLED === 'true';
export const SERVER_PRESENCE_ENABLED = import.meta.env?.VITE_SERVER_PRESENCE_ENABLED === 'true';
export const serverGameEnabled = game => (game === 'xox' && SERVER_XOX_ENABLED)
  || (game === 'amiralbatti' && SERVER_BATTLESHIP_ENABLED) || (game === 'okey101' && SERVER_OKEY_ENABLED)
  || (game === 'connect4' && SERVER_CONNECT4_ENABLED);
export const serverCreateType = game => ({ xox: 'room.create', amiralbatti: 'battleship.create', okey101: 'okey.create', connect4: 'connect4.create' })[game];
export const serverMatchType = game => ({ xox: 'room.match', amiralbatti: 'battleship.match', okey101: 'okey.match', connect4: 'connect4.match' })[game];

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
    column_full: 'Bu sütun dolu. Başka bir sütun seç.', invalid_column: 'Geçerli bir sütun seç.',
    already_shot: 'Bu hücreye zaten ateş ettin.', invalid_fleet: 'Gemilerin yerleşimi geçerli değil. Filonu kontrol et.',
    setup_locked: 'Yerleştirme aşaması değişti. Son durumu kontrol et.',
    stale_round: 'Yeni tur başladı. Son durumu kontrol edip tekrar dene.',
    stale_turn: 'Sıra değişti. Son durumu kontrol edip tekrar dene.',
    turn_expired: 'Hamle süren doldu; otomatik hamle bekleniyor.',
    tile_not_owned: 'Taşların güncellendi. Son elini kontrol et.',
    side_tile_unused: 'Yandan aldığın taşı kullanmalı veya geri koymalısın.',
    invalid_melds: 'Per veya çift seçimi geçerli değil.',
    must_keep_tile: 'Istakanda atacak en az bir taş kalmalı.',
    not_enough_pairs: 'Çift açmak için gereken çift sayısına ulaşamadın.',
    team_full: 'Bu takım dolu.', teams_incomplete: 'İki takımın da ikişer oyuncusu olmalı.',
    seat_unavailable: 'Bu koltuk veya teklif artık uygun değil.',
    lobby_locked: 'Oyun başladı; oda ayarları artık değiştirilemez.',
    too_early: 'Sayaç henüz dolmadı.',
    too_many_actions: 'Çok hızlı işlem yapıldı. Birkaç saniye sonra tekrar dene.',
    too_many_rooms: 'Kısa sürede çok oda açıldı. Bir dakika sonra tekrar dene.',
    too_many_tabs: 'Çok fazla bağlantı açıldı. Kullanmadığın sekmeleri kapatıp biraz bekle.',
    presence_capacity: 'Bağlantı sayacı şu anda yoğun. Kısa süre sonra tekrar dene.',
    server_not_enabled: 'Yeni oyun sistemi henüz açılmadı. Sayfayı yenileyip tekrar dene.',
    invalid_token: 'Oturum doğrulanamadı. Sayfayı yenileyip tekrar dene.',
    connection_failed: 'İşlem doğrulanamadı. İnternet bağlantını kontrol edip tekrar dene.',
    session_expired: 'Bağlantın yenileniyor. Birkaç saniye sonra tekrar dene.',
    'permission-denied': 'Odadaki oturumun sona erdi. Oda koduyla yeniden katılabilirsin.',
  })[error?.code] || 'İşlem tamamlanamadı. Tekrar dene.';
}
