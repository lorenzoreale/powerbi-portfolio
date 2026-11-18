-- The monitoring tables written by the nightly load (mon), and the reporting schema (rpt).
CREATE SCHEMA mon;
GO
CREATE SCHEMA rpt;
GO

CREATE TABLE mon.Feed (
    feed_code         VARCHAR(4)     NOT NULL PRIMARY KEY,
    data_area         VARCHAR(30)    NOT NULL,
    feed_name         VARCHAR(40)    NOT NULL,
    source_system     VARCHAR(30)    NOT NULL,
    feeds_into        VARCHAR(60)    NOT NULL,
    record_name       VARCHAR(20)    NOT NULL,
    schedule          VARCHAR(20)    NOT NULL,
    owner             VARCHAR(30)    NOT NULL,
    has_value         BIT            NOT NULL,
    files_expected    TINYINT        NOT NULL,
    sort_order        TINYINT        NOT NULL
);

CREATE TABLE mon.[Rule] (
    rule_id           VARCHAR(5)     NOT NULL PRIMARY KEY,
    feed_code         VARCHAR(4)     NOT NULL REFERENCES mon.Feed (feed_code),
    rule_name         VARCHAR(60)    NOT NULL,
    quality_dimension VARCHAR(20)    NOT NULL,
    unit              VARCHAR(10)    NOT NULL,
    is_load_check     BIT            NOT NULL,
    warn_above_pct    DECIMAL(6, 2)  NULL,
    fail_above_pct    DECIMAL(6, 2)  NULL,
    warn_late_mins    SMALLINT       NULL,
    fail_late_mins    SMALLINT       NULL,
    active_from       DATE           NULL,
    failing_record    VARCHAR(60)    NULL
);

CREATE TABLE mon.FeedRun (
    run_date          DATE           NOT NULL,
    feed_code         VARCHAR(4)     NOT NULL REFERENCES mon.Feed (feed_code),
    source_rows       BIGINT         NOT NULL,
    warehouse_rows    BIGINT         NOT NULL,
    source_value      DECIMAL(14, 2) NULL,
    warehouse_value   DECIMAL(14, 2) NULL,
    files_expected    TINYINT        NOT NULL,
    files_received    TINYINT        NOT NULL,
    arrival_time      VARCHAR(8)     NOT NULL,
    PRIMARY KEY (run_date, feed_code)
);

CREATE TABLE mon.CheckResult (
    run_date          DATE           NOT NULL,
    rule_id           VARCHAR(5)     NOT NULL REFERENCES mon.[Rule] (rule_id),
    feed_code         VARCHAR(4)     NOT NULL REFERENCES mon.Feed (feed_code),
    run_seq           TINYINT        NOT NULL,
    units_checked     BIGINT         NOT NULL,
    units_failed      BIGINT         NOT NULL,
    minutes_late      SMALLINT       NULL,
    PRIMARY KEY (run_date, rule_id, run_seq)
);
