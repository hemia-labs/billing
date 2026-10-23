// The deployment calls this explicitly, outside application startup.
const { PaymentsSchema1792886400000 } = require('@hemia/payments/nestjs');
async function migrate(dataSource) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await new PaymentsSchema1792886400000().up(runner);
    await runner.commitTransaction();
  } catch (error) {
    await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
  }
}
module.exports = { migrate };
