// Parse data-only Lua table constructors. Never execute Lua expressions.
class LuaDataParser {
  constructor(source) {
    this.source = source;
    this.position = 0;
  }

  error(message) {
    const line = this.source.slice(0, this.position).split("\n").length;
    throw new SyntaxError(`第 ${line} 行：${message}`);
  }

  skipTrivia() {
    while (this.position < this.source.length) {
      if (/\s/.test(this.source[this.position])) {
        this.position += 1;
      } else if (this.source.startsWith("--[[", this.position)) {
        const end = this.source.indexOf("]]", this.position + 4);
        if (end < 0) this.error("Lua 块注释没有结束");
        this.position = end + 2;
      } else if (this.source.startsWith("--", this.position)) {
        const end = this.source.indexOf("\n", this.position + 2);
        this.position = end < 0 ? this.source.length : end + 1;
      } else {
        break;
      }
    }
  }

  take(character) {
    this.skipTrivia();
    if (this.source[this.position] !== character) this.error(`需要 ${character}`);
    this.position += 1;
  }

  parseString() {
    const quote = this.source[this.position++];
    let value = "";
    while (this.position < this.source.length) {
      const char = this.source[this.position++];
      if (char === quote) return value;
      if (char === "\n" || char === "\r") this.error("字符串没有结束");
      if (char !== "\\") {
        value += char;
        continue;
      }
      const escaped = this.source[this.position++];
      if (escaped === undefined) this.error("字符串没有结束");
      const simple = { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\", '"': '"', "'": "'" };
      if (Object.hasOwn(simple, escaped)) {
        value += simple[escaped];
      } else if (escaped === "x") {
        const digits = this.source.slice(this.position, this.position + 2);
        if (!/^[0-9a-fA-F]{2}$/.test(digits)) this.error("十六进制转义无效");
        value += String.fromCharCode(Number.parseInt(digits, 16));
        this.position += 2;
      } else if (escaped === "u") {
        const match = /^\{([0-9a-fA-F]+)\}/.exec(this.source.slice(this.position));
        if (!match) this.error("Unicode 转义无效");
        const codePoint = Number.parseInt(match[1], 16);
        if (codePoint > 0x10ffff) this.error("Unicode 转义超出范围");
        value += String.fromCodePoint(codePoint);
        this.position += match[0].length;
      } else if (escaped === "z") {
        while (/\s/.test(this.source[this.position] ?? "")) this.position += 1;
      } else if (escaped === "\n") {
        value += "\n";
      } else if (/[0-9]/.test(escaped)) {
        let digits = escaped;
        while (digits.length < 3 && /[0-9]/.test(this.source[this.position] ?? "")) digits += this.source[this.position++];
        const byte = Number(digits);
        if (byte > 255) this.error("十进制转义超出范围");
        value += String.fromCharCode(byte);
      } else {
        this.error(`不支持的转义 \\${escaped}`);
      }
    }
    this.error("字符串没有结束");
  }

  parseValue() {
    this.skipTrivia();
    const char = this.source[this.position];
    if (char === "{") return this.parseTable();
    if (char === '"' || char === "'") return this.parseString();
    const rest = this.source.slice(this.position);
    const number = /^-?(?:0[xX][0-9a-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/.exec(rest);
    if (number) {
      this.position += number[0].length;
      const value = Number(number[0]);
      if (!Number.isFinite(value)) this.error("数字超出 JSON 可表示范围");
      return value;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (identifier) {
      this.position += identifier[0].length;
      if (identifier[0] === "true") return true;
      if (identifier[0] === "false") return false;
      if (identifier[0] === "nil") this.error("nil 无法无损转换成 JSON 值");
      this.error(`不支持 Lua 表达式 ${identifier[0]}`);
    }
    this.error("需要 Lua 字面量或表");
  }

  parseTable() {
    this.position += 1;
    const entries = [];
    let nextListIndex = 1;
    this.skipTrivia();
    while (this.source[this.position] !== "}") {
      if (this.position >= this.source.length) this.error("Lua 表没有结束");
      let key;
      let value;
      if (this.source[this.position] === "[") {
        this.position += 1;
        key = this.parseValue();
        if (typeof key !== "string" && typeof key !== "number") this.error("表键只能转换字符串或数字");
        this.take("]");
        this.take("=");
        value = this.parseValue();
      } else {
        const start = this.position;
        const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.source.slice(start));
        if (name) {
          this.position += name[0].length;
          this.skipTrivia();
          if (this.source[this.position] === "=") {
            this.position += 1;
            key = name[0];
            value = this.parseValue();
          } else {
            this.position = start;
          }
        }
        if (value === undefined) {
          key = nextListIndex++;
          value = this.parseValue();
        }
      }
      entries.push({ key, value });
      this.skipTrivia();
      const separator = this.source[this.position];
      if (separator === "," || separator === ";") {
        this.position += 1;
        this.skipTrivia();
      } else if (separator !== "}") {
        this.error("表项目之间需要逗号或分号");
      }
    }
    this.position += 1;
    return { kind: "table", entries };
  }

  parse() {
    this.skipTrivia();
    if (this.source[this.position] !== "{") this.error("请输入 Lua 表构造器");
    const table = this.parseTable();
    this.skipTrivia();
    if (this.position !== this.source.length) this.error("Lua 表后还有多余内容");
    return table;
  }
}

function renderJson(value) {
  if (value?.kind !== "table") return JSON.stringify(value);
  const { entries } = value;
  if (!entries.length) return "{}";
  const numericKeys = entries.map(({ key }) => key);
  const isArray = numericKeys.every((key) => Number.isInteger(key) && key > 0) &&
    new Set(numericKeys).size === entries.length && Math.max(...numericKeys) === entries.length;
  if (isArray) {
    return `[${[...entries].sort((a, b) => a.key - b.key).map(({ value: item }) => renderJson(item)).join(",")}]`;
  }
  return `{${entries.map(({ key, value: item }) => `${JSON.stringify(String(key))}:${renderJson(item)}`).join(",")}}`;
}

export function luaTableToJson(source) {
  return renderJson(new LuaDataParser(source).parse());
}
