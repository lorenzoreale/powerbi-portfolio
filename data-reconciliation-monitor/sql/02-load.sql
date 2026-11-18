-- Loads the CSV files in $(DataPath) into the mon tables.
BULK INSERT mon.Feed        FROM '$(DataPath)\feed.csv'         WITH (FORMAT = 'CSV', FIRSTROW = 2, CODEPAGE = '65001', ROWTERMINATOR = '0x0a');
BULK INSERT mon.[Rule]      FROM '$(DataPath)\rule.csv'         WITH (FORMAT = 'CSV', FIRSTROW = 2, CODEPAGE = '65001', ROWTERMINATOR = '0x0a');
BULK INSERT mon.FeedRun     FROM '$(DataPath)\feed_run.csv'     WITH (FORMAT = 'CSV', FIRSTROW = 2, CODEPAGE = '65001', ROWTERMINATOR = '0x0a');
BULK INSERT mon.CheckResult FROM '$(DataPath)\check_result.csv' WITH (FORMAT = 'CSV', FIRSTROW = 2, CODEPAGE = '65001', ROWTERMINATOR = '0x0a');
