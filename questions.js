const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { parse } = require('csv-parse/sync');

const headers = [
  'Catégorie', 'Série', 'Question', 'Bonne réponse',
  'Mauvaise réponse 1', 'Mauvaise réponse 2', 'Mauvaise réponse 3',
];

function readQuestions(csv) {
  const firstLine = csv.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0];
  const delimiter = firstLine.includes(';') ? ';' : ',';
  let rows;
  try {
    rows = parse(csv, { bom: true, delimiter, skip_empty_lines: true, trim: true });
  } catch (error) {
    throw new Error(`CSV invalide à la ligne ${error.lines || '?'} : vérifie les colonnes et les guillemets.`);
  }
  const columns = rows.shift();
  if (!columns || columns.length !== headers.length ||
      columns.some((column, index) => column !== headers[index])) {
    throw new Error('Les titres de colonnes ne correspondent pas au modèle. Garde la première ligne intacte.');
  }
  return rows.flatMap((row, index) => {
    const [category, series, question, ...options] = row.map(value => value.trim());
    if (row.every(value => !value.trim())) return [];
    if ((!category && !series) || !question || options.some(value => !value)) {
      throw new Error(`Ligne de données ${index + 1} : renseigne une catégorie ou une série, la question et les quatre réponses.`);
    }
    if (new Set(options.map(value => value.toLocaleLowerCase('fr'))).size !== 4) {
      throw new Error(`Ligne de données ${index + 1} : les quatre réponses doivent être différentes.`);
    }
    return { category, series, question, options };
  });
}

function groupQuestions(rows, field) {
  const groups = new Map();
  for (const row of rows) {
    const name = row[field];
    if (!groups.has(name)) groups.set(name, []);
    const questions = groups.get(name);
    if (questions.some(existing => existing.question === row.question)) {
      throw new Error(`Question en double dans « ${name} » : ${row.question}`);
    }
    questions.push(row);
  }
  return groups;
}

const base = readQuestions(readFileSync(join(__dirname, 'questions.csv'), 'utf8'));
const categories = groupQuestions(base.filter(row => !row.series), 'category');
const series = groupQuestions(base.filter(row => row.series), 'series');

function importSeries(csv) {
  const rows = readQuestions(csv);
  if (!rows.length || rows.some(row => !row.series)) {
    throw new Error('Indique un nom dans la colonne Série pour chaque question du fichier personnalisé.');
  }
  return groupQuestions(rows, 'series');
}

module.exports = { categories, series, importSeries };
