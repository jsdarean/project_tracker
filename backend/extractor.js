/**
 * 立项批复正文字段提取器
 * 规则基于 testfiles/2024-2025年投资项目情况（全室）.et 分析得出
 */

const CN_NUMBERS = {
  '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
  '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
};

function cnToInt(s) {
  if (!s) return 0;
  s = s.trim();
  if (s === '十') return 10;
  if (s.startsWith('十')) return 10 + cnToInt(s.slice(1));
  if (s.endsWith('十')) return cnToInt(s.slice(0, -1)) * 10;
  if (s.includes('十')) {
    const parts = s.split('十');
    return cnToInt(parts[0]) * 10 + cnToInt(parts[1]);
  }
  if (s.length === 1) return CN_NUMBERS[s] || 0;
  let result = 0;
  for (const ch of s) {
    if (ch in CN_NUMBERS) result = result * 10 + CN_NUMBERS[ch];
  }
  return result;
}

function normalizeText(text) {
  if (!text) return '';
  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanCode(raw) {
  return (raw || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

function extractProjectCode(text) {
  const patterns = [
    /项目编码\s*[:：]\s*([A-Z0-9\s\n]+?)(?:，|。|；|\n|，|项目|的)/i,
    /项目编码\s*为\s*["""']?([A-Z0-9\s\n]+?)["""']?\s*(?:，|。|；|\n|，|项目|的)/i,
    /项目编码\s*[:：]\s*([A-Z0-9\s\n]+)/i,
    /项目编码\s*为\s*([A-Z0-9\s\n]+)/i,
    /项目编码\s*([A-Z0-9\s\n]{10,})/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const code = cleanCode(m[1]);
      if (code.length >= 10) return code;
    }
  }
  return '';
}

function extractProjectName(text) {
  // [，。；,] 同时排除中英文逗号、句号、分号
  const stopChars = '[^，。；,\n]+';
  const patterns = [
    /项目名称为\s*[“""'『]([^”""'』]+)[”""'』]/,
    /项目名称\s*[:：]\s*[“""'『]([^”""'』]+)[”""'』]/,
    /项目名称\s*[“""'『]([^”""'』]+)[”""'』]/,
    new RegExp(`项目名称为\\s*[：:]\\s*(${stopChars})`),
    new RegExp(`项目名称\\s*[:：]\\s*(${stopChars})`),
    new RegExp(`同意(?:立项)?建设\\s*(${stopChars})`),
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) return m[1].trim();
  }
  return '';
}

function extractChineseDate(text) {
  // 二〇二四年一月二十五日 / 二零二四年一月二十五日
  const m = text.match(/二[〇零]([一二三四五六七八九十〇零]{2,4})年([一二三四五六七八九十〇零]+)月([一二三四五六七八九十〇零]+)日/);
  if (m) {
    const year = 2000 + cnToInt(m[1]);
    const month = cnToInt(m[2]);
    const day = cnToInt(m[3]);
    if (year >= 2000 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  // 兼容 2024年1月25日
  const m2 = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m2) {
    return `${m2[1]}-${String(m2[2]).padStart(2, '0')}-${String(m2[3]).padStart(2, '0')}`;
  }
  return '';
}

function extractInvestment(text) {
  const patterns = [
    /项目投资预算不超过\s*([0-9.,]+)\s*万/,
    /项目总投资不超过\s*([0-9.,]+)\s*万/,
    /项目投资不超过\s*([0-9.,]+)\s*万/,
    /投资不超过\s*([0-9.,]+)\s*万/,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(val)) return val;
    }
  }
  return null;
}

function extractProjectManager(text) {
  const patterns = [
    // 正向：项目工程管理责任人为 XXX
    /项目工程管理责任人\s*为\s*([^，。；\n]+)/,
    /该项目责任人\s*为\s*([^，。；\n]+)/,
    /项目责任人\s*为\s*([^，。；\n]+)/,
    /工程管理责任人\s*为\s*([^，。；\n]+)/,
    // 反向：XXX 为该项目责任人
    /([^，。；\n]+)\s*为\s*该项目责任人/,
    /([^，。；\n]+)\s*为\s*项目责任人/,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) return stripOrgPrefix(m[1]);
  }
  return '';
}

