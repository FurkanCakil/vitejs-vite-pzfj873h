export class ActionError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function requireAction(condition, status, code) {
  if (!condition) throw new ActionError(status, code);
}
