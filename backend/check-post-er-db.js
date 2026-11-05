const pool = require('./db');

(async () => {
    try {
        const db = await pool.query(
            'SELECT current_database() AS database'
        );

        console.log('\nCONNECTED DATABASE:');
        console.table(db.rows);

        const tables = [
            'patients',
            'ed_stays',
            'diagnoses',
            'observations',
            'medications',
            'discharges',
            'prescriptions',
            'follow_ups',
            'emergency_cases'
        ];

        console.log('\nEXISTING RECORD COUNTS:');

        for (const table of tables) {
            const result = await pool.query(
                `SELECT COUNT(*) AS total FROM public."${table}"`
            );

            console.log(`${table}: ${result.rows[0].total}`);
        }

    } catch (error) {
        console.error('DATABASE ERROR:', error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
