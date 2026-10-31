// Queue writers cap each game at 30 entries. Preserve the cheap first-candidate
// path; only a stale prefix triggers bounded five-candidate read batches.
export async function scanMatchQueue(tx, entries, references, inspect) {
  const rejected = new Set();
  for (let offset = 0; offset < entries.length;) {
    const batch = entries.slice(offset, offset + (offset === 0 ? 1 : 5));
    const refs = batch.map(references);
    const snapshots = await tx.getAll(...refs.flat());
    let cursor = 0;
    for (let i = 0; i < batch.length; i++) {
      const value = inspect(batch[i], snapshots.slice(cursor, cursor + refs[i].length));
      cursor += refs[i].length;
      if (value) return { match: { entry: batch[i], value }, entries: entries.filter(entry => !rejected.has(entry.roomId)) };
      rejected.add(batch[i].roomId);
    }
    offset += batch.length;
  }
  return { match: null, entries: [] };
}
