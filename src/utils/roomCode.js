export const generateRoomCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const array = new Uint32Array(6);
  window.crypto.getRandomValues(array);
  
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars[array[i] % chars.length];
  }
  return result;
};