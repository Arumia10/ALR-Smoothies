export const LABELS_PER_SHEET = 51;
export const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const clean = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const xml = (value) => clean(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

export function labelDestination(order) {
  const room = clean(order.room);
  if (order.fulfillment === "delivery") return `Livraison : ${room || "À l’école"}`;
  const place = {
    library: "Devant la bibliothèque",
    staff: "Proffen Konferenz",
    fridge: "Frigo à l’extérieur du Proffenkonferenz",
  }[order.fulfillment] || clean(order.delivery_location || order.fulfillment) || "Non précisé";
  return `Retrait : ${place}${room ? " · " + room : ""}`;
}

export function orderLabels(orders) {
  const labels = [];
  for (const order of orders) {
    if (order.status === "cancelled") continue;
    if (!Array.isArray(order.items)) throw new Error("Les articles d’une commande sont manquants. Actualisez les commandes.");
    for (const item of order.items) {
      if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > 10000)
        throw new Error("Une quantité est invalide. Actualisez les commandes.");
      if (labels.length + item.qty > 20000) throw new Error("Trop d’étiquettes. Filtrez les commandes par date.");
      for (let unit = 0; unit < item.qty; unit++) labels.push({
        name: clean(`${order.first_name || ""} ${order.last_name || ""}`),
        product: clean(item.name),
        destination: labelDestination(order),
        demo: Boolean(order.demo),
      });
    }
  }
  return labels;
}

function textWidth(text, size, bold) {
  let width = 0;
  for (const char of text) width += /[MW@%Œ]/u.test(char) ? 1 : /[ilI.,'’ :;]/u.test(char) ? 0.3 : /[A-ZÀ-Ý]/u.test(char) ? 0.73 : 0.6;
  return width * size * (bold ? 1.05 : 1);
}

function wrap(text, size, bold) {
  const lines = [];
  let line = "";
  for (const word of clean(text).split(" ")) {
    const next = line ? line + " " + word : word;
    if (textWidth(next, size, bold) <= 175) { line = next; continue; }
    if (line) lines.push(line);
    line = "";
    for (const char of word) {
      if (textWidth(line + char, size, bold) > 175) { lines.push(line); line = ""; }
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function labelParagraphs(label) {
  if (!label) return '<w:p><w:pPr><w:spacing w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>';
  let lines;
  for (let size = 10; size >= 4; size -= 0.5) {
    const fields = [
      [label.name, size, true],
      [(label.demo ? "TEST · " : "") + label.product, size - 0.5, false],
      [label.destination, size - 1, false],
    ];
    lines = fields.flatMap(([text, fontSize, bold]) => wrap(text, fontSize, bold).map(text => ({ text, fontSize, bold })));
    if (lines.reduce((height, line) => height + line.fontSize + 1, 0) <= 40) break;
  }
  return lines.map(({ text, fontSize, bold }) => `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${(fontSize + 1) * 20}" w:lineRule="exact"/><w:jc w:val="center"/><w:widowControl w:val="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${bold ? '<w:b/>' : ''}<w:color w:val="000000"/><w:sz w:val="${fontSize * 2}"/><w:szCs w:val="${fontSize * 2}"/></w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`).join("");
}

export function labelsDocumentXml(labels, startPosition = 1) {
  if (!Number.isInteger(startPosition) || startPosition < 1 || startPosition > LABELS_PER_SHEET)
    throw new Error("Choisissez une position entre 1 et 51.");
  if (!labels.length) throw new Error("Aucune étiquette à télécharger. Les commandes annulées sont exclues.");
  const slots = [...Array(startPosition - 1).fill(null), ...labels];
  const pages = [];
  for (let offset = 0; offset < slots.length; offset += LABELS_PER_SHEET) {
    const rows = [];
    for (let row = 0; row < 17; row++) {
      const cells = [];
      for (let col = 0; col < 3; col++) cells.push(`<w:tc><w:tcPr><w:tcW w:w="3969" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${labelParagraphs(slots[offset + row * 3 + col])}</w:tc>`);
      rows.push(`<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="958" w:hRule="exact"/></w:trPr>${cells.join("")}</w:tr>`);
    }
    const borders = ["top", "left", "bottom", "right", "insideH", "insideV"].map(edge => `<w:${edge} w:val="nil"/>`).join("");
    pages.push(`<w:tbl><w:tblPr><w:tblW w:w="11907" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="170" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="170" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${'<w:gridCol w:w="3969"/>'.repeat(3)}</w:tblGrid>${rows.join("")}</w:tbl>`);
  }
  const separator = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${pages.join(separator)}<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p><w:sectPr><w:pgSz w:w="11907" w:h="16838"/><w:pgMar w:top="275" w:right="0" w:bottom="226" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const encoder = new TextEncoder(), locals = [], central = [];
  let offset = 0;
  for (const [path, content] of Object.entries(files)) {
    const name = encoder.encode(path), data = encoder.encode(content), crc = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length), view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true);
    view.setUint16(12, 33, true); view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, name.length, true);
    local.set(name, 30); local.set(data, 30 + name.length);
    const directory = new Uint8Array(46 + name.length), d = new DataView(directory.buffer);
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true);
    d.setUint16(14, 33, true); d.setUint32(16, crc, true); d.setUint32(20, data.length, true); d.setUint32(24, data.length, true);
    d.setUint16(28, name.length, true); d.setUint32(42, offset, true); directory.set(name, 46);
    locals.push(local); central.push(directory); offset += local.length;
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, central.length, true); e.setUint16(10, central.length, true);
  e.setUint32(12, central.reduce((sum, entry) => sum + entry.length, 0), true); e.setUint32(16, offset, true);
  return new Blob([...locals, ...central, end], { type: DOCX_TYPE });
}

export function createLabelsDocx(labels, startPosition = 1) {
  return zip({
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": labelsDocumentXml(labels, startPosition),
  });
}
