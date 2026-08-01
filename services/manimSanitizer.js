export function sanitizeManimForLocalRender(code) {
  return String(code || '').replace(/(?<![\w"'])expo_out(?![\w"'])/g, 'rate_functions.ease_out_expo');
}

export function replaceNaturalLanguageMathTex(code, { font = 'Georgia' } = {}) {
  return String(code || '').replace(
    /MathTex\(\s*r?(["'])\\text\{([^{}]*)\}\1\s*((?:,\s*(?:color|font_size)\s*=\s*[^,)]+)*)\s*\)/g,
    (_match, _quote, label, options = '') => (
      `Text(${JSON.stringify(label.replace(/\\([%_&])/g, '$1'))}, font=${JSON.stringify(font)}${options})`
    )
  );
}
