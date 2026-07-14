const fs = require('fs');
const path = require('path');
const { extract } = require('./extractor');

const inputPath = path.join(__dirname, '..', 'testfiles', 'extractor_test_input.json');
const samples = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));

let total = 0;
let match = 0;

console.log('=== 提取器测试 ===\n');

for (const sample of samples) {
  const result = extract(sample.text);
  const a = sample.actual;

  // 清理编码中的换行
  const cleanCode = (a.C || '').replace(/\s/g, '');
  const cleanResultCode = (result.project_code || '').replace(/\s/g, '');

  const actualAmount = parseFloat(String(a.L).replace(/[^0-9.]/g, ''));
  const extractedAmount = result.approval_amount;
  const amountMatch = isNaN(actualAmount)
    ? (extractedAmount === null || extractedAmount === undefined || extractedAmount === '')
    : Math.abs(extractedAmount - actualAmount) < 0.01;

  const normalizeAg = (s) => String(s || '').replace(/\s+/g, '').replace(/决策会$/, '决策会纪要').replace(/专题办公会$/, '专题办公会纪要');

  const checks = {
    C: cleanResultCode === cleanCode,
    D: result.project_name === a.D,
    E: result.approval_date === a.E,
    L: amountMatch,
    B: result.category === a.B,
    H: result.project_set === a.H,
    I: result.project_subset === a.I,
    AF: result.is_rnd === a.AF,
    AD: result.listed === a.AD,
    AC: result.build_level === a.AC,
    AG: normalizeAg(result.decision_method) === normalizeAg(a.AG),
  };

  const allMatch = Object.values(checks).every(Boolean);
  total++;
  if (allMatch) match++;

  console.log(`Row ${sample.row}: ${allMatch ? '✅' : '❌'}`);
  console.log('  提取:', JSON.stringify({
    C: result.project_code, D: result.project_name, E: result.approval_date,
    L: result.approval_amount, B: result.category, H: result.project_set,
    I: result.project_subset, AF: result.is_rnd, AD: result.listed,
    AC: result.build_level, AE: result.region, AG: result.decision_method
  }));
  console.log('  实际:', JSON.stringify({
    C: a.C, D: a.D, E: a.E, L: a.L, B: a.B, H: a.H,
    I: a.I, AF: a.AF, AD: a.AD, AC: a.AC, AE: a.AE, AG: a.AG
  }));
  if (!allMatch) {
    const failed = Object.entries(checks).filter(([k, v]) => !v).map(([k]) => k).join(',');
    console.log(`  不匹配字段: ${failed}`);
  }
  console.log();
}

console.log(`准确率: ${match}/${total} (${((match / total) * 100).toFixed(1)}%)`);
