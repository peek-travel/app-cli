import * as clack from "@clack/prompts";

export const intro = clack.intro;
export const outro = clack.outro;
export const cancel = clack.cancel;
export const isCancel = clack.isCancel;
export const text = clack.text;
export const select = clack.select;

export function spinner(message: string) {
  const s = clack.spinner();
  s.start(message);
  return {
    succeed: (msg?: string) => s.stop(msg ?? message, 0),
    fail: (msg?: string) => s.stop(msg ?? message, 1),
  };
}

export function failure(message: string, suggestion?: string) {
  clack.log.error(message);
  if (suggestion) {
    clack.log.info(suggestion);
  }
}
