export const sanitizeUnicodeForJson = (value: string) => {
  let sanitized = "";

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = index + 1 < value.length ? value.charCodeAt(index + 1) : null;

      if (nextCodeUnit !== null && nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        sanitized += value[index] + value[index + 1];
        index += 1;
      } else {
        sanitized += "\uFFFD";
      }

      continue;
    }

    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      sanitized += "\uFFFD";
      continue;
    }

    sanitized += value[index];
  }

  return sanitized;
};

export const stringifyUnicodeSafe = (value: unknown) =>
  JSON.stringify(value, (_key, currentValue) =>
    typeof currentValue === "string"
      ? sanitizeUnicodeForJson(currentValue)
      : currentValue,
  );
