import { beginServerTiming, updateServerClock } from './serverClock.js';

export const SERVER_XOX_ENABLED = import.meta.env?.VITE_SERVER_XOX_ENABLED === 'true';
export const SERVER_BATTLESHIP_ENABLED = import.meta.env?.VITE_SERVER_BATTLESHIP_ENABLED === 'true';
export const SERVER_OKEY_ENABLED = import.meta.env?.VITE_SERVER_OKEY_ENABLED === 'true';
export const SERVER_CONNECT4_ENABLED = import.meta.env?.VITE_SERVER_CONNECT4_ENABLED === 'true';
export const SERVER_CHECKERS_ENABLED = import.meta.env?.VITE_SERVER_CHECKERS_ENABLED === 'true';
export const SERVER_CHESS_ENABLED = import.meta.env?.VITE_SERVER_CHESS_ENABLED === 'true';
export const SERVER_TAVLA_ENABLED = import.meta.env?.VITE_SERVER_TAVLA_ENABLED === 'true';
export const SERVER_PRESENCE_ENABLED = import.meta.env?.VITE_SERVER_PRESENCE_ENABLED === 'true';
export const SERVER_ROOMS_ENABLED = SERVER_XOX_ENABLED || SERVER_BATTLESHIP_ENABLED || SERVER_OKEY_ENABLED
  || SERVER_CONNECT4_ENABLED || SERVER_CHECKERS_ENABLED || SERVER_CHESS_ENABLED || SERVER_TAVLA_ENABLED;
export const serverGameEnabled = game => (game === 'xox' && SERVER_XOX_ENABLED)
  || (game === 'amiralbatti' && SERVER_BATTLESHIP_ENABLED) || (game === 'okey101' && SERVER_OKEY_ENABLED)
  || (game === 'connect4' && SERVER_CONNECT4_ENABLED) || (game === 'dama' && SERVER_CHECKERS_ENABLED) || (game === 'satranc' && SERVER_CHESS_ENABLED)
  || (game === 'tavla' && SERVER_TAVLA_ENABLED);
export const serverCreateType = game => ({ xox: 'room.create', amiralbatti: 'battleship.create', okey101: 'okey.create', connect4: 'connect4.create', dama: 'checkers.create', satranc: 'chess.create', tavla: 'tavla.create' })[game];
export const serverMatchType = game => ({ xox: 'room.match', amiralbatti: 'battleship.match', okey101: 'okey.match', connect4: 'connect4.match', dama: 'checkers.match', satranc: 'chess.match', tavla: 'tavla.match' })[game];

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
      let token;
      try { token = await getToken(attempt > 0); }
      catch (error) {
        const invalidSession = ['auth/user-disabled', 'auth/user-token-expired', 'auth/invalid-user-token', 'auth/user-not-found'].includes(error?.code);
        throw new GameApiError(invalidSession ? 'invalid_token' : 'authentication_unavailable');
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      try {
        const timing = beginServerTiming();
        const response = await fetcher('/api/room-action', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body, signal: controller.signal, keepalive,
        });
        let result;
        try { result = await response.json(); }
        catch (error) {
          // WAF/proxy rejections may be HTML or plain text. Their HTTP status
          // is still authoritative; retrying would amplify a rate limit.
          // Preserve lost-success recovery with the original action ID.
          if (response.ok) throw error;
        }
        if (response.status === 401 && attempt === 0) continue;
        if (!response.ok || result?.ok !== true) {
          const fallback = { 401: 'invalid_token', 403: 'security_check_required', 429: 'too_many_actions' }[response.status]
            || 'service_unavailable';
          throw new GameApiError(typeof result?.error === 'string' ? result.error : fallback);
        }
        updateServerClock(result.serverNow, timing);
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
    room_not_found: 'Bu kodda bir oda bulunamadı. Eski odalar yerine yeni bir oda kurabilirsin.', room_closed: 'Bu oda kapalı.',
    room_full: 'Bu odadaki oyuncu koltukları dolu.',
    stale_version: 'Oyun güncellendi. Son durumu kontrol edip tekrar dene.',
    player_disconnected: 'Rakibin bağlantısı bekleniyor.',
    player_reconnected: 'Rakibin yeniden bağlandı; oyun devam ediyor.',
    not_your_turn: 'Henüz senin sıran değil.', occupied_cell: 'Bu kare dolu.',
    column_full: 'Bu sütun dolu. Başka bir sütun seç.', invalid_column: 'Geçerli bir sütun seç.',
    piece_not_owned: 'Bu taş sana ait değil.', illegal_move: 'Bu hamle mevcut konumda geçerli değil.',
    invalid_promotion: 'Piyon terfisi için vezir, kale, fil veya at seç.',
    offer_pending: 'Bekleyen teklife yanıt verilmesi gerekiyor.',
    invalid_offer: 'Bu teklif artık geçerli değil. Güncel durumu kontrol et.',
    invalid_takeback: 'Yalnız son hamleni, rakibin yanıtından önce geri alabilirsin.',
    invalid_undo: 'Bu sıradaki hamleler artık geri alınamaz.',
    already_rolled: 'Açılış zarını zaten attın. Rakibin bekleniyor.',
    invalid_phase: 'Oyun aşaması değişti. Güncel durumu kontrol et.',
    cube_not_owned: 'Çiftleme küpü rakibinde.',
    score_limit: 'Bu işlem puan sınırını aşıyor.',
    game_not_playing: 'Oyun şu anda hamle kabul etmiyor.',
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
    security_check_required: 'İstek güvenlik kontrolünde durduruldu. Biraz bekleyip sayfayı yenileyerek tekrar dene.',
    authentication_unavailable: 'Oturum hizmetine şu anda ulaşılamıyor. Biraz bekleyip tekrar dene.',
    connection_failed: 'İşlem doğrulanamadı. İnternet bağlantını kontrol edip tekrar dene.',
    session_expired: 'Bağlantın yenileniyor. Birkaç saniye sonra tekrar dene.',
    'permission-denied': 'Odadaki oturumun sona erdi. Oda koduyla yeniden katılabilirsin.',
  })[error?.code] || 'İşlem tamamlanamadı. Tekrar dene.';
}
