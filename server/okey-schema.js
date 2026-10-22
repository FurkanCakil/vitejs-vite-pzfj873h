import { requireAction } from './errors.js';
import { validateOkeyCommand } from './games/okey.js';

export const okeyFields = {
  'okey.create': ['sessionId', 'nickname', 'isPublic'], 'okey.match': ['sessionId', 'nickname'],
  'okey.rules': ['roomId', 'expectedVersion', 'rules'],
  'okey.team': ['roomId', 'expectedVersion', 'targetUid', 'team'],
  'okey.distribute': ['roomId', 'expectedVersion'], 'okey.bots': ['roomId', 'expectedVersion'],
  'okey.start': ['roomId', 'expectedVersion'],
  'okey.seat.request': ['roomId', 'botUid', 'nickname'], 'okey.seat.cancel': ['roomId'],
  'okey.seat.resolve': ['roomId', 'expectedVersion', 'requesterUid', 'accept'],
  'okey.layout': ['roomId', 'roundId', 'rack', 'groups'],
  'okey.draw': ['roomId', 'roundId', 'turnNumber', 'expectedPlayVersion', 'source', 'targetIndex'],
  'okey.cancel': ['roomId', 'roundId', 'turnNumber', 'expectedPlayVersion'],
  'okey.discard': ['roomId', 'roundId', 'turnNumber', 'expectedPlayVersion', 'tileId'],
  'okey.open': ['roomId', 'roundId', 'turnNumber', 'expectedPlayVersion', 'mode', 'melds'],
  'okey.tack': ['roomId', 'roundId', 'turnNumber', 'expectedPlayVersion', 'tileId', 'targetUid', 'groupIndex', 'side', 'replaceTileId'],
  'okey.tick': ['roomId', 'roundId', 'expectedVersion'], 'okey.newRound': ['roomId', 'roundId'],
};
const gameplay = new Set(['okey.layout', 'okey.draw', 'okey.cancel', 'okey.discard', 'okey.open', 'okey.tack', 'okey.tick', 'okey.newRound']);
export function okeyCommand(action) {
  return Object.fromEntries(Object.entries(action).filter(([key]) => !['roomId', 'actionId', 'expectedVersion', 'expectedPlayVersion'].includes(key)));
}
export function validateOkeyFields(action) {
  if (Object.hasOwn(action, 'expectedPlayVersion')) requireAction(Number.isSafeInteger(action.expectedPlayVersion)
    && action.expectedPlayVersion >= 0 && action.expectedPlayVersion < Number.MAX_SAFE_INTEGER, 400, 'invalid_version');
  if (gameplay.has(action.type)) validateOkeyCommand(okeyCommand(action));
  for (const key of ['targetUid', 'botUid', 'requesterUid']) if (Object.hasOwn(action, key)) {
    requireAction(typeof action[key] === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(action[key]), 400, 'invalid_target');
  }
  if (Object.hasOwn(action, 'team')) requireAction([null, 'A', 'B'].includes(action.team), 400, 'invalid_team');
  if (Object.hasOwn(action, 'accept')) requireAction(typeof action.accept === 'boolean', 400, 'invalid_accept');
  if (Object.hasOwn(action, 'rules')) {
    const rules = action.rules;
    requireAction(rules && typeof rules === 'object' && !Array.isArray(rules)
      && Object.keys(rules).sort().join(',') === 'assistedEnabled,foldToPartnerEnabled,foldingEnabled,gameType'
      && ['ffa', '2v2'].includes(rules.gameType)
      && ['assistedEnabled', 'foldingEnabled', 'foldToPartnerEnabled'].every(key => typeof rules[key] === 'boolean')
      && (!rules.foldToPartnerEnabled || (rules.gameType === '2v2' && rules.foldingEnabled)), 400, 'invalid_rules');
  }
}
