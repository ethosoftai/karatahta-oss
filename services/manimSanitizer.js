export function sanitizeManimForLocalRender(code) {
  return String(code || '').replace(/(?<![\w"'])expo_out(?![\w"'])/g, 'rate_functions.ease_out_expo');
}