function extractPlanningManager(text) {
  const m = text.match(/项目投资责任人\s*为\s*([^，。；\n]+)/);
  if (m) return stripOrgPrefix(m[1]);
  const m2 = text.match(/投资责任人\s*为\s*([^，。；\n]+)/);
  if (m2) return stripOrgPrefix(m2[1]);
  return '';
}

function stripOrgPrefix(str) {
  return str
    .replace(/^你公司/, '')
    .replace(/^你单位/, '')
    .replace(/^贵公司/, '')
    .replace(/^省公司工程建设部/, '')
    .replace(/^省公司规划技术部/, '')
    .replace(/^省公司网络部/, '')
    .replace(/^省公司信息技术中心/, '')
    .replace(/^省公司物资供应部/, '')
    .replace(/^省公司/, '')
    .replace(/^.*工程建设部/, '')
    .replace(/^.*规划技术部/, '')
    .trim();
}

function stripCompanyPrefix(str) {
  return str
    .replace(/^你公司/, '')
    .replace(/^你单位/, '')
    .replace(/^贵公司/, '')
    .trim();
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 把“省公司规划技术部宗红昌”拆成 { dept: '省公司规划技术部', person: '宗红昌' }
function splitDeptPerson(raw) {
  if (!raw) return { dept: '', person: '' };
  // 责任部门通常以 部/中心/局/处/科 结尾，后面紧跟姓名
  const m = raw.match(/^(.*[部中心局处科])([^部中心局处科，。；\n]+)$/);
  if (m) {
    return { dept: m[1].trim(), person: m[2].trim() };
  }
  return { dept: '', person: raw.trim() };
}

// 解析责任部门/责任人
// 支持两种语序：
//   1. 工程管理责任人为 省公司工程建设部谭旭辉
//   2. 你公司朱勇为 该项目工程管理责任人
function extractResponsibility(text, personLabels, deptLabels, recipient = '') {
  let dept = '';
  let person = '';

  if (deptLabels) {
    for (const label of deptLabels) {
      const escaped = escapeRegExp(label);
      // 正向：责任部门为 XXX
      const pat1 = new RegExp(escaped + '\\s*为\\s*([^，。；\\n]+)');
      const m1 = text.match(pat1);
      if (m1) {
        dept = stripCompanyPrefix(m1[1].trim());
        break;
      }
      // 反向：XXX 为（该/此）责任部门
      const pat2 = new RegExp('([^，。；\\n]+)\\s*为\\s*(?:该|此)?' + escaped);
      const m2 = text.match(pat2);
      if (m2) {
        dept = stripCompanyPrefix(m2[1].trim());
        break;
      }
    }
  }

  for (const label of personLabels) {
    const escaped = escapeRegExp(label);
    // 正向：责任人为 XXX
    const pat1 = new RegExp(escaped + '\\s*为\\s*([^，。；\\n]+)');
    const m1 = text.match(pat1);
    if (m1) {
      const raw = stripCompanyPrefix(m1[1].trim());
      const split = splitDeptPerson(raw);
      if (split.person) {
        person = split.person;
        if (!dept) dept = split.dept;
      } else {
        person = raw;
      }
      break;
    }
    // 反向：XXX 为（该/此）责任人
    const pat2 = new RegExp('([^，。；\\n]+)\\s*为\\s*(?:该|此)?' + escaped);
    const m2 = text.match(pat2);
    if (m2) {
      const raw = stripCompanyPrefix(m2[1].trim());
      const split = splitDeptPerson(raw);
      if (split.person) {
        person = split.person;
        if (!dept) dept = split.dept;
      } else {
        person = raw;
      }
      break;
    }
  }

  // 对于分公司项目，如果责任部门仍为空，则默认使用主送分公司作为责任部门
  if (!dept && recipient && /分公司/.test(recipient)) {
    dept = recipient;
  }

  return { dept, person };
}

function extractResponsibilities(text, recipient = '') {
  const investment = extractResponsibility(
    text,
    ['项目投资责任人', '投资责任人'],
    ['项目投资责任部门', '投资责任部门'],
    recipient
  );
  const engineering = extractResponsibility(
    text,
    ['项目工程管理责任人', '工程管理责任人'],
    ['项目工程管理责任部门', '工程管理责任部门'],
    recipient
  );
  const software = extractResponsibility(
    text,
    ['软件开发管理责任人', '软件管理责任人'],
    ['软件开发管理责任部门', '软件管理责任部门'],
    recipient
  );
  const maintenance = extractResponsibility(
    text,
    ['项目维护责任人', '维护责任人'],
    ['项目维护责任部门', '维护责任部门'],
    recipient
  );
  const procurement = extractResponsibility(
    text,
    ['项目合同采购责任人', '合同采购责任人'],
    ['项目合同采购责任部门', '合同采购责任部门'],
    recipient
  );

  return {
    investment_dept: investment.dept,
    investment_person: investment.person,
    engineering_dept: engineering.dept,
    engineering_person: engineering.person,
    software_dept: software.dept,
    software_person: software.person,
    maintenance_dept: maintenance.dept,
    maintenance_person: maintenance.person,
    procurement_dept: procurement.dept,
    procurement_person: procurement.person,
  };
}

function extractDecisionBasis(text) {
  const patterns = [
    /根据\s*[《“"]([^》”"]+)[》”"]/,
    /经\s*[《“"]([^》”"]+)[》”"]/,
    /根据\s*([^，。；\n]{3,200})/,
    /经\s*(?:公司领导|集团公司|公司)?(?:决策|批准|同意)?\s*[（(]([^）)]+)[）)]/,
    /经\s*([^，。；\n]{3,200}(?:决策|批准|同意)[^，。；\n]*)/,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const val = m[m.length - 1].replace(/\s+/g, '').trim();
      if (val) return val;
    }
  }
  return '';
}

