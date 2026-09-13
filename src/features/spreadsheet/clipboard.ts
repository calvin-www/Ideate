// Excel-style quoted TSV. Delimiters inside quoted fields belong to the cell.
export function parseClipboard(text: string): string[][] {
  if (text.length > 6_000_000) throw new Error("This clipboard is too large. Paste a smaller range.");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  let count = 0;
  function append(char: string) {
    field += char;
    if (field.length > 1000) throw new Error("A pasted cell exceeds the 1,000 character limit.");
  }
  function finishField() {
    if (row.length >= 26 || ++count > 5000) throw new Error("This paste exceeds the sheet's cell or column limit.");
    row.push(field);
    field = "";
    closed = false;
  }
  function finishRow() {
    finishField();
    if (rows.length >= 200) throw new Error("This paste exceeds the sheet's 200 row limit.");
    rows.push(row);
    row = [];
  }
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { append('"'); index++; }
        else { quoted = false; closed = true; }
      } else append(char);
    } else if (char === "\t") finishField();
    else if (char === "\n" || char === "\r") {
      finishRow();
      if (char === "\r" && text[index + 1] === "\n") index++;
      if (index === text.length - 1) return rows;
    } else if (closed) throw new Error("Invalid quoted clipboard text. Check the pasted cells.");
    else if (char === '"' && field === "") quoted = true;
    else append(char);
  }
  if (quoted) throw new Error("The clipboard contains an unclosed quoted cell.");
  finishRow();
  return rows;
}

export function serializeClipboard(rows: string[][]): string {
  return rows.map((row) => row.map((value) => /[\t\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value).join("\t")).join("\n");
}
