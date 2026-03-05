const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function main() {
  // Get column names
  const cols = await p.query("SELECT column_name FROM information_schema.columns WHERE table_name='bot_messages'");
  console.log('COLS:', cols.rows.map(r => r.column_name).join(', '));
  await p.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
