export const generateRoomCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const array = new Uint32Array(6);
  globalThis.crypto.getRandomValues(array);
  
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars[array[i] % chars.length];
  }
  return result;
};

export function normalizeRoomCode(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z0-9]{6}$/.test(code) ? code : null;
}

// reserve must atomically return false when the code already exists.
export async function reserveRoomCode(reserve, generate = generateRoomCode) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generate();
    if (await reserve(code)) return code;
  }
  throw new Error('room-code-collision');
}
