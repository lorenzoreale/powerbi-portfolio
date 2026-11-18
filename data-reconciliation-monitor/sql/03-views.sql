-- The reporting views: the only objects the semantic model reads from the database.
CREATE VIEW rpt.Feed AS
SELECT
    feed_code      AS [Feed Code],
    data_area      AS [Data Area],
    feed_name      AS [Feed],
    source_system  AS [Source System],
    feeds_into     AS [Feeds Into],
    record_name    AS [Record Name],
    schedule       AS [Schedule],
    owner          AS [Owner],
    has_value      AS [Has Value],
    files_expected AS [Files Expected],
    sort_order     AS [Sort Order]
FROM mon.Feed;
GO

CREATE VIEW rpt.[Rule] AS
SELECT
    rule_id           AS [Rule Id],
    feed_code         AS [Feed Code],
    rule_name         AS [Rule],
    quality_dimension AS [Quality Dimension],
    unit              AS [Unit],
    is_load_check     AS [Is Load Check],
    CASE WHEN is_load_check = 1 THEN 'Load check' ELSE 'Quality rule' END AS [Check Type],
    warn_above_pct    AS [Warn Above %],
    fail_above_pct    AS [Fail Above %],
    warn_late_mins    AS [Warn Late Mins],
    fail_late_mins    AS [Fail Late Mins],
    CASE
        WHEN unit = 'files' THEN 'Late warns, missing or ' + CAST(fail_late_mins AS VARCHAR(4)) + ' min late fails'
        WHEN warn_above_pct = 0 THEN 'Any warns, over ' + FORMAT(fail_above_pct, '0.##') + '% fails'
        ELSE 'Over ' + FORMAT(warn_above_pct, '0.##') + '% warns, over ' + FORMAT(fail_above_pct, '0.##') + '% fails'
    END               AS [Limit],
    active_from       AS [Active From],
    NULLIF(failing_record, '') AS [Failing Record]
FROM mon.[Rule];
GO

CREATE VIEW rpt.Night AS
SELECT
    n.run_date AS [Date],
    FORMAT(n.run_date, 'ddd d MMM yyyy', 'en-GB') AS [Load],
    CAST(DAY(n.run_date) AS VARCHAR(2))           AS [Night Label],
    DATEDIFF(DAY, n.run_date, MAX(n.run_date) OVER ()) AS [Nights Back]
FROM (SELECT DISTINCT run_date FROM mon.FeedRun) AS n;
GO

-- DepotTrack writes its arrival times three ways; they are read as times to the minute.
CREATE VIEW rpt.FeedRun AS
SELECT
    r.run_date        AS [Date],
    r.feed_code       AS [Feed Code],
    r.source_rows     AS [Source Rows],
    r.warehouse_rows  AS [Warehouse Rows],
    CASE WHEN f.has_value = 1 THEN r.source_value END    AS [Source Value],
    CASE WHEN f.has_value = 1 THEN r.warehouse_value END AS [Warehouse Value],
    r.files_expected  AS [Files Expected],
    r.files_received  AS [Files Received],
    TIMEFROMPARTS(DATEPART(HOUR, a.arrival), DATEPART(MINUTE, a.arrival), 0, 0, 0) AS [Arrival Time],
    CAST(CASE WHEN r.arrival_time LIKE '[0-2][0-9]:[0-5][0-9]' THEN 0 ELSE 1 END AS BIT) AS [Arrival Reformatted]
FROM mon.FeedRun AS r
JOIN mon.Feed AS f ON f.feed_code = r.feed_code
CROSS APPLY (SELECT TRY_CONVERT(TIME(0), r.arrival_time) AS arrival) AS a;
GO

-- A rerun writes a second set of results for the same night; the latest run is kept.
CREATE VIEW rpt.CheckResult AS
WITH numbered AS (
    SELECT
        *,
        ROW_NUMBER() OVER (PARTITION BY run_date, rule_id ORDER BY run_seq DESC) AS run_rank,
        COUNT(*) OVER (PARTITION BY run_date, rule_id) AS runs
    FROM mon.CheckResult
)
SELECT
    run_date      AS [Date],
    rule_id       AS [Rule Id],
    feed_code     AS [Feed Code],
    units_checked AS [Checked],
    units_failed  AS [Failed],
    minutes_late  AS [Late Mins],
    runs          AS [Runs]
FROM numbered
WHERE run_rank = 1;
GO