function inferDecisionMethod(text) {
  let basis = extractDecisionBasis(text);
  if (!basis) return '';
  // 去掉文号后缀，如（苏移呈（0094）号）、（苏移纪要〔2024〕15号）
  basis = basis.replace(/（[^）]+号）/g, '').replace(/\([^)]+号\)/g, '').trim();
  if (/苏移呈|请示|公司领导决策|公司领导批准/.test(basis)) return '呈批件';
  if (/决策会/.test(basis) || /专题办公会/.test(basis) || /纪要/.test(basis)) {
    let result = basis.replace(/要求$/, '').trim();
    if (/决策会$/.test(result) && !/决策会纪要$/.test(result)) result += '纪要';
    if (/专题办公会$/.test(result) && !/专题办公会纪要$/.test(result)) result += '纪要';
    return result;
  }
  if (/集团/.test(basis) && /立项/.test(basis)) return '集团立项';
  return basis;
}

function extractConstructionUnit(text) {
  const patterns = [
    /工程建设单位及维护单位为\s*([^。；\n]+)/,
    /本项目建设单位为\s*([^，。；\n]+)/,
    /工程建设单位为\s*([^，。；\n]+)/,
    /([^，。；\n]{2,20})为本工程建设单位/,
    /你公司为\s*本工程\s*建设单位\s*和\s*维护单位/,
    /你公司为本工程建设单位/,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const raw = m[1] ? m[1].trim() : '你公司';
      // 去掉序号前缀，如“六、”
      return raw.replace(/^[一二三四五六七八九十]+、\s*/, '').trim();
    }
  }
  return '';
}

function extractRecipient(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 5)) {
    if (/分公司/.test(line) || /工程建设部/.test(line) || /：/.test(line) || /:$/.test(line)) {
      return line.replace(/[：:]$/, '').trim();
    }
  }
  return '';
}

function inferBuildLevel(unit, recipient) {
  const combined = `${unit} ${recipient}`;
  // 一干项目通常明确出现“一干”或骨干网/直联点/跨省
  if (/\b一干\b|骨干网|骨干直联点|跨省骨干|一干项目|网间骨干/.test(combined)) return '一干';
  if (/省公司工程建设部|省公司网络部|省公司信息技术中心|省公司.*部/.test(combined)) return '省建';
  if (/分公司/.test(combined)) return '市建';
  // 主送/建设单位仅为“工程建设部”时，默认省建
  if (/^工程建设部$/.test(recipient?.trim()) || /^工程建设部$/.test(unit?.trim())) return '省建';
  return '';
}

