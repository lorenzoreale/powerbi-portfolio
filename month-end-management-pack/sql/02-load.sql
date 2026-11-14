-- Loads the CSV files in $(DataPath) into the erp and ts tables.
BULK INSERT erp.Entity      FROM '$(DataPath)\entities.csv'      WITH (FORMAT = 'CSV', FIRSTROW = 2, CODEPAGE = '65001', ROWTERMINATOR = '0x0a');
BULK INSERT erp.ServiceLine FROM '$(DataPath)\service_lines.csv' WITH (FORMAT = 'CSV', FIRSTROW = 2, CODEPAGE = '65001', ROWTERMINATOR = '0x0a');
BULK INSERT erp.Account     FROM '$(DataPath)\accounts.csv'      WITH (FORMAT = 'CSV', FIRSTROW = 2, CODEPAGE = '65001', ROWTERMINATOR = '0x0a');
BULK INSERT erp.Client      FROM '$(DataPath)\clients.csv'       WITH (FORMAT = 'CSV', FIRSTROW = 2, CODEPAGE = '65001', ROWTERMINATOR = '0x0a');
BULK INSERT erp.JournalLine FROM '$(DataPath)\journal_lines.csv' WITH (FORMAT = 'CSV', FIRSTROW = 2, CODEPAGE = '65001', ROWTERMINATOR = '0x0a');
BULK INSERT erp.TrialBalance FROM '$(DataPath)\trial_balance.csv' WITH (FORMAT = 'CSV', FIRSTROW = 2, CODEPAGE = '65001', ROWTERMINATOR = '0x0a');
BULK INSERT ts.Hours        FROM '$(DataPath)\hours.csv'         WITH (FORMAT = 'CSV', FIRSTROW = 2, CODEPAGE = '65001', ROWTERMINATOR = '0x0a');
