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

const JSON_UNICODE_ESCAPE_PATTERN = /^[0-9a-fA-F]{4}$/;
const JSON_SIMPLE_ESCAPES = new Set(["\"", "\\", "/", "b", "f", "n", "r", "t"]);

const escapeControlCharacter = (value: string) => {
  switch (value) {
    case "\b":
      return "\\b";
    case "\f":
      return "\\f";
    case "\n":
      return "\\n";
    case "\r":
      return "\\r";
    case "\t":
      return "\\t";
    default:
      return `\\u${value.charCodeAt(0).toString(16).padStart(4, "0")}`;
  }
};

export const repairJsonTextForParse = (value: string) => {
  const sanitized = sanitizeUnicodeForJson(value);
  let repaired = "";
  let inString = false;

  for (let index = 0; index < sanitized.length; index += 1) {
    const character = sanitized[index];

    if (!inString) {
      repaired += character;

      if (character === "\"") {
        inString = true;
      }

      continue;
    }

    const codeUnit = sanitized.charCodeAt(index);

    if (codeUnit <= 0x1f) {
      repaired += escapeControlCharacter(character);
      continue;
    }

    if (character === "\"") {
      repaired += character;
      inString = false;
      continue;
    }

    if (character !== "\\") {
      repaired += character;
      continue;
    }

    const nextCharacter = sanitized[index + 1];

    if (!nextCharacter) {
      repaired += "\\\\";
      continue;
    }

    if (nextCharacter === "u") {
      const hexDigits = sanitized.slice(index + 2, index + 6);

      if (JSON_UNICODE_ESCAPE_PATTERN.test(hexDigits)) {
        repaired += `\\u${hexDigits}`;
        index += 5;
        continue;
      }

      repaired += "\\\\u";
      index += 1;
      continue;
    }

    if (JSON_SIMPLE_ESCAPES.has(nextCharacter)) {
      repaired += `\\${nextCharacter}`;
      index += 1;
      continue;
    }

    repaired += "\\\\";
  }

  return repaired;
};

export const sanitizeUnicodeValue = (value: unknown): unknown => {
  if (typeof value === "string") {
    return sanitizeUnicodeForJson(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeUnicodeValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, currentValue]) => [key, sanitizeUnicodeValue(currentValue)]),
  );
};

export const parseUnicodeSafeJson = <TValue>(value: string) =>
  sanitizeUnicodeValue(JSON.parse(repairJsonTextForParse(value))) as TValue;

export const stringifyUnicodeSafe = (value: unknown) =>
  JSON.stringify(value, (_key, currentValue) =>
    typeof currentValue === "string"
      ? sanitizeUnicodeForJson(currentValue)
      : currentValue,
  );
