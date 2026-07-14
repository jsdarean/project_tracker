require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const xlsx = require('xlsx');
const { exec } = require('child_process');
const { query, initDatabase, projectColumns, setDbConfig, getDbConfig } = require('./db');
const { extract } = require('./extractor');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 本地归档设置文件
const SETTINGS_FILE = path.join(__dirname, 'settings.json');

async function loadSettings() {
  const dbCfg = getDbConfig();
  const defaults = {
    archive_folder: '',
    download_dir: path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads'),
    db_host: dbCfg.host,
    db_port: dbCfg.port,
    db_user: dbCfg.user,
    db_password: dbCfg.password,
    db_name: dbCfg.database,
  };
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
    return { ...defaults, ...JSON.parse(raw) };
  } catch (err) {
    return defaults;
  }
}

async function saveSettings(settings) {
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

// 字段 -> 中文注释映射
const COMMENT_MAP = {};
for (const def of projectColumns) {
  const nameMatch = def.match(/^`([^`]+)`/);
  const commentMatch = def.match(/COMMENT\s+'([^']*)'/);
  if (nameMatch && commentMatch) {
    COMMENT_MAP[nameMatch[1]] = commentMatch[1];
  }
}

// 请求日志
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${new Date().toISOString()} ${req.method} ${req.url} ${res.statusCode} ${duration}ms ${req.ip || ''}`);
  });
  next();
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 获取归档设置
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await loadSettings();
    res.json({ success: true, data: settings });
  } catch (err) {
    console.error('读取设置失败:', err);
    res.status(500).json({ error: '读取设置失败', message: err.message });
  }
});

// 保存归档与数据库设置
app.post('/api/settings', async (req, res) => {
  try {
    const body = req.body || {};
    const folder = String(body.archive_folder || '').trim();
    const dldir = String(body.download_dir || '').trim();
    const dbHost = String(body.db_host || '').trim() || 'localhost';
    const dbPort = Number(body.db_port) || 3306;
    const dbUser = String(body.db_user || '').trim() || 'root';
    const dbPassword = String(body.db_password || '');
    const dbName = String(body.db_name || '').trim() || 'project_tracker';

    if (!folder) {
      return res.status(400).json({ error: '请填写归档文件夹路径' });
    }
    if (!dldir) {
      return res.status(400).json({ error: '请填写浏览器默认下载目录' });
    }

    // 检查下载目录是否存在
    try {
      await fs.access(dldir);
    } catch (e) {
      return res.status(400).json({ error: '浏览器默认下载目录不存在或无法访问', path: dldir });
    }

    // 归档文件夹不存在则自动创建
    await fs.mkdir(folder, { recursive: true });

    // 先测试数据库连接再保存
    const testConfig = {
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
    };
    let dbTest;
    try {
      dbTest = await require('mysql2/promise').createConnection(testConfig);
      await dbTest.execute('SELECT 1');
      await dbTest.changeUser({ database: dbName });
      await dbTest.end();
    } catch (dbErr) {
      if (dbTest) {
        try { await dbTest.end(); } catch (e) {}
      }
      return res.status(400).json({ error: '数据库连接测试失败：' + dbErr.message });
    }

    const settings = {
      archive_folder: folder,
      download_dir: dldir,
      db_host: dbHost,
      db_port: dbPort,
      db_user: dbUser,
      db_password: dbPassword,
      db_name: dbName,
    };
    await saveSettings(settings);

    // 立即应用数据库配置
    setDbConfig({
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      database: dbName,
    });

    res.json({ success: true, data: settings });
  } catch (err) {
    console.error('保存设置失败:', err);
    res.status(500).json({ error: '保存设置失败', message: err.message });
  }
});

// 测试数据库连通性（不保存）
app.post('/api/db/test', async (req, res) => {
  try {
    const body = req.body || {};
    const testConfig = {
      host: String(body.db_host || '').trim() || 'localhost',
      port: Number(body.db_port) || 3306,
      user: String(body.db_user || '').trim() || 'root',
      password: String(body.db_password || ''),
      database: String(body.db_name || '').trim() || 'project_tracker',
    };

    const connection = await require('mysql2/promise').createConnection({
      host: testConfig.host,
      port: testConfig.port,
      user: testConfig.user,
      password: testConfig.password,
    });
    await connection.execute('SELECT 1');
    await connection.changeUser({ database: testConfig.database });
    await connection.end();
    res.json({ success: true, message: '数据库连接正常' });
  } catch (err) {
    console.error('数据库连通性测试失败:', err);
    res.status(400).json({ success: false, error: '数据库连接失败：' + err.message });
  }
});