function inferRegion(recipient, unit) {
  // 优先使用主送单位（正文开头称谓）
  const source = recipient || unit || '';
  if (!source) return '';
  // 省级单位（无分公司）默认南京
  if (/省公司|工程建设部/.test(source) && !/分公司/.test(source)) return '南京';
  const matches = source.match(/([\u4e00-\u9fa5]{2,7})分公司/g);
  if (matches) {
    return matches
      .map(s => s.replace('分公司', ''))
      .filter((v, i, a) => a.indexOf(v) === i)
      .join('、');
  }
  const cityMatch = source.match(/^([\u4e00-\u9fa5]{2,7})[:：]/);
  if (cityMatch) return cityMatch[1];
  return '';
}

function inferListed(code) {
  const first = (code || '')[0];
  return first === 'T' ? '非上市' : '上市';
}

function inferIsRnd(code) {
  const first = (code || '')[0];
  return first === 'R' ? '研发' : '非研发';
}

// 项目编码映射表（基于样表归纳，可扩展）
const CATEGORY_MAP = {
  'CA': '业务网',
  'CB': '支撑网',
  'AB': '移动通信网-核心网',
  'BB': '传输网',
};

const PROJECT_SET_MAP = {
  'CA3': '移动云',
  'CA4': '移动云',
  'CA6': '互联网业务系统',
  'CA7': '互联网业务系统',
  'CAB': '信息安全系统',
  'CA8': 'IDC系统',
  'CB0': 'IT云',
  'CBJ': '大数据',
  'CBF': '业务支撑系统',
  'CBD': '网管系统',
  'CBC': '业务支撑系统',
  'ABB': '虚拟化设备',
  'ABA': '虚拟化设备',
  'ABF': '边缘计算',
  'BBB': '数据承载网/IP专用承载网',
  'BBA': '数据承载网',
};

const PROJECT_SUBSET_MAP = {
  'CA30': '服务器算力',
  'CA40': '智算中心',
  'CA60': 'DPI及日志留存系统',
  'CA62': 'DPI及日志留存系统',
  'CA70': '其它业务系统',
  'CA71': '其它业务系统',
  'CAB0': '信息安全系统',
  'CB00': 'IT云',
  'CBJ0': '大数据应用',
  'CBF0': '其它业务支撑系统',
  'CBD0': '网管系统',
  'CBCF': '业务支撑系统',
  'AB00': '4/5G融合核心网',
  'ABA0': '4/5G融合核心网',
  'ABF0': '5G专网及边缘计算',
  'ABF2': '5G专网及边缘计算',
  'BBB0': 'IP专用承载网省内延伸',
  'BBB3': 'IP专用承载网省内延伸',
  'BBA0': '省际网',
};

function getCodePrefix(code) {
  if (!code || code.length < 11) return '';
  // 形如 B24302310CA3001，字母段从第 10 位开始（0-indexed 为 9）
  return code.slice(9);
}

function inferCategory(code) {
  const prefix = getCodePrefix(code);
  return CATEGORY_MAP[prefix.slice(0, 2)] || '';
}

function inferProjectSet(code) {
  const prefix = getCodePrefix(code);
  // 优先匹配 3 位
  return PROJECT_SET_MAP[prefix.slice(0, 3)]
    || PROJECT_SET_MAP[prefix.slice(0, 2)]
    || '';
}

function inferProjectSubset(code) {
  const prefix = getCodePrefix(code);
  return PROJECT_SUBSET_MAP[prefix.slice(0, 4)]
    || PROJECT_SUBSET_MAP[prefix.slice(0, 3)]
    || PROJECT_SUBSET_MAP[prefix.slice(0, 2)]
    || '';
}

// 用 AI 中的“项目类别”行交叉校验/补全
function extractProjectCategory(text) {
  const patterns = [
    /项目类别\s*为\s*[“""'『]([^”""'』]+)[”""'』]/,
    /项目类别\s*[“""'『]([^”""'』]+)[”""'』]/,
    /项目类别\s*为\s*([^，。；\n（]+)/,
    /项目类别\s*为\s*([^，。；\n]+)/,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) return m[1].replace(/（/g, '-').replace(/）/g, '').trim();
  }
  return '';
}

