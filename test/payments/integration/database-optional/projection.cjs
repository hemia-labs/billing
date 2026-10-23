// Product-owned example: the SDK itself does not depend on either driver or schema.
async function projection(engine, port) {
  const options = { host: '127.0.0.1', port, user: engine === 'postgres' ? 'postgres' : 'root', password: 'optional-fixture-only', database: 'payments_optional_test' };
  const pool = engine === 'postgres' ? new (require('pg').Pool)(options) : require('mysql2/promise').createPool(options);
  async function withConnection(work) {
    const connection = engine === 'postgres' ? await pool.connect() : await pool.getConnection();
    const query = async (sql, params = []) => engine === 'postgres' ? (await connection.query(sql, params)).rows : (await connection.query(sql, params))[0];
    try { return await work(query); } finally { connection.release(); }
  }
  await withConnection(q => q(`CREATE TABLE IF NOT EXISTS product_payment_copy (organization_id varchar(36) NOT NULL,product_code varchar(80) NOT NULL,revision decimal(65,0) NOT NULL DEFAULT 0,snapshot ${engine === 'postgres' ? 'jsonb' : 'json'} NULL,PRIMARY KEY(organization_id,product_code))`));
  const placeholders = engine === 'postgres' ? ['$1', '$2', '$3', '$4'] : ['?', '?', '?', '?'];
  return {
    async apply(snapshot) {
      return withConnection(async q => {
        await q('BEGIN');
        try {
          const key = [snapshot.organizationId, snapshot.productCode];
          await q(`INSERT INTO product_payment_copy(organization_id,product_code,revision) VALUES(${placeholders[0]},${placeholders[1]},0) ${engine === 'postgres' ? 'ON CONFLICT DO NOTHING' : 'ON DUPLICATE KEY UPDATE revision=revision'}`, key);
          const [saved] = await q(`SELECT revision FROM product_payment_copy WHERE organization_id=${placeholders[0]} AND product_code=${placeholders[1]} FOR UPDATE`, key);
          const applied = BigInt(snapshot.revision) > BigInt(saved.revision);
          if (applied) await q(`UPDATE product_payment_copy SET revision=${placeholders[0]},snapshot=${placeholders[1]} WHERE organization_id=${placeholders[2]} AND product_code=${placeholders[3]}`, [snapshot.revision, JSON.stringify(snapshot), ...key]);
          await q('COMMIT');
          return { applied };
        } catch (error) { await q('ROLLBACK'); throw error; }
      });
    },
    async read(org, product) {
      const [row] = await withConnection(q => q(`SELECT snapshot FROM product_payment_copy WHERE organization_id=${placeholders[0]} AND product_code=${placeholders[1]}`, [org, product]));
      return typeof row?.snapshot === 'string' ? JSON.parse(row.snapshot) : row?.snapshot;
    },
    close: () => pool.end(),
  };
}
module.exports = { projection };