// 打开项目对应的本地文件夹
app.post('/api/open-folder', async (req, res) => {
  try {
    const { project_code, project_name } = req.body || {};
    if (!project_code) {
      return res.status(400).json({ error: '缺少 project_code' });
    }

    const settings = await loadSettings();
    if (!settings.archive_folder) {
      return res.status(400).json({ error: '未配置归档文件夹' });
    }

    const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
    const subFolder = project_name ? `${safeName(project_code)}-${safeName(project_name)}` : safeName(project_code);
    const targetDir = path.resolve(settings.archive_folder, subFolder);

    if (!fsSync.existsSync(targetDir)) {
      return res.status(404).json({ error: '项目文件夹不存在', path: targetDir });
    }

    // Windows 使用 start 命令打开文件夹，尝试获取焦点并最大化显示
    const escapedDir = targetDir.replace(/"/g, '""');
    const cmd = `cmd /c start "" /max "${escapedDir}"`;
    exec(cmd, (err) => {
      if (err) {
        console.error('打开文件夹失败:', err);
      }
    });

    res.json({ success: true, path: targetDir });
  } catch (err) {
    console.error('打开文件夹失败:', err);
    res.status(500).json({ error: '打开文件夹失败', message: err.message });
  }
});

// 整理下载的立项批复文件：移动/重命名并生成字段 Excel
app.post('/api/organize-download', async (req, res) => {
  try {
    const { project_code, project_name, source_relative_path, fields } = req.body || {};
    if (!project_code) {
      return res.status(400).json({ error: '缺少 project_code' });
    }
    if (!source_relative_path) {
      return res.status(400).json({ error: '缺少 source_relative_path' });
    }

    const settings = await loadSettings();
    console.log('[organize] 当前设置:', settings);
    if (!settings.archive_folder) {
      return res.status(400).json({ error: '未配置归档文件夹，请先在网页设置' });
    }

    // Chrome downloads API 返回的 filename 可能是相对路径，也可能是绝对路径
    const sourceAbsolute = path.isAbsolute(source_relative_path)
      ? path.resolve(source_relative_path)
      : path.resolve(settings.download_dir, source_relative_path);
    console.log('[organize] 源文件绝对路径:', sourceAbsolute);

    try {
      await fs.access(sourceAbsolute);
    } catch (e) {
      return res.status(400).json({ error: '下载源文件不存在或无法访问', path: sourceAbsolute });
    }

    // 用于文件夹/文件名的安全名称
    function safeName(s) {
      return String(s || '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim();
    }

    const safeCode = safeName(project_code);
    const safeName2 = safeName(project_name);
    const subFolderName = safeName2 ? `${safeCode}-${safeName2}` : safeCode;
    const targetDir = path.resolve(settings.archive_folder, subFolderName);
    await fs.mkdir(targetDir, { recursive: true });

    const ext = path.extname(source_relative_path) || '.doc';
    const docFileName = safeName2
      ? `${safeCode}-${safeName2}-立项批复（发文）${ext}`
      : `${safeCode}-立项批复（发文）${ext}`;
    const targetDocPath = path.join(targetDir, docFileName);

    // 如果目标已存在则先删除
    try {
      await fs.unlink(targetDocPath);
    } catch (e) {
      // ignore
    }

    // 文件可能被浏览器短暂锁定，重试几次；跨磁盘时 copy+unlink
    let moveError = null;
    for (let i = 0; i < 5; i++) {
      try {
        await fs.rename(sourceAbsolute, targetDocPath);
        moveError = null;
        break;
      } catch (e) {
        moveError = e;
        console.log(`[organize] 移动文件失败，第 ${i + 1} 次重试:`, e.message);
        if (e.code === 'EXDEV') {
          // 跨磁盘，改用复制
          try {
            await fs.copyFile(sourceAbsolute, targetDocPath);
            await fs.unlink(sourceAbsolute);
            moveError = null;
            break;
          } catch (copyErr) {
            moveError = copyErr;
            console.log('[organize] 复制文件失败:', copyErr.message);
          }
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }
    if (moveError) throw moveError;

    // 生成字段 Excel
    const excelFileName = safeName2
      ? `${safeCode}-${safeName2}-立项批复（发文）.xlsx`
      : `${safeCode}-立项批复（发文）.xlsx`;
    const excelPath = path.join(targetDir, excelFileName);

    // 字段顺序以 projectColumns 为准，排除系统字段
    const excludeFields = new Set(['id', 'created_at', 'updated_at']);
    const orderedFields = projectColumns
      .map(def => {
        const m = def.match(/^`([^`]+)`/);
        return m ? m[1] : '';
      })
      .filter(f => f && !excludeFields.has(f));

    const headers = orderedFields.map(f => COMMENT_MAP[f] || f);
    const dataRow = orderedFields.map(f => {
      const v = fields && fields[f];
      if (v === undefined || v === null) return '';
      return v;
    });

    const ws = xlsx.utils.aoa_to_sheet([headers, dataRow]);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, '项目信息');
    xlsx.writeFile(wb, excelPath);

    res.json({
      success: true,
      target_dir: targetDir,
      doc_file: targetDocPath,
      excel_file: excelPath
    });
  } catch (err) {
    console.error('整理归档文件失败:', err);
    res.status(500).json({ error: '整理归档文件失败', message: err.message });
  }
});

// 获取 projects 表字段及中文注释（用于展示网页表头）
app.get('/api/projects/columns', async (req, res) => {
  try {
    const rows = await query('SHOW FULL COLUMNS FROM projects');
    const data = rows.map(r => ({
      field: r.Field,
      comment: r.Comment || r.Field,
      type: r.Type,
    }));
    res.json({ success: true, data });
  } catch (err) {
    console.error('获取字段注释失败:', err);
    res.status(500).json({ error: '获取字段注释失败', message: err.message });
  }
});

// 提取字段（不保存）
app.post('/api/extract', (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: '缺少 text 参数' });
  }
  try {
    const result = extract(text);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('提取失败:', err);
    res.status(500).json({ error: '提取失败', message: err.message });
  }
});

// 检查项目编码是否已存在
app.get('/api/projects/check', async (req, res) => {
  try {
    const { project_code } = req.query;
    if (!project_code) {
      return res.status(400).json({ error: '缺少 project_code 参数' });
    }
    const rows = await query('SELECT id, project_name, doc_number FROM projects WHERE project_code = ? LIMIT 1', [project_code]);
    if (rows.length > 0) {
      res.json({ success: true, exists: true, data: rows[0] });
    } else {
      res.json({ success: true, exists: false, data: null });
    }
  } catch (err) {
    console.error('检查项目编码失败:', err);
    res.status(500).json({ error: '检查失败', message: err.message });
  }
});

// 创建项目
app.post('/api/projects', async (req, res) => {
  try {
    const data = req.body;
    const fields = [
      'source_url', 'extracted_text', 'doc_number', 'category', 'project_code', 'project_name',
      'approval_date', 'design_date', 'completion_date', 'project_set', 'project_subset',
      'project_manager', 'planning_manager',
      'investment_dept', 'investment_person', 'engineering_dept', 'engineering_person',
      'software_dept', 'software_person', 'maintenance_dept', 'maintenance_person',
      'procurement_dept', 'procurement_person',
      'approval_amount', 'amount_note', 'change_status',
      'mid_year_budget', 'budget_increase', 'undecided_supplement', 'decided_budget',
      'decided_in_project', 'undecided_in_project', 'remarks', 'estimated_actual',
      'releasable_amount', 'design_amount', 'completion_amount', 'build_level', 'listed',
      'region', 'is_rnd', 'decision_method', 'status'
    ];
    const placeholders = fields.map(() => '?').join(',');
    const values = fields.map(f => {
      if (data[f] === undefined || data[f] === '') return null;
      // 数字字段空字符串转 null
      if (['approval_amount', 'estimated_actual', 'releasable_amount', 'design_amount', 'completion_amount'].includes(f)) {
        const n = parseFloat(data[f]);
        return isNaN(n) ? null : n;
      }
      return data[f];
    });

    const sql = `INSERT INTO projects (${fields.map(f => `\`${f}\``).join(',')}) VALUES (${placeholders})`;
    const result = await query(sql, values);
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('保存失败:', err);
    res.status(500).json({ error: '保存失败', message: err.message });
  }
});

// 列表查询
app.get('/api/projects', async (req, res) => {
  try {
    const { status, keyword } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const size = Math.max(1, Math.min(100, parseInt(req.query.pageSize, 10) || 20));
    const offset = (page - 1) * size;

    let sql = 'SELECT * FROM projects WHERE 1=1';
    const params = [];
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (keyword) {
      sql += ' AND (project_name LIKE ? OR project_code LIKE ? OR doc_number LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    // LIMIT/OFFSET 直接拼入 SQL，避免部分 MySQL 版本对占位符的支持问题
    sql += ` ORDER BY id DESC LIMIT ${size} OFFSET ${offset}`;

    const rows = await query(sql, params);

    let countSql = 'SELECT COUNT(*) AS total FROM projects WHERE 1=1';
    const countParams = [];
    if (status) {
      countSql += ' AND status = ?';
      countParams.push(status);
    }
    if (keyword) {
      countSql += ' AND (project_name LIKE ? OR project_code LIKE ? OR doc_number LIKE ?)';
      countParams.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    const [countRow] = await query(countSql, countParams);

    res.json({ success: true, data: rows, total: countRow.total });
  } catch (err) {
    console.error('查询失败:', err);
    res.status(500).json({ error: '查询失败', message: err.message });
  }
});

// 单条查询
app.get('/api/projects/:id', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: '记录不存在' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ error: '查询失败', message: err.message });
  }
});

// 更新
app.put('/api/projects/:id', async (req, res) => {
  try {
    const data = req.body;
    const fields = [
      'source_url', 'extracted_text', 'doc_number', 'category', 'project_code', 'project_name',
      'approval_date', 'design_date', 'completion_date', 'project_set', 'project_subset',
      'project_manager', 'planning_manager',
      'investment_dept', 'investment_person', 'engineering_dept', 'engineering_person',
      'software_dept', 'software_person', 'maintenance_dept', 'maintenance_person',
      'procurement_dept', 'procurement_person',
      'approval_amount', 'amount_note', 'change_status',
      'mid_year_budget', 'budget_increase', 'undecided_supplement', 'decided_budget',
      'decided_in_project', 'undecided_in_project', 'remarks', 'estimated_actual',
      'releasable_amount', 'design_amount', 'completion_amount', 'build_level', 'listed',
      'region', 'is_rnd', 'decision_method', 'status'
    ];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      if (data[f] !== undefined) {
        updates.push(`\`${f}\` = ?`);
        if (['approval_amount', 'estimated_actual', 'releasable_amount', 'design_amount', 'completion_amount'].includes(f)) {
          const n = parseFloat(data[f]);
          values.push(isNaN(n) ? null : n);
        } else {
          values.push(data[f] === '' ? null : data[f]);
        }
      }
    });
    if (updates.length === 0) return res.status(400).json({ error: '没有可更新字段' });
    values.push(req.params.id);
    const sql = `UPDATE projects SET ${updates.join(',')} WHERE id = ?`;
    await query(sql, values);
    res.json({ success: true });
  } catch (err) {
    console.error('更新失败:', err);
    res.status(500).json({ error: '更新失败', message: err.message });
  }
});

// 删除
app.delete('/api/projects/:id', async (req, res) => {
  try {
    await query('DELETE FROM projects WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '删除失败', message: err.message });
  }
});

async function start() {
  // 加载本地设置并应用数据库配置（覆盖环境变量默认值）
  try {
    const settings = await loadSettings();
    if (settings.db_host) {
      setDbConfig({
        host: settings.db_host,
        port: Number(settings.db_port) || 3306,
        user: settings.db_user,
        password: settings.db_password,
        database: settings.db_name,
      });
    }
  } catch (err) {
    console.warn('加载本地设置失败，使用环境变量默认配置:', err.message);
  }

  await initDatabase();
  app.listen(PORT, () => {
    console.log(`项目信息提取后端已启动: http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