function applyCategoryCorrection(categoryLine, codeResult) {
  if (!categoryLine) return codeResult;
  const parts = categoryLine.split('-').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return codeResult;

  // 取最后一段去掉“项目集”
  const cleanLast = (s) => s.replace(/项目集$/, '').trim();

  // 如果 AI 中的类别与编码映射冲突，以编码映射为准，但用 AI 补全缺失项
  const result = { ...codeResult };
  if (!result.category && parts[0]) {
    // 旧批文可能把业务支撑网写成业务网/支撑网的前置，这里不直接用第一段
    const first = parts[0];
    if (first === '业务支撑网') {
      // 根据编码判断
    } else {
      result.category = first;
    }
  }
  if (!result.project_set && parts[1]) result.project_set = parts[1];
  if (!result.project_subset && parts[2]) result.project_subset = cleanLast(parts[2]);
  return result;
}

function extractDocNumber(text) {
  const patterns = [
    /江苏立项批复\[[0-9]{4}\]\s*[0-9]+\s*号/,
    /计划通〔[0-9]{4}〕\s*[0-9]+\s*号/,
    /苏移呈\s*（\s*[0-9]+\s*）\s*号/,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) return m[0].trim();
  }
  return '';
}

function extract(text) {
  const normalized = normalizeText(text);

  const code = extractProjectCode(normalized);
  const name = extractProjectName(normalized);
  const approvalDate = extractChineseDate(normalized);
  const amount = extractInvestment(normalized);
  const projectManager = extractProjectManager(normalized);
  const planningManager = extractPlanningManager(normalized);
  // 主送单位识别需要保留原始换行，因此使用未 normalized 的 text
  const recipient = extractRecipient(text);
  const responsibilities = extractResponsibilities(normalized, recipient);
  const decisionMethod = inferDecisionMethod(normalized);
  const constructionUnit = extractConstructionUnit(normalized);
  const buildLevel = inferBuildLevel(constructionUnit, recipient);
  const region = inferRegion(recipient, constructionUnit);
  const docNumber = extractDocNumber(normalized);
  const categoryLine = extractProjectCategory(normalized);

  let result = {
    extracted_text: text,
    doc_number: docNumber,
    project_code: code,
    project_name: name,
    approval_date: approvalDate,
    approval_amount: amount,
    project_manager: projectManager,
    planning_manager: planningManager,
    investment_dept: responsibilities.investment_dept,
    investment_person: responsibilities.investment_person,
    engineering_dept: responsibilities.engineering_dept,
    engineering_person: responsibilities.engineering_person,
    software_dept: responsibilities.software_dept,
    software_person: responsibilities.software_person,
    maintenance_dept: responsibilities.maintenance_dept,
    maintenance_person: responsibilities.maintenance_person,
    procurement_dept: responsibilities.procurement_dept,
    procurement_person: responsibilities.procurement_person,
    decision_method: decisionMethod,
    build_level: buildLevel,
    region: region,
    category: inferCategory(code),
    project_set: inferProjectSet(code),
    project_subset: inferProjectSubset(code),
    is_rnd: inferIsRnd(code),
    listed: inferListed(code),
    // 以下字段无法从立项批复正文稳定提取，默认空
    design_date: '',
    completion_date: '',
    change_status: '',
    mid_year_budget: '',
    budget_increase: '',
    undecided_supplement: '',
    decided_budget: '',
    decided_in_project: '',
    undecided_in_project: '',
    remarks: '',
    estimated_actual: null,
    releasable_amount: null,
    design_amount: null,
    completion_amount: null,
    amount_note: '',
  };

  result = applyCategoryCorrection(categoryLine, result);

  // 金额备注处理：如果金额为 0 或空但正文有投资，记录原值
  if (amount && (!result.approval_amount || result.approval_amount === 0)) {
    result.amount_note = `原${amount}`;
  }

  return result;
}

module.exports = {
  extract,
  extractProjectCode,
  extractProjectName,
  extractChineseDate,
  extractInvestment,
};
