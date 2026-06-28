export const CHESS_ICONS = { p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚' };
export const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
// Android, iOS ve Windows için ortak çalışan evrensel emoji fontları eklendi:
export const chessPieceStyle = { 
    fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Android Emoji", "Segoe UI Symbol", "Arial Unicode MS", serif', 
    WebkitTextFillColor: 'currentColor' 
};