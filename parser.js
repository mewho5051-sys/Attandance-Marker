// parser.js = the "smart reader".
// Job 1: open any file (Word, PDF, Excel, CSV, text) and turn it into ROWS.
// Job 2: look through the rows and pick out only the roll numbers, names
//        and the course details. Everything else is skipped.

// ---------- What a roll number looks like ----------
// Example: 25014198-001  (6 or more digits, then an optional -number)
// Example: BSSE-F22-001  (letters, then -F22, then -number)
const ROLL = /\b(?:\d{6,}(?:-\d{1,4})?|[A-Za-z]{2,6}-[A-Za-z]?\d{2}-\d{1,4})\b/;
const ROLL_EXACT = new RegExp("^(?:" + ROLL.source + ")$");

// ---------- Part 1: turn a file into rows ----------
// A "row" is a list of cells, like one line of a table.

async function readDocx(file) {
  if (typeof mammoth === "undefined") {
    throw new Error("The Word reader did not load. Check your internet and refresh.");
  }
  const buffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
  const doc = new DOMParser().parseFromString(result.value, "text/html");

  const rows = [];
  doc.body.querySelectorAll("tr, p").forEach(function (el) {
    if (el.tagName === "TR") {
      rows.push(Array.from(el.children).map(function (cell) {
        return cell.textContent;
      }));
    } else if (!el.closest("table")) {
      rows.push([el.textContent]);
    }
  });
  return rows;
}

async function readPdf(file) {
  if (typeof pdfjsLib === "undefined") {
    throw new Error("The PDF reader did not load. Check your internet and refresh.");
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const rows = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    // Put pieces of text that sit at the same height on the same line
    const lines = new Map();
    content.items.forEach(function (item) {
      const y = Math.round(item.transform[5] / 3);
      if (!lines.has(y)) {
        lines.set(y, []);
      }
      lines.get(y).push(item);
    });

    Array.from(lines.keys()).sort(function (a, b) { return b - a; }).forEach(function (y) {
      const items = lines.get(y).sort(function (a, b) {
        return a.transform[4] - b.transform[4];
      });
      rows.push([items.map(function (i) { return i.str; }).join(" ")]);
    });
  }

  if (rows.every(function (r) { return r[0].trim() === ""; })) {
    throw new Error("This PDF has no readable text. It may be a scanned photo.");
  }
  return rows;
}

async function readSheet(file) {
  if (typeof XLSX === "undefined") {
    throw new Error("The Excel reader did not load. Check your internet and refresh.");
  }
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const rows = [];
  workbook.SheetNames.forEach(function (sheetName) {
    const sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: ""
    });
    sheetRows.forEach(function (r) { rows.push(r); });
  });
  return rows;
}

async function readText(file) {
  const text = await file.text();
  return text.split(/\r?\n/).map(function (line) {
    return line.split(/,|\t|;/);
  });
}

// Pick the right reader using the end of the file name
async function readAnyFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();

  if (ext === "docx") return readDocx(file);
  if (ext === "pdf") return readPdf(file);
  if (ext === "xlsx" || ext === "xls") return readSheet(file);
  if (ext === "csv" || ext === "txt") return readText(file);

  if (ext === "doc") {
    throw new Error("Old .doc files are not supported. Open it in Word and save as .docx.");
  }
  if (ext === "jpg" || ext === "jpeg" || ext === "png") {
    throw new Error("Photos are not supported yet. Please use Word, PDF, Excel or CSV.");
  }
  throw new Error("This file type is not supported: ." + ext);
}

// ---------- Part 2: find the students ----------

// Clean cell text: remove extra spaces
function tidy(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/\s+/g, " ")
    .trim();
}

// If one cell holds "1 25014198-001 JAWAD ALI", cut it into 3 cells
function expandCells(cells) {
  const result = [];
  cells.forEach(function (cell) {
    const text = tidy(cell);
    const match = text.match(ROLL);
    if (match && text !== match[0]) {
      const before = text.slice(0, match.index).trim();
      const after = text.slice(match.index + match[0].length).trim();
      if (before) result.push(before);
      result.push(match[0]);
      if (after) result.push(after);
    } else if (text) {
      result.push(text);
    }
  });
  return result;
}

// Keep only the letters at the start: "JAWAD ALI AMIR 25/11" becomes "JAWAD ALI AMIR"
function cleanName(text) {
  const match = text.match(/^[A-Za-z][A-Za-z .'’-]*/);
  if (!match) return "";
  return match[0].replace(/[\s.'’-]+$/, "").trim();
}

// Look at ONE row. If it has a roll number and a name, return them.
function extractStudentFromRow(rawCells) {
  const cells = expandCells(rawCells);
  const rollIndex = cells.findIndex(function (c) { return ROLL_EXACT.test(c); });
  if (rollIndex === -1) return null;

  let name = "";

  // First look at the cells AFTER the roll number
  for (let i = rollIndex + 1; i < cells.length && !name; i++) {
    const candidate = cleanName(cells[i]);
    if (candidate.length >= 3) name = candidate;
  }
  // If nothing found, look BEFORE the roll number (closest first)
  for (let i = rollIndex - 1; i >= 0 && !name; i--) {
    const candidate = cleanName(cells[i]);
    if (candidate.length >= 3) name = candidate;
  }

  if (!name) return null;
  return { roll_no: cells[rollIndex], name: name };
}

// Look at ALL rows. Skip the rest. Remove repeated roll numbers.
function extractStudents(rows) {
  const found = new Map();
  rows.forEach(function (row) {
    const student = extractStudentFromRow(row);
    if (student && !found.has(student.roll_no)) {
      found.set(student.roll_no, student);
    }
  });
  return Array.from(found.values());
}

// ---------- Part 3: find the course details at the top of the file ----------
function extractCourse(rows) {
  // Use only the rows ABOVE the first student
  const headerParts = [];
  for (let i = 0; i < rows.length; i++) {
    if (extractStudentFromRow(rows[i])) break;
    const line = rows[i].map(tidy).filter(Boolean).join(" | ");
    if (line) headerParts.push(line);
  }
  const text = headerParts.join(" | ");

  const stop =
    "(?=\\s*\\|\\s*|\\s+(?:Department|Programme|Semester|Course Section|Course|Instructor|Section)\\s*:|$)";

  function grab(label) {
    const re = new RegExp("(?:^|[|\\s])" + label + "\\s*:\\s*(.*?)" + stop, "i");
    const match = text.match(re);
    return match ? match[1].trim() : "";
  }

  const courseText = grab("Course");
  let code = "";
  let name = courseText;
  const split = courseText.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (split) {
    name = split[1].trim();
    code = split[2].trim();
  }

  return {
    code: code,
    name: name,
    section: grab("Course Section") || grab("Section"),
    semester: grab("Semester"),
    instructor: grab("Instructor")
  };
}

// This lets us test the file on a computer. The browser ignores this line.
if (typeof module !== "undefined") {
  module.exports = { extractStudents, extractCourse, extractStudentFromRow };
}
