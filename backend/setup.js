/**
 * 交互式配置助手：生成 .env 并初始化数据库
 * 运行：node setup.js
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { initDatabase } = require('./db');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question, defaultValue = '') {
  return new Promise(resolve => {
    rl.question(`${question}${defaultValue ? ` (${defaultValue})` : ''}: `, answer => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

async function main() {
  console.log('=== 项目信息一键提取 - 后端配置助手 ===\n');

  const port = await ask('后端端口', '3000');
  const host = await ask('MySQL 主机', 'localhost');
  const dbPort = await ask('MySQL 端口', '3306');
  const user = await ask('MySQL 用户名', 'root');
  const password = await ask('MySQL 密码');
  const dbName = await ask('数据库名', 'project_tracker');

  const envContent = `PORT=${port}
DB_HOST=${host}
DB_PORT=${dbPort}
DB_USER=${user}
DB_PASSWORD=${password}
DB_NAME=${dbName}
`;

  const envPath = path.join(__dirname, '.env');
  fs.writeFileSync(envPath, envContent, 'utf-8');
  console.log(`\n已生成 ${envPath}`);

  // 重新加载环境变量
  require('dotenv').config({ path: envPath });

  try {
    await initDatabase();
    console.log('\n数据库初始化成功。');
    console.log('现在可以运行: npm start');
  } catch (err) {
    console.error('\n数据库初始化失败:', err.message);
    console.log('请检查 MySQL 服务是否启动，以及账号密码是否正确。');
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
